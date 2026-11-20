'use strict';
// aitell/detect.js — 문서 한 편에서 AI스러운 곳을 모두 찾아 위치·유형·근거로 돌려준다.
// 결정적(모델 호출 0회, 네트워크 0회). 유형 체계와 어휘 사전의 출처는 aitell/NOTICE.md.
//
//   const { detect } = require('./aitell/detect.js');
//   const r = detect(text, { genre: '일반' });   // 장르: '일반' | '보고서' | '논문'
//   r.findings[i] = { id, rule, group, label, severity, strength, start, end, line, col, text, reason, caveat?, source }
//     strength 'strong' = 뚜렷(S1이거나 반복 임계를 넘음) · 'weak' = 참고(임계 미달·실측이 약한 유형)
//     start/end = 원문 문자열의 위치(UTF-16 색인), line/col = 1부터

const path = require('node:path');
const { PHRASE, HUMAN_MARKERS, GROUPS } = require('./rules.js');

const LEXICON = require(path.join(__dirname, 'third_party', 'im-not-ai', 'lexicon.json'));
const GENRES = ['일반', '보고서', '논문'];
const EXCLUDE_WINDOW = 12;          // 정당 용법 제외 창(매치 앞뒤 글자 수) — 사전의 규약
const SEV_WEIGHT = { S1: 5, S2: 2, S3: 0.5 };
const MAX_CHARS = 200000;

const LEX = LEXICON.entries.map((e) => ({
  ...e,
  _re: new RegExp(e.regex_detect || e.regex, 'g'),
  _ex: (e.regex_detect_exclude || (!e.regex_detect && e.regex_exclude)) ? new RegExp(e.regex_detect_exclude || e.regex_exclude) : null,
}));

const QUOTE_RE = /"[^"\n]{1,200}"|“[^”\n]{1,200}”|‘[^’\n]{1,200}’|「[^」\n]{1,200}」|『[^』\n]{1,200}』/g;
const HEADING_RE = /^\s{0,3}#{1,6}\s+\S/;
const BULLET_RE = /^\s*(?:[-*+•·▪◦‣]|\d{1,2}[.)])\s+\S/;
const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;
const OBLIG_RE = /(?:[해아어여]야\s?(?:한다|합니다|할\s?것이다|할\s?것입니다|만\s?한다)|필요가\s?있(?:다|습니다)|필요하다|필요합니다|요구된다|요구됩니다|바람직하다|바람직합니다)[.!]?["'”’)]*$/;
const SCHEMA_HEAD = /^(?:서론|도입|도입부|본론|결론|개요|마무리|맺음말|맺으며|요약|들어가며|들어가기|마치며|나가며|배경|소개)$/;

// 코드 블록은 같은 길이의 공백으로 가려 위치가 어긋나지 않게 한다
function maskCode(text) {
  return text.replace(/```[\s\S]*?(?:```|$)/g, (m) => m.replace(/[^\n]/g, ' ')).replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
}

// 줄 → 블록(문단). 종류: heading | bullet | prose. 빈 줄은 건너뛴다.
function blocksOf(text) {
  const out = []; let pos = 0, lineNo = 0;
  for (const line of text.split('\n')) {
    lineNo++;
    const start = pos; pos += line.length + 1;
    if (!line.trim()) { out.push({ blank: true, line: lineNo }); continue; }
    const lead = line.length - line.trimStart().length;
    const kind = HEADING_RE.test(line) ? 'heading' : BULLET_RE.test(line) ? 'bullet' : 'prose';
    out.push({ kind, start: start + lead, end: start + line.trimEnd().length, text: line.trim(), line: lineNo });
  }
  // 마크다운 표시가 없는 짧은 줄(앞뒤가 비었거나 처음, 끝 문장부호 없음)도 제목으로 본다
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    if (b.blank || b.kind !== 'prose') continue;
    const prevBlank = i === 0 || out[i - 1].blank, nextBlank = i === out.length - 1 || out[i + 1].blank;
    if (b.text.length <= 40 && !/[.!?。…,]$/.test(b.text) && !/[.!?]\s/.test(b.text) && prevBlank && (nextBlank || i === 0) && out.some((x) => !x.blank && x.kind === 'prose' && x.text.length > 60)) b.kind = 'heading';
  }
  return out;
}

function sentencesOf(block) {
  const out = []; const t = block.text;
  const re = /[.!?…。]+["'”’)\]』」]*(?=\s|$)/g;
  let from = 0, m;
  const push = (a, b) => {
    const raw = t.slice(a, b); const lead = raw.length - raw.trimStart().length; const s = raw.trim();
    if (s) out.push({ start: block.start + a + lead, end: block.start + a + lead + s.length, text: s, block });
  };
  while ((m = re.exec(t))) { push(from, m.index + m[0].length); from = m.index + m[0].length; }
  push(from, t.length);
  return out;
}

function lineColFn(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (pos) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, col: pos - starts[lo] + 1 };
  };
}

function endingOf(s) {
  const m = /([가-힣]{2})[.!?…]+["'”’)\]]*$/.exec(s) || /([가-힣])[.!?…]+["'”’)\]]*$/.exec(s);
  return m ? m[1] : '';
}

function detect(input, opts = {}) {
  const original = String(input == null ? '' : input).replace(/\r\n?/g, '\n');
  if (original.length > MAX_CHARS) throw new Error(`문서가 너무 깁니다(${original.length}자). ${MAX_CHARS}자까지 한 번에 봅니다.`);
  const genre = GENRES.includes(opts.genre) ? opts.genre : '일반';
  const text = maskCode(original);
  const lc = lineColFn(original);

  const blocks = blocksOf(text);
  const real = blocks.filter((b) => !b.blank);
  const prose = real.filter((b) => b.kind === 'prose');
  const sents = prose.flatMap(sentencesOf);
  const blockAt = (pos) => real.find((b) => pos >= b.start && pos < b.end + 1);
  const quotes = []; { let m; QUOTE_RE.lastIndex = 0; while ((m = QUOTE_RE.exec(text))) quotes.push([m.index, m.index + m[0].length]); }
  const inQuote = (pos) => quotes.some(([a, b]) => pos > a && pos < b - 1);

  // "문서 3회 이상" 같은 기준은 칼럼 한 편(2,000자 안팎)을 두고 정한 값이다. 긴 문서에서는 길이에 비례해 올린다.
  const scale = Math.max(1, original.replace(/\s/g, '').length / 2000);
  const docMin = (min) => (min <= 1 ? 1 : Math.ceil(min * scale));

  const findings = [];
  const add = (rule, start, end, o) => {
    const { line, col } = lc(start);
    findings.push({
      rule: rule.id, group: rule.id.replace(/-.*$/, ''), label: rule.label, severity: rule.sev || 'S2',
      strength: o.strength, start, end, line, col, text: original.slice(start, end),
      reason: o.reason, ...(rule.caveat ? { caveat: rule.caveat } : {}), ...(o.extra || {}), source: o.source || 'rule',
    });
  };

  // ── 1. 표현 규칙 ──
  for (const rule of PHRASE) {
    const hits = [];
    const scan = (str, base, anchor) => {
      rule.re.lastIndex = 0; let m;
      while ((m = rule.re.exec(str))) {
        if (!m[0]) { rule.re.lastIndex++; continue; }
        const lead = m[0].length - m[0].trimStart().length;
        const s = base + m.index + lead, e = base + m.index + m[0].trimEnd().length;
        const frag = text.slice(s, e);
        if (rule.skip && rule.skip(frag, text.slice(Math.max(0, s - 12), s))) continue;
        if (rule.id !== 'J-2' && rule.id !== 'BOT-1' && inQuote(s)) continue;   // 직접 인용 안은 세지 않는다
        hits.push({ s, e });
        if (anchor) break;
      }
    };
    if (rule.at === 'sentStart' || rule.at === 'sentEnd') for (const st of sents) scan(st.text, st.start, true);
    else for (const b of real) { if (rule.id === 'J-1' && b.kind === 'heading') continue; scan(b.text, b.start, false); }
    if (!hits.length) continue;
    const perPara = new Map();
    for (const h of hits) { const b = blockAt(h.s); h.b = b; perPara.set(b, (perPara.get(b) || 0) + 1); }
    const total = hits.length;
    for (const h of hits) {
      const n = rule.scope === 'para' ? perPara.get(h.b) : total;
      const min = rule.scope === 'para' ? rule.min : docMin(rule.min);
      const met = n >= min;
      const strength = rule.cap === 'weak' ? 'weak' : (met ? 'strong' : 'weak');
      const where = rule.scope === 'para' ? '이 문단' : '문서';
      const count = rule.min > 1 ? ` ${where}에서 ${n}회 — 기준 ${min}회 이상${met ? '을 넘었다' : '에는 못 미친다'}.` : (total > 1 ? ` 문서에서 ${total}회.` : '');
      add(rule, h.s, h.e, { strength, reason: rule.why + count });
    }
  }

  // ── 2. 어색한 낱말 사전(벤치마크 lexicon.json 그대로) ──
  for (const e of LEX) {
    if ((e.skip_genres || []).includes(genre)) continue;
    e._re.lastIndex = 0; let m;
    while ((m = e._re.exec(text))) {
      if (!m[0]) { e._re.lastIndex++; continue; }
      const s = m.index, en = m.index + m[0].length;
      if (e._ex && e._ex.test(text.slice(Math.max(0, s - EXCLUDE_WINDOW), en + EXCLUDE_WINDOW))) continue;
      if (inQuote(s)) continue;
      const when = (e.change_when || {})[genre] || '', keep = (e.keep_when || {})[genre] || '';
      // 사전의 낱말은 같은 표현도 문맥에 따라 멀쩡하다(예: "원고를 붙들다"). 규칙만으로는 "참고"까지만 올리고,
      // 조건에 해당하는지는 읽어서 판단하는 2차 단계(skills/ai-tell-detect)가 정한다.
      const sure = false;
      add({ id: e.id, label: `어색한 낱말 "${e.headword}"`, sev: e.tier === 'change' ? 'S2' : 'S3' }, s, en, {
        strength: sure ? 'strong' : 'weak', source: 'lexicon',
        reason: (e.tier === 'change' ? '독자 평가에서 확실히 어색하다고 판정된 낱말' : '문맥에 따라 어색한 낱말') + (sure ? '. ' : ' — 아래 조건에 해당하는지 문맥 확인이 필요하다. ') + (when ? `해당 조건: ${when}` : ''),
        extra: keep ? { keep_when: keep } : {},
      });
    }
  }
  for (const f of findings) if (f.source === 'lexicon') f.group = 'L';
  const isLex = (f) => f.source === 'lexicon';

  // ── 3. 구조·리듬 규칙 ──
  const S = (id, label, sev, caveat) => ({ id, label, sev, caveat });
  const cnt = (n, min) => ` (${n}회, 기준 ${min}회 이상)`;

  // C-2 연속 불릿 3줄+
  for (let i = 0; i < blocks.length;) {
    if (blocks[i].blank || blocks[i].kind !== 'bullet') { i++; continue; }
    let j = i; while (j < blocks.length && !blocks[j].blank && blocks[j].kind === 'bullet') j++;
    if (j - i >= 3) add(S('C-2', '불릿 리스트 블록', 'S2', '안내문·매뉴얼처럼 목록이 맞는 글이면 문제가 아니다.'), blocks[i].start, blocks[j - 1].end,
      { strength: 'strong', reason: `불릿이 ${j - i}줄 연속된다. 에세이·칼럼·보고서 본문에서 3줄 이상 이어지는 불릿은 AI 서식의 표지다.` });
    i = j;
  }
  // C-3 도식 헤딩 · C-10 콜론 부제 헤딩
  const heads = real.filter((b) => b.kind === 'heading');
  const headText = (b) => b.text.replace(/^#{1,6}\s+/, '').replace(/^\d+[.)]\s*/, '').replace(/\*\*/g, '').trim();
  const schema = heads.filter((b) => SCHEMA_HEAD.test(headText(b)));
  for (const b of schema) add(S('C-3', '도식적 섹션 헤딩', 'S2'), b.start, b.end,
    { strength: schema.length >= 2 ? 'strong' : 'weak', reason: `"서론·본론·결론"식 도식 제목.${cnt(schema.length, 2)}` });
  const colon = heads.filter((b) => /\S\s?[:：]\s\S/.test(headText(b)));
  for (const b of colon) add(S('C-10', '콜론 부제 헤딩 "X: Y"', 'S2'), b.start, b.end,
    { strength: colon.length >= docMin(2) ? 'strong' : 'weak', reason: `제목을 "라벨: 부제"로 짓는 공식.${cnt(colon.length, docMin(2))}` });

  // C-5 이모지
  { let m; EMOJI_RE.lastIndex = 0; const em = []; while ((m = EMOJI_RE.exec(text))) em.push(m);
    for (const x of em) add(S('C-5', '이모지', 'S1'), x.index, x.index + x[0].length,
      { strength: 'strong', reason: `리스트 머리·제목·강조에 박힌 이모지. 문서에서 ${em.length}개.` }); }

  // C-7 문단 머리 "먼저 → 반면 → 결국"
  { const op = prose.map((b) => ({ b, m: /^(먼저|우선|반면|한편|그러나|하지만|결국|결론적으로|따라서)[,\s]/.exec(b.text) })).filter((x) => x.m);
    const a = op.find((x) => /먼저|우선/.test(x.m[1]));
    const b2 = a && op.find((x) => x.b.start > a.b.start && /반면|한편|그러나|하지만/.test(x.m[1]));
    const c = b2 && op.find((x) => x.b.start > b2.b.start && /결국|결론적으로|따라서/.test(x.m[1]));
    if (c) for (const x of [a, b2, c]) add(S('C-7', '문단 머리 "먼저·반면·결국" 3단 공식', 'S2'), x.b.start, x.b.start + x.m[1].length,
      { strength: 'strong', reason: '문단이 차례로 "먼저 → 반면 → 결국"으로 열린다. 기계적 3단 전개.' }); }

  // C-12 쉼표 포함률
  const nS = sents.length;
  const commaS = sents.filter((s) => /,/.test(s.text)).length;
  const commaRate = nS ? commaS / nS : 0;

  // D-11 결말부 막연한 시간지평
  { const tail = text.length * 0.7;
    for (const st of sents) { const m = /^(향후|앞으로(?:는|도)?|중장기적으로|장기적으로|머지않아)[,\s]/.exec(st.text);
      if (m && st.start >= tail) add(S('D-11', '결말부 막연한 시간지평 "향후·앞으로"', 'S2'), st.start, st.start + m[1].length,
        { strength: 'strong', reason: '글 후반 30%에서 구체 시점·조건 없이 시간부사로 문장을 연다.' }); } }

  // E-2 같은 종결 4문장+ 연속 (사이에 제목·목록이 끼면 끊는다)
  { const idx = new Map(real.map((b, i) => [b, i]));
    const adjacent = (a, b) => a === b || real.slice(idx.get(a) + 1, idx.get(b)).every((x) => x.kind === 'prose');
    let i = 0;
    while (i < sents.length) {
      const e = endingOf(sents[i].text); let j = i + 1;
      while (e && j < sents.length && endingOf(sents[j].text) === e && adjacent(sents[j - 1].block, sents[j].block)) j++;
      if (e && j - i >= 4) add(S('E-2', '같은 종결어미 연속', 'S2'), sents[i].start, sents[j - 1].end,
        { strength: 'strong', reason: `"~${e}"로 끝나는 문장이 ${j - i}개 연속된다(기준 4문장 이상).` });
      i = Math.max(j, i + 1);
    } }

  // I-4 당위로 끝나는 문단 2개+
  { const obl = [];
    for (const b of prose) { const ss = sentencesOf(b); const last = ss[ss.length - 1]; if (last && ss.length >= 2 && OBLIG_RE.test(last.text)) obl.push(last); }
    obl.forEach((s, k) => add(S('I-4', '당위로 끝나는 문단', 'S2'), s.start, s.end,
      { strength: obl.length >= docMin(2) ? 'strong' : 'weak', reason: `문단이 "~해야 한다/~할 필요가 있다"로 닫힌다. 당위 결말 문단 ${obl.length}개 중 ${k + 1}번째(기준 ${docMin(2)}개 이상${k === 0 ? ', 첫 번째는 자연스러울 수 있다' : ''}).` })); }

  // ── 4. 문서 단위 신호(위치가 아니라 글 전체의 모양) ──
  const signals = [];
  const lens = sents.map((s) => s.text.length);
  const mean = nS ? lens.reduce((a, b) => a + b, 0) / nS : 0;
  const sd = nS ? Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / nS) : 0;
  const long100 = lens.filter((n) => n >= 100).length;
  const sig = (id, label, fired, value, basis) => signals.push({ id, label, fired, value, basis });
  const enough = nS >= 8;
  const enough20 = nS >= 20;   // 사람 글의 장문 비율(약 9%)로 보면 20문장은 돼야 "장문 없음"이 우연이 아니다
  sig('E-1', '문장 길이 균일 · 100자 넘는 장문 없음', enough20 && long100 === 0,
    `문장 ${nS}개 · 평균 ${mean.toFixed(1)}자 · 표준편차 ${sd.toFixed(1)} · 100자 이상 ${long100}개`,
    enough20 ? '사람 글은 100자 넘는 문장이 섞인다(벤치마크 실측: 사람 91.3 대 AI 8.1건/1000문장).' : '문장이 20개 미만이라 판단하지 않는다.');
  sig('C-12', '쉼표 포함률 50% 초과', enough && commaRate > 0.5,
    `쉼표가 있는 문장 ${commaS}/${nS} (${(commaRate * 100).toFixed(0)}%)`,
    enough ? '전체 문장의 절반 넘게 쉼표가 들어 있으면 AI 쪽 분포다. 개인 습관일 수 있어 단독으로는 보지 않는다.' : '문장이 8개 미만이라 판단하지 않는다.');
  { const pc = prose.map((b) => sentencesOf(b).length).filter((n) => n >= 2);
    const uni = pc.length >= 4 && pc.every((n) => n === 3 || n === 4);
    sig('E-3', '모든 문단이 3~4문장', uni, `문단별 문장 수 ${pc.join('·') || '-'}`, pc.length >= 4 ? '문단 길이까지 고르면 기계적 리듬이다.' : '본문 문단이 4개 미만이라 판단하지 않는다.'); }
  { const short = sents.filter((s) => !/,|[가-힣](?:고|며|지만|면서|아서|어서|해서|는데|므로|니까|려고|도록)\s/.test(s.text)).length;
    sig('E-4', '단문 일변도', enough && short / nS >= 0.8, `이음 없는 단문 ${short}/${nS}`, enough ? '연결어미·쉼표 없이 끊어진 문장이 80%를 넘는다.' : '문장이 8개 미만이라 판단하지 않는다.'); }

  const human = [];
  for (const h of HUMAN_MARKERS) { h.re.lastIndex = 0; const ms = text.match(h.re); if (ms) human.push({ id: h.id, label: h.label, count: ms.length, examples: [...new Set(ms.map((x) => x.replace(/^[.!?\s]+/, '').trim()))].slice(0, 3) }); }

  // ── 정리 ──
  findings.sort((a, b) => a.start - b.start || b.end - a.end);
  findings.forEach((f, i) => { f.id = 'f' + String(i + 1).padStart(3, '0'); });

  const strong = findings.filter((f) => f.strength === 'strong');
  const byRule = new Map();
  for (const f of findings) {
    const r = byRule.get(f.rule) || { rule: f.rule, group: f.group, label: f.label, severity: f.severity, count: 0, strong: 0 };
    r.count++; if (f.strength === 'strong') r.strong++; byRule.set(f.rule, r);
  }
  const rules = [...byRule.values()].sort((a, b) => b.strong - a.strong || b.count - a.count);
  const byGroup = {};
  for (const f of findings) { const g = (byGroup[f.group] ||= { label: GROUPS[f.group] || f.group, count: 0, strong: 0 }); g.count++; if (f.strength === 'strong') g.strong++; }

  const chars = original.replace(/\s/g, '').length;
  const covered = new Uint8Array(original.length);
  for (const f of strong) covered.fill(1, f.start, f.end);
  let cov = 0; for (let i = 0; i < covered.length; i++) if (covered[i] && !/\s/.test(original[i])) cov++;
  const weighted = strong.reduce((a, f) => a + (SEV_WEIGHT[f.severity] || 2), 0);
  const firedTypes = new Set(strong.map((f) => isLex(f) ? 'L' : f.rule));
  for (const s of signals) if (s.fired) firedTypes.add(s.id);
  const level = firedTypes.size >= 6 ? '높음' : firedTypes.size >= 3 ? '보통' : '낮음';

  return {
    meta: {
      genre, chars, sentences: nS, paragraphs: prose.length,
      found: findings.length, strong: strong.length, weak: findings.length - strong.length,
      types_fired: firedTypes.size, level,
      density: chars ? +(cov / chars).toFixed(3) : 0,                      // 뚜렷한 곳이 덮은 글자 비율
      weighted_per_1000: chars ? +(weighted / chars * 1000).toFixed(1) : 0, // S1=5·S2=2·S3=0.5 가중합 / 1000자
      note: '겹쳐서 나타난 유형의 수로 본 참고 수준이다. AI가 썼는지에 대한 판정이 아니며, 한 가지 신호만으로는 근거가 되지 않는다.',
    },
    findings, rules, groups: byGroup, signals, human_markers: human,
  };
}

// 사람이 읽는 요약(채팅·터미널용)
function toText(r, { max = 200 } = {}) {
  const L = [];
  const m = r.meta;
  L.push(`AI스러움 ${m.level} — 뚜렷 ${m.strong}곳 · 참고 ${m.weak}곳 · 겹친 유형 ${m.types_fired}가지 (${m.chars}자, 문장 ${m.sentences}개, 장르 ${m.genre})`);
  L.push(m.note, '');
  const fired = r.signals.filter((s) => s.fired);
  if (fired.length) { L.push('글 전체의 모양'); for (const s of fired) L.push(`  [${s.id}] ${s.label} — ${s.value}. ${s.basis}`); L.push(''); }
  L.push('유형별');
  for (const x of r.rules) L.push(`  [${x.rule}] ${x.label} — ${x.count}곳${x.strong ? ` (뚜렷 ${x.strong})` : ' (참고)'}`);
  L.push('', '찾은 곳');
  for (const f of r.findings.slice(0, max)) {
    const t = f.text.length > 60 ? f.text.slice(0, 57) + '…' : f.text;
    L.push(`  ${f.line}:${f.col} [${f.rule}] ${f.strength === 'strong' ? '뚜렷' : '참고'} "${t.replace(/\n/g, ' ⏎ ')}"`);
    L.push(`      ${f.reason}${f.caveat ? ` ※ ${f.caveat}` : ''}`);
  }
  if (r.findings.length > max) L.push(`  … 외 ${r.findings.length - max}곳`);
  if (r.human_markers.length) { L.push('', '사람 글 쪽 표지'); for (const h of r.human_markers) L.push(`  [${h.id}] ${h.label} ${h.count}회 (${h.examples.join(', ')})`); }
  return L.join('\n');
}

module.exports = { detect, toText, GENRES, MAX_CHARS, LEXICON_META: LEXICON.meta };

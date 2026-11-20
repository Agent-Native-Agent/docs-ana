'use strict';
// 규칙 점검 — 코드가 센다(같은 문서는 늘 같은 결과). 모델 호출 없음.
//   패턴 목록은 한국어 AI 문체 연구를 정리한 공개 자료(epoko77-ai/im-not-ai, MIT)의 분류
//   (번역투 · 관용구 · 구조 · 리듬 · 완곡 · 접속사 · 시각 장식)를 참고해 다시 썼다.
// 결과는 "판정"이 아니라 "신호"다. 사람이 쓴 글에도 같은 패턴이 나온다.
const crypto = require('node:crypto');
const newId = (p = '') => p + crypto.randomBytes(6).toString('hex');

const DOC_EXT = ['hwp', 'hwpx', 'pdf', 'docx', 'pptx'];
const LEVELS = ['문단', '문장', '단어', '조판'];
const STEPS = ['문서 읽기', '규칙 점검', 'AI 검토', '정리'];
const ymd = (d = new Date()) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const arr = (v) => (Array.isArray(v) ? v : []);

// ---------- 글 나누기 ----------
// 색인해 둔 글은 kordoc 이 읽은 마크다운이다(제목 #, 굵게 **, 표 | · <tr>). 검토는 글만 본다 — 표는 빼고, 제목 · 굵게 기호는 걷는다.
function splitParas(passages, max = 600) {
  const out = [];
  for (const p of passages) for (const line of String(p.text || '').split(/\n+/)) {
    let t = line.trim(); if (!t || /^[|<]/.test(t) || /^\|?\s*-{3,}/.test(t) || /^!\[/.test(t)) continue;   // 표 · 그림 줄
    const heading = /^#{1,6}\s/.test(t); t = t.replace(/^#{1,6}\s+/, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/<br\s*\/?>/gi, ' ').replace(/\\([*#_\-\[\]()>])/g, '$1').replace(/\s+/g, ' ').trim();
    if (t.length < 2) continue;
    out.push({ i: out.length, page: p.page || null, text: t, heading }); if (out.length >= max) return out;
  }
  return out;
}
const sentencesOf = (t) => t.split(/(?<=[.!?。…])\s+|(?<=다\.)\s*|(?<=요\.)\s*/).map((x) => x.trim()).filter((x) => x.length >= 6);
const body = (t) => t.replace(/^\s*(?:[□■○ㅇ●▪▶◦·\-–—*•※#>]+|\(?\d{1,2}[.)]|[가-하][.)])\s*/, '').replace(/^\*\*|\*\*$/g, '');   // 개조식 머리표를 뗀 본문

// ---------- 규칙 ----------
// 단어 · 구(句): [id, 갈래, 이름, 정규식, 문서 전체에서 이 횟수 이상이면 신호, 왜, 고치는 법]
const WORD_RULES = [
  ['chat', '단어', '대화형 AI의 말투가 남음', /(물론입니다|알겠습니다[.!]|도움이 되(었기를|셨기를|길) 바랍니다|추가로 (필요하|궁금하)신|궁금한 점이 있으시면|아래와 같이 (정리|작성)(해 드리|했)|다음은 .{2,30}(입니다|예시입니다)\s*[:.]|요청하신 (내용|문서)|AI 언어 모델|as an AI)/g, 1, '답변을 그대로 붙여 넣을 때 남는 문구다. 문서 본문에 있을 이유가 없다.', '문구를 지운다.'],
  ['placeholder', '단어', '채우지 않은 자리표시', /(\[[^\]\n]{1,14}(이름|명|날짜|일자|부서|기관|금액|번호|내용|입력)\]|\{\{[^}\n]{1,20}\}\}|○○○|XXX|OOO 기관)/g, 1, '초안 틀의 빈칸이 그대로 남았다.', '실제 값으로 채운다.'],
  ['closing', '단어', '결산 접속어', /(결론적으로|요약하자면|요약하면|정리하자면|종합하면|종합적으로 볼 때|이를 통해|이러한 점에서|이처럼)/g, 3, '문단을 맺을 때마다 정리 접속어를 다는 것은 AI 글에서 두드러지는 버릇이다.', '한두 곳만 남기고 바로 내용을 쓴다.'],
  ['hype', '단어', '의의를 부풀리는 표현', /(시사하는 바가 (크|많)|주목할 (만하|필요가)|매우 중요(하|한)|핵심적인 역할|중요한 의미를 (가|갖)|큰 의의|획기적(인|으로)|혁신적(인|으로)|새로운 지평|패러다임(의)? (전환|변화))/g, 2, '근거 없이 중요하다고만 말하는 표현이 되풀이된다.', '무엇이 얼마나 달라지는지 수치나 사실로 쓴다.'],
  ['enum', '단어', '열거를 여는 상투구', /(다음과 같(다|습니다|은)|크게 [두세네]\s?가지|[두세네] 가지 (측면|관점|방향)|아래와 같(다|습니다|이))/g, 3, '나열 앞에 도입구를 매번 붙인다.', '도입구 없이 바로 항목을 쓴다.'],
  ['trans1', '단어', '번역투 "~에 대해/~에 있어/~와 관련하여"', /(에 대해서?|에 대한|에 있어서?|와 관련하여|과 관련하여|와 관련된|과 관련된)/g, 8, '영어 전치사를 옮긴 표현이 몰려 있다.', '"~을/를", "~에서", "~의"로 줄인다.'],
  ['trans2', '단어', '번역투 "~을 통해/~에 기반하여/~로 인해"', /(을 통해|를 통해|을 통한|를 통한|에 기반하여|에 기반한|을 바탕으로|를 바탕으로|으로 인해|로 인해|에 의해)/g, 8, '수단 · 원인을 같은 틀로만 잇는다.', '"~로", "~해서", 행위자를 주어로 바꾼다.'],
  ['have', '단어', '"~을 가지고 있다/~되어진다" 직역', /(가지고 있(다|습니다|으며|는)|갖고 있(다|습니다|으며|는)|되어[지진]|지게 된다|지게 됩니다)/g, 3, 'have · be+p.p.를 그대로 옮긴 꼴이다.', '"~이 크다/있다", "~된다"로 쓴다.'],
  ['beyond', '단어', '"단순한 ~을 넘어" 틀', /(단순(한|히) .{1,24}(을|를|에서)? ?넘어|그 이상의 (의미|가치)|단순한 .{1,20}이 아니라|단지 .{1,20}에 그치지 않고)/g, 1, '사람 글에서는 드물고 AI 글에서 자주 보이는 범위 상승 틀이다.', '"A만이 아니라 B다"로 풀거나 뺀다.'],
  ['hedge', '단어', '겹친 완곡 표현', /(할 수 있을 것으로 (보|판단|기대|예상)|것으로 (보여|판단되어|사료되어)[지집]|로 보여질 수|가능성이 있을 수 있|일 수도 있을 것)/g, 1, '완곡 표현을 두세 겹 쌓았다.', '완곡은 하나만 남긴다.'],
  ['can', '단어', '"~할 수 있다"의 반복', /(할|될|볼|줄|일) 수 있(다|습니다|으며|을 것)/g, 9, '같은 가능 표현이 계속 되풀이된다.', '단정할 수 있는 곳은 단정하고, 일부는 다른 말로 바꾼다.'],
  ['policy', '단어', '범용 정책 동사', /(강화|확대|제고|고도화|활성화|내실화|체계화|극대화|최적화|도모|구축)(하|할|한|해|를|을|에|와|및|,|\s)/g, 0, '무엇을 어떻게 하는지 없이 "강화 · 확대 · 제고"만 이어진다.', '구체 행위(누가 무엇을 언제까지)로 바꾼다.'],
  ['abstract', '단어', '"~적 + 명사" 추상어 사슬', /[가-힣]{1,4}적(인)? [가-힣]{2,6}(과|와|,|\s)\s?[가-힣]{1,4}적(인)? [가-힣]{2,6}/g, 3, '"체계적 관리와 효율적 운영"처럼 추상어를 짝지어 늘어놓는다.', '하나만 남기거나 구체 명사로 바꾼다.'],
  ['english', '단어', '영어 병기의 반복', /[가-힣]{2,12}\s?\(([A-Z][A-Za-z]{2,}(\s[A-Za-z]{2,}){0,3})\)/g, 5, '같은 방식의 "한글(English)" 병기가 계속 나온다.', '처음 한 번만 병기한다.'],
  // ── 아래는 im-not-ai 분류표(A~J)에서 더 가져온 것. 설명 끝의 번호는 그쪽 항목 ──
  ['absubj', '문장', '추상 주어 + 만능 동사', /[가-힣]{2,12}(은|는|이|가) [^.\n]{0,28}(보여준다|보여줍니다|보여주고 있|시사한다|시사합니다|제공한다|제공합니다|가져온다|가져옵니다|가져왔다|의미한다|의미합니다|요구한다|요구합니다|던진다|던집니다|증명한다|증명합니다)/g, 3, '사건 · 기술 · 개념을 주어로 삼아 "보여준다 · 시사한다 · 제공한다"로 맺는다(영어 The X shows Y의 직역, A-15 · D-5).', '실제 행위자를 주어로 하거나 "~에 따르면 ~이다"로 쓴다.'],
  ['whenis', '문장', '"~할 때입니다 / 시점입니다" 맺음', /(할|해야 할|나설|준비할|고민할|모아야 할|돌아볼) (때|시점|순간|시기)(이다|입니다)[.。]?/g, 1, '글을 행동 촉구 공식으로 맺는다(D-6).', '무엇을 언제 하는지 구체 동사로 쓴다.'],
  ['fromto', '문장', '"X에서 Y로" 변환 공식', /[가-힣]{2,10}에서 [가-힣 ]{2,12}(으로|로)(의)? (전환|도약|진화|나아가|변화|이행|탈바꿈)/g, 2, '"A에서 B로의 전환" 틀이 되풀이된다(D-7).', '무엇이 어떻게 바뀌는지 직접 쓴다.'],
  ['cleft', '문장', '분열문 "중요한 것은 ~이다"', /(중요한 것은|필요한 것은|핵심은|문제는|관건은|주목할 점은|주목해야 할 것은|분명한 것은)\s/g, 2, '"중요한 것은 X이다" 꼴로 강조를 되풀이한다(D-8 · I-2).', '"X가 중요하다"처럼 주어 – 서술로 바로 쓴다.'],
  ['leadsto', '문장', '"결국 ~로 이어진다" 결산', /(결국|궁극적으로|나아가서는)\s|(으로|로) 이어(진다|집니다|질 것)|에 직결(된다|됩니다)/g, 3, '인과를 "결국 ~로 이어진다"로 뭉뚱그려 맺는다(D-9).', '어떤 경로로 그렇게 되는지 쓴다.'],
  ['reason', '문장', '"~하는 이유다" 도치 결산', /(하는|되는|인|한) 이유(다|입니다)[.。]/g, 2, '문장 끝을 "~하는 이유다"로 뒤집어 맺는다(D-10).', '"그래서 ~다"로 순서대로 쓴다.'],
  ['remain', '문단', '"과제도 남아 있다" 식 빈 반론', /(과제도|한계도|아쉬운 점도|우려도|숙제도) (여전히 )?(남아 있|분명하|존재하|있)/g, 1, '구체 내용 없이 "과제도 남아 있다"로 균형만 맞춘다(D-12).', '실제 과제를 첫 문장으로 쓴다.'],
  ['metaphor', '단어', '지어 얹은 은유', /(잠식|청사진|적신호|경고등|신호탄|뿌리내리|뿌리 내리|짓누르|주춧돌|밑거름|나침반|교두보|청구서|성적표|씨앗을 뿌리|토양을|견인차|새로운 지평|도약의 발판|디딤돌|마중물)/g, 3, '건축 · 농경 · 신호 계열 은유가 겹쳐 나온다(D-14, 은유는 하나씩이 아니라 합쳐서 본다).', '은유를 걷고 실제로 일어나는 일을 쓴다.'],
  ['pave', '단어', '"발판 · 토대를 마련하다" 공식', /(발판|토대|기틀|초석)을 (마련|다지|놓)|지평을 (열|넓히)|새로운 장을 열|가능성을 열어|시대가 도래/g, 2, 'pave the way · lay the groundwork를 옮긴 정형구다(A-23).', '그 조치로 무엇이 가능해지는지 쓴다.'],
  ['dblpart', '단어', '이중 조사 "~에서의 / ~으로의"', /[가-힣](에서의|으로의|로의|에의|으로부터의|로부터의|에 있어서의|에로의)\s/g, 4, '격조사를 겹쳐 쓴 표현이 몰려 있다(A-19).', '"~에서 하는", "~로 가는"처럼 풀어 쓴다.'],
  ['passprog', '단어', '"~되고 있다 / ~지고 있다" 남발', /(되고 있|지고 있)(다|습니다|으며|는|음)/g, 4, '피동 진행형이 되풀이된다(A-20).', '"~됐다", "~한다"로 쓴다.'],
  ['clear', '문장', '"~은 분명하다 / 명확하다" 얹기', /(은|는|이|가|임은|점은) (명확|분명|자명|확실)(하다|합니다)[.。]/g, 2, '명제 뒤에 평가 술어를 얹는다(A-22).', '술어를 걷고 명제를 바로 단언한다.'],
  ['nolonger', '문장', '"더 이상 ~ 아니다"', /더 이상 [^.\n]{1,30}(않|아니|없)/g, 2, 'no longer를 옮긴 틀이 되풀이된다(A-24).', '"이제 ~다"로 쓴다.'],
  ['intens', '단어', '정도 부사 중독', /(매우|굉장히|상당히|대단히|극히|한층|더욱더|보다 더|훨씬 더)\s/g, 6, '"매우 · 상당히 · 한층"이 계속 붙는다(F-1).', '수치로 바꾸거나 뺀다.'],
  ['twin', '단어', '뜻이 겹치는 이중 수식', /(효율적이고 효과적|효과적이고 효율적|체계적이고 종합적|종합적이고 체계적|신속하고 정확|안전하고 신뢰|지속적이고 안정적|안정적이고 지속적|다양하고 폭넓|유기적이고 긴밀|긴밀하고 유기적)/g, 2, '비슷한 말을 둘씩 묶어 꾸민다(F-2).', '하나만 남긴다.'],
  ['role', '단어', '"역할을 수행 / 기능을 담당" 복합구', /(역할을 수행|기능을 수행|역할을 담당|기능을 담당|역할을 하고 있|역할을 해 ?나가)/g, 3, '"~한다"로 될 말을 "역할을 수행한다"로 늘인다(F-3).', '동사 하나로 줄인다.'],
  ['guess', '문장', '추측 · 관측형 종결의 반복', /(로 보인다|로 보입니다|로 판단된다|로 판단됩니다|로 여겨진다|로 사료된다|로 사료됩니다|로 예상된다|로 예상됩니다|로 전망된다|로 전망됩니다|것으로 기대된다|것으로 기대됩니다)/g, 4, '같은 추측 종결이 되풀이된다(G-1).', '확인된 것은 단정하고, 종결을 달리한다.'],
  ['thisis', '문장', '"이는 ~" 지시 반복', /(^|[.。]\s)(이는|이것은|이 점에서|이 관점에서 보면|이 말은)\s/g, 4, '앞 문장을 "이는 ~"으로 받아 부연하는 꼴이 이어진다(H-3). 사람도 쓰는 장치라 약한 신호다.', '두 문장을 잇거나 주어를 살린다.'],
  ['namely', '단어', '"즉"의 반복', /(^|[.。,]\s)즉[, ]/g, 3, '"즉"으로 다시 말하기를 되풀이한다(H-4).', '한두 번만 남긴다.'],
  ['thing', '문장', '"~것이다" 종결 남발', /것(이다|입니다)[.。]/g, 5, '"~것이다"로 끝나는 문장이 많다(I-1).', '"~다"로 바로 맺는다.'],
  ['point', '단어', '"~라는 점에서 / ~다는 것이다"', /(라는 점에서|다는 점에서|는 점이다|다는 것이다|다는 뜻이다|라는 것이다)/g, 3, '형식명사 "점 · 것"으로 문장을 감싼다(I-2 · I-3).', '"X는 ~다"로 바로 쓴다.'],
  ['need', '문장', '"~할 필요가 있다 / ~이 필요하다" 권고형', /(할 필요가 있|이 필요하다|가 필요하다|이 필요합니다|가 필요합니다|이 요구된다|가 요구된다|이 요구됩니다)/g, 6, '권고형 종결이 계속 나온다(I-4 · I-5).', '누가 무엇을 할지로 쓴다.'],
  ['analysis', '문장', '주체 없는 "~다는 분석이다 / 평가다"', /다는 (분석|평가|지적|관측|전망|해석)(이다|입니다|이 나온다|이 나옵니다)/g, 1, '누가 분석했는지 없이 "~다는 분석이다"로 맺는다(I-7).', '출처를 밝히거나 직접 서술한다.'],
];
const DENSITY = { closing: 0.8, hype: 0.5, enum: 0.8, trans1: 3.2, trans2: 3.2, have: 0.6, can: 2.2, abstract: 0.7, english: 99, absubj: 0.7, leadsto: 0.7, metaphor: 0.6, dblpart: 0.9, passprog: 1.0, intens: 1.8, role: 0.6, guess: 1.0, thisis: 0.9, namely: 0.6, thing: 1.2, point: 0.7, need: 2.2 };
// 근거 세기 — 참고 자료가 사람 글과 AI 글을 견줘 밝힌 것을 따른다. 직접 = 붙여 넣은 흔적, 강함 = 실측으로 크게 갈림, 약함 = 사람도 흔히 씀
const EVID = { chat: '직접', mdleak: '직접', placeholder: '직접', comma: '강함', notbut: '강함', beyond: '강함', metaphor: '강함', leadbold: '강함', emoji: '강함', lists: '강함', hype: '약함', thisis: '약함', quote: '약함', english: '약함', trans1: '약함', trans2: '약함', need: '약함', policy: '약함', intens: '약함' };
const WEIGHT = { 직접: 6, 강함: 3, 보통: 1.5, 약함: 0.6 };   // 1,000자당 이만큼은 넘어야 신호
const POLICY_PER_1000 = 9;   // 범용 정책 동사가 1,000자에 이만큼 넘으면 신호

function countMatches(re, text) { const out = []; let m; const r = new RegExp(re.source, re.flags); while ((m = r.exec(text))) { out.push({ at: m.index, s: m[0] }); if (m.index === r.lastIndex) r.lastIndex++; if (out.length > 400) break; } return out; }

function ruleCheck(paras, md, raw) {
  const findings = [], metrics = [];
  const all = paras.map((p) => p.text).join('\n'), chars = all.replace(/\s/g, '').length || 1, k1 = chars / 1000;
  const rawText = typeof raw === 'string' && raw.trim() ? raw : null;   // 문서에 실제로 적힌 글자(서식 없이) — 남은 기호는 여기서만 본다
  const add = (f) => { const ev = EVID[f.rule] || '보통'; findings.push({ id: newId('f'), src: '규칙', ...f, ev, weight: WEIGHT[ev] }); };
  const locate = (re, limit = 6) => { const hits = []; for (const p of paras) { for (const m of countMatches(re, p.text)) { hits.push({ p: p.i, quote: m.s }); if (hits.length >= limit) return hits; } } return hits; };

  // 단어 · 구
  for (const [id, level, name, re, min, why, fix] of WORD_RULES) {
    const n = countMatches(re, all).length;
    if (id === 'policy') { const per = n / chars * 1000; metrics.push({ key: 'policy', label: '범용 정책 동사(강화 · 확대 · 제고 …)', value: `${n}회 · 1,000자에 ${per.toFixed(1)}회`, flag: per >= POLICY_PER_1000 && n >= 8 }); if (!(per >= POLICY_PER_1000 && n >= 8)) continue; }
    else if (n < min || (min >= 3 && n / k1 < DENSITY[id])) continue;   // 긴 문서는 횟수가 아니라 1,000자당 빈도로 본다
    if (id === 'english') { const seen = {}; for (const m of countMatches(re, all)) seen[m.s.replace(/\s/g, '')] = (seen[m.s.replace(/\s/g, '')] || 0) + 1; const rep3 = Object.entries(seen).filter(([, c]) => c >= 3); if (!rep3.length) continue; add({ rule: id, level, pattern: name, why: `같은 병기가 되풀이된다(${rep3.slice(0, 3).map(([t, c]) => `${t} ${c}회`).join(', ')}).`, fix, count: rep3.reduce((a, [, c]) => a + c, 0), weight: 1, spots: locate(new RegExp(rep3[0][0].replace(/[()]/g, '\\$&').replace(/^([가-힣]+)/, '$1\\s?')), 3) }); continue; }
    const hits = locate(re, id === 'chat' || id === 'placeholder' ? 12 : 5);
    add({ rule: id, level, pattern: name, why, fix, count: n, weight: id === 'chat' ? 6 : id === 'placeholder' ? 3 : id === 'beyond' || id === 'hedge' ? 2 : 1, spots: hits });
  }

  // 문장
  const sents = []; for (const p of paras) { if (p.heading) continue; for (const s of sentencesOf(p.text)) sents.push({ p: p.i, s }); }
  const lens = sents.map((x) => body(x.s).length).filter((n) => n > 0);
  // 개조식 문서(□ · ㅇ · - 로 시작하거나 "~함 · ~임"으로 끝나는 줄이 많음)는 짧은 줄이 정상이다 — 문장 길이 · 홑문장 점검을 하지 않는다
  const bulletish = paras.filter((p) => !p.heading && (/^\s*[□■○ㅇ●▪▶◦·\-–※*•]/.test(p.text) || /(함|임|음|됨|있음|없음|예정|필요|추진|계획|완료|검토|확인)[.。]?\s*$/.test(p.text))).length, gaejo = paras.length >= 6 && bulletish / paras.length >= 0.35;
  if (gaejo) metrics.push({ key: 'gaejo', label: '문서 꼴', value: '개조식(문장 길이 · 홑문장 점검은 하지 않음)' });
  if (lens.length >= 8 && !gaejo) {
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length, sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length), cv = sd / mean;
    const longOnes = lens.filter((n) => n >= 90).length, shortOnes = lens.filter((n) => n <= 18).length;
    metrics.push({ key: 'len', label: '문장 길이', value: `평균 ${mean.toFixed(0)}자 · 들쭉날쭉한 정도 ${cv.toFixed(2)}`, note: '사람 글은 대개 0.45 이상(짧은 문장과 긴 문장이 섞인다)', flag: cv < 0.34 });
    if (cv < 0.34) add({ rule: 'uniform', level: '문장', pattern: '문장 길이가 고르다', why: `문장 ${lens.length}개의 길이가 거의 같다(평균 ${mean.toFixed(0)}자, 긴 문장 ${longOnes}개 · 짧은 문장 ${shortOnes}개). 사람 글은 짧은 문장과 긴 문장이 섞인다.`, fix: '짧은 문장 한두 개와 이어 쓴 긴 문장 하나를 섞는다.', count: lens.length, weight: 3, spots: [] });
  }
  const endOf = (s) => { const m = /(습니다|입니다|합니다|됩니다|있다|없다|이다|한다|된다|였다|했다|것이다|바란다|필요하다|함|임|음|됨|있음|없음|예정|필요|추진|계획)[.。]?\s*$/.exec(s); return m ? m[1] : ''; };
  let run = 0, runEnd = '', best = { n: 0 };
  sents.forEach((x, i) => { const e = endOf(x.s); if (e && e === runEnd) run++; else { run = e ? 1 : 0; runEnd = e; } if (run > best.n) best = { n: run, e, p: x.p, i }; });
  if (best.n >= 5 && !['함', '임', '음', '됨'].includes(best.e)) add({ rule: 'ending', level: '문장', pattern: '같은 종결어미가 이어진다', why: `"~${best.e}"로 끝나는 문장이 ${best.n}개 연달아 나온다.`, fix: '종결어미를 바꾸거나 문장을 잇는다.', count: best.n, weight: 2, spots: [{ p: best.p, quote: sents[best.i].s.slice(-24) }] });
  const commaRe = /[가-힣](고|며|지만|면서|아서|어서|으나|는데|므로),\s/g, nComma = countMatches(commaRe, all).length;
  const commaFlag = nComma >= 6 && nComma / k1 >= 1.6;
  metrics.push({ key: 'comma', label: '연결어미 뒤 쉼표("~하고, ~하며,")', value: `${nComma}회 · 1,000자에 ${(nComma / k1).toFixed(1)}회`, note: '사람 글에서는 드물다', flag: commaFlag });
  if (commaFlag) add({ rule: 'comma', level: '문장', pattern: '연결어미 뒤 쉼표', why: `"~하고, ~하며," 꼴의 쉼표가 ${nComma}번 나온다. 한국어 사람 글에서는 드물고 AI 글에서 뚜렷하게 많다.`, fix: '쉼표를 뺀다.', count: nComma, weight: 3, spots: locate(commaRe, 5) });
  const notButRe = /(이|가) 아니라 |것이 아니라|것은 아니다|[가-힣]인가, [가-힣]{1,12}인가/g, nNotBut = countMatches(notButRe, all).length;
  if (nNotBut >= 2 && nNotBut / k1 >= 0.35) add({ rule: 'notbut', level: '문장', pattern: '"A가 아니라 B" 대구의 반복', why: `"A가 아니라 B", "A인가, B인가" 대구가 ${nNotBut}번 나온다. 참고 자료의 실측에서 사람 글과 가장 크게 갈린 신호다(C-8).`, fix: '한 번만 살리고 나머지는 평서문으로 쓴다.', count: nNotBut, weight: 2, spots: locate(notButRe, 4) });
  const triRe = /[가-힣]{2,10}, [가-힣]{2,10},? (그리고|및) [가-힣]{2,10}|[가-힣]{2,8} · [가-힣]{2,8} · [가-힣]{2,8}/g, nTri = countMatches(triRe, all).length;
  const triFlag = nTri >= 6 && nTri / k1 >= 1.2;
  metrics.push({ key: 'tri', label: '셋씩 묶은 나열("A, B 그리고 C")', value: `${nTri}회`, flag: triFlag });
  if (triFlag) add({ rule: 'triad', level: '문장', pattern: '셋씩 묶은 나열', why: `항목을 꼭 셋으로 맞춘 나열이 ${nTri}번 나온다.`, fix: '실제로 있는 만큼만 쓴다.', count: nTri, weight: 2, spots: locate(triRe, 4) });
  const startRe = /^(또한|더불어|아울러|나아가|특히|이에 따라|이를 위해|그러나|하지만|한편)[, ]/;
  const starts = sents.filter((x) => startRe.test(body(x.s)));
  if (sents.length >= 8 && starts.length / sents.length >= 0.3) add({ rule: 'conn', level: '문장', pattern: '문장마다 접속어로 시작', why: `문장 ${sents.length}개 가운데 ${starts.length}개가 "또한 · 아울러 · 특히 …"로 시작한다.`, fix: '접속어를 줄이고 내용으로 잇는다.', count: starts.length, weight: 2, spots: starts.slice(0, 4).map((x) => ({ p: x.p, quote: body(x.s).slice(0, 20) })) });

  // 문단
  const proseParas = paras.filter((p) => !p.heading && body(p.text).length >= 60);
  if (proseParas.length >= 5) {
    const pl = proseParas.map((p) => body(p.text).length), pm = pl.reduce((a, b) => a + b, 0) / pl.length, pcv = Math.sqrt(pl.reduce((a, b) => a + (b - pm) ** 2, 0) / pl.length) / pm;
    metrics.push({ key: 'plen', label: '문단 길이', value: `평균 ${pm.toFixed(0)}자 · 들쭉날쭉한 정도 ${pcv.toFixed(2)}`, flag: pcv < 0.22 });
    if (pcv < 0.22) add({ rule: 'puniform', level: '문단', pattern: '문단 길이가 고르다', why: `긴 문단 ${pl.length}개의 길이가 거의 같다(평균 ${pm.toFixed(0)}자).`, fix: '내용의 무게에 따라 문단 길이를 달리한다.', count: pl.length, weight: 2, spots: [] });
    const mustRe = /(해야 한다|해야 합니다|해야 할 것이다|필요하다|필요합니다|할 것이다|될 것이다|기대된다|기대됩니다|바람직하다|요구된다|중요하다)[.。]?\s*$/;
    const musts = proseParas.filter((p) => mustRe.test(p.text));
    if (musts.length >= 3 && musts.length / proseParas.length >= 0.4) add({ rule: 'must', level: '문단', pattern: '문단마다 당위 · 전망으로 맺는다', why: `긴 문단 ${proseParas.length}개 가운데 ${musts.length}개가 "~해야 한다 · ~할 것이다 · ~기대된다"로 끝난다.`, fix: '맺음 문장을 빼거나 구체 사실로 끝낸다.', count: musts.length, weight: 3, spots: musts.slice(0, 5).map((p) => ({ p: p.i, quote: p.text.slice(-26) })) });
  }
  const multi = proseParas.map((p) => sentencesOf(p.text).length).filter((n) => n >= 2);
  if (multi.length >= 5) { const f34 = multi.filter((n) => n === 3 || n === 4).length; metrics.push({ key: 'p34', label: '문장 3~4개짜리 문단', value: `${f34}개 / ${multi.length}개`, flag: f34 / multi.length >= 0.75 });
    if (f34 / multi.length >= 0.75) add({ rule: 'p34', level: '문단', pattern: '문단마다 문장이 3~4개', why: `여러 문장으로 된 문단 ${multi.length}개 가운데 ${f34}개가 똑같이 3~4문장이다(E-3).`, fix: '한 문장 문단과 긴 문단을 섞는다.', count: f34, spots: [] }); }
  if (sents.length >= 10) { const linked = sents.filter((x) => /[가-힣](고|며|지만|면서|아서|어서|는데|므로|으나|도록|려고)[, ]/.test(x.s)).length, withComma = sents.filter((x) => x.s.includes(',')).length;
    metrics.push({ key: 'linked', label: '이어 쓴 문장(복문)', value: `${linked}개 / ${sents.length}개`, flag: linked / sents.length < 0.12 });
    metrics.push({ key: 'commaRate', label: '쉼표가 든 문장', value: `${Math.round(withComma / sents.length * 100)}%`, note: '참고용(개인 버릇 차이가 크다)' });
    if (!gaejo && linked / sents.length < 0.12 && lens.length && lens.reduce((a, b) => a + b, 0) / lens.length < 42) add({ rule: 'short', level: '문장', pattern: '짧은 홑문장만 이어진다', why: `문장 ${sents.length}개 가운데 이어 쓴 문장이 ${linked}개뿐이다(E-4).`, fix: '관계가 있는 문장은 이어 쓴다.', count: sents.length - linked, spots: [] }); }
  const tail = sents.slice(Math.floor(sents.length * 0.7)), ahead = tail.filter((x) => /^(향후|앞으로|중장기적으로|장기적으로|미래에는)[, ]/.test(body(x.s)));
  if (sents.length >= 10 && ahead.length >= 2) add({ rule: 'ahead', level: '문단', pattern: '끝부분의 막연한 "향후 · 앞으로"', why: `글의 뒤쪽 30%에서 "향후 · 앞으로"로 시작하는 문장이 ${ahead.length}개다(D-11).`, fix: '실제 시점이나 조건으로 바꾼다.', count: ahead.length, spots: ahead.slice(0, 4).map((x) => ({ p: x.p, quote: body(x.s).slice(0, 20) })) });
  const openRe = /^(먼저|우선|첫째|둘째|셋째|다음으로|또한|마지막으로|끝으로|결론적으로)[,\s]/;
  const opens = paras.filter((p) => openRe.test(body(p.text)));
  if (opens.length >= 3 && /^(먼저|우선|첫째)/.test(body(opens[0].text)) && opens.some((p) => /^(마지막으로|끝으로|결론적으로|셋째)/.test(body(p.text)))) add({ rule: 'three', level: '문단', pattern: '"먼저 – 또한 – 마지막으로" 3단 틀', why: `문단 머리가 순서 접속어로 짜여 있다(${opens.length}개 문단).`, fix: '접속어 없이 내용으로 순서를 드러낸다.', count: opens.length, weight: 2, spots: opens.slice(0, 5).map((p) => ({ p: p.i, quote: body(p.text).slice(0, 18) })) });
  const firstWords = {}; for (const p of proseParas) { const w = body(p.text).split(/\s+/).slice(0, 2).join(' '); if (w.length >= 4) (firstWords[w] = firstWords[w] || []).push(p.i); }
  for (const [w, ps] of Object.entries(firstWords)) if (ps.length >= 3 && ps.length / proseParas.length >= 0.2 && !/^[\d(]/.test(w)) add({ rule: 'sameopen', level: '문단', pattern: '같은 말로 시작하는 문단', why: `"${w}"로 시작하는 문단이 ${ps.length}개다.`, fix: '문단 첫머리를 달리한다.', count: ps.length, weight: 1, spots: ps.slice(0, 4).map((p) => ({ p, quote: w })) });

  // 조판 — 본문 글자에 남은 흔적 + 문서를 마크다운으로 읽은 모양
  if (rawText) {   // 문서에 글자로 적혀 있는 마크다운 기호
    const rl = rawText.split('\n'), leaked = [];
    for (const l of rl) { const m = /(\*\*[^*\n]{1,40}\*\*|^\s{0,3}#{1,4} \S.{0,30}|```|^\s*[-*] \*\*[^*]{1,30}|^\s*>\s\S.{0,20}|\[[^\]\n]{1,30}\]\(https?:[^)]{0,40}\))/.exec(l); if (m) leaked.push(m[0].slice(0, 40)); }
    if (leaked.length) { const clean = (q) => q.replace(/\*\*/g, '').replace(/^\s*#{1,4} /, '').replace(/^\s*[-*>] /, '').trim();
      add({ rule: 'mdleak', level: '조판', pattern: '마크다운 기호가 글자로 남음', why: `"**굵게**", "## 제목" 같은 기호가 문서에 글자로 ${leaked.length}곳 적혀 있다(예: ${leaked.slice(0, 2).map((x) => '"' + x + '"').join(', ')}). 대화형 AI의 답을 그대로 붙여 넣을 때 생긴다.`, fix: '기호를 지우고 한글의 글자 모양(굵게 · 제목 스타일)으로 바꾼다.', count: leaked.length, weight: 6, spots: leaked.slice(0, 8).map((q) => { const c = clean(q).slice(0, 24), p = c.length >= 3 && paras.find((x) => x.text.includes(c)); return p ? { p: p.i, quote: c } : null; }).filter(Boolean) }); }
  }
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2705}\u{2728}\u{2B50}\u{26A0}\u{2757}\u{1F1E6}-\u{1F1FF}]/gu, nEmoji = countMatches(emojiRe, rawText || all).length;
  if (nEmoji >= 1) add({ rule: 'emoji', level: '조판', pattern: '그림 문자(이모지)', why: `그림 문자가 ${nEmoji}개 있다. 공문서에는 쓰지 않으며 AI 답변의 제목 · 목록 머리에 흔하다.`, fix: '모두 지운다.', count: nEmoji, weight: 4, spots: locate(emojiRe, 6) });
  const dashRe = /[가-힣)] ?[—–] ?[가-힣(]/g, nDash = countMatches(dashRe, all).length;
  const dashFlag = nDash >= 4 && nDash / k1 >= 0.8;
  metrics.push({ key: 'dash', label: '줄표(—)로 덧붙인 설명', value: `${nDash}회`, flag: dashFlag });
  if (dashFlag) add({ rule: 'dash', level: '조판', pattern: '줄표(—) 남용', why: `줄표로 설명을 덧붙인 곳이 ${nDash}곳이다. 영어식 문장 부호가 그대로 넘어온 흔적일 수 있다.`, fix: '쉼표 · 괄호 · 별도 문장으로 바꾼다.', count: nDash, weight: 2, spots: locate(dashRe, 5) });
  const colonHeads = paras.filter((p) => p.heading && p.text.length <= 40 && /^[^.!?:\d]{2,18}: [^.!?\d]{2,24}$/.test(body(p.text)));   // 제목 줄만("구분 : 값" 같은 항목 표기는 정상)
  if (colonHeads.length >= 3) add({ rule: 'colon', level: '조판', pattern: '"주제: 부제" 꼴 제목', why: `쌍점으로 나눈 제목이 ${colonHeads.length}개다. 영어권 글 제목 틀이다.`, fix: '한 덩어리 명사구로 줄인다.', count: colonHeads.length, weight: 2, spots: colonHeads.slice(0, 5).map((p) => ({ p: p.i, quote: p.text.slice(0, 40) })) });
  const quoteRe = /['‘’"“”]([가-힣A-Za-z ]{2,14})['‘’"“”]/g, nQuote = countMatches(quoteRe, all).length;
  if (nQuote >= 8 && nQuote / k1 >= 2.5) add({ rule: 'quote', level: '조판', pattern: '따옴표 강조', why: `낱말을 따옴표로 강조한 곳이 ${nQuote}곳이다.`, fix: '실제 인용만 남긴다.', count: nQuote, weight: 1, spots: locate(quoteRe, 5) });
  if (md) {
    const lines = md.split('\n'), boldLines = lines.filter((l) => /\*\*[^*]+\*\*/.test(l)).length, textLines = lines.filter((l) => l.trim().length > 12 && !/^[|<]/.test(l.trim())).length || 1;
    const leadBold = lines.filter((l) => /^\s*([-*•□ㅇ○]\s*)?\*\*[^*]{2,24}\*\*\s*[:：]/.test(l)).length;
    metrics.push({ key: 'bold', label: '굵은 글씨가 든 줄', value: `${boldLines}줄 / ${textLines}줄`, flag: boldLines / textLines > 0.3 && boldLines >= 6 });
    if (leadBold >= 3) add({ rule: 'leadbold', level: '조판', pattern: '"굵은 머리말: 설명" 꼴 항목', why: `항목마다 굵은 머리말 뒤에 쌍점과 설명을 다는 꼴이 ${leadBold}줄이다. 대화형 AI 답변의 전형적인 목록 모양이다.`, fix: '머리말을 빼고 문장으로 쓰거나 표로 바꾼다.', count: leadBold, weight: 4, spots: [] });
    else if (boldLines / textLines > 0.3 && boldLines >= 6) add({ rule: 'bold', level: '조판', pattern: '굵은 글씨 남용', why: `글이 있는 줄 ${textLines}줄 가운데 ${boldLines}줄에 굵은 글씨가 있다.`, fix: '꼭 필요한 곳만 남긴다.', count: boldLines, weight: 2, spots: [] });
    const lists = []; let cur = 0; for (const l of lines) { if (/^\s*([-*•]|\d+[.)])\s+\S/.test(l)) cur++; else { if (cur) lists.push(cur); cur = 0; } } if (cur) lists.push(cur);
    if (lists.length >= 4) { const same = Math.max(...[2, 3, 4, 5].map((k) => lists.filter((n) => n === k).length)), k = [2, 3, 4, 5].find((x) => lists.filter((n) => n === x).length === same);
      metrics.push({ key: 'lists', label: '목록 묶음', value: `${lists.length}개 · 그중 ${same}개가 ${k}줄짜리`, flag: same / lists.length >= 0.7 });
      if (same / lists.length >= 0.7) add({ rule: 'lists', level: '조판', pattern: '목록마다 줄 수가 같다', why: `목록 ${lists.length}묶음 가운데 ${same}묶음이 똑같이 ${k}줄이다. 내용과 상관없이 개수를 맞춘 흔적이다.`, fix: '실제 내용만큼만 쓴다.', count: same, weight: 3, spots: [] }); }
  }
  return { findings, metrics, stats: { chars, paras: paras.length, sents: sents.length } };
}

// 종합: 지표 하나만으로는 판정하지 않는다(오탐 방지). 서로 다른 신호가 겹칠 때만 올린다.
//  - 붙여 넣은 흔적(대화 말투 · 남은 기호 · 빈 자리표시)은 그 자체가 직접 증거라 "높음".
//  - 그 밖에는 근거가 강함 · 보통인 서로 다른 신호가 몇 가지 겹치는지와 글 길이에 견준 양을 함께 본다.
// d = { findings, stats: { chars } }
function verdictOf(d) {
  const per = d.stats.chars / 1000 || 1, fs0 = d.findings, w = (f) => (f.weight || 1) * Math.min(4, 1 + Math.log2(Math.max(1, f.count)));
  const score = fs0.reduce((a, f) => a + w(f), 0), dens = score / Math.max(1.5, Math.sqrt(per) * 1.6);
  const direct = fs0.filter((f) => f.ev === '직접'), strong = new Set(fs0.filter((f) => f.ev === '강함').map((f) => f.rule || f.pattern)), mid = new Set(fs0.filter((f) => f.ev === '보통' && f.src !== 'AI').map((f) => f.rule || f.pattern)), aiN = fs0.filter((f) => f.src === 'AI').length, kinds = strong.size + mid.size + Math.min(2, Math.floor(aiN / 2));   // AI 검토가 짚은 것은 많아도 두 가지로만 친다
  const levelsHit = LEVELS.filter((l) => fs0.some((f) => f.level === l && f.ev !== '약함')).length;
  let level = '낮음';
  if (direct.length) level = '높음';
  else if (dens >= 9 && strong.size >= 2 && kinds >= 5 && levelsHit >= 3) level = '높음';
  else if (dens >= 4 && kinds >= 3 && levelsHit >= 2) level = '보통';
  const by = {}; for (const l of LEVELS) by[l] = fs0.filter((f) => f.level === l).length;
  const top = fs0.slice().sort((a, b) => w(b) - w(a)).slice(0, 3).map((f) => f.pattern);
  const why = direct.length ? `AI 답변을 붙여 넣은 흔적이 있습니다(${direct.map((f) => f.pattern).join(', ')}).` : level === '높음' ? `서로 다른 신호 ${kinds}가지가 문단 · 문장 · 단어 · 조판 가운데 ${levelsHit}갈래에 걸쳐 겹칩니다.` : level === '보통' ? `신호 ${kinds}가지가 겹치지만 단정할 만큼은 아닙니다.` : fs0.length ? '찾은 것이 몇 가지 있지만 겹치는 정도가 약합니다. 지표 하나만으로는 판단하지 않습니다.' : '눈에 띄는 신호를 찾지 못했습니다.';
  const summary = `${why}${fs0.length ? ` 찾은 것 ${fs0.length}가지(문단 ${by['문단']} · 문장 ${by['문장']} · 단어 ${by['단어']} · 조판 ${by['조판']}), 두드러진 것: ${top.join(', ')}.` : ''}`;
  return { level, score: Math.round(dens * 10) / 10, by, summary, kinds, strong: strong.size, direct: direct.length };
}

module.exports = { splitParas, sentencesOf, ruleCheck, verdictOf, WORD_RULES, DENSITY, EVID, WEIGHT, DOC_EXT, LEVELS, STEPS, newId, str, arr, ymd };

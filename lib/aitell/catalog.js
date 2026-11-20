'use strict';
// aitell/catalog.js — 무엇을 어떤 방식으로 찾는지의 목록(Work › 유형 · 낱말 사전).
// 유형 목록은 벤치마크의 diagnosis-rules.md(85개)를 읽어 만들고, 판정 방식은 이 ANA의 구현 상태에서 나온다.
//   method 'logic' = 규칙(정규식·계산)으로 찾는다 — rules.js / detect.js
//          'llm'   = 글을 읽어 판단해야 한다(LLM as judge, skills/ai-tell-detect의 2차 단계)
//          'mixed' = 규칙이 후보를 찾고, 해당 여부는 읽어서 정한다

const fs = require('node:fs');
const path = require('node:path');
const { PHRASE, HUMAN_MARKERS, GROUPS } = require('./rules.js');
const LEXICON = require('./third_party/im-not-ai/lexicon.json');

// detect.js 안에서 계산으로 잡는 유형(위치 있음)과 글 전체 신호(위치 없음)
const STRUCT = {
  'C-2': '불릿이 3줄 이상 연속', 'C-3': '도식 제목 2개 이상', 'C-10': '콜론 제목 2개 이상', 'C-5': '이모지 1개부터',
  'C-7': '문단 머리가 먼저→반면→결국 순서', 'D-11': '글 후반 30%의 문장 머리', 'E-2': '같은 종결 4문장 이상 연속', 'I-4': '당위로 끝나는 문단 2개 이상',
};
const SIGNAL = {
  'E-1': '20문장 이상인 글에 100자 넘는 문장이 0개', 'C-12': '쉼표가 든 문장이 50% 초과(8문장 이상)',
  'E-3': '본문 문단 4개 이상이 모두 3~4문장', 'E-4': '이음 없는 단문이 80% 이상(8문장 이상)',
};

// 비고 — 특정 모델·서비스에서 두드러진다고 보고된 내용.
// 출처는 모두 im-not-ai: 실측(사람 60편 대 AI 60편, fable-5·gpt-5.6-sol·haiku-4.5, 1000어절당 건수)과 분류 체계 문서의 관찰 기록.
// 보고가 없는 유형은 비워 둔다 — 지어내지 않는다.
const MODEL_NOTES = {
  'C-8': '세 모델 공통: Claude fable-5 7.05 · OpenAI gpt-5.6-sol 6.63 · Claude haiku-4.5 4.84 (사람 0.52). 분류 체계는 GPT 계열에서 문단 전체가 이 틀로 굴러가는 경향이 특히 강하다고 적는다.',
  'I-4': 'OpenAI gpt-5.6-sol에서 두드러진다: 12.01 (Claude haiku-4.5 5.65 · fable-5 2.61 · 사람 1.64).',
  'F-5': '세 모델 모두 사람보다 많다: Claude haiku-4.5 6.85 · fable-5 6.26 · OpenAI gpt-5.6-sol 4.97 (사람 3.87). 격차는 작다.',
  'H-1': 'Claude haiku-4.5 한 모델이 끌어올린 신호: 6.85. fable-5 0.26 · gpt-5.6-sol 0.83은 사람(0.43)과 구별되지 않는다.',
  'H-3': 'Claude haiku-4.5에서만 보고됐다: 2.02. fable-5와 gpt-5.6-sol은 0.00, 사람은 0.86.',
  'A-20': '세 모델 모두 사람보다 많고 Claude haiku-4.5에서 가장 많다: haiku-4.5 6.45 · fable-5 2.61 · gpt-5.6-sol 1.66.',
  'A-21': 'Claude fable-5와 OpenAI gpt-5.6-sol 중심으로 보고됐다(AI 12건/12편, 사람 60편 0건).',
  'C-10': 'Google Gemini에서 우세한 시그니처로 보고됐다(Gemini Pro 2.5 표본 4편).',
  'D-7': 'Google Gemini에서 우세한 시그니처로 보고됐다(Gemini Pro 2.5 표본, 7회·2개 분야).',
  'D-4': 'Google Gemini는 "압도적·막강한·폭발적·파격적·대대적·강력한" 류를 많이 쓰는 것으로 보고됐다.',
  'J-2': 'Google Gemini는 한 문서에 따옴표 강조가 17~33회 나온 사례가 보고됐다.',
  'D-8': '세 모델 공통(fable-5 0.8 · gpt-5.6-sol 0.8 · haiku-4.5 1.2) — 모델·과업과 무관한 신호로 보고됐다.',
  'D-9': '세 모델 모두에서 나오고(0.3·0.4·0.4) 사람 60편에서는 0건.',
  'D-10': '세 모델 모두에서 보고됐다. 7건 중 6건이 문단·문서 끝.',
  'D-11': '세 모델 모두에서 보고됐다(AI 12건/12편, 사람 0건).',
  'D-12': 'Claude fable-5·haiku-4.5에서 보고됐다(AI 8건/8편, 사람 0건).',
  'D-13': '낱말 하나하나는 모델에 따라 쏠리지만 묶음으로는 세 모델 공통(에세이 한정).',
  'D-14': '세 모델 모두 사람보다 많고 Claude fable-5에서 가장 많다: fable-5 1.83 · gpt-5.6-sol 0.83 · haiku-4.5 0.40.',
  'I-3': '"~다는 뜻이다"는 GPT가 결산 문장에서 거의 자동으로 쓴다고 보고됐다. 변종 "~인 셈이다"는 Claude fable-5에 쏠린다.',
  'F-7': '세 모델 모두에서 보고됐다.',
  'G-3': '거의 나타나지 않는다(fable-5 1건 · gpt-5.6-sol 0건 · haiku-4.5 3건) — 보류된 유형.',
  'DS-3': '열거 표지를 쓰지 않는 OpenAI gpt 계열에서도 유지되는 신호로 보고됐다.',
};

const LLM_EXTRA = [
  { id: 'DS-1', label: '무시간 도입 — 첫 문장에 날짜·현장·인용이 없다', sev: '', sig: '첫 문장의 시점 앵커 보유율: 사람 33% 대 AI 10%' },
  { id: 'DS-3', label: '등장인물 없는 글 — 구체 인물·사례가 글을 관통하지 않는다', sev: '', sig: '사람 6/60편 대 AI 0/99편' },
  { id: 'DS-5', label: '경구형 결말 — 마지막 문장이 결산 경구', sev: '', sig: '마지막 문장의 결산 표지율: 사람 7% 대 AI 28~51%' },
];

function parseDiagnosis() {
  const md = fs.readFileSync(path.join(__dirname, 'third_party', 'im-not-ai', 'diagnosis-rules.md'), 'utf8');
  const out = []; const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^- \*\*([A-Z]-\d+)\*\*\s*(?:\[(S\d)\])?\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const label = m[3].split(' — ')[0].replace(/…$/, '').trim();
    const sg = /^\s+시그니처:\s*(.*)$/.exec(lines[i + 1] || '');
    out.push({ id: m[1], sev: m[2] || '', label, sig: sg ? sg[1].split(' · 예:')[0].replace(/\*\*/g, '').replace(/…$/, '').trim() : '' });
  }
  return out;
}

let cache = null;
function catalog() {
  if (cache) return cache;
  const phrase = new Map(PHRASE.map((r) => [r.id, r]));
  const basis = (id) => {
    const r = phrase.get(id);
    if (r) return (r.min > 1 ? `${r.scope === 'para' ? '한 문단' : '문서(2,000자당)'} ${r.min}회 이상이면 뚜렷` : '1회부터 뚜렷') + (r.cap === 'weak' ? ' → 항상 참고로만' : '');
    return STRUCT[id] || SIGNAL[id] || '';
  };
  const types = parseDiagnosis().map((t) => {
    const r = phrase.get(t.id);
    const method = (r || STRUCT[t.id] || SIGNAL[t.id]) ? 'logic' : 'llm';
    return { id: t.id, group: t.id[0], label: t.label, severity: t.sev, signature: t.sig, method,
      where: SIGNAL[t.id] ? '글 전체' : method === 'logic' ? '위치' : '위치(읽어서)',
      basis: method === 'logic' ? basis(t.id) : '글을 읽고 문맥으로 판단', caveat: (r && r.caveat) || '', note: MODEL_NOTES[t.id] || '' };
  });
  const have = new Set(types.map((t) => t.id));
  for (const r of PHRASE) if (!have.has(r.id)) types.push({ id: r.id, group: r.id.replace(/-.*/, ''), label: r.label, severity: r.sev, signature: r.why, method: 'logic', where: '위치', basis: basis(r.id), caveat: r.caveat || '', note: MODEL_NOTES[r.id] || (r.id === 'BOT-1' ? '벤치마크에 없는 유형. 이 ANA가 덧붙였고 모델별 보고는 없다.' : '') });
  for (const x of LLM_EXTRA) types.push({ id: x.id, group: 'DS', label: x.label, severity: '', signature: x.sig, method: 'llm', where: '글 전체(읽어서)', basis: '글을 읽고 문맥으로 판단', caveat: '', note: MODEL_NOTES[x.id] || '' });
  for (const h of HUMAN_MARKERS) types.push({ id: h.id + '↔', group: 'DS', label: `사람 글 쪽 표지 — ${h.label}`, severity: '', signature: '있으면 사람 글 쪽 참고(찾은 곳으로 올리지 않는다)', method: 'logic', where: '글 전체', basis: '1회부터 표시', caveat: '', note: h.id === 'DS-4' ? '수행적 자기 한정("솔직히·내가 보기에")은 사람 13건/11편 대 AI 99편 0건으로 보고됐다.' : '' });

  const lexicon = LEXICON.entries.map((e) => ({
    id: e.id, headword: e.headword, tier: e.tier, off: ['일반', '보고서', '논문'].every((g) => (e.skip_genres || []).includes(g)),
    skip_genres: e.skip_genres || [], change_when: (e.change_when || {})['일반'] || '', keep_when: (e.keep_when || {})['일반'] || '',
    example: (e.test_detect_pos || [])[0] || '', method: 'mixed',
  }));
  const count = (m) => types.filter((t) => t.method === m).length;
  cache = {
    groups: GROUPS, types, lexicon,
    counts: { types: types.length, logic: count('logic'), llm: count('llm'), lexicon: lexicon.length },
    llm_enabled: false,   // 2차(읽어서 판단)는 사용자가 허용하기 전까지 검사하기에 연결하지 않는다
    source: { name: 'im-not-ai', url: 'https://github.com/epoko77-ai/im-not-ai', license: 'MIT', lexicon_version: LEXICON.meta.version,
      note_basis: '비고의 수치는 im-not-ai의 실측(사람 60편 대 AI 60편 · Claude fable-5, OpenAI gpt-5.6-sol, Claude haiku-4.5 · 1000어절당 건수)과 분류 체계 문서의 관찰 기록이다. 표본이 작고 모델은 빨리 바뀐다.' },
  };
  return cache;
}

module.exports = { catalog };

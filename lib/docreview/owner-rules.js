'use strict';
// owner-rules.js — 이 Docs 주인이 문서를 고치며 지적한 것(공공 기획서 작업)을 문서검토 규칙으로 만든 것.
// 원래 doc-review 규칙(rules.js)은 받은 그대로 두고, 여기 규칙을 함께 돌린다. 각 항목 = { id, level, name, why, fix, basis }.
// 찾은 것의 꼴은 rules.js 의 findings 와 같다: { rule, level, pattern, why, fix, ev, weight, count, spots:[{p, quote}] }

const RULES = [
  { id: 'o_tail', level: '문장', name: '개조식 끝맺음 누락', why: '개조식 항목이 연도·수치에서 뚝 끊겨 끝난다(예: "…확대는 2028년").', fix: '"~으로 함", "~임"처럼 개조식 서술로 맺는다(예: "…확대는 2028년으로 함").', basis: '개조식 줄(○ · ※ · - · ◈)이 연도 · 금액 · 개수로 끝나면 한 곳부터' },
  { id: 'o_slogan', level: '문장', name: '구호형 키 메시지', why: '전략 · 원칙 이름이 "~ 중심", "~으로 시작", "기능은 독립, 사용은 하나"처럼 구호로 쓰였다. 보고서에서는 어색하다.', fix: '개조식 명사형으로 쓴다(예: "사람 승인 중심" → "감정관 승인 기반 운영", "최소 조합으로 시작" → "최소 기술 조합 우선 적용").', basis: '짧은 항목 이름이 구호 꼴이면 한 곳부터' },
  { id: 'o_product', level: '단어', name: '제품 · 도구 이름 나열', why: '기획서 독자는 오픈소스 제품 이름보다 무엇을 하는 기능인지를 본다. 제품 이름은 설계서에 둔다.', fix: '제품 이름을 지우거나 기능 이름으로 바꾼다(예: "Kueue" → "작업 대기열", "Keycloak" → "인증 중계").', basis: '알려진 제품 · 도구 이름이 문서에서 3번 이상' },
  { id: 'o_jargon', level: '단어', name: '풀이 없는 외래 전문 용어', why: '"에어갭" 같은 영어 전문 용어가 풀이 없이 쓰였다.', fix: '처음 나올 때 우리말로 풀어 쓰거나("에어갭(인터넷 미연결 망분리)") 우리말 표현으로 바꾼다.', basis: '외래 전문 용어가 풀이 괄호 없이 3번 이상' },
  { id: 'o_termmix', level: '단어', name: '같은 대상을 다른 이름으로', why: '같은 것을 가리키는 말이 문서 안에서 섞여 쓰인다(예: 중앙 플랫폼 / 통합 플랫폼, 담당관 / 담당자). 상위 개념과 구성 요소가 뒤섞이기도 한다.', fix: '용어 하나로 맞추고, 처음 나올 때 정의한다(예: "원스톱 AI 운영 플랫폼 = 중앙 플랫폼 + 통합 DB + 각종 Ops").', basis: '같은 대상을 부르는 이름이 2가지 이상 쓰이면' },
  { id: 'o_moneysum', level: '문단', name: '요약이 금액 위주', why: '앞머리 요약(◈ 항목)이 대부분 예산 금액이라 문서 전체(배경 · 내용 · 원칙)를 대표하지 못한다.', fix: '요약을 배경 · 내용 · 예산·원칙처럼 문서 전체를 고르게 담도록 고친다.', basis: '◈ 요약 항목의 절반 이상에 금액(억 원)이 들어 있으면' },
  { id: 'o_levelmix', level: '문단', name: '체계도에 급이 다른 세부 내용', why: '비전 · 목표 · 전략 체계도 안에 과제 번호(A-01 …) 같은 한 해치 실행 목록이 들어 있다.', fix: '체계도에는 5개년 단위의 추진과제를 쓰고, 과제 번호 목록은 본문 표로 보낸다.', basis: '"비전"이 나온 뒤 가까운 곳에 과제 번호가 2개 이상' },
  { id: 'o_outline', level: '조판', name: '제목 체계 불일치', why: '제목·항목이 "Ⅰ → 1.1. → □ → ○" 체계를 따르지 않는다. □를 절 제목으로 쓰고 "(1)"·"[서브시스템]" 같은 머리말을 붙였다.', fix: '장(Ⅰ) 아래 절은 "1.1." 번호 제목으로, 그 아래 핵심 항목은 □, 세부는 ○로 맞춘다.', basis: '"□ (1)"·"□ [ … ]" 꼴 제목이 2개 이상이거나, 장 제목은 있는데 "N.M." 절 제목이 없을 때' },
  { id: 'o_opsname', level: '단어', name: '영문 구성 요소 이름', why: '구성 요소를 "AgentOps · LLMOps · MLOps"처럼 영문 약칭으로 부른다.', fix: '"에이전트 운영 · LLM 운영 · 모델 운영"처럼 우리말 이름을 쓰고 괄호 설명은 붙이지 않는다.', basis: '영문 Ops 약칭이 3번 이상' },
  { id: 'o_lonepage', level: '조판', name: '한두 줄만 남은 쪽', why: '앞 쪽에서 넘친 한두 줄(주석 · 마지막 문장)만 한 쪽에 홀로 있다. 쪽이 거의 비어 낭비로 보인다.', fix: '앞 쪽의 표 칸 여백 · 줄 간격을 줄이거나 표를 조금 줄여 앞 쪽으로 합친다(문장을 다듬어 한 줄을 줄여도 된다).', basis: '화면 쪽 나눔에서 내용이 두 줄 이하인 쪽이 있을 때(문서검토를 돌린 화면 기준)' },
  { id: 'o_literal', level: '단어', name: '직역 외래어', why: '영어 표현을 글자 그대로 옮겨 우리 보고서에서 쓰지 않는 말이 되었다(예: blind comparison → "눈가림 비교", deterministic metric → "결정적 지표").', fix: '참고 문서나 업무에서 실제로 쓰는 말로 바꾼다(예: "담당자-AI 비교(작성자 가림)", "규칙 기반 지표"). 꼭 필요하면 괄호로 풀이를 단다.', basis: '직역 외래어 목록(눈가림 · 결정적 지표 · 세로로 관통 · 근거 칩 · 관측성 · 지상 진실 · 골든셋 · 가드레일 · 엔드투엔드 · 플레이북 · 온보딩 · 휴먼 인 더 루프 등)이 한 번이라도 나올 때' },
  { id: 'o_toc', level: '조판', name: '목차에 쪽 번호 없음', why: '목차 줄에 쪽 번호가 없다.', fix: '쪽 번호를 오른쪽 끝에 맞추고 사이를 점으로 채운다(오른쪽 탭 · 점 채움).', basis: '"목차" 아래 장·절 줄이 5개 이상인데 쪽 번호로 끝나는 줄이 없을 때' },
];

const PRODUCTS = /\b(Kueue|OpenBao|Triton|Helm|PostgreSQL|MLflow|promptfoo|Keycloak|Ceph|RKE2|React|PDF\.js|Presidio|Docling|Trino|Iceberg|Syft|Trivy|vLLM|Harbor|OpenSearch|ResourceQuota|Redis|Kafka|Airflow|LangChain|LangGraph|Elasticsearch|MinIO|Grafana|Prometheus|Argo ?CD|Jenkins|GitLab)\b/g;
const JARGON = /(에어갭|레드팀|오케스트레이션|레이크하우스|샌드박스|온톨로지|페르소나|하네스)(?!\s*\()/g;
// 직역 외래어: [찾을 말, 바꿀 말 예]
const LITERAL = [[/눈가림/g, '담당자-AI 비교(작성자 가림) · 블라인드 평가'], [/결정적\s?(지표|채점|평가)/g, '규칙 기반 지표(같은 입력이면 같은 점수)'], [/(세로로|가로로)\s?관통/g, '모든 계층에 걸쳐'], [/근거\s?칩/g, '근거 표시'], [/관측\s?(성|가능성)/g, '운영 상태 감시'], [/지상\s?진실/g, '정답 자료'], [/골든\s?셋/g, '기준 정답 자료'], [/가드레일/g, '안전장치 · 차단 규칙'], [/엔드\s?투\s?엔드/g, '처음부터 끝까지'], [/플레이북/g, '대응 절차서'], [/온보딩/g, '도입 지원 · 사용 교육'], [/휴먼\s?인\s?더\s?루프/g, '사람 확인 단계'], [/레버리지/g, '활용'], [/가시성\s?확보/g, '현황 파악']];
const TERM_GROUPS = [['중앙 플랫폼', '통합 플랫폼'], ['공통 서브시스템', '공통기반', '공통 기반'], ['담당관', '담당자'], ['작업 화면', '작업화면'], ['통합 DB', '통합DB', '통합 데이터베이스']];
const BULLET = /^\s*[○ㅇ※\-–◈•·]\s?/;

function hitsIn(paras, re, limit = 6) {
  const out = [];
  for (const p of paras) { const r = new RegExp(re.source, re.flags); let m; while ((m = r.exec(p.text))) { out.push({ p: p.i, quote: m[0] }); if (out.length >= limit) return out; if (m.index === r.lastIndex) r.lastIndex++; } }
  return out;
}
const count = (paras, re) => paras.reduce((n, p) => n + ((p.text.match(new RegExp(re.source, re.flags)) || []).length), 0);

function ownerCheck(paras) {
  const R = Object.fromEntries(RULES.map((r) => [r.id, r]));
  const found = [];
  const add = (id, spots, cnt, extra = {}) => { const r = R[id]; found.push({ rule: id, level: r.level, pattern: r.name, why: extra.why || r.why, fix: r.fix, ev: '보통', weight: 1.5, count: cnt, spots }); };

  // 개조식 끝맺음 누락
  const tail = paras.filter((p) => { const t = p.text.trim(); return BULLET.test(t) && t.length >= 15 && /(\d{4}년|\d+(?:\.\d+)?\s?(?:억|억 원|백만 원|개|건|명|%))\)?\s*$/.test(t) && !/(함|임|음|됨|있음|없음)\s*\([^()]*\)\s*$/.test(t); });
  if (tail.length) add('o_tail', tail.slice(0, 8).map((p) => ({ p: p.i, quote: p.text.trim().slice(-Math.min(30, p.text.trim().length)) })), tail.length);

  // 구호형 키 메시지
  const slo = paras.filter((p) => { const t = p.text.trim(); return t.length <= 16 && !BULLET.test(t) && /(중심|으로 시작|로 시작|은 하나|는 하나|는 독립,?|은 독립,?|부터 먼저)$/.test(t); });
  if (slo.length) add('o_slogan', slo.slice(0, 8).map((p) => ({ p: p.i, quote: p.text.trim() })), slo.length);

  // 제품 · 도구 이름
  const np = count(paras, PRODUCTS);
  if (np >= 3) add('o_product', hitsIn(paras, PRODUCTS, 8), np);

  // 풀이 없는 외래 전문 용어
  const nj = count(paras, JARGON);
  if (nj >= 3) add('o_jargon', hitsIn(paras, JARGON, 6), nj);
  // 직역 외래어 — 한 번만 나와도 짚는다(어느 말로 바꿀지 함께)
  { const spots = []; const fixes = []; let cnt = 0;
    for (const [re, to] of LITERAL) { const h = hitsIn(paras, re, 4); if (h.length) { spots.push(...h); cnt += count(paras, re); fixes.push(`"${h[0].quote}" → ${to}`); } }
    if (spots.length) add('o_literal', spots.slice(0, 10), cnt, { why: `${R.o_literal.why} 이 문서: ${fixes.join(' · ')}` }); }

  // 같은 대상을 다른 이름으로
  for (const g of TERM_GROUPS) {
    const used = g.map((w) => ({ w, n: count(paras, new RegExp(w.replace(/\s/g, '\\s?'), 'g')) })).filter((x) => x.n);
    // "통합 DB" 와 "통합DB"처럼 띄어쓰기만 다른 것은 같은 정규식에 걸리므로 실제 글자로 다시 센다
    const exact = g.map((w) => ({ w, n: count(paras, new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) })).filter((x) => x.n);
    if (used.length && exact.length >= 2) {
      exact.sort((a, b) => b.n - a.n);
      const minor = exact.slice(1);
      add('o_termmix', minor.flatMap((x) => hitsIn(paras, new RegExp(x.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 4)).slice(0, 8), minor.reduce((a, x) => a + x.n, 0),
        { why: `같은 대상을 ${exact.map((x) => `"${x.w}"(${x.n})`).join(' · ')}로 섞어 부른다.` });
    }
  }

  // 요약이 금액 위주
  const sums = paras.slice(0, 60).filter((p) => /^\s*◈/.test(p.text));
  const money = sums.filter((p) => /\d\s?억/.test(p.text));
  if (sums.length >= 2 && money.length * 2 >= sums.length && money.length >= 2) add('o_moneysum', money.slice(0, 4).map((p) => ({ p: p.i, quote: p.text.trim().slice(0, 30) })), money.length);

  // 체계도에 급이 다른 세부 내용
  const vi = paras.findIndex((p) => /^비\s*전$|비전 및 추진전략|비전·목표/.test(p.text.trim()));
  if (vi >= 0) {
    const near = paras.slice(vi, vi + 40).filter((p) => (p.text.match(/\b[A-Z]{3}-\d{2}\b/g) || []).length >= 2);
    if (near.length) add('o_levelmix', near.slice(0, 4).map((p) => ({ p: p.i, quote: (p.text.match(/\b[A-Z]{3}-\d{2}\b[^·]{0,16}/) || [p.text.slice(0, 24)])[0] })), near.length);
  }
  // 제목 체계 불일치
  const oldHead = paras.filter((p) => /^\s*□\s*(\(\d+\)|\[[^\]]+\])/.test(p.text));
  const hasChap = paras.some((p) => /^[ⅠⅡⅢⅣⅤⅥⅦⅧ](\s|$)/.test(p.text.trim())); const hasSect = paras.some((p) => /^\d+\.\d+\.\s/.test(p.text.trim()));
  if (oldHead.length >= 2) add('o_outline', oldHead.slice(0, 6).map((p) => ({ p: p.i, quote: p.text.trim().slice(0, 30) })), oldHead.length);
  else if (hasChap && !hasSect) { const h = paras.filter((p) => /^\s*□/.test(p.text) && p.text.length <= 40).slice(0, 4); if (h.length) add('o_outline', h.map((p) => ({ p: p.i, quote: p.text.trim().slice(0, 30) })), h.length, { why: '장 제목 아래에 "1.1." 절 제목이 없고 □가 절 제목 노릇을 한다.' }); }

  // 영문 구성 요소 이름
  const OPS = /\b(AgentOps|LLMOps|MLOps|DataOps|DevOps)\b/g; const no = count(paras, OPS);
  if (no >= 3) add('o_opsname', hitsIn(paras, OPS, 6), no);

  // 목차에 쪽 번호 없음
  const ti = paras.findIndex((p) => /^목\s*차$/.test(p.text.trim()));
  if (ti >= 0) {
    const toc = paras.slice(ti + 1, ti + 80).filter((p) => /^([ⅠⅡⅢⅣⅤⅥⅦⅧ]|\d+\.\d+\.|붙임|첨부)/.test(p.text.trim()));
    if (toc.length >= 5 && !toc.some((p) => /\d\s*$/.test(p.text.trim()) && /[\t·.…\s]\d+\s*$/.test(p.text))) add('o_toc', toc.slice(0, 3).map((p) => ({ p: p.i, quote: p.text.trim().slice(0, 30) })), toc.length);
  }
  return found;
}

// AI 검토 지시문에 덧붙이는 주인의 기준(글자로는 셀 수 없는 조판 · 짜임까지)
const REVIEWER_NOTE = `
이 Docs 주인이 실제로 지적해 온 것(함께 본다):
- 개조식 줄이 연도·수치에서 뚝 끝남("…확대는 2028년") → "~으로 함"
- 전략·원칙 이름이 구호형("사람 승인 중심", "기능은 독립, 사용은 하나") → 개조식 명사형
- 오픈소스 제품·도구 이름 나열 → 기능 이름으로 · 풀이 없는 외래 용어("에어갭") → 우리말 풀이
- 영어를 글자 그대로 옮긴 직역 외래어("눈가림 비교" ← blind comparison, "결정적 지표" ← deterministic metric, "세로로 관통") → 참고 문서·업무에서 실제로 쓰는 말("담당자-AI 비교(작성자 가림)", "규칙 기반 지표")
- 같은 대상을 다른 이름으로 부름(중앙/통합 플랫폼, 담당관/담당자), 상위 개념과 구성 요소 혼용
- 요약이 금액 위주라 문서 전체를 대표하지 못함 · 체계도에 급이 다른 세부(과제 번호)가 섞임
- 조판: 2단계 이상 들여쓰기가 과함, 진한 바탕 칸에 긴 글, 앞 쪽에서 넘친 한두 줄만 있는 빈 쪽, 편집할 수 없는 그림으로 넣은 표
- 제목 체계는 "Ⅰ → 1.1. → □ → ○". 장(Ⅰ)은 새 쪽에서 시작하고, 제목만 쪽 끝에 남기지 않는다. 표·그림 제목은 그 표와 같은 쪽에 두고, 표는 가급적 쪽에서 나누지 않는다.
- 표 안 항목이 두 줄로 넘어가면 둘째 줄을 첫 줄 글자 시작에 맞춘다(내어쓰기). 한국어는 단어 중간에서 줄을 바꾸지 않는다.
- 범례는 빈 행으로 표와 구분한다. 표 머리에서 번호와 이름은 다른 행으로 나눈다. 다이어그램은 칸 여백을 두어 읽기 쉽게.
- 목차에는 쪽 번호를 오른쪽 끝에 맞추고 사이를 점으로 채운다.
- 구성 요소는 우리말 이름(에이전트 운영 · LLM 운영 · 모델 운영)으로 쓰고 괄호 설명을 붙이지 않는다. 함축적인 요구 내용은 항목별 문장으로 풀어 쓴다.
- 비교 대상이 없는 "처음 구상", 꼭 필요하지 않은 "간이" 같은 수식은 쓰지 않는다.`;

// 화면이 보낸 「한두 줄만 남은 쪽」(lone: [{k 첫 문단 키, page, lines}]) → 찾은 것 하나
function lonePages(paras, lone) {
  const byK = new Map(paras.map((p, i) => [p.k, i])); const spots = [];
  for (const x of lone) { const i = byK.get(x.k); if (i === undefined) continue; spots.push({ p: paras[i].i !== undefined ? paras[i].i : i, quote: paras[i].text.trim().slice(0, 30) }); }
  if (!spots.length) return null;
  const R0 = RULES.find((r) => r.id === 'o_lonepage');
  return { rule: R0.id, level: R0.level, pattern: R0.name, why: `${R0.why} (${lone.map((x) => `${x.page}쪽`).join(', ')})`, fix: R0.fix, ev: '직접', weight: 1, count: spots.length, spots };
}
module.exports = { RULES, ownerCheck, lonePages, REVIEWER_NOTE };

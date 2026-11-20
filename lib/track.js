'use strict';
// track.js — 변경 추적(track changes) 엔진. 의존성 없음.
//
// 문단 하나 = 조각(seg)의 줄.
//   seg { t: 글자들, o?: 원본에서의 시작 위치(원본 글자일 때), ins?: {by, at, cid}, del?: {by, at, cid} }
//   · 원본 글   = ins 가 없는 조각을 이은 것
//   · 최종본 글 = del 이 없는 조각을 이은 것
//   · 수정(바꾸기) = 옛 글자에 del + 새 글자에 ins, 둘이 같은 cid(변경 번호)
//   · 서식 = seg.f { b|i|u|sz|c: [값, cid] } — 굵게·기울임·밑줄(1/0), 크기(1/100 pt), 색('#rrggbb'). 원래 모양 위에 덮어쓴다.
// 사람이 문단을 고치면 "고치기 전 최종 글 → 고친 뒤 최종 글"의 차이를 구해 조각에 반영한다.

const sameMark = (a, b) => (!a && !b) || (a && b && a.cid === b.cid && a.by === b.by);
const fsig = (f) => (f ? JSON.stringify(Object.keys(f).sort().map((k) => [k, f[k]])) : '');
const sameF = (a, b) => a === b || fsig(a) === fsig(b);

function toChars(segs) {
  const out = [];
  for (const s of segs) {
    for (let i = 0; i < s.t.length; i++) out.push({ c: s.t[i], o: s.o === undefined ? undefined : s.o + i, ins: s.ins, del: s.del, f: s.f });
  }
  return out;
}
function toSegs(chars) {
  const out = [];
  let cur = null, last = null;
  for (const ch of chars) {
    const joins = cur && sameMark(last.ins, ch.ins) && sameMark(last.del, ch.del) && sameF(last.f, ch.f)
      && ((last.o === undefined && ch.o === undefined) || (last.o !== undefined && ch.o === last.o + 1));
    if (joins) cur.t += ch.c;
    else { cur = { t: ch.c }; if (ch.o !== undefined) cur.o = ch.o; if (ch.ins) cur.ins = ch.ins; if (ch.del) cur.del = ch.del; if (ch.f && Object.keys(ch.f).length) cur.f = ch.f; out.push(cur); }
    last = ch;
  }
  return out;
}
const finalText = (segs) => segs.filter((s) => !s.del).map((s) => s.t).join('');
const originalText = (segs) => segs.filter((s) => !s.ins).map((s) => s.t).join('');
const baseSegs = (text) => (text ? [{ t: text, o: 0 }] : []);

// a → b 의 차이를 [{eq:n} | {del:n, ins:'…'}] 로. 앞뒤 공통 부분을 떼고, 가운데가 길면 LCS 로 여러 곳을 나눈다.
function diff(a, b) {
  let p = 0; const max = Math.min(a.length, b.length);
  while (p < max && a[p] === b[p]) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  // 낱말 가운데만 바뀐 '바꾸기'는 낱말 단위로 넓힌다(양식→서식: '양'→'서' 가 아니라 낱말 전체) — 옛 낱말 취소선 + 새 낱말 강조
  if (a.length - p - s > 0 && b.length - p - s > 0) {
    const W = /[0-9A-Za-z\u00c0-\u024f\u3131-\u318e\uac00-\ud7a3\u4e00-\u9fff]/;
    let n = 0; while (p > 0 && n < 24 && W.test(a[p - 1])) { p--; n++; }
    n = 0; while (s > 0 && n < 24 && W.test(a[a.length - s])) { s--; n++; }
  }
  const am = a.slice(p, a.length - s), bm = b.slice(p, b.length - s);
  const ops = [];
  if (p) ops.push({ eq: p });
  if (am.length || bm.length) {
    if (am.length >= 8 && bm.length >= 8 && am.length * bm.length <= 4e6) ops.push(...lcsOps(am, bm));
    else ops.push({ del: am.length, ins: bm });
  }
  if (s) ops.push({ eq: s });
  return ops;
}
function lcsOps(a, b) {
  const n = a.length, m = b.length, w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  // 원시 연산열
  const raw = []; let i = 0, j = 0;
  const push = (k, c) => { const l = raw[raw.length - 1]; if (l && l.k === k) l.s += c; else raw.push({ k, s: c }); };
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('e', a[i]); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { push('d', a[i]); i++; }
    else { push('i', b[j]); j++; }
  }
  if (i < n) push('d', a.slice(i)); if (j < m) push('i', b.slice(j));
  // 변경 사이에 낀 짧은 일치(4자 미만)는 우연이므로 변경으로 합친다 — 문장을 통째로 바꿨을 때 색종이처럼 흩어지지 않게
  const ops = []; let d = '', ins = '';
  const flush = () => { if (d || ins) { ops.push({ del: d.length, ins }); d = ''; ins = ''; } };
  raw.forEach((r, idx) => {
    if (r.k === 'd') d += r.s;
    else if (r.k === 'i') ins += r.s;
    else if (r.s.length < 4 && idx > 0 && idx < raw.length - 1) { d += r.s; ins += r.s; }
    else { flush(); ops.push({ eq: r.s.length }); }
  });
  flush();
  return ops;
}

// 문단 조각에 "최종 글을 newText 로" 를 반영한다. 돌려주는 값: { segs, cids: 이번에 쓰인 변경 번호들 }
function applyEdit(segs, newText, by, at, newCid) {
  const chars = toChars(segs);
  const ops = diff(finalText(segs), newText);
  const out = []; const cids = new Set();
  let i = 0;
  const mine = (ch) => (ch && ((ch.del && ch.del.by === by && ch.del.cid) || (ch.ins && !ch.del && ch.ins.by === by && ch.ins.cid))) || null;
  for (const op of ops) {
    if (op.eq) {
      let left = op.eq;
      while (left > 0 && i < chars.length) { const ch = chars[i++]; out.push(ch); if (!ch.del) left--; }
      continue;
    }
    // 이미 지워진 글자는 건너 보낸다(변경 지점을 살아 있는 글자 바로 앞에 맞춘다) — 단, 넣기만 할 때는 그 자리 그대로
    if (op.del) while (i < chars.length && chars[i].del) out.push(chars[i++]);
    // 이 변경이 붙을 번호: 바로 앞·뒤가 같은 사람의 변경이면 그 번호를 잇는다(한 문장을 이어 쓰면 변경 하나)
    let look = i, left = op.del;
    while (left > 0 && look < chars.length) { if (!chars[look].del) left--; look++; }
    const cid = mine(out[out.length - 1]) || mine(chars[look]) || newCid();
    cids.add(cid);
    left = op.del;
    while (left > 0 && i < chars.length) {
      const ch = chars[i++];
      if (ch.del) { out.push(ch); continue; }
      left--;
      if (ch.ins && ch.ins.by === by) continue;            // 내가 넣은 글자는 그냥 없앤다
      out.push({ ...ch, del: { by, at, cid } });           // 원본 글자·남이 넣은 글자는 취소선으로 남긴다
    }
    let inh; for (let k = out.length - 1; k >= 0 && k >= out.length - 400; k--) { if (!out[k].del || (out[k].del.cid === cid)) { inh = out[k].f; break; } }
    for (const c of op.ins || '') out.push({ c, ins: { by, at, cid }, ...(inh ? { f: inh } : {}) });
  }
  while (i < chars.length) out.push(chars[i++]);
  return { segs: toSegs(out), cids: [...cids] };
}

// 변경 하나를 되돌린다: 그 변경이 넣은 글자는 없애고, 그 변경이 지운 표시는 푼다.
function revert(segs, cid) {
  const out = [];
  for (const ch of toChars(segs)) {
    if (ch.ins && ch.ins.cid === cid) continue;
    if (ch.del && ch.del.cid === cid) out.push({ c: ch.c, o: ch.o, ins: ch.ins, f: ch.f });
    else out.push(ch);
  }
  return toSegs(out);
}

// 문단 조각에서 변경 목록을 뽑는다: [{cid, by, at, del:'지운 글', ins:'넣은 글'}] (문단 안 순서)
function changesOf(segs) {
  const map = new Map();
  const get = (m) => { let c = map.get(m.cid); if (!c) { c = { cid: m.cid, by: m.by, at: m.at, del: '', ins: '' }; map.set(m.cid, c); } if (m.at > c.at) c.at = m.at; return c; };
  for (const s of segs) {
    if (s.del) get(s.del).del += s.t;
    if (s.ins && !s.del) get(s.ins).ins += s.t;
  }
  return [...map.values()];
}

// 서식 입히기: 최종 글의 [a, b) 글자에 set({b,i,u,sz,c} 중 일부)을 cid 로 덮어쓴다. clear 면 그 범위의 서식을 모두 걷는다.
function applyFormat(segs, a, b, set, cid, clear) {
  const chars = toChars(segs); let i = 0; let n = 0;
  for (const ch of chars) {
    if (ch.del) continue;
    if (i >= a && i < b) {
      if (clear) { if (ch.f) { delete ch.f; n++; } }
      else { const f = { ...(ch.f || {}) }; for (const [k, v] of Object.entries(set)) f[k] = [v, cid]; ch.f = f; n++; }
    }
    i++;
  }
  return { segs: toSegs(chars), n };
}
// 서식 변경 하나를 걷는다
function revertFormat(segs, cid) {
  const chars = toChars(segs);
  for (const ch of chars) { if (!ch.f) continue; const f = {}; for (const [k, v] of Object.entries(ch.f)) if (v[1] !== cid) f[k] = v; ch.f = Object.keys(f).length ? f : undefined; }
  return toSegs(chars);
}
// 문단 안의 서식 변경 목록: [{cid, text: 그 서식이 걸린 글}]
function formatsOf(segs) {
  const map = new Map();
  for (const s of segs) { if (!s.f || s.del) continue; for (const v of Object.values(s.f)) { const id = v[1]; if (!map.has(id)) map.set(id, { cid: id, text: '', seen: new Set() }); const e = map.get(id); if (!e.seen.has(s)) { e.seen.add(s); e.text += s.t; } } }
  return [...map.values()].map((e) => ({ cid: e.cid, text: e.text }));
}
const hasMarks = (segs) => segs.some((x) => x.ins || x.del || x.f);

module.exports = { toChars, toSegs, finalText, originalText, baseSegs, diff, applyEdit, revert, changesOf, applyFormat, revertFormat, formatsOf, hasMarks, fsig };

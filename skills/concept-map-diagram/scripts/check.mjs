#!/usr/bin/env node
// 개념도 spec 검사 — 그리기 전에 틀린 참조·겹침·넘치는 글자를 찾는다.
//   node scripts/check.mjs <spec.json>      오류가 있으면 종료 코드 1
// 글자 폭은 어림값이다(한글 1em, 영문 0.58em). 경고는 실제 화면(스냅샷)으로 한 번 더 본다.
import fs from 'node:fs';
import { textWidth, FONT, LAYOUT, splitTwo } from './render.mjs';

export function check(spec) {
  const errors = [], warns = [];
  const E = (m) => errors.push(m), W = (m) => warns.push(m);
  const fits = (where, t, [size, bold], room) => { const w = textWidth(t, size, bold); if (w > room) W(`${where}: "${t}" 폭 약 ${Math.round(w)}px > 칸 ${room}px — 줄이거나 두 줄로`); };
  if (!spec || typeof spec !== 'object') return { errors: ['spec이 객체가 아님'], warns };
  if (!spec.core || !spec.core.name) E('core.name이 필요함(가운데 시스템 이름)');
  const mods = spec.modules || [];
  if (!mods.length) E('modules가 비어 있음(가운데 시스템 안의 단계)');
  if (mods.length > 8) W(`단계가 ${mods.length}개 — 7개 이하가 읽기 쉽다`);
  const n = mods.length, inRow = (r) => Number.isInteger(r) && r >= 0 && r < n;
  const wl = LAYOUT.wide, tl = LAYOUT.tall;
  mods.forEach((m, i) => {
    if (!m.title) E(`modules[${i}].title이 없음`);
    fits(`modules[${i}].title`, m.title || '', FONT.t, wl.module.w - 16);
    fits(`modules[${i}].sub`, m.sub || '', FONT.sub, wl.module.w - 16);
    const [a, b] = m.tall || splitTwo(m.sub || '');
    fits(`modules[${i}] 세로판 1줄`, a || '', FONT.sub, tl.module.w - 12);
    fits(`modules[${i}] 세로판 2줄`, b || '', FONT.sub, tl.module.w - 12);
  });
  fits('core.sub', spec.core && spec.core.sub || '', FONT.sub, wl.core.w - 24);
  fits('core.note', spec.core && spec.core.note || '', FONT.note, wl.core.w - 24);
  // 사람: 행이 겹치면 상자가 겹친다
  const taken = new Map();
  (spec.actors || []).forEach((a, i) => {
    const rows = Array.isArray(a.rows) ? a.rows : [a.row ?? 0];
    if (!a.title) E(`actors[${i}].title이 없음`);
    for (const r of rows) if (!inRow(r)) E(`actors[${i}].rows에 없는 행 ${r}(0~${n - 1})`);
    const lo = Math.min(...rows), hi = Math.max(...rows);
    for (let r = lo; r <= hi; r++) { if (taken.has(r)) E(`actors[${i}]와 actors[${taken.get(r)}]가 ${r}행에서 겹침`); taken.set(r, i); }
    fits(`actors[${i}].title`, a.title || '', FONT.t, wl.actor.w - 12);
    (a.lines || []).forEach((t, j) => fits(`actors[${i}].lines[${j}]`, t, FONT.sub, wl.actor.w - 12));
    if (hi === lo && (a.lines || []).length > 1) W(`actors[${i}]: 한 행 상자에는 설명 1줄만 들어감(${a.lines.length}줄) — rows를 늘리거나 줄이기`);
    if (hi > lo && (a.lines || []).length > (hi - lo + 1) * 2 + 1) W(`actors[${i}]: 설명 줄이 상자 높이보다 많음`);
    (a.links || []).forEach((l, j) => {
      if (!inRow(l.row)) E(`actors[${i}].links[${j}].row ${l.row}이 단계 범위 밖`);
      else if (l.row < lo || l.row > hi) E(`actors[${i}].links[${j}]: ${l.row}행은 이 사람 상자 높이(${lo}~${hi}) 밖 — 화살표가 상자에 닿지 않음`);
      const room = wl.core.x + (wl.core.w - wl.module.w) / 2 - (wl.actor.x + wl.actor.w) - 8;
      fits(`actors[${i}].links[${j}].label`, l.label || '', FONT.lbl, room);
      fits(`actors[${i}].links[${j}].back`, l.back || '', FONT.lbl, room);
    });
    if (!(a.links || []).length) W(`actors[${i}]: links가 없어 화살표가 없음`);
  });
  // 바깥 시스템: 같은 행이나 붙은 행이면 상자가 겹친다(상자 높이 80 > 행 간격 76)
  const er = [];
  (spec.externals || []).forEach((e, i) => {
    if (!e.title) E(`externals[${i}].title이 없음`);
    if (!inRow(e.row)) E(`externals[${i}].row ${e.row}이 단계 범위 밖`);
    for (const [j, r] of er) if (Math.abs(r - e.row) < 2) E(`externals[${i}]와 externals[${j}]가 겹침(행 ${r}·${e.row}) — 한 행 이상 떨어뜨리기`);
    er.push([i, e.row]);
    if ((e.lines || []).length > 2) W(`externals[${i}].lines는 2줄까지만 그림`);
    fits(`externals[${i}].title`, e.title || '', FONT.t, wl.external.w - 12);
    (e.lines || []).forEach((t, j) => fits(`externals[${i}].lines[${j}]`, t, FONT.sub, wl.external.w - 12));
    const room = wl.external.x - (wl.core.x + wl.core.w) - 8 + (wl.core.w - wl.module.w) / 2;
    fits(`externals[${i}].out`, e.out || '', FONT.lbl, room);
    fits(`externals[${i}].back`, e.back || '', FONT.lbl, room);
    const t = e.tall || {};
    fits(`externals[${i}] 세로판 제목`, t.title || e.title || '', FONT.t, tl.external.w - 6);
    fits(`externals[${i}] 세로판 설명`, t.sub ?? (e.lines || [])[0] ?? '', FONT.sub, tl.external.w - 6);
    fits(`externals[${i}] 세로판 보냄`, t.out ?? (e.out ? `→ ${e.out}` : ''), FONT.lbl, tl.external.w - 6);
    fits(`externals[${i}] 세로판 받음`, t.back ?? (e.back ? `← ${e.back}` : ''), FONT.lbl, tl.external.w - 6);
    if (!e.out && !e.back) W(`externals[${i}]: out·back이 없어 화살표가 없음`);
  });
  const hd = spec.tall && spec.tall.header;
  if (hd) { fits('tall.header.title', hd.title || '', FONT.t, tl.header.w - 16); fits('tall.header.sub', hd.sub || '', FONT.sub, tl.header.w - 16); }
  for (const [k, t] of (spec.tall && spec.tall.note || []).entries()) fits(`tall.note[${k}]`, t, FONT.note, tl.core.w - 12);
  return { errors, warns };
}

if (process.argv[1] && process.argv[1].endsWith('check.mjs')) {
  const file = process.argv[2];
  if (!file) { console.error('사용법: node scripts/check.mjs <spec.json>'); process.exit(2); }
  const spec = JSON.parse(fs.readFileSync(file, 'utf8')); const si = process.argv.indexOf('--scale'), sc = si > 0 ? Number(process.argv[si + 1]) || 1 : 1;
  const { errors, warns } = spec.layout === 'board' ? (await import('./board.mjs')).boardCheck(spec, sc) : check(spec);
  for (const e of errors) console.log('오류  ' + e);
  for (const w of warns) console.log('경고  ' + w);
  console.log(errors.length ? `오류 ${errors.length} · 경고 ${warns.length}` : `통과 · 경고 ${warns.length}`);
  process.exit(errors.length ? 1 : 0);
}

#!/usr/bin/env node
// 순서도·관계도 spec 검사 — 그리기 전에 잘못된 참조, 겹친 상자, 상자를 뚫는 선, 넘치는 글자, 상자 위 라벨을 찾는다.
//   node scripts/check.mjs <spec.json> [--scale 1.15]   오류가 있으면 종료 코드 1
//   --scale: 문서(인쇄)에 넣으려고 글자를 키워 찍을 때 그 배율로 글자 폭을 잰다
// 글자 폭은 어림값이다. 경고는 스냅샷(scripts/snapshot.mjs)으로 한 번 더 본다.
import fs from 'node:fs';
import { layout, textWidth, FONT } from './render.mjs';

const SIDES = ['top', 'bottom', 'left', 'right'];
const si = process.argv.indexOf('--scale'); const SCALE = si > 0 ? Number(process.argv[si + 1]) || 1 : 1;
export function check(spec) {
  const errors = [], warns = [];
  const E = (m) => errors.push(m), W = (m) => warns.push(m);
  const nodes = spec.nodes || [], rows = spec.rows || [];
  if (!rows.length) E('rows가 비어 있음(행 높이 목록)');
  if (!nodes.length) E('nodes가 비어 있음');
  const ids = new Set();
  nodes.forEach((n, i) => {
    if (!n.id) E(`nodes[${i}].id가 없음`); else if (ids.has(n.id)) E(`상자 id 중복: ${n.id}`); else ids.add(n.id);
    if (typeof n.col !== 'number' || n.col < 0) E(`${n.id}: col이 0 이상의 수가 아님(0.5처럼 열 사이도 됨)`);
    if (!Number.isInteger(n.row) || !rows[n.row]) E(`${n.id}: row ${n.row}이 rows 범위 밖`);
    if (!n.title) E(`${n.id}: title이 없음`);
  });
  for (const [k, z] of (spec.zones || []).entries()) for (const r of z.rows || []) if (!rows[r]) E(`zones[${k}]: 없는 행 ${r}`);
  if (errors.length) return { errors, warns };
  const L = layout(spec), B = Object.values(L.box);
  // 상자 겹침
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    const a = B[i], b = B[j];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) E(`상자 겹침: ${a.node.id} · ${b.node.id}`);
  }
  // 글자 폭(마름모는 가운데 폭의 60%만 쓴다)
  for (const b of B) {
    // 시작·끝(terminal)은 양 끝이 반원이라 글이 들어갈 폭이 상자 높이만큼 줄어든다
    const n = b.node, room = (n.kind === 'decision' ? b.w * 0.6 : n.kind === 'terminal' ? b.w - b.h * 0.9 : n.kind === 'actor' ? Math.min(b.w, b.h) * 0.82 : b.w - 14), lines = n.lines || [];
    if (n.kind === 'list') { const it = n.items || []; const iw = n.itemsRow ? (b.w - 16 - (it.length - 1) * 6) / Math.max(1, it.length) - 6 : b.w - 26; it.forEach((t, i) => { const w = textWidth(t, FONT.sub[0] * SCALE, false); if (w > iw) W(`${n.id}.items[${i}]: "${t}" 폭 약 ${Math.round(w)}px > ${Math.round(iw)}px`); }); const need = n.itemsRow ? 64 : 34 + it.length * 27; if (need > b.h) W(`${n.id}: 목록 ${it.length}칸이 상자 높이 ${b.h}px보다 큼`); continue; }
    const fit = (t, f, where) => { const w = textWidth(t, f[0] * SCALE, f[1]); if (w > room) W(`${n.id}${where}: "${t}" 폭 약 ${Math.round(w)}px > ${Math.round(room)}px`); };
    fit(n.title, FONT.t, '.title'); lines.forEach((t, i) => fit(t, FONT.sub, `.lines[${i}]`));
    const need = 22 + lines.length * 15;
    if (need > b.h) W(`${n.id}: 글자 ${1 + lines.length}줄이 상자 높이 ${b.h}px보다 큼(행 h를 늘리기)`);
    if (n.kind === 'decision' && lines.length > 1) W(`${n.id}: 마름모에는 설명 1줄까지만`);
  }
  // 선: 참조·방향·뚫고 지나감
  const inside = (b, x, y, pad = 1.5) => x > b.x + pad && x < b.x + b.w - pad && y > b.y + pad && y < b.y + b.h - pad;
  const segHits = (b, a, c) => {           // 축에 평행한 선분이 상자 안쪽을 지나는가
    if (Math.abs(a.y - c.y) < 0.5) { const y = a.y, x1 = Math.min(a.x, c.x), x2 = Math.max(a.x, c.x); return y > b.y + 1.5 && y < b.y + b.h - 1.5 && x2 > b.x + 1.5 && x1 < b.x + b.w - 1.5; }
    const x = a.x, y1 = Math.min(a.y, c.y), y2 = Math.max(a.y, c.y); return x > b.x + 1.5 && x < b.x + b.w - 1.5 && y2 > b.y + 1.5 && y1 < b.y + b.h - 1.5;
  };
  const labelBoxes = [];
  for (const ed of L.edges) {
    const e = ed.e, name = `edges[${ed.i}] ${e.from} → ${e.to}`;
    if (ed.bad) { E(`${name}: ${ed.bad}`); continue; }
    for (const ref of [e.from, e.to]) { const s = (String(ref).split(':')[1] || '').split('@')[0]; if (s && !SIDES.includes(s)) E(`${name}: 변 이름 '${s}'는 top·bottom·left·right 중 하나`); }
    if (ed.route === 'h' && Math.abs(ed.pts[0].y - ed.pts[1].y) > 0.5) E(`${name}: route h인데 두 끝 높이가 다름`);
    if (ed.route === 'v' && Math.abs(ed.pts[0].x - ed.pts[1].x) > 0.5) E(`${name}: route v인데 두 끝 x가 다름`);
    for (let k = 0; k < ed.pts.length - 1; k++) for (const b of B) {
      if (b.node.id === ed.from && k === 0) continue;
      if (b.node.id === ed.to && k === ed.pts.length - 2) continue;
      if (segHits(b, ed.pts[k], ed.pts[k + 1])) E(`${name}: 선이 상자 '${b.node.id}'를 뚫고 지나감 — route·via·변을 바꾸기`);
    }
    if (e.from === e.to) E(`${name}: 자기 자신으로 가는 선`);
    if (ed.label) labelBoxes.push([name, ed.label, FONT.lbl]);
    for (const c of ed.cards) labelBoxes.push([name + ' 관계 수', c, FONT.card]);
  }
  // 라벨이 상자 위에 앉는가(어림 상자로)
  for (const [name, l, f] of labelBoxes) {
    const w = textWidth(l.text, f[0], f[1]), x1 = l.anchor === 'middle' ? l.x - w / 2 : l.anchor === 'end' ? l.x - w : l.x, y1 = l.y - f[0];
    for (const b of B) if (x1 < b.x + b.w && x1 + w > b.x && y1 < b.y + b.h && l.y > b.y) W(`${name}: 라벨 "${l.text}"이 상자 '${b.node.id}'에 걸침 — labelDx/labelDy/labelSide/labelAt로 옮기기`);
    if (x1 < 0 || x1 + w > L.W) W(`${name}: 라벨 "${l.text}"이 그림 밖으로 나감`);
  }
  // 고립된 상자
  const used = new Set(L.edges.flatMap((e) => [e.from, e.to]));
  for (const b of B) if (!used.has(b.node.id)) W(`${b.node.id}: 이어진 선이 없음`);
  return { errors, warns };
}

if (process.argv[1] && process.argv[1].endsWith('check.mjs')) {
  const file = process.argv[2];
  if (!file) { console.error('사용법: node scripts/check.mjs <spec.json>'); process.exit(2); }
  const { errors, warns } = check(JSON.parse(fs.readFileSync(file, 'utf8')));
  for (const e of errors) console.log('오류  ' + e);
  for (const w of warns) console.log('경고  ' + w);
  console.log(errors.length ? `오류 ${errors.length} · 경고 ${warns.length}` : `통과 · 경고 ${warns.length}`);
  process.exit(errors.length ? 1 : 0);
}

#!/usr/bin/env node
// 순서도·관계도 렌더러 — 격자(열 × 행) 위에 상자를 놓고 꺾은 선으로 잇는다. 의존성 없음(Node 18+).
//
//   node scripts/render.mjs <spec.json> [--out <폴더>]
//     → <id>.html (그림 + 표 + 테마)   → <id>.svg (스타일을 안에 넣은 단독 SVG)
//
// 코드에서 쓰기: import { layout, flowSvg, renderPage } from './render.mjs'
//
// 원칙(AgentTA 홈 '개념과 관계'에서 가져옴)
// - 좌표는 모두 격자 상수(열 폭·열 간격·행 높이·행 간격)에서 계산한다. 같은 열·행이면 곧은 선, 아니면 꺾은 선.
// - 선은 상자 변의 가운데(마름모는 꼭짓점)에 닿는다. 한 변에 선 둘이 모이면 합류점(점)에서 합친다(merge).
// - 꺾은 선은 빈 칸(열 사이·행 사이 틈)으로만 지나간다. check.mjs가 상자를 뚫는 선을 찾아 준다.
// - 선 끝의 1 · n · 0..1이 관계의 수다(card). 이름은 선 위 라벨(바탕색 테두리로 선 위에서도 읽힘).
// - 그림마다 다른 marker ID, 색은 클래스(테마 토큰)로만.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function textWidth(s, size, bold = false) {
  let w = 0;
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    const wide = (c >= 0x1100 && c <= 0x11ff) || (c >= 0x2460 && c <= 0x24ff) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef);
    w += wide ? size * 0.98 : ch === ' ' ? size * 0.3 : /[·]/.test(ch) ? size * 0.4 : size * 0.58;
  }
  return w * (bold ? 1.05 : 1);
}
export const FONT = { t: [13.5, true], sub: [11.5, false], lbl: [11.5, true], card: [12, true], zt: [12.5, true], nn: [12, true] };
export const GRID = { colWidth: 170, colStep: 230, marginX: 40, rowGap: 56, top: 16, zoneHead: 38, zonePad: 16, zoneGap: 16 };
const KIND = { box: 'dg-box', core: 'dg-core', map: 'dg-map', ext: 'dg-ext', inner: 'dg-inner', terminal: 'dg-term', decision: 'dg-relbox', actor: 'dg-actor', accent: 'dg-accent', list: 'dg-box', plain: 'dg-plain' };
const TONES = ['blue', 'green', 'amber'];
const SIDES = ['top', 'bottom', 'left', 'right'];

// ---------- 배치 계산(그리기·검사가 함께 쓴다) ----------
export function layout(spec) {
  const g = { ...GRID, ...(spec.grid || {}) }, rows = spec.rows || [], zones = spec.zones || [], nodes = spec.nodes || [];
  const pills = spec.pills || [];
  const zoneStart = (r) => zones.some((z) => Math.min(...z.rows) === r);
  const laneTop = (spec.edges || []).some((e) => e.via === 'top'), laneBot = (spec.edges || []).some((e) => e.via === 'bottom');
  const groupTop = (spec.groups || []).length > 0;
  const tops = [];
  rows.forEach((row, r) => {
    if (r === 0) tops.push((zones.length ? 8 + g.zoneHead : g.top + (pills.length ? 30 : 0)) + (laneTop ? 34 : 0) + (groupTop ? 26 : 0));
    else tops.push(tops[r - 1] + rows[r - 1].h + (zoneStart(r) ? g.zonePad + g.zoneGap + g.zoneHead : (row.gap ?? g.rowGap)));
  });
  const top = (r) => tops[r], bot = (r) => tops[r] + rows[r].h, gapMid = (r) => (bot(r) + top(r + 1)) / 2;
  const cols = Math.max(1, ...nodes.map((n) => Math.ceil(n.col + (n.span || 1))));
  const W = g.marginX * 2 + g.colStep * (cols - 1) + g.colWidth;
  const H = rows.length ? bot(rows.length - 1) + (zones.length ? g.zonePad + 8 : 16) + (laneBot ? 34 : 0) + (groupTop ? 20 : 0) : 100;
  const cx = (c) => g.marginX + g.colWidth / 2 + c * g.colStep;
  const gapColMid = (c) => cx(c) + g.colWidth / 2 + (g.colStep - g.colWidth) / 2;
  const box = {};
  for (const n of nodes) {
    const span = n.span || 1, w = n.w || g.colStep * (span - 1) + g.colWidth, c = (cx(n.col) + cx(n.col + span - 1)) / 2;
    const rh = rows[n.row] ? rows[n.row].h : 60, h = Math.min(n.h || rh, rh), y = (rows[n.row] ? top(n.row) : 0) + (rh - h) / 2;
    const dx = n.dx || 0, dy = n.dy || 0;
    box[n.id] = { x: c - w / 2 + dx, y: y + dy, w, h, cx: c + dx, cy: y + h / 2 + dy, node: n };
  }
  const port = (ref) => {
    const [id, side0] = String(ref).split(':'), b = box[id];
    if (!b) return null;
    const [s0, fr] = String(side0 || '').split('@'), s = s0 || '', f = fr !== undefined ? Math.max(0, Math.min(1, Number(fr))) : 0.5;      // 「id:bottom@0.25」 = 변의 25% 자리
    return { id, side: s, x: s === 'left' ? b.x : s === 'right' ? b.x + b.w : b.x + b.w * f, y: s === 'top' ? b.y : s === 'bottom' ? b.y + b.h : b.y + b.h * f };
  };
  const autoSides = (e) => {
    let [fa, fs] = String(e.from).split(':'), [ta, ts] = String(e.to).split(':');
    const A = box[fa], B = box[ta];
    if (A && B && (!fs || !ts)) {
      const sameRow = A.node.row === B.node.row;
      if (sameRow) { fs = fs || (B.cx > A.cx ? 'right' : 'left'); ts = ts || (B.cx > A.cx ? 'left' : 'right'); }
      else { fs = fs || (B.cy > A.cy ? 'bottom' : 'top'); ts = ts || (B.cy > A.cy ? 'top' : 'bottom'); }
    }
    return [`${fa}:${fs}`, `${ta}:${ts}`];
  };
  const edges = (spec.edges || []).map((e, i) => {
    const [f, t] = autoSides(e), p0 = port(f), p1 = port(t);
    if (!p0 || !p1) return { i, e, bad: `없는 상자: ${!p0 ? e.from : e.to}` };
    const hz = (s) => s === 'left' || s === 'right';
    let route = e.route && e.route !== 'auto' ? e.route : hz(p0.side) && hz(p1.side) ? (Math.abs(p0.y - p1.y) < 0.5 ? 'h' : 'hvh') : !hz(p0.side) && !hz(p1.side) ? (Math.abs(p0.x - p1.x) < 0.5 ? 'v' : 'vhv') : hz(p0.side) ? 'hv' : 'vh';
    const via = String(e.via || ''), vm = via.match(/^gap(c?):(\d+)$/);
    let pts;
    const laneY = via === 'top' ? top(0) - (groupTop ? 44 : 20) : via === 'bottom' ? bot(rows.length - 1) + (groupTop ? 40 : 20) : null;
    if (laneY !== null) { pts = [p0, { x: p0.x, y: laneY }, { x: p1.x, y: laneY }, p1]; route = 'lane'; }
    else if (route === 'h' || route === 'v') pts = [p0, p1];
    else if (route === 'hvh') { const xm = vm && vm[1] ? gapColMid(+vm[2]) : (p0.x + p1.x) / 2; pts = [p0, { x: xm, y: p0.y }, { x: xm, y: p1.y }, p1]; }
    else if (route === 'vhv') { const ym = vm && !vm[1] ? gapMid(+vm[2]) : (p0.y + p1.y) / 2; pts = [p0, { x: p0.x, y: ym }, { x: p1.x, y: ym }, p1]; }
    else if (route === 'hv') pts = [p0, { x: p1.x, y: p0.y }, p1];
    else pts = [p0, { x: p0.x, y: p1.y }, p1];
    if (e.merge) pts = pts.slice(0, -1);   // 합류: 마지막 꺾인 점에서 멈추고 점을 찍는다(화살촉은 합쳐지는 선이 가진다)
    // 라벨: 곧은 선은 그 선, hvh·vhv는 가운데 토막, hv·vh는 첫 토막
    let label = null;
    if (e.label) {
      const si = Math.min(route === 'hvh' || route === 'vhv' || route === 'lane' ? 1 : 0, pts.length - 2), a = pts[si], b = pts[si + 1];
      const horiz = Math.abs(a.y - b.y) < 0.5, dx = e.labelDx || 0, dy = e.labelDy || 0;
      if (horiz) label = { x: (a.x + b.x) / 2 + dx, y: (e.labelSide === 'below' ? a.y + 18 : a.y - 7) + dy, anchor: 'middle', text: e.label };
      else {
        const gm = String(e.labelAt || '').match(/^gap:(\d+)$/), y = gm ? gapMid(+gm[1]) : (a.y + b.y) / 2;
        label = e.labelSide === 'left' ? { x: a.x - 9 + dx, y: y + 4 + dy, anchor: 'end', text: e.label } : { x: a.x + 9 + dx, y: y + 4 + dy, anchor: 'start', text: e.label };
      }
    }
    // 관계 수: 시작·끝 옆
    const cards = [];
    const cardAt = (p, q, isEnd, text, side) => {
      if (!text) return;
      // t = 나아가는 방향(+1: 오른쪽·아래). 끝점은 앞 점에서 끝점 쪽으로
      const horiz = Math.abs(p.y - q.y) < 0.5, d = horiz ? Math.sign(q.x - p.x) : Math.sign(q.y - p.y), t = isEnd ? -d : d;
      if (horiz) {
        const y = p.y + (side === 'above' ? -7 : 15);
        if (!isEnd) cards.push({ x: p.x + 5 * t + (t < 0 ? -1 : 0), y, anchor: t > 0 ? 'start' : 'end', text });
        else cards.push({ x: p.x - 9 * t, y, anchor: t > 0 ? 'end' : 'start', text });
      } else {
        const x = side === 'left' ? p.x - 7 : p.x + 7, anchor = side === 'left' ? 'end' : 'start';
        if (!isEnd) cards.push({ x, y: t > 0 ? p.y + 14 : p.y - 6, anchor, text });
        else cards.push({ x, y: t > 0 ? p.y - 6 : p.y + 14, anchor, text });
      }
    };
    const [c0, c1] = e.card || [], [s0, s1] = e.cardSide || [];
    cardAt(pts[0], pts[1], false, c0, s0);
    if (!e.merge) cardAt(pts[pts.length - 1], pts[pts.length - 2], true, c1, s1);
    const dots = [];
    if (e.merge) dots.push(pts[pts.length - 1]);
    if (e.dot === 'first' && pts.length > 2) dots.push(pts[1]);
    return { i, e, route, pts, label, cards, dots, from: p0.id, to: p1.id };
  });
  const zoneBoxes = zones.map((z) => { const r0 = Math.min(...z.rows), r1 = Math.max(...z.rows), y = top(r0) - g.zoneHead; return { x: 12, y, w: W - 24, h: bot(r1) + g.zonePad - y, title: z.title, tone: z.tone }; });
  const groupBoxes = (spec.groups || []).map((gr) => { const bs = (gr.nodes || []).map((id) => box[id]).filter(Boolean); if (!bs.length) return null; const pad = gr.pad ?? 14, x0 = Math.min(...bs.map((b) => b.x)) - pad, y0 = Math.min(...bs.map((b) => b.y)) - pad - (gr.title ? 20 : 0), x1 = Math.max(...bs.map((b) => b.x + b.w)) + pad, y1 = Math.max(...bs.map((b) => b.y + b.h)) + pad; return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, title: gr.title, tone: gr.tone || '', dashed: gr.dashed !== false }; }).filter(Boolean);
  const pillBoxes = pills.map((p) => { const w = Math.round(textWidth(p.text, 12, true) + 28); return { x: cx(p.col) - w / 2, y: p.y ?? 12, w, h: 24, text: p.text }; });
  return { g, W, H, cx, top, bot, box, edges, zones: zoneBoxes, pills: pillBoxes, groups: groupBoxes };
}

const pathOf = (pts) => pts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : Math.abs(p.y - pts[i - 1].y) < 0.5 ? ` H${p.x}` : Math.abs(p.x - pts[i - 1].x) < 0.5 ? ` V${p.y}` : ` L${p.x},${p.y}`)).join('');

export function ariaOf(spec) {
  if (spec.aria) return spec.aria;
  const name = Object.fromEntries((spec.nodes || []).map((n) => [n.id, n.title]));
  const rel = (spec.edges || []).filter((e) => !e.merge).map((e) => { const a = name[String(e.from).split(':')[0]], b = name[String(e.to).split(':')[0]]; return `${a} → ${b}${e.card ? ` ${e.card.filter(Boolean).join(':')}` : ''}${e.label ? `(${e.label})` : ''}`; });
  return `${spec.title || '순서도'}: ${rel.join(', ')}`;
}

export function flowSvg(spec) {
  const L = layout(spec), mk = `${spec.id || 'fc'}-head`;
  const T = (x, y, t, cls, anchor = 'middle') => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${esc(t)}</text>`;
  const minW = spec.minWidth ?? Math.min(L.W, 760);
  let s = `<svg class="dg dg-flow" viewBox="0 0 ${L.W} ${L.H}" style="min-width:${minW}px;max-width:${L.W}px" role="img" aria-label="${esc(ariaOf(spec))}">`;
  s += `<defs><marker id="${mk}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="dg-headfill"/></marker>${TONES.map((t) => `<marker id="${mk}-${t}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="dg-headfill t-${t}"/></marker>`).join('')}</defs>`;
  // 묶음(점선 테두리 · 왼쪽 위 이름) — 상자보다 먼저
  for (const gr of L.groups) s += `<rect x="${gr.x}" y="${gr.y}" width="${gr.w}" height="${gr.h}" rx="14" class="dg-group${gr.tone ? ` t-${gr.tone}` : ''}${gr.dashed ? ' dg-dash' : ''}"/>` + (gr.title ? T(gr.x + 12, gr.y + 17, gr.title, `dg-gt${gr.tone ? ` t-${gr.tone}` : ''}`, 'start') : '');
  for (const z of L.zones) s += `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="16" class="dg-zone${z.tone ? ` ${z.tone}` : ''}"/>` + (z.title ? T(z.x + 16, z.y + 22, z.title, 'dg-zt', 'start') : '');
  // 상자
  for (const b of Object.values(L.box)) {
    const n = b.node, lines = n.lines || [], k = lines.length, cls = KIND[n.kind || 'box'] || 'dg-box';
    if (n.kind === 'decision') s += `<polygon points="${b.cx},${b.y} ${b.x + b.w},${b.cy} ${b.cx},${b.y + b.h} ${b.x},${b.cy}" class="${cls}"/>`;
    else if (n.kind === 'actor') s += `<circle cx="${b.cx}" cy="${b.cy}" r="${Math.min(b.w, b.h) / 2}" class="${cls}"/>`;
    else if (n.kind !== 'plain') s += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${n.kind === 'terminal' ? b.h / 2 : 10}" class="${cls}"/>`;
    if (n.kind === 'list') {      // 목록 상자: 제목 아래 작은 칸들(세로로 쌓거나 itemsRow면 가로로)
      const items = n.items || [], ty = b.y + 20; s += T(b.cx, ty, n.title, 'dg-t');
      if (n.itemsRow) { const iw = (b.w - 16 - (items.length - 1) * 6) / Math.max(1, items.length); items.forEach((it, i) => { const x = b.x + 8 + i * (iw + 6); s += `<rect x="${x}" y="${ty + 10}" width="${iw}" height="${b.h - 38}" rx="6" class="dg-item"/>` + T(x + iw / 2, ty + 10 + (b.h - 38) / 2 + 4, it, 'dg-sub'); }); }
      else { const ih = 22; items.forEach((it, i) => { const y = ty + 10 + i * (ih + 5); s += `<rect x="${b.x + 10}" y="${y}" width="${b.w - 20}" height="${ih}" rx="6" class="dg-item"/>` + T(b.cx, y + 15, it, 'dg-sub'); }); }
      continue;
    }
    const t0 = b.cy - (k * 15) / 2 + (k ? 2 : 5);
    s += T(b.cx, t0, n.title, n.kind === 'actor' ? 'dg-t dg-at' : 'dg-t') + lines.map((t, i) => T(b.cx, t0 + 17 + i * 15, t, n.mono ? 'dg-sub dg-mono' : 'dg-sub')).join('');
  }
  // 선 → 점 → 관계 수 → 라벨(라벨이 선 위에 오도록 마지막에)
  let lbl = '';
  for (const ed of L.edges) {
    if (ed.bad) continue;
    const e = ed.e, arrow = e.arrow !== false && !e.merge;
    const tn = TONES.includes(e.tone) ? e.tone : '', m = tn ? `${mk}-${tn}` : mk;
    s += `<path d="${pathOf(ed.pts)}" class="dg-arrow${tn ? ` t-${tn}` : ''}${e.dashed ? ' dg-dash' : ''}"${arrow ? ` marker-end="url(#${m})"` : ''}${e.both ? ` marker-start="url(#${m})"` : ''}/>`;
    for (const d of ed.dots) s += `<circle cx="${d.x}" cy="${d.y}" r="4" class="dg-dot"/>`;
    for (const c of ed.cards) lbl += T(c.x, c.y, c.text, 'dg-card', c.anchor);
    if (ed.label) lbl += T(ed.label.x, ed.label.y, ed.label.text, `dg-lbl${TONES.includes(e.tone) ? ` t-${e.tone}` : ''}`, ed.label.anchor);
  }
  for (const p of L.pills) lbl += `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="12" class="dg-nnpill"/>` + T(p.x + p.w / 2, p.y + 17, p.text, 'dg-nn');
  return s + lbl + '</svg>';
}

// ---------- 표·페이지 ----------
const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
export function tableHtml(tb) {
  if (!tb) return '';
  const k = tb.keyCol;
  return `${tb.title ? `<h3 style="margin:16px 0 6px;font-size:15px">${esc(tb.title)}</h3>` : ''}<div style="overflow-x:auto"><table class="dg-table"><thead><tr>${tb.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${tb.rows.map((r) => `<tr>${r.map((c, i) => `<td${i === k ? ' class="k"' : ''}>${i === 0 ? `<b>${md(c)}</b>` : md(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
export const themeCss = () => fs.readFileSync(path.join(HERE, '..', 'templates', 'theme.css'), 'utf8');
export function figureHtml(spec) {
  const L = layout(spec), minW = spec.minWidth ?? Math.min(L.W, 760);
  return `<div class="dg-flowwrap${minW > 390 ? ' scroll' : ''}">${flowSvg(spec)}</div>`;
}
export function renderPage(spec) {
  const tpl = fs.readFileSync(path.join(HERE, '..', 'templates', 'page.html'), 'utf8');
  const extra = [].concat(spec.tables || (spec.table ? [spec.table] : [])).map(tableHtml).join('') + (spec.notes || []).map((n) => `<p style="font-size:13px;color:var(--text-sub)">${md(n)}</p>`).join('');
  return tpl.replace('{{THEME_CSS}}', themeCss()).replace(/{{TITLE}}/g, esc(spec.title || '순서도')).replace('{{DESC}}', esc(spec.desc || '')).replace('{{FIGURE}}', figureHtml(spec)).replace('{{EXTRA}}', extra);
}
export function standaloneSvg(svg) {
  const css = themeCss().replace(/@media \(max-width: 640px\)[^\n]*\n/g, '');
  return svg.replace(/^<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/ style="min-width:[^"]*"/, '')
    .replace(/(<svg[^>]*>)/, `$1<style>${css.replace(/\s+/g, ' ')} svg{background:var(--surface);font-family:"Pretendard","Apple SD Gothic Neo","Noto Sans KR",sans-serif}</style>`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), file = args.find((a) => !a.startsWith('--'));
  const oi = args.indexOf('--out'), out = oi >= 0 ? args[oi + 1] : path.dirname(path.resolve(file || '.'));
  if (!file) { console.error('사용법: node scripts/render.mjs <spec.json> [--out <폴더>]'); process.exit(2); }
  const spec = JSON.parse(fs.readFileSync(file, 'utf8')), id = spec.id || path.basename(file, '.json');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `${id}.html`), renderPage(spec));
  fs.writeFileSync(path.join(out, `${id}.svg`), standaloneSvg(flowSvg(spec)));
  console.log(`만듦: ${path.join(out, id)}.html · .svg`);
}

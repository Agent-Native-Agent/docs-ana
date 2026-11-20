// 목표모델형 개념도(layout: "board") — 공공 정보화 문서의 「목표 모델 / 구성도」 결.
// 왼쪽 열(제공·연계) · 연계 막대 · 가운데 패널(남색 제목 띠 + 모듈 카드 + 기능 칸) · 오른쪽 열(사용자) · 아래 층(데이터베이스 · 인프라).
// 색은 남색 계열 하나 + 굵은 화살표 황토 하나. 그림자·그라데이션·사진 아이콘은 쓰지 않는다(사람 · DB는 단순 도형).
// render.mjs 를 import 하지 않는다(render.mjs 가 이 파일을 불러 쓰므로 서로 물리면 멈춘다) — 같은 두 함수를 여기 둔다
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function textWidth(s, size, bold = false) { let w = 0; for (const ch of String(s ?? '')) { const c = ch.codePointAt(0); const wide = (c >= 0x1100 && c <= 0x11ff) || (c >= 0x2460 && c <= 0x24ff) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef); w += wide ? size * 0.98 : ch === ' ' ? size * 0.3 : /[·]/.test(ch) ? size * 0.4 : size * 0.58; } return w * (bold ? 1.05 : 1); }

// 선 아이콘(24×24, 선 굵기 2, 남색 한 색) — 이모지 · 사진 대신. 이름: person people building server db monitor doc pen check chart search shield lock cloud gear plug ai flask network mobile refresh flow
export const ICONS = {
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.2c3.2-.4 5.5 1.8 5.5 5"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  doc: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4M9 11h6M9 15h6M9 19h4"/>',
  pen: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/><path d="M14 7l3 3"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  chart: '<path d="M4 4v16h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4"/>',
  shield: '<path d="M12 2l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5z"/><path d="M9 12l2 2 4-4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .4-8A6 6 0 0 0 5.8 11.5 3.3 3.3 0 0 0 7 18z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  plug: '<path d="M9 2v5M15 2v5M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v6"/>',
  ai: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/><path d="M9.5 14.5l1.5-5 1.5 5M10 13h2M14.5 9.5v5"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9.5A2 2 0 0 0 6.8 21h10.4a2 2 0 0 0 1.8-2.5L14 9V3"/><path d="M7.5 15h9"/>',
  network: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M11 7.2L6.2 15.8M13 7.2l4.8 8.6M7.5 18h9"/>',
  mobile: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.5L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.5L20 16"/><path d="M20 21v-5h-5"/>',
  flow: '<rect x="3" y="3" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/><path d="M6.5 9v5a2 2 0 0 0 2 2H14"/>',
  car: '<path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v3H3z"/><circle cx="7.5" cy="16" r="1.6"/><circle cx="16.5" cy="16" r="1.6"/><path d="M5 11h14"/>',
  dna: '<path d="M7 3c0 6 10 6 10 12M17 3c0 3-2.5 4.6-5 6M7 21c0-3 2.5-4.6 5-6M17 21c0-6-10-6-10-12"/><path d="M8 6h8M8 18h8M9.5 12h5"/>',
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.2-4 2.5-5 .2 1.8 1 2.8 2 3 0-3-.5-5.5.5-8z"/>',
  pill: '<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="M9.6 8.7l4.8 6.6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  scale: '<path d="M12 4v16M6 20h12M5 7h14"/><path d="M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>',
  box: '<path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/>',
};
const icon = (name, x, y, size, cls) => ICONS[name] ? `<g transform="translate(${x},${y}) scale(${size / 24})" class="${cls}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>` : '';
export const BOARD = { W: 1180, M: 12, colW: 176, rightW: 150, bridgeW: 30, gap: 12, sideGap: 40, head: 30, modHead: 26, item: 22, itemGap: 5, rowGap: 18, layerH: 58 };
export const BF = { title: 14.5, sub: 12, mod: 12.5, item: 11.5, col: 12.5, colSub: 11, chip: 11, layer: 12 };

const rowsOf = (panels) => (panels || []).map((r) => (Array.isArray(r) ? r : [r]));

// ---------- 배치 ----------
export function boardLayout(spec) {
  const g = { ...BOARD, ...(spec.grid || {}) };
  if ((spec.links || []).length && !(spec.grid && spec.grid.rowGap)) g.rowGap = 44;      // 패널 사이 세로 화살표가 있으면 꼬리가 보이게 줄 간격을 넓힌다
  const hasL = !!spec.left, hasR = !!spec.right, bL = hasL && spec.bridgeLeft, bR = hasR && spec.bridgeRight;
  let x = g.M; const L = {};
  if (hasL) { L.left = { x, w: spec.left.w || g.colW }; x += L.left.w + g.sideGap; }
  if (bL) { L.bl = { x, w: g.bridgeW }; x += g.bridgeW + g.sideGap; }
  let xr = g.W - g.M; if (hasR) { L.right = { x: xr - (spec.right.w || g.rightW), w: spec.right.w || g.rightW }; xr = L.right.x - g.sideGap; }
  if (bR) { L.br = { x: xr - g.bridgeW, w: g.bridgeW }; xr -= g.bridgeW + g.sideGap; }
  const cx0 = x, cw = xr - x; let y = g.M + (spec.banner ? 40 : 0); const top = y;
  // 패널 줄
  const panels = [];
  for (const row of rowsOf(spec.panels)) {
    const tot = row.reduce((a, p) => a + (p.share || 1), 0); let px = cx0; const placed = [];
    for (const p of row) {
      const pw = (cw - g.gap * (row.length - 1)) * (p.share || 1) / tot;
      const mods = p.modules || [], cols = Math.max(1, Math.min(p.cols || mods.length || 1, mods.length || 1));
      const mw = (pw - 20 - (cols - 1) * 8) / cols; const mrows = [];
      for (let i = 0; i < mods.length; i += cols) mrows.push(mods.slice(i, i + cols));
      const mh = (m) => g.modHead + 8 + (m.items || []).length * (g.item + g.itemGap) + 3;
      const rowH = mrows.map((r) => Math.max(...r.map(mh)));
      const bodyH = rowH.reduce((a, h) => a + h + 8, 0) + (p.note ? 26 : 0);
      placed.push({ p, x: px, w: pw, mw, cols, mrows, rowH, h: g.head + 10 + bodyH });
      px += pw + g.gap;
    }
    const rh = Math.max(...placed.map((q) => q.h));
    for (const q of placed) { q.y = y; q.h = rh; panels.push(q); }
    y += rh + g.rowGap;
  }
  const layers = (spec.layers || []).map((ly) => { const o = { ly, x: ly.full ? g.M : cx0, w: ly.full ? g.W - 2 * g.M : cw, y, h: g.layerH }; y += g.layerH + 10; return o; });
  const bottom = y - (layers.length ? 10 : g.rowGap);
  const colH = (layers.length && !spec.colsToBottom ? (layers[0].y - 10) : bottom) - top;
  return { g, L, cx0, cw, top, panels, layers, colH, H: bottom + g.M };
}

// ---------- 그리기 ----------
const CSS = `
.bd text { font-family: "Pretendard","Apple SD Gothic Neo","Noto Sans KR",sans-serif; }
.bd .bnr { fill: #24406E; } .bd .bnrt { fill: #fff; font-size: 17px; font-weight: 800; }
.bd .ph { fill: #24406E; } .bd .pht { fill: #fff; font-size: ${BF.title}px; font-weight: 800; } .bd .phs { fill: #D6E1F2; font-size: ${BF.sub}px; font-weight: 600; }
.bd .pb { fill: #F3F6FB; stroke: #8FA6C8; stroke-width: 1.2; }
.bd .ph.alt { fill: #3E6FA8; } .bd .pb.alt { fill: #F6F9FD; stroke: #A9BCD8; }
.bd .mh { fill: #DCE6F4; } .bd .mht { fill: #1F3864; font-size: ${BF.mod}px; font-weight: 800; } .bd .mb { fill: #fff; stroke: #B8C7DD; stroke-width: 1; }
.bd .mh.hl { fill: #FCEBD2; } .bd .mb.hl { stroke: #D9A35F; }
.bd .it { fill: #fff; stroke: #C9D4E5; stroke-width: 1; } .bd .itt { fill: #33415C; font-size: ${BF.item}px; }
.bd .cb { fill: #EEF2F8; stroke: #8FA6C8; stroke-width: 1.2; } .bd .ch { fill: #24406E; } .bd .cht { fill: #fff; font-size: 13px; font-weight: 800; }
.bd .ct { fill: #1F3864; font-size: ${BF.col}px; font-weight: 800; } .bd .cs { fill: #4A5874; font-size: ${BF.colSub}px; }
.bd .chip { fill: #3E6FA8; } .bd .chip.g { fill: #8C97A8; } .bd .chipt { fill: #fff; font-size: ${BF.chip}px; font-weight: 700; }
.bd .br { fill: #2F4F86; } .bd .brt { fill: #fff; font-size: 13px; font-weight: 800; }
.bd .ar { stroke: #C8843A; stroke-width: 5; fill: none; } .bd .arh { fill: #C8843A; } .bd .arl { fill: #8A5A22; font-size: 11.5px; font-weight: 700; paint-order: stroke; stroke: #fff; stroke-width: 4px; }
.bd .ly { fill: #F3F6FB; stroke: #8FA6C8; stroke-width: 1.2; } .bd .lyh { fill: #24406E; } .bd .lyt { fill: #fff; font-size: ${BF.layer}px; font-weight: 800; }
.bd .db { fill: #E3EAF5; stroke: #6E8DBF; stroke-width: 1.2; } .bd .dbt { fill: #1F3864; font-size: 11px; font-weight: 700; }
.bd .tag { fill: #fff; stroke: #8FA6C8; stroke-width: 1; } .bd .tagt { fill: #24406E; font-size: 11.5px; font-weight: 700; }
.bd .pn { fill: #6E8DBF; } .bd .ic { stroke: #2F5A9E; } .bd .icw { stroke: #FFFFFF; } .bd .icc { stroke: #3E6FA8; } .bd .ich { stroke: #8A5A22; } .bd .note { fill: #3E5A8A; font-size: 11.5px; font-weight: 700; }
`;
export function boardSvg(spec) {
  const B = boardLayout(spec), g = B.g, id = spec.id || 'bd';
  const T = (x, y, t, cls, a = 'middle') => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${a}">${esc(t)}</text>`;
  let s = `<svg class="dg bd" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.W} ${B.H}" role="img" aria-label="${esc(spec.aria || spec.title || '구성도')}"><style>${CSS.replace(/\s+/g, ' ')}</style>`;
  s += `<defs><marker id="${id}-ah" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3" markerHeight="3" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="arh"/></marker></defs>`;
  s += `<rect x="0" y="0" width="${g.W}" height="${B.H}" fill="#fff"/>`;
  if (spec.banner) s += `<rect x="${g.M}" y="${g.M}" width="${g.W - 2 * g.M}" height="32" rx="6" class="bnr"/>` + T(g.W / 2, g.M + 22, spec.banner, 'bnrt');
  // 옆 열(왼쪽 · 오른쪽)
  const column = (c, box, side) => {
    const y0 = B.top, h = B.colH; let o = `<rect x="${box.x}" y="${y0}" width="${box.w}" height="${h}" rx="8" class="cb"/><rect x="${box.x}" y="${y0}" width="${box.w}" height="28" rx="8" class="ch"/><rect x="${box.x}" y="${y0 + 20}" width="${box.w}" height="8" class="ch"/>` + T(box.x + box.w / 2, y0 + 19, c.title, 'cht');
    const items = c.items || []; const ih = items.map((it) => 18 + (it.lines || []).length * 15 + (it.chips || []).length * 24 + (it.icon ? 40 : 0) + 8);
    const free = h - 36 - ih.reduce((a, b) => a + b, 0); const sp = Math.max(6, free / (items.length + 1)); let y = y0 + 32 + sp;
    items.forEach((it, i) => {
      const cxm = box.x + box.w / 2;
      if (it.icon === 'person') { o += `<circle cx="${cxm}" cy="${y + 12}" r="9" class="pn"/><path d="M${cxm - 16},${y + 40} q0,-17 16,-17 q16,0 16,17 z" class="pn"/>`; y += 44; }
      else if (it.icon && ICONS[it.icon]) { o += icon(it.icon, cxm - 15, y + 4, 30, 'icc'); y += 44; }
      if (it.iconInline && ICONS[it.iconInline]) { const tw = textWidth(it.title, BF.col, true); o += icon(it.iconInline, cxm - tw / 2 - 11, y - 1, 18, 'icc') + T(cxm + 11, y + 12, it.title, 'ct'); } else o += T(cxm, y + 12, it.title, 'ct'); let yy = y + 18;
      for (const l of it.lines || []) { o += T(cxm, yy + 11, l, 'cs'); yy += 15; }
      for (const ch of it.chips || []) { const t = typeof ch === 'string' ? ch : ch.t, gray = typeof ch === 'string' ? /원천|원본/.test(ch) : ch.tone === 'g'; o += `<rect x="${box.x + 12}" y="${yy + 3}" width="${box.w - 24}" height="19" rx="3" class="chip${gray ? ' g' : ''}"/>` + T(cxm, yy + 16.5, t, 'chipt'); yy += 24; }
      y += ih[i] - (it.icon ? 44 : 0) + sp;
    });
    return o;
  };
  if (B.L.left) s += column(spec.left, B.L.left, 'l');
  if (B.L.right) s += column(spec.right, B.L.right, 'r');
  // 연계 막대(세로 글)
  const bridge = (box, t) => { let o = `<rect x="${box.x}" y="${B.top}" width="${box.w}" height="${B.colH}" rx="6" class="br"/>`; const chars = [...String(t)]; const hOf = (c) => (c === ' ' ? 6 : c === '·' ? 12 : 16); const tot = chars.reduce((a, c) => a + hOf(c), 0); let yy = B.top + B.colH / 2 - tot / 2 + 12; for (const c of chars) { if (c !== ' ') o += T(box.x + box.w / 2, yy, c, 'brt'); yy += hOf(c); } return o; };
  if (B.L.bl) s += bridge(B.L.bl, spec.bridgeLeft);
  if (B.L.br) s += bridge(B.L.br, spec.bridgeRight);
  // 패널
  for (const q of B.panels) {
    const p = q.p, alt = p.tone === 'alt' ? ' alt' : '';
    s += `<rect x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" rx="8" class="pb${alt}"/><rect x="${q.x}" y="${q.y}" width="${q.w}" height="${g.head}" rx="8" class="ph${alt}"/><rect x="${q.x}" y="${q.y + g.head - 8}" width="${q.w}" height="8" class="ph${alt}"/>`;
    const tw = textWidth(p.title, BF.title, true);
    const io = p.icon && ICONS[p.icon] ? 24 : 0; if (io) s += icon(p.icon, q.x + 12, q.y + 6, 18, 'icw');
    s += T(q.x + 14 + io, q.y + 20, p.title, 'pht', 'start') + (p.sub ? T(q.x + 26 + io + tw, q.y + 20, p.sub, 'phs', 'start') : '');
    let y = q.y + g.head + 10;
    q.mrows.forEach((r, ri) => {
      r.forEach((m, ci) => {
        const mx = q.x + 10 + ci * (q.mw + 8), hl = m.hl ? ' hl' : '', mh = q.rowH[ri];
        s += `<rect x="${mx}" y="${y}" width="${q.mw}" height="${mh}" rx="6" class="mb${hl}"/><rect x="${mx}" y="${y}" width="${q.mw}" height="${g.modHead}" rx="6" class="mh${hl}"/><rect x="${mx}" y="${y + g.modHead - 6}" width="${q.mw}" height="6" class="mh${hl}"/>` + (m.icon && ICONS[m.icon] ? icon(m.icon, mx + q.mw / 2 - textWidth(m.title, BF.mod, true) / 2 - 22, y + 4, 17, hl ? 'ich' : 'ic') + T(mx + q.mw / 2 + 10, y + 17.5, m.title, 'mht') : T(mx + q.mw / 2, y + 17.5, m.title, 'mht'));
        (m.items || []).forEach((it, k) => { const iy = y + g.modHead + 6 + k * (g.item + g.itemGap); s += `<rect x="${mx + 7}" y="${iy}" width="${q.mw - 14}" height="${g.item}" rx="4" class="it"/>` + T(mx + q.mw / 2, iy + 15, it, 'itt'); });
      });
      y += q.rowH[ri] + 8;
    });
    if (p.note) s += T(q.x + q.w / 2, y + 12, p.note, 'note');
  }
  // 아래 층
  for (const l of B.layers) {
    const ly = l.ly, lw = 86; s += `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="8" class="ly"/><rect x="${l.x}" y="${l.y}" width="${lw}" height="${l.h}" rx="8" class="lyh"/><rect x="${l.x + lw - 8}" y="${l.y}" width="8" height="${l.h}" class="lyh"/>` + T(l.x + lw / 2, l.y + l.h / 2 + 4, ly.title, 'lyt');
    const items = ly.items || [], n = items.length, aw = l.w - lw - 16, step = aw / Math.max(1, n);
    items.forEach((it, i) => {
      const cxm = l.x + lw + 8 + step * (i + 0.5);
      if (ly.kind === 'db') { it = typeof it === 'string' ? it : it.t; const w = Math.min(84, step - 10), x0 = cxm - w / 2, y0 = l.y + 10, h = l.h - 20; s += `<path d="M${x0},${y0 + 5} v${h - 10} a${w / 2},5 0 0 0 ${w},0 v-${h - 10}" class="db"/><ellipse cx="${cxm}" cy="${y0 + 5}" rx="${w / 2}" ry="5" class="db"/>` + T(cxm, y0 + h / 2 + 6, it, 'dbt'); }
      else { const t = typeof it === 'string' ? it : it.t, ic = typeof it === 'object' && ICONS[it.icon] ? it.icon : null; const w = Math.min(step - 10, textWidth(t, 11.5, true) + 26 + (ic ? 20 : 0)); s += `<rect x="${cxm - w / 2}" y="${l.y + l.h / 2 - 12}" width="${w}" height="24" rx="12" class="tag"/>` + (ic ? icon(ic, cxm - w / 2 + 9, l.y + l.h / 2 - 8, 16, 'ic') + T(cxm + 10, l.y + l.h / 2 + 4, t, 'tagt') : T(cxm, l.y + l.h / 2 + 4, t, 'tagt')); }
    });
  }
  // 굵은 화살표: 왼쪽 열 → (연계 막대) → 패널, 패널 → (연계 막대) → 오른쪽 열
  const arrow = (x1, x2, y, label) => `<path d="M${x1 + 2},${y} H${x2 - 8}" class="ar" marker-end="url(#${id}-ah)"/>` + (label && x2 - x1 >= 70 ? T((x1 + x2) / 2, y - 8, label, 'arl') : '');      // 틈이 좁으면 라벨은 싣지 않는다(연계 막대 글이 대신 말한다)
  for (const q of B.panels) {
    const p = q.p, my = q.y + q.h / 2;
    if (p.fromLeft && B.L.left && q.x - B.cx0 < 2) { if (B.L.bl) { s += arrow(B.L.left.x + B.L.left.w + 1, B.L.bl.x, my - 0, p.fromLeftLabel1); s += arrow(B.L.bl.x + B.L.bl.w + 1, q.x, my, p.fromLeftLabel); } else s += arrow(B.L.left.x + B.L.left.w + 1, q.x, my, p.fromLeftLabel); }
    if (p.toRight && B.L.right && Math.abs(q.x + q.w - (B.cx0 + B.cw)) < 2) { if (B.L.br) { s += arrow(q.x + q.w + 1, B.L.br.x, my, p.toRightLabel); s += arrow(B.L.br.x + B.L.br.w + 1, B.L.right.x, my); } else s += arrow(q.x + q.w + 1, B.L.right.x, my, p.toRightLabel); }
  }
  for (const v of spec.links || []) {      // 패널 사이 세로 화살표: { from: 패널 번호, to: 패널 번호, label }
    const a = B.panels[v.from], b = B.panels[v.to]; if (!a || !b) continue; const x = Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x); const xm = (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2 + (v.dx || 0);
    const down = b.y > a.y; void x; s += `<path d="M${xm},${down ? a.y + a.h + 1 : a.y - 1} V${down ? b.y - 7 : b.y + b.h + 7}" class="ar" marker-end="url(#${id}-ah)"/>` + (v.label ? T(xm + 10, (down ? a.y + a.h + b.y : a.y + b.y + b.h) / 2 + 4, v.label, 'arl', 'start') : '');
  }
  return s + '</svg>';
}

// ---------- 검사(글자 폭 · 빈 칸) ----------
export function boardCheck(spec, scale = 1) {
  const errors = [], warns = []; const B = boardLayout(spec);
  if (!rowsOf(spec.panels).length) errors.push('panels가 비어 있음');
  for (const q of B.panels) {
    const p = q.p; if (!(p.modules || []).length) warns.push(`패널 "${p.title}": modules가 없음`);
    const tw = textWidth(p.title, BF.title * scale, true) + (p.sub ? textWidth(p.sub, BF.sub * scale) + 12 : 0); if (tw > q.w - 24) warns.push(`패널 "${p.title}": 제목 폭 약 ${Math.round(tw)}px > ${Math.round(q.w - 24)}px`);
    for (const m of p.modules || []) {
      const t = textWidth(m.title, BF.mod * scale, true) + (m.icon ? 24 : 0); if (t > q.mw - 10) warns.push(`모듈 "${m.title}": 제목 폭 약 ${Math.round(t)}px > ${Math.round(q.mw - 10)}px`);
      for (const it of m.items || []) { const w = textWidth(it, BF.item * scale); if (w > q.mw - 20) warns.push(`모듈 "${m.title}" · "${it}": 폭 약 ${Math.round(w)}px > ${Math.round(q.mw - 20)}px`); }
    }
  }
  for (const [side, c, box] of [['left', spec.left, B.L.left], ['right', spec.right, B.L.right]]) {
    if (!c || !box) continue;
    for (const it of c.items || []) { for (const t of [it.title, ...(it.lines || [])]) { const w = textWidth(t, BF.col * scale, true); if (w > box.w - 12) warns.push(`${side} "${t}": 폭 약 ${Math.round(w)}px > ${Math.round(box.w - 12)}px`); } }
    const need = (c.items || []).reduce((a, it) => a + 18 + (it.lines || []).length * 15 + (it.chips || []).length * 24 + (it.icon ? 44 : 0) + 14, 36);
    for (const it of c.items || []) if (it.icon && it.icon !== 'person' && !ICONS[it.icon]) warns.push(`${side} "${it.title}": 없는 아이콘 "${it.icon}" — ${Object.keys(ICONS).join(' · ')}`);
    if (need > B.colH) warns.push(`${side} 열: 항목이 열 높이(${Math.round(B.colH)}px)보다 많음(약 ${need}px)`);
  }
  return { errors, warns };
}
export function boardPage(spec) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(spec.title || '구성도')}</title><style>body{margin:0;padding:16px;background:#fff}svg{display:block;width:100%;max-width:${BOARD.W}px;height:auto}</style></head><body>${boardSvg(spec)}</body></html>`;
}

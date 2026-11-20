#!/usr/bin/env node
// 개념도 렌더러 — spec(JSON) 하나로 넓은 그림(PC)과 세로 그림(휴대폰) SVG를 만든다. 의존성 없음(Node 18+).
//
//   node scripts/render.mjs <spec.json> [--out <폴더>]
//     → <id>.html (두 그림 + 테마, 바로 열어 볼 수 있음)
//     → <id>-wide.svg, <id>-tall.svg (스타일을 안에 넣은 단독 SVG)
//
// 코드에서 쓰기: import { conceptWide, conceptTall, renderPage } from './render.mjs'
//
// 원칙(AgentTA 홈 개념도에서 가져옴)
// - 모든 좌표는 격자 상수(행 높이·간격·열 위치)에서 계산한다. 상자·화살표·라벨이 같은 기준선을 써서 어긋나지 않는다.
// - 사람(왼쪽)·바깥 시스템(오른쪽)은 실제로 닿는 단계의 '행 높이'에 맞춰 놓는다. 화살표는 상자 변의 가운데에 닿는다.
// - 그림마다 다른 marker ID를 쓴다(같은 ID면 숨겨진 그림의 marker를 참조해 화살촉이 사라진다).
// - 색은 클래스(테마 토큰)로만 준다. 밝은·어두운 화면을 함께 지원한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 글자 폭 어림(px). 한글·한자·전각은 글자 크기만큼, 영문·숫자는 0.58배, 공백 0.3배. 굵은 글씨는 5% 더.
export function textWidth(s, size, bold = false) {
  let w = 0;
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    const wide = (c >= 0x1100 && c <= 0x11ff) || (c >= 0x2460 && c <= 0x24ff) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef);
    w += wide ? size * 0.98 : ch === ' ' ? size * 0.3 : /[·]/.test(ch) ? size * 0.4 : size * 0.58;
  }
  return w * (bold ? 1.05 : 1);
}
// 글자 크기(theme.css와 같아야 한다)
export const FONT = { title: [19, true], t: [13.5, true], sub: [11.5, false], lbl: [11.5, true], note: [11.5, true] };

// ' · '로 나뉜 긴 문장을 길이가 비슷한 두 줄로
export function splitTwo(s) {
  const parts = String(s || '').split(' · ');
  if (parts.length < 2) return [s, ''];
  let best = [s, ''], bestD = Infinity;
  for (let i = 1; i < parts.length; i++) {
    const a = parts.slice(0, i).join(' · '), b = parts.slice(i).join(' · ');
    const d = Math.abs(textWidth(a, 11.5) - textWidth(b, 11.5));
    if (d < bestD) { bestD = d; best = [a, b]; }
  }
  return best;
}

const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] || {}, v) : v; return o; };
export const LAYOUT = {
  wide: { width: 1040, core: { x: 300, y: 20, w: 440 }, module: { w: 392, h: 54, top: 100, step: 76 }, actor: { x: 20, w: 176 }, external: { x: 844, w: 180, h: 80 } },
  tall: { width: 360, header: { x: 16, y: 8, w: 328, h: 56 }, core: { x: 12, y: 96, w: 236 }, module: { w: 208, h: 62, step: 80 }, external: { x: 264, w: 84, h: 92 } },
};

// SVG 조각
function kit(mk) {
  const T = (x, y, t, cls, anchor = 'middle') => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${esc(t)}</text>`;
  const R = (x, y, w, h, cls, rx = 10) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="${cls}"/>`;
  const H = (x1, y, x2, both) => `<path d="M${x1},${y} H${x2}" class="dg-arrow" marker-end="url(#${mk})"${both ? ` marker-start="url(#${mk})"` : ''}/>`;
  const V = (x, y1, y2) => `<path d="M${x},${y1} V${y2}" class="dg-arrow" marker-end="url(#${mk})"/>`;
  const defs = `<defs><marker id="${mk}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="dg-headfill"/></marker></defs>`;
  return { T, R, H, V, defs };
}
const rowsOf = (a) => { const r = Array.isArray(a.rows) ? a.rows : [a.row ?? (a.links && a.links[0] && a.links[0].row) ?? 0]; return [Math.min(...r), Math.max(...r)]; };
const strip = (t) => String(t).replace(/^[①-⑳\d.\s]+/, '');

export function ariaOf(spec) {
  if (spec.aria) return spec.aria;
  const mods = spec.modules.map((m) => strip(m.title)).join(', ');
  const acts = (spec.actors || []).map((a) => a.title).join(', ');
  const exts = (spec.externals || []).map((e) => `${e.title}(${strip(spec.modules[e.row].title)} 단계와 주고받음)`).join(', ');
  return `${spec.title || '개념도'}: ${acts ? `${acts}이(가) ` : ''}${spec.core.name}의 단계(${mods})를 쓴다${exts ? `. 바깥 시스템: ${exts}` : ''}`;
}

// ---------- 넓은 그림(PC) ----------
export function conceptWide(spec) {
  const L = merge(LAYOUT.wide, spec.layout && spec.layout.wide);
  const { core, actor: left, external: right } = L, m = { ...L.module, x: core.x + (core.w - L.module.w) / 2 };
  const n = spec.modules.length, id = `${spec.id || 'cm'}-wide-head`;
  const { T, R, H, V, defs } = kit(id);
  const rowY = (i) => m.top + i * m.step, rowC = (i) => rowY(i) + m.h / 2, mx2 = m.x + m.w, cx = m.x + m.w / 2;
  const coreH = rowY(n - 1) + m.h + (spec.core.note ? 50 : 24) - core.y;
  const H_ = core.y + coreH + 16;
  let s = `<svg class="dg dg-wide" viewBox="0 0 ${L.width} ${H_}" role="img" aria-label="${esc(ariaOf(spec))}">${defs}`;
  s += R(core.x, core.y, core.w, coreH, 'dg-core', 18) + T(core.x + core.w / 2, core.y + 34, spec.core.name, 'dg-title');
  if (spec.core.sub) s += T(core.x + core.w / 2, core.y + 54, spec.core.sub, 'dg-sub');
  spec.modules.forEach((md, i) => {
    const y = rowY(i);
    s += R(m.x, y, m.w, m.h, 'dg-inner') + T(cx, y + 22, md.title, 'dg-t') + (md.sub ? T(cx, y + 41, md.sub, 'dg-sub') : '');
    if (i < n - 1 && spec.chain !== false) s += V(cx, y + m.h, rowY(i + 1) - 2);
  });
  if (spec.core.note) s += T(core.x + core.w / 2, rowY(n - 1) + m.h + 30, spec.core.note, 'dg-note');
  // 왼쪽: 사람(역할) — 닿는 단계의 행에 맞춘다. 여러 행이면 상자가 그 행들을 덮는다
  const lx2 = left.x + left.w, lc = (lx2 + m.x) / 2;
  for (const a of spec.actors || []) {
    const [r0, r1] = rowsOf(a), y = rowY(r0), h = rowY(r1) + m.h - y, k = (a.lines || []).length;
    const multi = r1 > r0, tg = multi ? 22 : 19, lg = multi ? 18 : 19;
    const ch = 14 + (k ? tg + (k - 1) * lg : 0), ty = Math.round(y + (h - ch) / 2 + 13);
    s += R(left.x, y, left.w, h, 'dg-box') + T(left.x + left.w / 2, ty, a.title, 'dg-t');
    (a.lines || []).forEach((t, i) => { s += T(left.x + left.w / 2, ty + tg + i * lg, t, 'dg-sub'); });
    for (const lk of a.links || []) {
      const c = rowC(lk.row), dir = lk.dir || (lk.back ? 'both' : 'out');
      if (dir === 'both') s += H(lx2 + 2, c, m.x - 2, true);
      else if (dir === 'in') s += `<path d="M${m.x},${c} H${lx2 + 2}" class="dg-arrow" marker-end="url(#${id})"/>`;
      else s += H(lx2, c, m.x - 2);
      if (lk.label) s += T(lc, c - 8, lk.label, 'dg-lbl');
      if (lk.back) s += T(lc, c + 18, lk.back, 'dg-lbl');
    }
  }
  // 오른쪽: 바깥 시스템 — 주고받는 단계와 같은 높이. 위 화살표는 보내는 것, 아래 화살표는 돌아오는 것
  for (const e of spec.externals || []) {
    const c = rowC(e.row), hh = right.h, y = c - hh / 2, rc = (core.x + core.w + right.x) / 2, ln = e.lines || [];
    s += R(right.x, y, right.w, hh, 'dg-ext') + T(right.x + right.w / 2, y + (ln.length ? 26 : hh / 2 + 5), e.title, 'dg-t');
    ln.slice(0, 2).forEach((t, i) => { s += T(right.x + right.w / 2, y + 46 + i * 17, t, 'dg-sub'); });
    const both = e.out && e.back;
    if (e.out) s += H(mx2, both ? c - 9 : c, right.x - 2) + T(rc, (both ? c - 9 : c) - 7, e.out, 'dg-lbl');
    if (e.back) s += H(right.x, both ? c + 9 : c, mx2 + 2) + T(rc, (both ? c + 9 : c) + 18, e.back, 'dg-lbl');
  }
  return s + '</svg>';
}

// ---------- 세로 그림(휴대폰) ----------
export function conceptTall(spec) {
  const L = merge(LAYOUT.tall, spec.layout && spec.layout.tall);
  const tl = spec.tall || {}, hd = tl.header !== false && (tl.header || ((spec.actors || []).length ? { title: '사용하는 사람', sub: spec.actors.map((a) => a.title).join(' · ') } : null));
  const core = { ...L.core, y: hd ? L.core.y : 16 }, m = { ...L.module, x: core.x + (core.w - L.module.w) / 2, top: core.y + 60 }, ext = L.external;
  const n = spec.modules.length, id = `${spec.id || 'cm'}-tall-head`;
  const { T, R, H, V, defs } = kit(id);
  const rowY = (i) => m.top + i * m.step, rowC = (i) => rowY(i) + m.h / 2, cx = m.x + m.w / 2;
  const noteT = tl.note || (spec.core.note ? splitTwo(spec.core.note).filter(Boolean) : []);
  const coreH = rowY(n - 1) + m.h + (noteT.length ? 26 + noteT.length * 16 : 18) - core.y;
  let s = `<svg class="dg dg-tall" viewBox="0 0 ${L.width} ${core.y + coreH + 12}" role="img" aria-label="${esc(ariaOf(spec))}">${defs}`;
  if (hd) {
    const h = L.header;
    s += R(h.x, h.y, h.w, h.h, 'dg-box') + T(h.x + h.w / 2, h.y + 22, hd.title, 'dg-t') + (hd.sub ? T(h.x + h.w / 2, h.y + 42, hd.sub, 'dg-sub') : '');
    s += V(cx, h.y + h.h, core.y - 2) + (hd.label ? T(cx + 10, h.y + h.h + 20, hd.label, 'dg-lbl', 'start') : '');
  }
  s += R(core.x, core.y, core.w, coreH, 'dg-core', 18) + T(core.x + core.w / 2, core.y + 30, spec.core.name, 'dg-title');
  const csub = tl.coreSub ?? spec.core.sub; if (csub) s += T(core.x + core.w / 2, core.y + 48, csub, 'dg-sub');
  spec.modules.forEach((md, i) => {
    const y = rowY(i), [a, b] = md.tall || splitTwo(md.sub || '');
    s += R(m.x, y, m.w, m.h, 'dg-inner') + T(cx, y + 21, md.title, 'dg-t') + (a ? T(cx, y + 39, a, 'dg-sub') : '') + (b ? T(cx, y + 54, b, 'dg-sub') : '');
    if (i < n - 1 && spec.chain !== false) s += V(cx, y + m.h, rowY(i + 1) - 2);
  });
  noteT.forEach((t, i) => { s += T(core.x + core.w / 2, rowY(n - 1) + m.h + 26 + i * 16, t, 'dg-note'); });
  for (const e of spec.externals || []) {
    const t = e.tall || {}, c = rowC(e.row), y = c - ext.h / 2;
    const sub = t.sub ?? (e.lines || [])[0] ?? '', out = t.out ?? (e.out ? `→ ${e.out}` : ''), back = t.back ?? (e.back ? `← ${e.back}` : '');
    s += R(ext.x, y, ext.w, ext.h, 'dg-ext') + T(ext.x + ext.w / 2, y + 22, t.title || e.title, 'dg-t') + (sub ? T(ext.x + ext.w / 2, y + 40, sub, 'dg-sub') : '')
      + (out ? T(ext.x + ext.w / 2, y + 62, out, 'dg-lbl') : '') + (back ? T(ext.x + ext.w / 2, y + 79, back, 'dg-lbl') : '')
      + H(m.x + m.w + 2, c, ext.x - 2, !!(e.out && e.back));
  }
  return s + '</svg>';
}

// ---------- 파일로 내보내기 ----------
export const themeCss = () => fs.readFileSync(path.join(HERE, '..', 'templates', 'theme.css'), 'utf8');
export function standaloneSvg(svg) {
  // 단독 SVG 파일: 테마를 <style>로 넣고, 넓은·세로 그림 숨김 규칙은 뺀다
  const css = themeCss().replace(/\.dg-tall \{ display: none;[^}]*\}/, '').replace(/@media \(max-width: 640px\)[^\n]*\n/, '');
  return svg.replace(/^<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/(<svg[^>]*>)/, `$1<style>${css.replace(/\s+/g, ' ')} svg{background:var(--surface);font-family:"Pretendard","Apple SD Gothic Neo","Noto Sans KR",sans-serif}</style>`);
}
export function renderPage(spec) {
  const tpl = fs.readFileSync(path.join(HERE, '..', 'templates', 'page.html'), 'utf8');
  return tpl.replace('{{THEME_CSS}}', themeCss()).replace(/{{TITLE}}/g, esc(spec.title || '개념도')).replace('{{DESC}}', esc(spec.desc || ''))
    .replace('{{FIGURE}}', conceptWide(spec) + '\n' + conceptTall(spec));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), file = args.find((a) => !a.startsWith('--'));
  const oi = args.indexOf('--out'), out = oi >= 0 ? args[oi + 1] : path.dirname(path.resolve(file || '.'));
  if (!file) { console.error('사용법: node scripts/render.mjs <spec.json> [--out <폴더>]'); process.exit(2); }
  const spec = JSON.parse(fs.readFileSync(file, 'utf8')), id = spec.id || path.basename(file, '.json');
  fs.mkdirSync(out, { recursive: true });
  if (spec.layout === 'board') {      // 목표모델형(공공 정보화 구성도 결)
    const { boardSvg, boardPage } = await import('./board.mjs');
    fs.writeFileSync(path.join(out, `${id}.html`), boardPage(spec)); fs.writeFileSync(path.join(out, `${id}-board.svg`), boardSvg(spec));
    console.log(`만듦: ${path.join(out, id)}.html · -board.svg`); process.exit(0);
  }
  fs.writeFileSync(path.join(out, `${id}.html`), renderPage(spec));
  fs.writeFileSync(path.join(out, `${id}-wide.svg`), standaloneSvg(conceptWide(spec)));
  fs.writeFileSync(path.join(out, `${id}-tall.svg`), standaloneSvg(conceptTall(spec)));
  console.log(`만듦: ${path.join(out, id)}.html · -wide.svg · -tall.svg`);
}

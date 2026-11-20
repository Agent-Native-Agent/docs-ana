'use strict';
// docx.js — DOCX(Word, OOXML) 읽기·최종본 쓰기·새로 만들기. 의존성 없음(zip.js · xml.js).
//   parse(buf)              → hwpx.js 와 같은 문서 모델(model.js). 문단마다 xi(문서 순서 번호)를 붙인다.
//   buildFinal(buf, plans)  → 고친 결과를 원본 DOCX 의 word/document.xml 에 써 넣은 새 DOCX (서식·표·그림은 그대로)
//   build(blocks)           → 글·표만 있는 새 DOCX. blocks: [{p:'글'} | {h:'제목'} | {table:[[칸,…],…]}]
//                             (PDF·PPTX·XLSX·TXT 처럼 DOCX 가 아닌 문서를 '작업용 DOCX' 로 바꿀 때 쓴다)
// 단위: 모델은 HWPUNIT(1/100 pt). DOCX 는 twip(1/20 pt) → ×5, EMU(1/914400 in) → ÷127.
const zip = require('./zip');
const zipw = require('./zipw');
const xml = require('./xml');
const { newDoc, newSection, newParagraph } = require('./model');

const TW = 5;
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const els = (n) => (n ? n.children.filter((c) => typeof c !== 'string') : []);
const kid = (n, name) => (n && n.children.find((c) => typeof c !== 'string' && c.name === name)) || null;
const kids = (n, name) => (n ? n.children.filter((c) => typeof c !== 'string' && c.name === name) : []);
const val = (n, name) => { const k = kid(n, name); return k ? k.attrs['w:val'] : undefined; };
const on = (el) => !/^(0|false|off)$/i.test(el.attrs['w:val'] || '1');
// mc:Fallback(옛 프로그램용 사본) 안은 보지 않는다 — 같은 문단이 두 번 나오지 않게
function deep(n, name, out = []) {
  for (const c of n.children) { if (typeof c === 'string' || c.name === 'mc:Fallback') continue; if (c.name === name) out.push(c); deep(c, name, out); }
  return out;
}
// 문단·표에 문서 순서 번호를 붙인다(읽을 때와 최종본을 쓸 때 같은 번호). 부모도 적어 둔다.
function number(root) {
  const paras = []; const tbls = [];
  (function go(n) {
    for (const c of n.children) {
      if (typeof c === 'string') continue;
      c._parent = n;
      if (c.name === 'mc:Fallback') continue;
      if (c.name === 'w:p') { c._xi = paras.length; paras.push(c); } else if (c.name === 'w:tbl') { c._xt = tbls.length; tbls.push(c); }
      go(c);
    }
  })(root);
  return { paras, tbls };
}

// ---------- 테마(글꼴·색) ----------
let TH = { fonts: {}, colors: {} };       // parse() 가 문서마다 채운다(읽기는 한 번에 한 문서 — 동기)
function loadTheme(z) {
  const th = { fonts: {}, colors: {} };
  const name = z.list().find((n) => /^word\/theme\/[^/]+\.xml$/.test(n));
  if (!name) return th;
  const root = xml.parse(z.read(name).toString('utf8'));
  for (const kind of ['major', 'minor']) {
    const n = xml.descendants(root, `a:${kind}Font`)[0]; if (!n) continue;
    const latin = (kid(n, 'a:latin') || { attrs: {} }).attrs.typeface || '';
    const ea = (kid(n, 'a:ea') || { attrs: {} }).attrs.typeface || '';
    const hang = (kids(n, 'a:font').find((f) => f.attrs.script === 'Hang') || { attrs: {} }).attrs.typeface || '';
    th.fonts[kind] = { latin, ea: hang || ea || latin };
  }
  const cs = xml.descendants(root, 'a:clrScheme')[0];
  for (const c of els(cs)) {
    const v = els(c)[0]; if (!v) continue;
    const hex = v.attrs.val && /^[0-9a-f]{6}$/i.test(v.attrs.val) ? v.attrs.val : v.attrs.lastClr;
    if (hex && /^[0-9a-f]{6}$/i.test(hex)) th.colors[c.name.replace(/^a:/, '')] = `#${hex.toLowerCase()}`;
  }
  const al = { tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2', text1: 'dk1', text2: 'dk2', background1: 'lt1', background2: 'lt2', hyperlink: 'hlink', followedHyperlink: 'folHlink' };
  for (const [a, b] of Object.entries(al)) if (th.colors[b]) th.colors[a] = th.colors[b];
  return th;
}
const themeFont = (v, ea) => { if (!v) return ''; const f = TH.fonts[/^major/.test(v) ? 'major' : 'minor']; return f ? (ea || /EastAsia/.test(v) ? f.ea : f.latin) : ''; };
const hexOf = (v) => (/^[0-9a-f]{6}$/i.test(v || '') ? `#${v.toLowerCase()}` : '');
const HILITE = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff' };
const SANS = /고딕|gothic|sans|arial|calibri|helvet|돋움|굴림|tahoma|verdana|segoe|dotum|gulim|pretendard|aptos|roboto|나눔바른|스퀘어/i;
const fontName = (s) => String(s || '').replace(/['"<>&;{}\\]/g, '').trim().slice(0, 60);
function fontStack(ascii, ea) {
  const list = [...new Set([fontName(ascii), fontName(ea)].filter(Boolean))];
  if (!list.length) return '';
  const sans = list.some((f) => SANS.test(f));
  return `${list.map((f) => `'${f}'`).join(',')},${sans ? "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR','Noto Sans CJK KR',sans-serif" : "'Batang','AppleMyungjo','Noto Serif KR','Noto Serif CJK KR',serif"}`;
}
// 테두리 하나 → CSS (sz 는 1/8 pt)
function bcss(b) {
  if (!b) return undefined;
  const v = b.attrs['w:val'];
  if (!v || v === 'nil' || v === 'none') return 'none';
  const px = Math.max(1, Math.round(num(b.attrs['w:sz'], 4) / 8 * 1.333 * 10) / 10);
  const st = v === 'double' ? 'double' : /dash/i.test(v) ? 'dashed' : /dot/i.test(v) ? 'dotted' : 'solid';
  return `${st === 'double' ? Math.max(3, px) : px}px ${st} ${hexOf(b.attrs['w:color']) || '#000'}`;
}

// ---------- 글자 모양 · 문단 모양 ----------
function readR(rPr, into) {
  for (const c of els(rPr)) {
    const v = c.attrs['w:val'];
    if (c.name === 'w:b') into.bold = on(c);
    else if (c.name === 'w:i') into.italic = on(c);
    else if (c.name === 'w:u') into.underline = v && v !== 'none' ? 1 : 0;
    else if (c.name === 'w:strike' || c.name === 'w:dstrike') into.strike = on(c);
    else if (c.name === 'w:sz') into.height = num(v, 20) * 50;
    else if (c.name === 'w:color') { const h = hexOf(v) || (c.attrs['w:themeColor'] && TH.colors[c.attrs['w:themeColor']]); if (h) into.color = h; else delete into.color; }
    else if (c.name === 'w:highlight') { if (HILITE[v]) into.bg = HILITE[v]; else delete into.bg; }
    else if (c.name === 'w:shd') { const h = hexOf(c.attrs['w:fill']); if (h) into.bg = h; }
    else if (c.name === 'w:vertAlign') { if (v === 'superscript') into.va = 'super'; else if (v === 'subscript') into.va = 'sub'; else delete into.va; }
    else if (c.name === 'w:rFonts') {
      const a = c.attrs['w:ascii'] || themeFont(c.attrs['w:asciiTheme']) || c.attrs['w:hAnsi'] || themeFont(c.attrs['w:hAnsiTheme']);
      const e = c.attrs['w:eastAsia'] || themeFont(c.attrs['w:eastAsiaTheme'], true);
      if (a) into.fontAscii = a; if (e) into.fontEA = e;
    }
  }
  return into;
}
const JC = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' };
function readP(pPr, into) {
  for (const c of els(pPr)) {
    const a = c.attrs;
    if (c.name === 'w:jc') into.align = JC[a['w:val']] || 'left';
    else if (c.name === 'w:ind') {
      const l = a['w:left'] !== undefined ? a['w:left'] : a['w:start']; const r = a['w:right'] !== undefined ? a['w:right'] : a['w:end'];
      if (l !== undefined) into.left = num(l) * TW;
      if (r !== undefined) into.marginRight = num(r) * TW;
      if (a['w:hanging'] !== undefined) { into.hanging = num(a['w:hanging']) * TW; delete into.firstLine; } else if (a['w:firstLine'] !== undefined) { into.firstLine = num(a['w:firstLine']) * TW; delete into.hanging; }
    } else if (c.name === 'w:spacing') {
      if (a['w:before'] !== undefined) into.spaceBefore = num(a['w:before']) * TW;
      if (a['w:after'] !== undefined) into.spaceAfter = num(a['w:after']) * TW;
      if (a['w:line'] !== undefined) { into.line = num(a['w:line'], 240); into.lineRule = a['w:lineRule'] || 'auto'; }
    } else if (c.name === 'w:numPr') { const nid = val(c, 'w:numId'); const lv = val(c, 'w:ilvl'); into.num = { id: nid !== undefined ? String(nid) : (into.num ? into.num.id : '0'), lvl: lv !== undefined ? num(lv) : (into.num && nid === undefined ? into.num.lvl : 0) }; }      // 적지 않은 쪽은 물려받는다(제목 2 = 제목 1 의 번호 틀 + 수준 1)
    else if (c.name === 'w:shd') { const h = hexOf(a['w:fill']); if (h) into.bg = h; else delete into.bg; }
    else if (c.name === 'w:pBdr') { const b = {}; for (const s of ['top', 'left', 'bottom', 'right']) { const v = bcss(kid(c, `w:${s}`)); if (v && v !== 'none') b[s] = v; } into.bdr = b; }
    else if (c.name === 'w:pageBreakBefore') into.pbb = on(c);
    else if (c.name === 'w:tabs') {            // 탭 자리는 스타일의 것에 더해진다(clear 는 그 자리를 지운다)
      const m = new Map((into.tabs || []).map((t) => [t.pos, t]));
      for (const t of kids(c, 'w:tab')) { const pos = num(t.attrs['w:pos']) * TW; if (t.attrs['w:val'] === 'clear') m.delete(pos); else m.set(pos, { pos, val: t.attrs['w:val'] || 'left', leader: t.attrs['w:leader'] || '' }); }
      into.tabs = [...m.values()].sort((x, y) => x.pos - y.pos);
    }
  }
  return into;
}

function loadStyles(z) {
  const st = { defR: { height: 1000 }, defP: {}, map: new Map(), defPara: null, defTable: null, memo: new Map() };
  if (!z.has('word/styles.xml')) return st;
  const root = xml.parse(z.read('word/styles.xml').toString('utf8'));
  const s = xml.descendants(root, 'w:styles')[0] || root;
  const dd = kid(s, 'w:docDefaults');
  if (dd) { readR(kid(kid(dd, 'w:rPrDefault'), 'w:rPr'), st.defR); readP(kid(kid(dd, 'w:pPrDefault'), 'w:pPr'), st.defP); }
  for (const e of kids(s, 'w:style')) {
    const id = e.attrs['w:styleId']; if (!id) continue;
    st.map.set(id, { basedOn: val(e, 'w:basedOn'), rPr: kid(e, 'w:rPr'), pPr: kid(e, 'w:pPr'), tblPr: kid(e, 'w:tblPr'), tcPr: kid(e, 'w:tcPr') });
    const dflt = /^(1|true|on)$/i.test(e.attrs['w:default'] || '');
    if (e.attrs['w:type'] === 'paragraph' && dflt) st.defPara = id;
    if (e.attrs['w:type'] === 'table' && dflt) st.defTable = id;
  }
  return st;
}
// 스타일 하나를 조상부터 차례로 겹쳐 푼다 → { r: 글자 모양, p: 문단 모양 }
function resolve(st, id, depth = 0) {
  if (!id || !st.map.has(id) || depth > 20) return { r: { ...st.defR }, p: { ...st.defP } };
  if (st.memo.has(id)) return st.memo.get(id);
  const e = st.map.get(id);
  const base = resolve(st, e.basedOn, depth + 1);
  const out = { r: readR(e.rPr, { ...base.r }), p: readP(e.pPr, { ...base.p }) };
  st.memo.set(id, out);
  return out;
}
function charChain(st, id, into, depth = 0) {
  if (!id || !st.map.has(id) || depth > 20) return into;
  const e = st.map.get(id);
  charChain(st, e.basedOn, into, depth + 1);
  return readR(e.rPr, into);
}
// 표 스타일의 tblPr 들(조상 → 자손)
function tableChain(st, id, out = [], depth = 0) {
  if (!id || !st.map.has(id) || depth > 20) return out;
  const e = st.map.get(id);
  tableChain(st, e.basedOn, out, depth + 1);
  out.push(e);
  return out;
}

// ---------- 글머리표 · 번호 ----------
function loadNumbering(z) {
  const out = { nums: new Map(), abs: new Map() };
  if (!z.has('word/numbering.xml')) return out;
  const root = xml.parse(z.read('word/numbering.xml').toString('utf8'));
  const lvls = (n) => { const m = {}; for (const l of kids(n, 'w:lvl')) m[num(l.attrs['w:ilvl'])] = { fmt: val(l, 'w:numFmt') || 'decimal', text: val(l, 'w:lvlText') || '', start: num(val(l, 'w:start'), 1), pPr: kid(l, 'w:pPr'), suff: val(l, 'w:suff') || 'tab' }; return m; };
  for (const a of xml.descendants(root, 'w:abstractNum')) out.abs.set(a.attrs['w:abstractNumId'], lvls(a));
  for (const n of xml.descendants(root, 'w:num')) {
    const absId = val(n, 'w:abstractNumId');
    const base = out.abs.get(absId) || {};
    const m = { ...base };
    for (const o of kids(n, 'w:lvlOverride')) { const i = num(o.attrs['w:ilvl']); const l = lvls(o)[i]; if (l) m[i] = l; else if (m[i] && kid(o, 'w:startOverride')) m[i] = { ...m[i], start: num(val(o, 'w:startOverride'), 1) }; }
    m.abs = absId;
    out.nums.set(String(n.attrs['w:numId']), m);
  }
  return out;
}
const GANADA = '가나다라마바사아자차카타파하'; const CHOSUNG = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ';
function roman(n) { const t = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v; } return s; }
function fmtNum(n, fmt) {
  if (n < 1) n = 1;
  const cyc = (s) => s[(n - 1) % s.length];
  switch (fmt) {
    case 'upperLetter': return String.fromCharCode(65 + (n - 1) % 26);
    case 'lowerLetter': return String.fromCharCode(97 + (n - 1) % 26);
    case 'upperRoman': return roman(n);
    case 'lowerRoman': return roman(n).toLowerCase();
    case 'ganada': return cyc(GANADA);
    case 'chosung': return cyc(CHOSUNG);
    case 'decimalEnclosedCircle': return n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n);
    case 'decimalZero': return n < 10 ? `0${n}` : String(n);
    case 'none': return '';
    default: return String(n);
  }
}
function markerOf(ctx, nm) {
  const lv = ctx.numbering.nums.get(nm.id); const l = lv && lv[nm.lvl];
  if (!l) return '';
  const key = lv.abs !== undefined ? `a${lv.abs}` : nm.id;      // 같은 번호 틀을 쓰는 목록은 번호를 이어 센다(제목 번호 1 → 1.1 → 2 …)
  if (!ctx.counts.has(key)) ctx.counts.set(key, []);
  const c = ctx.counts.get(key);
  c[nm.lvl] = c[nm.lvl] === undefined ? l.start : c[nm.lvl] + 1;
  c.length = nm.lvl + 1;
  if (l.fmt === 'bullet') { const ch = l.text || '•'; const cp = ch.codePointAt(0); return cp >= 0xe000 && cp <= 0xf8ff ? ({ 0xf0a7: '▪', 0xf0d8: '➢', 0xf0fc: '✓', 0xf0a8: '◆' }[cp] || '•') : ch.slice(0, 2); }
  return l.text.replace(/%(\d)/g, (m, d) => { const i = Number(d) - 1; const li = lv[i] || l; return fmtNum(c[i] === undefined ? li.start : c[i], li.fmt); }).slice(0, 24);
}

// ---------- 문단 ----------
const WRAP = new Set(['w:hyperlink', 'w:ins', 'w:smartTag', 'w:sdt', 'w:sdtContent', 'w:fldSimple', 'w:moveTo', 'w:customXml']);
// 문단 안의 글자 run 들(문서 순서) — 읽을 때와 최종본을 쓸 때 같은 규칙
function runsOf(p, out = []) {
  for (const c of els(p)) { if (c.name === 'w:r') out.push(c); else if (WRAP.has(c.name)) runsOf(c, out); }
  return out;
}
const TEXTY = new Set(['w:t', 'w:tab', 'w:br', 'w:cr', 'w:noBreakHyphen']);
const softBreak = (c) => !/^(page|column)$/.test(c.attrs['w:type'] || '');
function runText(r) {
  let s = '';
  for (const c of els(r)) {
    if (c.name === 'w:t') s += xml.text(c);
    else if (c.name === 'w:tab') s += '\t';
    else if (c.name === 'w:br') { if (softBreak(c)) s += '\n'; } else if (c.name === 'w:cr') s += '\n';
    else if (c.name === 'w:noBreakHyphen') s += '-';
  }
  return s;
}
// Word 가 마지막으로 그렸을 때의 쪽 나눔(w:lastRenderedPageBreak)과 쪽 나누기(w:br type=page): 문단 글 앞에 있는 것 / 글 뒤(가운데)에 있는 것
function breaksIn(p) {
  let before = 0, after = 0, seen = false;
  const brs = [];                 // 아직 lastRenderedPageBreak 와 짝짓지 못한 쪽 나누기(그때 글이 이미 나왔는지)
  for (const r of runsOf(p)) for (const c of els(r)) {
    if (c.name === 'w:br' && c.attrs['w:type'] === 'page') brs.push(seen);
    else if (c.name === 'w:lastRenderedPageBreak') { if (brs.length) brs.pop(); if (seen) after++; else before++; }      // 쪽 나누기 바로 뒤의 표시는 같은 나눔이다
    else if (c.name === 'w:t' ? xml.text(c).length : c.name === 'w:tab' || c.name === 'w:drawing' || c.name === 'mc:AlternateContent' || c.name === 'w:pict') { if (!seen) { for (let i = 0; i < brs.length; i++) if (brs[i] === false) { brs.splice(i--, 1); before++; } } seen = true; }
  }
  return { before, after: after + brs.length };
}

// ---------- 도형(벡터) → SVG ----------
const EMU = (v) => Math.round(num(v) / 127);                // EMU → HWPUNIT
function fillOf(n) {
  if (!n) return undefined;
  if (kid(n, 'a:noFill')) return 'none';
  const sf = kid(n, 'a:solidFill'); if (!sf) return undefined;
  const c = els(sf)[0]; if (!c) return undefined;
  let hex = c.name === 'a:srgbClr' ? hexOf(c.attrs.val) : c.name === 'a:schemeClr' ? TH.colors[c.attrs.val] : c.name === 'a:sysClr' ? hexOf(c.attrs.lastClr) : '';
  if (!hex) return undefined;
  const al = kid(c, 'a:alpha');
  return al ? `${hex}" fill-opacity="${Math.max(0, Math.min(1, num(al.attrs.val, 100000) / 100000))}` : hex;
}
const fnum = (v) => String(Math.round(v * 10) / 10);
function shapeSvg(sp, map) {
  const spPr = kid(sp, 'wps:spPr') || kid(sp, 'pic:spPr'); const xf = kid(spPr, 'a:xfrm');
  const off = kid(xf, 'a:off'); const ext = kid(xf, 'a:ext');
  if (!off || !ext) return '';
  const x0 = num(off.attrs.x), y0 = num(off.attrs.y), w = num(ext.attrs.cx), h = num(ext.attrs.cy);
  const P = (x, y) => { const q = map(x0 + x, y0 + y); return `${fnum(q[0])} ${fnum(q[1])}`; };
  let d = '';
  const cg = kid(spPr, 'a:custGeom');
  if (cg) {
    for (const path of kids(kid(cg, 'a:pathLst'), 'a:path')) {
      const pw = num(path.attrs.w) || w || 1, ph = num(path.attrs.h) || h || 1;
      const pt = (n) => kids(n, 'a:pt').map((q) => P(num(q.attrs.x) * w / pw, num(q.attrs.y) * h / ph));
      for (const c of els(path)) {
        if (c.name === 'a:moveTo') d += `M${pt(c)[0]}`;
        else if (c.name === 'a:lnTo') d += `L${pt(c)[0]}`;
        else if (c.name === 'a:cubicBezTo') d += `C${pt(c).join(' ')}`;
        else if (c.name === 'a:quadBezTo') d += `Q${pt(c).join(' ')}`;
        else if (c.name === 'a:close') d += 'Z';
      }
    }
  } else {
    const g = (kid(spPr, 'a:prstGeom') || { attrs: {} }).attrs.prst || 'rect';
    if (g === 'line' || g === 'straightConnector1') d = `M${P(0, 0)}L${P(w, h)}`;
    else if (g === 'triangle') d = `M${P(w / 2, 0)}L${P(w, h)}L${P(0, h)}Z`;
    else if (g === 'rtTriangle') d = `M${P(0, 0)}L${P(w, h)}L${P(0, h)}Z`;
    else if (g === 'ellipse') { const k = 0.5523; d = `M${P(w / 2, 0)}C${P(w / 2 + k * w / 2, 0)} ${P(w, h / 2 - k * h / 2)} ${P(w, h / 2)}C${P(w, h / 2 + k * h / 2)} ${P(w / 2 + k * w / 2, h)} ${P(w / 2, h)}C${P(w / 2 - k * w / 2, h)} ${P(0, h / 2 + k * h / 2)} ${P(0, h / 2)}C${P(0, h / 2 - k * h / 2)} ${P(w / 2 - k * w / 2, 0)} ${P(w / 2, 0)}Z`; }
    else d = `M${P(0, 0)}L${P(w, 0)}L${P(w, h)}L${P(0, h)}Z`;
  }
  if (!d) return '';
  const fill = fillOf(spPr);
  const ln = kid(spPr, 'a:ln'); const stroke = ln ? fillOf(ln) : undefined;
  if ((fill === undefined || fill === 'none') && (stroke === undefined || stroke === 'none')) return '';
  return `<path d="${d}" fill="${fill === undefined ? 'none' : fill}"${stroke && stroke !== 'none' ? ` stroke="${stroke}" stroke-width="${fnum(Math.max(60, num(ln.attrs.w, 9525) / 127))}"` : ''}/>`;
}
function groupSvg(n, map) {
  let s = '';
  for (const c of els(n)) {
    if (c.name === 'wps:wsp') s += shapeSvg(c, map);
    else if (c.name === 'wpg:grpSp' || c.name === 'wpg:wgp') {
      const xf = kid(kid(c, 'wpg:grpSpPr'), 'a:xfrm');
      const off = kid(xf, 'a:off'), ext = kid(xf, 'a:ext'), co = kid(xf, 'a:chOff'), ce = kid(xf, 'a:chExt');
      if (off && ext && co && ce && num(ce.attrs.cx) && num(ce.attrs.cy)) {
        const sx = num(ext.attrs.cx) / num(ce.attrs.cx), sy = num(ext.attrs.cy) / num(ce.attrs.cy);
        const ox = num(off.attrs.x), oy = num(off.attrs.y), cx = num(co.attrs.x), cy = num(co.attrs.y);
        s += groupSvg(c, (x, y) => map(ox + (x - cx) * sx, oy + (y - cy) * sy));
      } else s += groupSvg(c, map);
    }
  }
  return s;
}
const IMG_OK = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
function drawing(n, para, ctx) {
  if (n.name === 'mc:AlternateContent') { for (const k of els(kid(n, 'mc:Choice'))) drawing(k, para, ctx); return; }
  const obj = { type: 'shape', kind: 'rect', width: 0, height: 0, paragraphs: [] };
  const ext = deep(n, 'wp:extent')[0];
  if (ext) { obj.width = EMU(ext.attrs.cx); obj.height = EMU(ext.attrs.cy); }
  const anchor = deep(n, 'wp:anchor')[0];
  if (anchor) {
    const pos = (tag) => { const e = kid(anchor, tag); if (!e) return null; const o = kid(e, 'wp:posOffset'); const a = kid(e, 'wp:align'); return { rel: e.attrs.relativeFrom || 'column', off: o ? EMU(xml.text(o)) : 0, align: a ? xml.text(a) : '' }; };
    obj.anchor = { h: pos('wp:positionH'), v: pos('wp:positionV'), behind: anchor.attrs.behindDoc === '1' };
  }
  const blip = deep(n, 'a:blip')[0] || deep(n, 'v:imagedata')[0];
  const rid = blip && (blip.attrs['r:embed'] || blip.attrs['r:id']);
  const target = rid && ctx.rels[rid];
  if (target && IMG_OK.test(target) && ctx.z.has(target)) { obj.kind = 'picture'; obj.binRef = target; para.controls.push(obj); return; }
  for (const box of deep(n, 'w:txbxContent')) obj.paragraphs.push(...parseBlocks(box, ctx));
  if (obj.paragraphs.length) { para.controls.push(obj); return; }
  // 글도 그림도 아닌 도형(선·다각형·묶음): SVG 로
  const gd = deep(n, 'a:graphicData')[0];
  if (gd && ext && num(ext.attrs.cx) && num(ext.attrs.cy)) {
    const body = groupSvg(gd, (x, y) => [x / 127, y / 127]);
    if (body) { obj.kind = 'svg'; obj.svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${obj.width} ${obj.height}" preserveAspectRatio="none">${body}</svg>`; para.controls.push(obj); }
  }
}
function parsePara(p, ctx) {
  const para = newParagraph();
  para.xi = p._xi;
  const pPr = kid(p, 'w:pPr');
  const base = resolve(ctx.st, val(pPr, 'w:pStyle') || ctx.st.defPara);
  const ps = { ...base.p };
  const direct = readP(pPr, {});
  const nm = direct.num || ps.num;
  if (nm && nm.id !== '0') {
    const lv = ctx.numbering.nums.get(nm.id); const l = lv && lv[nm.lvl];
    if (l) {
      // 들여쓰기: 문단에 직접 건 번호면 번호 틀의 것이 스타일을 이기고, 스타일에서 온 번호면 스타일이 적은 것이 이긴다
      const li = readP(l.pPr, {});
      if (direct.num) { if (li.hanging !== undefined) delete ps.firstLine; else if (li.firstLine !== undefined) delete ps.hanging; Object.assign(ps, li); }
      else for (const k of Object.keys(li)) if (ps[k] === undefined && !((k === 'hanging' && ps.firstLine !== undefined) || (k === 'firstLine' && ps.hanging !== undefined))) ps[k] = li[k];
      const m = markerOf(ctx, nm); if (m) para.marker = m;
    }
  }
  if (direct.hanging !== undefined) delete ps.firstLine; else if (direct.firstLine !== undefined) delete ps.hanging;
  if (direct.tabs && ps.tabs) { const m = new Map(ps.tabs.map((t) => [t.pos, t])); for (const t of direct.tabs) m.set(t.pos, t); direct.tabs = [...m.values()].sort((x, y) => x.pos - y.pos); }
  Object.assign(ps, direct); delete ps.num;
  para.pbb = !!ps.pbb; delete ps.pbb;
  para.paraShapeId = ctx.pShape(ps);
  let text = '';
  for (const r of runsOf(p)) {
    const rPr = kid(r, 'w:rPr');
    const cs = { ...base.r };
    const rs = val(rPr, 'w:rStyle'); if (rs) charChain(ctx.st, rs, cs);
    readR(rPr, cs);
    const id = ctx.cShape(cs);
    const last = para.charShapes[para.charShapes.length - 1];
    if (last && last.pos === text.length) last.id = id; else if (!last || last.id !== id) para.charShapes.push({ pos: text.length, id });
    text += runText(r);
    for (const c of els(r)) if (c.name === 'w:drawing' || c.name === 'w:pict' || c.name === 'mc:AlternateContent' || c.name === 'w:object') drawing(c, para, ctx);
  }
  if (!para.charShapes.length) para.charShapes.push({ pos: 0, id: ctx.cShape(readR(kid(pPr, 'w:rPr'), { ...base.r })) });
  para.text = text;
  para.charShapeId = para.charShapes[0].id;
  return para;
}
function parseTable(tbl, ctx, top) {
  const sum = (a, b) => a + b;
  const grid = kids(kid(tbl, 'w:tblGrid'), 'w:gridCol').map((g) => num(g.attrs['w:w']) * TW);
  const t = { type: 'table', xt: tbl._xt, rows: 0, cols: grid.length, cells: [], width: grid.reduce(sum, 0), height: 0, grid, rowBreaks: [] };
  // 표 모양: 표 스타일(조상부터) → 표에 직접 적은 것
  const tblPr = kid(tbl, 'w:tblPr');
  const chain = [...tableChain(ctx.st, val(tblPr, 'w:tblStyle') || ctx.st.defTable).map((e) => e.tblPr), tblPr].filter(Boolean);
  const B = {}; const mar = { left: 108 * TW, right: 108 * TW, top: 0, bottom: 0 };
  let jc = '', ind = 0;
  for (const pr of chain) {
    const tb = kid(pr, 'w:tblBorders');
    for (const s of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) { const v = bcss(kid(tb, `w:${s}`) || (s === 'left' ? kid(tb, 'w:start') : s === 'right' ? kid(tb, 'w:end') : null)); if (v !== undefined) B[s] = v; }
    const cm = kid(pr, 'w:tblCellMar');
    for (const s of ['top', 'left', 'bottom', 'right']) { const e = kid(cm, `w:${s}`) || (s === 'left' ? kid(cm, 'w:start') : s === 'right' ? kid(cm, 'w:end') : null); if (e) mar[s] = num(e.attrs['w:w']) * TW; }
    if (val(pr, 'w:jc')) jc = JC[val(pr, 'w:jc')] || '';
    const ti = kid(pr, 'w:tblInd'); if (ti) ind = num(ti.attrs['w:w']) * TW;
  }
  const px = (hu) => Math.round(hu / 75 * 10) / 10;
  t.css = jc === 'center' ? 'margin-left:auto;margin-right:auto;' : jc === 'right' ? 'margin-left:auto;' : ind ? `margin-left:${px(ind)}px;` : '';
  const open = [];
  let r = 0;
  for (const tr of kids(tbl, 'w:tr')) {
    const trPr = kid(tr, 'w:trPr');
    let c = num(val(trPr, 'w:gridBefore'));
    const h = num(val(trPr, 'w:trHeight')) * TW;
    let brk = 0;
    for (const tc of kids(tr, 'w:tc')) {
      const pr = kid(tc, 'w:tcPr');
      const span = num(val(pr, 'w:gridSpan'), 1) || 1;
      const vm = kid(pr, 'w:vMerge');
      const tcw = kid(pr, 'w:tcW');
      const w = grid.slice(c, c + span).reduce(sum, 0) || (tcw ? num(tcw.attrs['w:w']) * TW : 0);
      if (top) { let n = 0; for (const p of kids(tc, 'w:p')) { const b = breaksIn(p); n += b.before + b.after; } brk = Math.max(brk, n); }
      if (vm && (vm.attrs['w:val'] || 'continue') === 'continue' && open[c]) open[c].rowspan++;
      else {
        const cell = { row: r, col: c, rowspan: 1, colspan: span, width: w, height: h, paragraphs: parseBlocks(tc, ctx), pr };
        t.cells.push(cell); open[c] = vm ? cell : null;
      }
      c += span;
    }
    if (brk) t.rowBreaks.push([r, brk]);
    t.cols = Math.max(t.cols, c); r++;
  }
  t.rows = r;
  // 칸마다: 바탕색 · 세로 맞춤 · 테두리(칸에 적은 것 → 표의 바깥·안쪽 선) · 안쪽 여백
  for (const cell of t.cells) {
    const pr = cell.pr; delete cell.pr;
    let css = '';
    const fill = hexOf((kid(pr, 'w:shd') || { attrs: {} }).attrs['w:fill']); if (fill) css += `background:${fill};`;
    const va = val(pr, 'w:vAlign'); css += `vertical-align:${va === 'center' ? 'middle' : va === 'bottom' ? 'bottom' : 'top'};`;
    const tb = kid(pr, 'w:tcBorders');
    const edge = { top: cell.row === 0, bottom: cell.row + cell.rowspan >= t.rows, left: cell.col === 0, right: cell.col + cell.colspan >= t.cols };
    for (const s of ['top', 'right', 'bottom', 'left']) {
      const own = bcss(kid(tb, `w:${s}`) || (s === 'left' ? kid(tb, 'w:start') : s === 'right' ? kid(tb, 'w:end') : null));
      const v = own !== undefined ? own : edge[s] ? B[s] : B[s === 'top' || s === 'bottom' ? 'insideH' : 'insideV'];
      if (v && v !== 'none') css += `border-${s}:${v};`;
    }
    const cm = kid(pr, 'w:tcMar'); const m = { ...mar };
    for (const s of ['top', 'left', 'bottom', 'right']) { const e = kid(cm, `w:${s}`) || (s === 'left' ? kid(cm, 'w:start') : s === 'right' ? kid(cm, 'w:end') : null); if (e) m[s] = num(e.attrs['w:w']) * TW; }
    css += `padding:${px(m.top)}px ${px(m.right)}px ${px(m.bottom)}px ${px(m.left)}px;`;
    if (cell.height && cell.rowspan === 1) css += `height:${px(cell.height)}px;`;
    cell.css = css;
  }
  return t;
}
// 본문·칸·글상자 안의 문단들. 표는 바로 앞 문단에 딸린다(화면은 문단 다음에 표를 그린다). 앞 문단이 없으면 빈 문단을 하나 세운다(xi = 't표번호').
// top(본문 맨 위 층)일 때는 쪽 나눔과 구역(쪽 크기·머리말·꼬리말이 바뀌는 곳)을 문단에 적는다: para.pb = 이 문단 앞에서 넘어가는 쪽 수, para.sect = 여기서 시작하는 구역 번호
function parseBlocks(container, ctx, out = [], top = false) {
  for (const c of els(container)) {
    if (c.name === 'w:p') {
      if (c._xi === undefined) continue;
      const para = parsePara(c, ctx);
      if (top) {
        const b = breaksIn(c);
        let pb = Math.max(ctx.carry, b.before + (para.pbb ? 1 : 0) > 0 ? Math.max(1, b.before) : 0);
        if (ctx.sectStart) { para.sect = ctx.sectNo; if (ctx.sectNo > 0 && ctx.sectTypes[ctx.sectNo] !== 'continuous') pb = Math.max(pb, 1); ctx.sectStart = false; }
        if (pb && out.length) para.pb = pb;
        ctx.carry = b.after;
        if (kid(kid(c, 'w:pPr'), 'w:sectPr')) { ctx.sectNo++; ctx.sectStart = true; }
      }
      out.push(para);
    } else if (c.name === 'w:tbl') {
      if (c._xt === undefined) continue;
      let host = out[out.length - 1];
      if (!host || (top && ctx.sectStart)) {
        host = newParagraph(); host.xi = `t${c._xt}`; host.paraShapeId = ctx.pShape({ ...ctx.st.defP }); host.charShapes = [{ pos: 0, id: ctx.cShape({ ...ctx.st.defR }) }]; host.synthetic = true;
        if (top) { if (ctx.sectStart) { host.sect = ctx.sectNo; ctx.sectStart = false; } if (ctx.carry && out.length) host.pb = ctx.carry; ctx.carry = 0; }
        out.push(host);
      }
      const t = parseTable(c, ctx, top);
      if (top && ctx.carry) { if (t.rowBreaks[0] && t.rowBreaks[0][0] === 0) t.rowBreaks[0][1] = Math.max(t.rowBreaks[0][1], ctx.carry); else t.rowBreaks.unshift([0, ctx.carry]); ctx.carry = 0; }
      host.controls.push(t);
    } else if (c.name === 'w:sdt' || c.name === 'w:sdtContent' || c.name === 'w:customXml' || c.name === 'w:ins') parseBlocks(c, ctx, out, top);
  }
  return out;
}
function relsOf(z, name) {
  const out = {};
  if (!z.has(name)) return out;
  for (const r of xml.descendants(xml.parse(z.read(name).toString('utf8')), 'Relationship')) {
    if (r.attrs.TargetMode === 'External') continue;
    const t = String(r.attrs.Target || '');
    out[r.attrs.Id] = t[0] === '/' ? t.slice(1) : `word/${t}`.replace(/[^/]+\/\.\.\//g, '');
  }
  return out;
}
// 머리말·꼬리말: 화면에는 글만 보인다(고치지는 않는다). 쪽 번호 필드는 \u0001(PAGE) · \u0002(NUMPAGES) 로 남겨 화면이 채운다.
function parseHF(z, name, ctx) {
  if (!name || !z.has(name)) return [];
  const root = xml.parse(z.read(name).toString('utf8'));
  const out = [];
  for (const p of xml.descendants(root, 'w:p')) {
    const pPr = kid(p, 'w:pPr');
    const base = resolve(ctx.st, val(pPr, 'w:pStyle') || ctx.st.defPara);
    const ps = readP(pPr, { ...base.p });
    let text = ''; let state = 0; let instr = ''; let first = null;
    const emit = (code) => { const m = /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/i.exec(code); if (m) text += m[1].toUpperCase() === 'PAGE' ? '\u0001' : '\u0002'; return !!m; };
    (function walk(n) {
      for (const c of els(n)) {
        if (c.name === 'w:fldSimple') { if (!emit(c.attrs['w:instr'] || '')) walk(c); continue; }
        if (WRAP.has(c.name)) { walk(c); continue; }
        if (c.name !== 'w:r') continue;
        const fc = kid(c, 'w:fldChar');
        if (fc) { const ty = fc.attrs['w:fldCharType']; if (ty === 'begin') { state = 1; instr = ''; } else if (ty === 'separate') { state = emit(instr) ? 2 : 0; } else if (ty === 'end') { if (state === 1) emit(instr); state = 0; } continue; }
        if (state === 1) { const it = kid(c, 'w:instrText'); if (it) instr += xml.text(it); continue; }
        if (state === 2) continue;
        if (!first) first = readR(kid(c, 'w:rPr'), { ...base.r });
        text += runText(c);
      }
    })(p);
    // 앞에 붙은 탭은 가운데·오른쪽 맞춤 자리로 가는 것이다
    const lead = (/^\t+/.exec(text) || [''])[0].length;
    let align = ps.align || 'left';
    if (lead) { const stop = (ps.tabs || [])[lead - 1]; align = stop ? (stop.val === 'center' ? 'center' : stop.val === 'right' || stop.val === 'end' ? 'right' : align) : lead === 1 ? 'center' : 'right'; }
    text = text.replace(/^\t+/, '').replace(/\t/g, '   ');
    const r = first || readR(kid(pPr, 'w:rPr'), { ...base.r });
    out.push({ t: text.slice(0, 300), a: align, h: r.height || 1000, b: r.bold ? 1 : 0, c: r.color, ff: fontStack(r.fontAscii, r.fontEA) });
  }
  while (out.length && !out[out.length - 1].t.trim()) out.pop();
  return out.slice(0, 12);
}

function parse(buf) {
  const z = zip.parse(buf);
  if (!z.has('word/document.xml')) throw new Error('Word 문서(DOCX)가 아닙니다');
  const doc = newDoc('docx');
  TH = loadTheme(z);
  const root = xml.parse(z.read('word/document.xml').toString('utf8'));
  number(root);
  const intern = (list, make) => { const map = new Map(); return (o) => { const k = JSON.stringify(o); if (!map.has(k)) { map.set(k, list.length); list.push(make(o)); } return map.get(k); }; };
  const px = (hu) => Math.round(hu / 75 * 10) / 10;
  const ctx = {
    z, st: loadStyles(z), numbering: loadNumbering(z), counts: new Map(), rels: relsOf(z, 'word/_rels/document.xml.rels'),
    carry: 0, sectNo: 0, sectStart: true, sectTypes: [],
    cShape: intern(doc.charShapes, (c) => ({
      fontId: 0, fontName: c.fontEA || c.fontAscii, ff: fontStack(c.fontAscii, c.fontEA), height: c.height || 1000, bold: !!c.bold, italic: !!c.italic, underline: c.underline ? 1 : 0, color: c.color,
      css: `${c.strike ? `text-decoration:line-through${c.underline ? ' underline' : ''};` : ''}${c.bg ? `background:${c.bg};` : ''}${c.va ? `vertical-align:${c.va};font-size:${Math.round((c.height || 1000) * 0.65) / 100}pt;` : ''}`,
    })),
    pShape: intern(doc.paraShapes, (p) => {
      const hang = p.hanging || 0;
      let css = '';
      if (p.bg) css += `background:${p.bg};`;
      for (const [s, v] of Object.entries(p.bdr || {})) css += `border-${s}:${v};`;
      if (p.line && p.lineRule === 'exact') css += `line-height:${Math.round(p.line / 20 * 10) / 10}pt;`;
      const rt = (p.tabs || []).filter((t) => t.val === 'right' || t.val === 'end').pop();
      return {
        align: p.align || 'left', marginLeft: (p.left || 0) - hang, marginRight: p.marginRight || 0, indent: hang ? -hang : p.firstLine || 0,
        spaceBefore: p.spaceBefore || 0, spaceAfter: p.spaceAfter || 0, lineSpacingType: 'percent',
        lineSpacing: p.line && (p.lineRule || 'auto') === 'auto' ? Math.round(p.line / 240 * 135) : 135, css, rtab: rt ? { leader: rt.leader && rt.leader !== 'none' ? 1 : 0 } : undefined,
      };
    }),
  };
  const body = xml.descendants(root, 'w:body')[0];
  if (!body) throw new Error('본문이 없는 문서입니다');
  // 구역: 문단 모양 안의 sectPr(그 구역의 끝) 들 + 본문 맨 끝의 sectPr
  const sps = [...deep(body, 'w:sectPr').filter((s) => s._parent && s._parent.name === 'w:pPr'), kids(body, 'w:sectPr').pop()].filter(Boolean);
  const hrels = ctx.rels;
  let prev = { hdr: {}, ftr: {} };
  doc.sects = sps.map((sp) => {
    const sz = kid(sp, 'w:pgSz'); const mar = kid(sp, 'w:pgMar');
    const pw = sz ? num(sz.attrs['w:w'], 11906) * TW : 59530; const ph = sz ? num(sz.attrs['w:h'], 16838) * TW : 84190;
    const m = (k, d) => (mar && mar.attrs[k] !== undefined ? Math.abs(num(mar.attrs[k])) * TW : d);
    const refs = (tag) => { const o = {}; for (const r of kids(sp, tag)) o[r.attrs['w:type'] || 'default'] = parseHF(z, hrels[r.attrs['r:id']], ctx); return o; };
    const hdr = { ...prev.hdr, ...refs('w:headerReference') }; const ftr = { ...prev.ftr, ...refs('w:footerReference') };   // 적지 않은 것은 앞 구역 것을 잇는다
    prev = { hdr, ftr };
    const pn = kid(sp, 'w:pgNumType');
    ctx.sectTypes.push(val(sp, 'w:type') || 'nextPage');
    return { page: { width: pw, height: ph, left: m('w:left', 7200), right: m('w:right', 7200), top: m('w:top', 7200), bottom: m('w:bottom', 7200), header: m('w:header', 3600), footer: m('w:footer', 3600), gutter: 0, landscape: pw > ph }, hdr, ftr, titlePg: !!kid(sp, 'w:titlePg'), start: pn && pn.attrs['w:start'] !== undefined ? num(pn.attrs['w:start'], 1) : undefined };
  });
  if (!doc.sects.length) doc.sects.push({ page: { width: 59530, height: 84190, left: 7200, right: 7200, top: 7200, bottom: 7200, header: 3600, footer: 3600, gutter: 0, landscape: false }, hdr: {}, ftr: {} });
  const sec = newSection(0);
  sec.page = doc.sects[0].page;
  sec.paragraphs = parseBlocks(body, ctx, [], true);
  if (!sec.paragraphs.length) { const p = newParagraph(); p.xi = 't-0'; sec.paragraphs.push(p); }
  doc.sections.push(sec);
  // 쪽 수: Word 가 적어 둔 쪽 나눔을 센다
  let pages = 1;
  for (const p of sec.paragraphs) { pages += p.pb || 0; for (const c of p.controls) if (c.type === 'table') for (const [, n] of c.rowBreaks) pages += n; }
  doc.pages = pages + ctx.carry;
  doc.lrpb = deep(body, 'w:lastRenderedPageBreak').length;      // Word 가 적어 둔 쪽 나눔 수(0 이면 Word 가 그린 적 없는 파일)
  doc.paged = pages > 1 || doc.sects.some((s) => Object.keys(s.hdr).length || Object.keys(s.ftr).length);
  doc.binNames = z.list().filter((n) => n.startsWith('word/media/'));
  doc.images = (name) => z.read(name);
  void px;
  return doc;
}

// Word 가 쪽 나눔을 적어 두지 않은 문서(DOC·ODT·RTF 에서 바꾼 것, 다른 프로그램이 만든 DOCX): LibreOffice 가 계산한 쪽마다의 첫머리 글(pages)을
// 문단·표의 행과 맞춰 쪽 나눔을 적는다. 돌려주는 값: 찾아서 적은 쪽 나눔 수
function applyPageHints(doc, pages) {
  if (!Array.isArray(pages) || pages.length < 2 || !doc.sections[0]) return 0;
  const strip = (x) => String(x || '').replace(/\s+/g, '');
  const paras = doc.sections[0].paragraphs;
  for (const p of paras) { delete p.pb; for (const c of p.controls) if (c.type === 'table') c.rowBreaks = []; }      // 쪽 나누기(강제)도 계산한 쪽에 들어 있다 — 처음부터 다시 적는다
  let D = ''; const marks = [];
  paras.forEach((p, pi) => {
    marks.push({ pos: D.length, pi }); D += strip(p.marker) + strip(p.text);
    for (const c of p.controls) {
      if (c.type !== 'table') continue;
      const rows = []; for (const cl of c.cells) (rows[cl.row] = rows[cl.row] || []).push(cl);
      rows.forEach((cells, r) => { marks.push({ pos: D.length, pi, tbl: c, row: r }); for (const cl of cells || []) for (const q of cl.paragraphs) D += strip(q.marker) + strip(q.text); });
    }
  });
  // 쪽마다 되풀이되는 첫 줄(머리말)은 건너뛴다
  const lines = pages.map((t) => String(t).split('\n').map(strip).filter(Boolean));
  const freq = new Map(); for (const l of lines) if (l[0]) freq.set(l[0], (freq.get(l[0]) || 0) + 1);
  let last = 0, pend = 0, placed = 0;
  for (let i = 1; i < lines.length; i++) {
    let ls = lines[i]; while (ls.length > 1 && (freq.get(ls[0]) || 0) > Math.max(2, pages.length * 0.4)) ls = ls.slice(1);
    let found = -1;
    for (let k = 0; k < Math.min(3, ls.length) && found < 0; k++) { const needle = ls.slice(k).join('').slice(0, 18); if (needle.length >= 6) found = D.indexOf(needle, last); }
    if (found < 0) { pend++; continue; }
    let mi = 0; for (let j = 0; j < marks.length && marks[j].pos <= found; j++) mi = j;
    if (found - marks[mi].pos > 2) mi++;                         // 문단(행) 가운데서 넘어갔다 → 다음 문단(행)부터 새 쪽
    while (mi < marks.length && marks[mi].tbl && marks[mi].row === 0) mi--;      // 표의 첫 행 앞 = 표를 달고 있는 문단 앞
    const m = marks[Math.max(0, mi)];
    if (!m || mi >= marks.length || (m.pi === 0 && !m.tbl)) { pend++; last = found + 1; continue; }
    const n = 1 + pend; pend = 0; last = found + 1; placed += n;
    if (m.tbl) { const e = m.tbl.rowBreaks.find((x) => x[0] === m.row); if (e) e[1] += n; else { m.tbl.rowBreaks.push([m.row, n]); m.tbl.rowBreaks.sort((x, y) => x[0] - y[0]); } }
    else paras[m.pi].pb = (paras[m.pi].pb || 0) + n;
  }
  doc.pages = pages.length; doc.paged = true; doc.pagesBy = 'libreoffice';
  return placed;
}

// ---------- XML 다시 쓰기 ----------
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
const escT = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escA = (s) => escT(String(s)).replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
function ser(n) {
  if (typeof n === 'string') return escT(n);
  let s = `<${n.name}`;
  for (const k of Object.keys(n.attrs)) s += ` ${k}="${escA(n.attrs[k])}"`;
  if (!n.children.length) return `${s}/>`;
  s += '>';
  for (const c of n.children) s += ser(c);
  return `${s}</${n.name}>`;
}
const el = (name, attrs = {}, children = []) => ({ name, attrs, children });
const cloneNode = (n) => (typeof n === 'string' ? n : { name: n.name, attrs: { ...n.attrs }, children: n.children.map(cloneNode) });
// 글 → run 안의 w:t / w:tab / w:br
function textNodes(t) {
  const out = [];
  for (const part of clean(t).split(/(\t|\n)/)) {
    if (part === '\t') out.push(el('w:tab')); else if (part === '\n') out.push(el('w:br'));
    else if (part) out.push(el('w:t', { 'xml:space': 'preserve' }, [part]));
  }
  return out;
}
// 스키마 순서를 지켜 자식을 넣는다(Word 는 순서가 틀리면 파일을 못 연다)
const R_ORDER = ['w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps', 'w:strike', 'w:dstrike', 'w:outline', 'w:shadow', 'w:emboss', 'w:imprint', 'w:noProof', 'w:snapToGrid', 'w:vanish', 'w:webHidden', 'w:color', 'w:spacing', 'w:w', 'w:kern', 'w:position', 'w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:effect', 'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout', 'w:specVanish', 'w:oMath', 'w:rPrChange'];
const P_AFTER_JC = ['w:textDirection', 'w:textAlignment', 'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange'];
function setOrdered(parent, node, order) {
  parent.children = parent.children.filter((c) => typeof c === 'string' || c.name !== node.name);
  const rank = order.indexOf(node.name);
  let at = parent.children.length;
  for (let i = 0; i < parent.children.length; i++) { const c = parent.children[i]; if (typeof c !== 'string' && order.indexOf(c.name) > rank) { at = i; break; } }
  parent.children.splice(at, 0, node);
}
function setJc(p, align) {
  let pPr = kid(p, 'w:pPr');
  if (!pPr) { pPr = el('w:pPr'); p.children.unshift(pPr); }
  pPr.children = pPr.children.filter((c) => typeof c === 'string' || c.name !== 'w:jc');
  let at = pPr.children.findIndex((c) => typeof c !== 'string' && P_AFTER_JC.includes(c.name));
  if (at < 0) at = pPr.children.length;
  pPr.children.splice(at, 0, el('w:jc', { 'w:val': { justify: 'both', left: 'left', right: 'right', center: 'center' }[align] || 'left' }));
}
// 본뜰 run 의 모양 + 덮어쓴 서식(f: {b|i|u|sz|c: [값, cid]}) 으로 새 run 하나
function mkRun(like, text, f) {
  const src = like && kid(like, 'w:rPr');
  const rPr = src ? cloneNode(src) : el('w:rPr');
  rPr.children = rPr.children.filter((c) => typeof c === 'string' || c.name !== 'w:rPrChange');
  if (f) {
    const flag = (name, v) => setOrdered(rPr, el(name, v ? {} : { 'w:val': '0' }), R_ORDER);
    if (f.b) { flag('w:b', f.b[0]); flag('w:bCs', f.b[0]); }
    if (f.i) { flag('w:i', f.i[0]); flag('w:iCs', f.i[0]); }
    if (f.u) setOrdered(rPr, el('w:u', { 'w:val': f.u[0] ? 'single' : 'none' }), R_ORDER);
    if (f.sz && num(f.sz[0]) > 0) { const hp = String(Math.max(2, Math.round(num(f.sz[0]) / 50))); setOrdered(rPr, el('w:sz', { 'w:val': hp }), R_ORDER); setOrdered(rPr, el('w:szCs', { 'w:val': hp }), R_ORDER); }
    if (f.c && /^#[0-9a-f]{6}$/i.test(f.c[0] || '')) setOrdered(rPr, el('w:color', { 'w:val': f.c[0].slice(1).toUpperCase() }), R_ORDER);
  }
  return el('w:r', {}, [...(rPr.children.length ? [rPr] : []), ...textNodes(text)]);
}
// 문단의 글을 조각(segs)의 최종 글로 바꾼다. 원본 글자는 제 run 의 모양을 지키고, 넣은 글자는 바로 앞 글자의 모양을 따른다.
function rewrite(p, segs) {
  const runs = []; let pos = 0;
  for (const r of runsOf(p)) { const n = runText(r).length; runs.push({ r, start: pos, end: pos + n }); pos += n; }
  const at = (o) => runs.find((x) => o >= x.start && o < x.end);
  let like = (runs.find((x) => x.end > x.start) || runs[0] || {}).r || null;
  const out = [];
  for (const s of segs || []) {
    if (s.o !== undefined && !s.ins) {
      let i = 0;
      while (i < s.t.length) {
        const x = at(s.o + i);
        const n = x ? Math.min(s.t.length - i, x.end - (s.o + i)) : s.t.length - i;
        if (x) like = x.r;
        if (!s.del) out.push(mkRun(like, s.t.substr(i, n), s.f));
        i += n;
      }
    } else if (!s.del) out.push(mkRun(like, s.t, s.f));
  }
  // 새 run 을 넣을 자리: 첫 글자 run 이 있던 곳(없으면 문단 모양 바로 뒤)
  let top = runs[0] && runs[0].r;
  while (top && top._parent !== p) top = top._parent;
  let idx = top ? p.children.indexOf(top) : -1;
  if (idx < 0) idx = kid(p, 'w:pPr') ? p.children.indexOf(kid(p, 'w:pPr')) + 1 : 0;
  for (const o of out) o._parent = p;
  p.children.splice(idx, 0, ...out);
  // 옛 글자를 걷는다. 그림 같은 것이 든 run 은 남기고 글자만 뺀다.
  for (const { r } of runs) {
    r.children = r.children.filter((c) => typeof c === 'string' || !(TEXTY.has(c.name) && (c.name !== 'w:br' || softBreak(c))));
    if (els(r).some((c) => c.name !== 'w:rPr')) continue;
    let node = r;
    while (node && node !== p) { const par = node._parent; if (!par) break; par.children = par.children.filter((c) => c !== node); if (par === p || els(par).some((c) => c.name !== 'w:rPr' && !/Pr$/.test(c.name))) break; node = par; }
  }
}
const lastRun = (p) => { const r = runsOf(p); return r[r.length - 1] || null; };
function newPara(anchor, item) {
  const src = anchor && kid(anchor, 'w:pPr');
  const p = el('w:p');
  if (src) { const pPr = cloneNode(src); pPr.children = pPr.children.filter((c) => typeof c === 'string' || (c.name !== 'w:sectPr' && c.name !== 'w:pPrChange')); if (pPr.children.length) p.children.push(pPr); }
  const like = anchor ? lastRun(anchor) : null;
  for (const s of item.segs || []) if (!s.del && s.t) p.children.push(mkRun(like, s.t, s.f));
  if (item.align) setJc(p, item.align);
  return p;
}

// plans: nrf-api 가 만든 계획 [{ sec, edits: Map(xi → segs), added: Map(xi → [{segs, align}]), remove?: Set(xi), aligns?: Map(xi → 정렬) }]
function buildFinal(buf, plans) {
  const z = zip.parse(buf);
  const root = xml.parse(z.read('word/document.xml').toString('utf8'));
  const { paras, tbls } = number(root);
  const stats = { edited: 0, added: 0, removed: 0 };
  const touched = new Set();
  const made = new Map();          // 't표번호' → 표 앞에 세운 문단들의 끝
  const before = (tbl, p) => { const par = tbl._parent; p._parent = par; par.children.splice(par.children.indexOf(tbl), 0, p); touched.add(tbl); };
  const after = (ref, p) => { const par = ref._parent; p._parent = par; par.children.splice(par.children.indexOf(ref) + 1, 0, p); };
  const tblOf = (xi) => (typeof xi === 'string' && /^t\d+$/.test(xi) ? tbls[Number(xi.slice(1))] : null);
  for (const plan of plans || []) {
    for (const [xi, segs] of plan.edits || []) {
      const p = typeof xi === 'number' ? paras[xi] : null;
      if (p) { rewrite(p, segs); touched.add(p); stats.edited++; continue; }
      const t = tblOf(xi);                                   // 표 앞에 세운 빈 문단에 글을 썼다 → 표 앞에 새 문단
      if (t && (segs || []).some((s) => !s.del && s.t)) { const np = newPara(null, { segs }); before(t, np); made.set(xi, np); stats.added++; }
    }
    for (const [xi, a] of plan.aligns || []) { const p = typeof xi === 'number' ? paras[xi] : made.get(xi); if (p) { setJc(p, a); touched.add(p); } }
    for (const [xi, list] of plan.added || []) {
      let tail = typeof xi === 'number' ? paras[xi] : made.get(xi);
      const t = tail ? null : tblOf(xi);
      if (!tail && !t) continue;
      const anchor = tail;
      for (const item of list) { const np = newPara(anchor, item); if (tail) after(tail, np); else before(t, np); tail = np; stats.added++; }
      touched.add(anchor || t);
    }
    for (const xi of plan.remove || []) {
      const p = typeof xi === 'number' ? paras[xi] : null;
      if (!p) continue;
      const par = p._parent; const sib = els(par);
      const pPr = kid(p, 'w:pPr');
      const keep = deep(p, 'w:drawing').length || deep(p, 'w:pict').length || (pPr && kid(pPr, 'w:sectPr'))
        || (par.name === 'w:tc' && sib[sib.length - 1] === p && (sib[sib.length - 2] || {}).name !== 'w:p')
        || (par.name === 'w:txbxContent' && sib.filter((c) => c.name === 'w:p').length === 1);
      if (keep) rewrite(p, []); else par.children = par.children.filter((c) => c !== p);
      touched.add(p); stats.removed++;
    }
  }
  // 고친 문단이 글상자 안이면, 옛 프로그램용 사본(mc:Fallback)은 낡았으니 뺀다
  for (const n of touched) for (let a = n; a; a = a._parent) if (a.name === 'mc:AlternateContent') a.children = a.children.filter((c) => typeof c === 'string' || c.name !== 'mc:Fallback');
  const out = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${root.children.map(ser).join('')}`;
  const entries = z.list().filter((n) => !n.endsWith('/')).map((n) => ({ name: n, data: n === 'word/document.xml' ? Buffer.from(out, 'utf8') : z.read(n) }));
  return { data: zipw.build(entries), stats };
}

// ---------- 새 DOCX (글·표만) ----------
function build(blocks) {
  const para = (t, rPr = '', pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${t ? `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${textNodes(t).map(ser).join('')}</w:r>` : ''}</w:p>`;
  const W = 9638;                 // A4 본문 너비(twip)
  let body = '';
  for (const b of blocks) {
    if (b.table) {
      const cols = Math.max(1, ...b.table.map((r) => r.length));
      const cw = Math.max(400, Math.floor(W / cols));
      const bd = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="888888"/>`;
      body += `<w:tbl><w:tblPr><w:tblW w:w="${cw * cols}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(bd).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${`<w:gridCol w:w="${cw}"/>`.repeat(cols)}</w:tblGrid>`;
      for (const row of b.table) {
        body += '<w:tr>';
        for (let c = 0; c < cols; c++) body += `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/></w:tcPr>${String(row[c] === undefined ? '' : row[c]).split('\n').map((l) => para(l)).join('')}</w:tc>`;
        body += '</w:tr>';
      }
      body += '</w:tbl><w:p/>';
    } else if (b.h !== undefined) body += para(b.h, '<w:b/><w:bCs/><w:sz w:val="30"/><w:szCs w:val="30"/>', '<w:spacing w:before="240" w:after="120"/>');
    else body += para(b.p || '');
  }
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const files = [
    ['[Content_Types].xml', `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`],
    ['_rels/.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/_rels/document.xml.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['word/styles.xml', `${head}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`],
    ['word/document.xml', `${head}<w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`],
  ];
  return zipw.build(files.map(([name, data]) => ({ name, data: Buffer.from(data, 'utf8') })));
}

module.exports = { parse, buildFinal, build, applyPageHints };

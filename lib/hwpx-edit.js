'use strict';
// hwpx-edit.js — 원본 HWPX 에 변경을 반영해 "최종본 HWPX" 를 만든다. 의존성 없음.
//
// 방식: 구역 XML(Contents/sectionN.xml)을 다시 조립하지 않고, 꼬리표(token) 단위로 잘라 **글자가 든 곳만** 바꾼다.
//   · 글자 모양·문단 모양·표·그림·쪽 설정은 원본 바이트 그대로 남는다.
//   · 문단 번호 xi = 구역 XML 에서 <hp:p> 가 나오는 순서(파서 lib/hwpx.js 가 붙인 번호와 같다).
//   · 넣은 글자는 바로 앞 글자의 런(hp:run)에 들어가 그 글자 모양을 물려받는다.
//   · 고친 문단은 hp:linesegarray(한/글이 저장해 둔 줄 배치)를 지운다 — 한/글이 열 때 다시 계산한다.
//   · 글이 모두 지워진 문단은(표·구역 설정이 없고 그 칸의 마지막 문단이 아니면) 통째로 뺀다.
//   · 새 문단은 기준 문단 뒤에, 기준 문단의 문단 모양·글자 모양으로 넣는다.
const zip = require('./zip');
const zipw = require('./zipw');
const { decode } = require('./xml');
const track = require('./track');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CHAR_EL = new Set(['hp:tab', 'hp:lineBreak', 'hp:nbSpace', 'hp:fwSpace', 'hp:hyphen']);
const PLAIN = new Set(['hp:run', 'hp:t', 'hp:linesegarray', 'hp:lineseg', ...CHAR_EL]);

function tokenize(src) {
  const toks = []; let i = 0; const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { toks.push({ k: 'text', raw: src.slice(i) }); break; }
    if (lt > i) toks.push({ k: 'text', raw: src.slice(i, lt) });
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); const j = e < 0 ? n : e + 3; toks.push({ k: 'other', raw: src.slice(lt, j) }); i = j; continue; }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt); const j = e < 0 ? n : e + 2; toks.push({ k: 'other', raw: src.slice(lt, j) }); i = j; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); const j = e < 0 ? n : e + 3; toks.push({ k: 'other', raw: src.slice(lt, j) }); i = j; continue; }
    if (src.startsWith('<!', lt)) { const e = src.indexOf('>', lt); const j = e < 0 ? n : e + 1; toks.push({ k: 'other', raw: src.slice(lt, j) }); i = j; continue; }
    let j = lt + 1, q = null;
    while (j < n) { const c = src[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; j++; }
    const raw = src.slice(lt, j + 1); const inner = src.slice(lt + 1, j);
    i = j + 1;
    if (inner[0] === '/') { toks.push({ k: 'close', name: inner.slice(1).trim(), raw }); continue; }
    const self = inner.endsWith('/');
    const body = self ? inner.slice(0, -1) : inner;
    const sp = body.search(/\s/);
    toks.push({ k: self ? 'self' : 'open', name: sp < 0 ? body : body.slice(0, sp), raw });
  }
  return toks;
}
const attr = (raw, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(raw); return m ? m[1] : null; };

// 구역 XML 의 문단 지도: xi → { open, close, parent, units[], runs[], lineseg[], plain }
function mapParagraphs(toks) {
  const paras = [];
  const stack = [];           // {name, idx}
  const pstack = [];          // 열려 있는 문단들
  let xi = 0;
  for (let idx = 0; idx < toks.length; idx++) {
    const t = toks[idx];
    const cur = pstack[pstack.length - 1];
    const inT = cur && stack.length === cur.depth + 3 && stack[stack.length - 1].name === 'hp:t' && stack[stack.length - 2].name === 'hp:run';
    if (t.k === 'text') {
      if (inT) { const len = decode(t.raw).length; if (len) { cur.units.push({ idx, a: cur.len, b: cur.len + len, text: true }); cur.len += len; } }
      continue;
    }
    if (t.k === 'other') { if (inT && t.raw.startsWith('<![CDATA[')) { const len = t.raw.length - 12; cur.units.push({ idx, a: cur.len, b: cur.len + len, cdata: true }); cur.len += len; } continue; }
    if (t.k === 'open' || t.k === 'self') {
      if (t.name === 'hp:p') {
        const p = { xi: xi++, openRaw: t.raw, open: idx, close: idx, parent: stack.length ? stack[stack.length - 1].idx : -1, depth: stack.length, units: [], len: 0, runs: [], lineseg: null, plain: true };
        paras.push(p);
        if (cur) cur.plain = false;
        if (t.k === 'open') pstack.push(p);
      } else if (cur) {
        if (!PLAIN.has(t.name)) { if (!(inT)) cur.plain = false; else cur.odd = true; }
        if (t.name === 'hp:run' && stack.length === cur.depth + 1) cur.runs.push({ open: idx, close: t.k === 'self' ? idx : -1, self: t.k === 'self', cp: attr(t.raw, 'charPrIDRef') });
        if (t.name === 'hp:linesegarray' && stack.length === cur.depth + 1) cur.lineseg = [idx, t.k === 'self' ? idx : -1];
        if (inT && CHAR_EL.has(t.name)) {
          // 글자 하나로 세는 요소. 여는 꼴이면 닫는 꼬리표까지가 한 단위
          let end = idx;
          if (t.k === 'open') { let d = 0; for (let k = idx; k < toks.length; k++) { if (toks[k].k === 'open') d++; else if (toks[k].k === 'close') { d--; if (d === 0) { end = k; break; } } } }
          cur.units.push({ idx, end, a: cur.len, b: cur.len + 1 }); cur.len += 1;
          if (end > idx) { idx = end; continue; }             // 안쪽은 건너뛴다(스택 변화 없음)
        }
      }
      if (t.k === 'open') stack.push({ name: t.name, idx });
      continue;
    }
    // close
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === t.name) { stack.length = k; break; }
    if (t.name === 'hp:p' && cur && stack.length === cur.depth) { cur.close = idx; pstack.pop(); }
    else if (cur && t.name === 'hp:run' && stack.length === cur.depth + 1) { const r = cur.runs[cur.runs.length - 1]; if (r && r.close < 0) r.close = idx; }
    else if (cur && t.name === 'hp:linesegarray' && stack.length === cur.depth + 1 && cur.lineseg) cur.lineseg[1] = idx;
  }
  return paras;
}

// 구역 XML 의 표 지도: xt(문서 순서) → { open, close, sz, trs:[{open, close}], cells: Map('행,열' → 칸) }
// 칸 = { open, close, addr, span, csz, openRaw, subOpenRaw, tailRaw(서브리스트 뒤~칸 끝), firstP(첫 문단의 여는 꼬리표·글자모양) }
function mapTables(toks) {
  const tables = []; const stack = []; const tstack = []; let xt = 0;
  for (let idx = 0; idx < toks.length; idx++) {
    const t = toks[idx];
    if (t.k === 'open' || t.k === 'self') {
      const cur = tstack[tstack.length - 1];
      if (t.name === 'hp:tbl') {
        const tb = { xt: xt++, open: idx, close: idx, depth: stack.length, sz: -1, trs: [], cells: new Map(), cell: null };
        tables.push(tb); if (t.k === 'open') tstack.push(tb);
      } else if (cur) {
        const d = stack.length - cur.depth;
        if (t.name === 'hp:sz' && d === 1 && cur.sz < 0) cur.sz = idx;
        else if (t.name === 'hp:tr' && d === 1) cur.trs.push({ open: idx, close: -1 });
        else if (t.name === 'hp:tc' && d === 2) cur.cell = { open: idx, close: -1, addr: -1, span: -1, csz: -1, sub: -1, subClose: -1, firstP: null, openRaw: t.raw };
        else if (cur.cell && d === 3) {
          if (t.name === 'hp:cellAddr') cur.cell.addr = idx; else if (t.name === 'hp:cellSpan') cur.cell.span = idx; else if (t.name === 'hp:cellSz') cur.cell.csz = idx;
          else if (t.name === 'hp:subList') cur.cell.sub = idx;
        } else if (cur.cell && d === 4 && t.name === 'hp:p' && !cur.cell.firstP) cur.cell.firstP = { openRaw: t.raw, cp: null };
        else if (cur.cell && d === 5 && t.name === 'hp:run' && cur.cell.firstP && cur.cell.firstP.cp === null && cur.cell.pOpen) cur.cell.firstP.cp = attr(t.raw, 'charPrIDRef');
        if (cur.cell && d === 4 && t.name === 'hp:p') cur.cell.pOpen = cur.cell.firstP && cur.cell.firstP.cp === null;
      }
      if (t.k === 'open') stack.push({ name: t.name, idx });
      continue;
    }
    if (t.k !== 'close') continue;
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === t.name) { stack.length = k; break; }
    const cur = tstack[tstack.length - 1]; if (!cur) continue;
    const d = stack.length - cur.depth;
    if (t.name === 'hp:tbl' && d === 0) { cur.close = idx; tstack.pop(); }
    else if (t.name === 'hp:tr' && d === 1) cur.trs[cur.trs.length - 1].close = idx;
    else if (t.name === 'hp:subList' && d === 3 && cur.cell) cur.cell.subClose = idx;
    else if (t.name === 'hp:tc' && d === 2 && cur.cell) {
      const c = cur.cell; c.close = idx; cur.cell = null;
      if (c.addr < 0 || c.sub < 0 || c.subClose < 0) continue;
      c.subOpenRaw = toks[c.sub].raw;
      c.tailRaw = toks.slice(c.subClose + 1, idx + 1).map((x) => x.raw).join('');
      c.tr = cur.trs.length - 1;
      cur.cells.set(`${attr(toks[c.addr].raw, 'rowAddr')},${attr(toks[c.addr].raw, 'colAddr')}`, c);
    }
  }
  return tables;
}
const setAttr = (raw, name, val) => raw.replace(new RegExp(`(\\s${name}\\s*=\\s*")[^"]*(")`), `$1${val}$2`);

// 서식이 걸린 글(조각들)을 글자모양별 run 으로. cp = 바탕 글자모양 id, hdr = 머리말(header.xml) 편집기
function runsXml(segs, cp, hdr) {
  const list = [];
  for (const sg of segs) {
    if (sg.del || !sg.t) continue;
    const id = hdr && sg.f ? hdr.charPr(cp, sg.f) : cp; const l = list[list.length - 1];
    if (l && l.id === id) l.t += sg.t; else list.push({ id, t: sg.t });
  }
  if (!list.length) return `<hp:run charPrIDRef="${cp}"></hp:run>`;
  return list.map((r) => `<hp:run charPrIDRef="${r.id}"><hp:t>${esc(r.t)}</hp:t></hp:run>`).join('');
}

// header.xml 편집기: 바탕 글자모양·문단모양을 본떠 서식이 바뀐 새 모양을 만들어 덧붙이고 그 id 를 돌려준다.
function headerEditor(z) {
  const NAME = 'Contents/header.xml';
  let xml = null; let dirty = false; const cache = new Map(); let nextC = 0; let nextP = 0;
  const maxId = (tag) => { let m = -1; const re = new RegExp(`<${tag}\\b[^>]*\\bid="(\\d+)"`, 'g'); let x; while ((x = re.exec(xml))) m = Math.max(m, Number(x[1])); return m; };
  const load = () => { if (xml !== null) return true; try { xml = z.read(NAME).toString('utf8'); } catch { xml = ''; } nextC = maxId('hh:charPr') + 1; nextP = maxId('hh:paraPr') + 1; return !!xml; };
  const bump = (list) => { xml = xml.replace(new RegExp(`(<${list}\\b[^>]*\\bitemCnt=")(\\d+)`), (m, a, n) => a + (Number(n) + 1)); };
  return {
    charPr(base, f) {
      const v = {}; for (const k of Object.keys(f || {}).sort()) v[k] = Array.isArray(f[k]) ? f[k][0] : f[k];
      if (!Object.keys(v).length) return base;
      const key = `c${base}|${JSON.stringify(v)}`; if (cache.has(key)) return cache.get(key);
      let id = base;
      if (load()) {
        const m = new RegExp(`<hh:charPr\\b[^>]*\\bid="${base}"[^>]*>[\\s\\S]*?</hh:charPr>`).exec(xml);
        if (m && xml.includes('</hh:charProperties>')) {
          id = String(nextC++);
          let x = m[0].replace(/(<hh:charPr\b[^>]*\bid=")\d+/, `$1${id}`);
          if (v.sz) x = x.replace(/(<hh:charPr\b[^>]*\bheight=")\d+/, `$1${v.sz}`);
          if (v.c) x = x.replace(/(<hh:charPr\b[^>]*\btextColor=")[^"]*/, `$1${String(v.c).toUpperCase()}`);
          const before = (el, anchors) => { for (const a of anchors) { const i = x.indexOf(a); if (i >= 0) { x = x.slice(0, i) + el + x.slice(i); return; } } };
          if (v.i !== undefined) { x = x.replace(/<hh:italic\s*\/>/, ''); if (v.i) before('<hh:italic/>', ['<hh:bold', '<hh:underline', '<hh:strikeout', '</hh:charPr>']); }
          if (v.b !== undefined) { x = x.replace(/<hh:bold\s*\/>/, ''); if (v.b) before('<hh:bold/>', ['<hh:underline', '<hh:strikeout', '</hh:charPr>']); }
          if (v.u !== undefined) x = x.replace(/(<hh:underline\b[^>]*\btype=")[^"]*/, `$1${v.u ? 'BOTTOM' : 'NONE'}`);
          xml = xml.replace('</hh:charProperties>', `${x}</hh:charProperties>`); bump('hh:charProperties'); dirty = true;
        }
      }
      cache.set(key, id); return id;
    },
    paraPr(base, align) {
      const key = `p${base}|${align}`; if (cache.has(key)) return cache.get(key);
      let id = base;
      if (load()) {
        const m = new RegExp(`<hh:paraPr\\b[^>]*\\bid="${base}"[^>]*>[\\s\\S]*?</hh:paraPr>`).exec(xml);
        if (m && /<hh:align\b/.test(m[0]) && xml.includes('</hh:paraProperties>')) {
          const cur = /<hh:align\b[^>]*\bhorizontal="([^"]*)"/.exec(m[0]);
          if (cur && cur[1] === String(align).toUpperCase()) { cache.set(key, base); return base; }
          id = String(nextP++);
          const x = m[0].replace(/(<hh:paraPr\b[^>]*\bid=")\d+/, `$1${id}`).replace(/(<hh:align\b[^>]*\bhorizontal=")[^"]*/, `$1${String(align).toUpperCase()}`);
          xml = xml.replace('</hh:paraProperties>', `${x}</hh:paraProperties>`); bump('hh:paraProperties'); dirty = true;
        }
      }
      cache.set(key, id); return id;
    },
    borderFill(base, fill) {
      const key = `b${base}|${fill}`; if (cache.has(key)) return cache.get(key);
      let id = base;
      if (load()) {
        const m = new RegExp(`<hh:borderFill\\b[^>]*\\bid="${base}"[^>]*>[\\s\\S]*?</hh:borderFill>`).exec(xml);
        if (m && xml.includes('</hh:borderFills>')) {
          id = String(maxId('hh:borderFill') + 1);
          let x = m[0].replace(/(<hh:borderFill\b[^>]*\bid=")\d+/, `$1${id}`).replace(/<hc:fillBrush>[\s\S]*?<\/hc:fillBrush>/, '');
          if (fill !== 'none') x = x.replace('</hh:borderFill>', `<hc:fillBrush><hc:winBrush faceColor="${String(fill).toUpperCase()}" hatchColor="#000000" alpha="0"/></hc:fillBrush></hh:borderFill>`);
          xml = xml.replace('</hh:borderFills>', `${x}</hh:borderFills>`); bump('hh:borderFills'); dirty = true;
        }
      }
      cache.set(key, id); return id;
    },
    result() { return dirty ? { name: NAME, data: Buffer.from(xml, 'utf8') } : null; },
  };
}

// 표 하나에 행 추가·칸 병합을 반영한다. grid = { rows:[행…], cells:[{r,c,rs,cs,w,h,orig,tplOrig,isNew,row,paras:[글…]}], gone:[[r,c]…] }
function rewriteTable(toks, tb, grid, paras, stats, ids, hdr) {
  const key = (rc) => `${rc[0]},${rc[1]}`;
  // 1) 남는 원본 칸: 주소·병합·크기 다시 쓰기
  for (const c of grid.cells) {
    if (c.isNew) continue;
    const tc = tb.cells.get(key(c.orig)); if (!tc) { stats.missing++; continue; }
    toks[tc.addr].raw = setAttr(setAttr(toks[tc.addr].raw, 'rowAddr', c.r), 'colAddr', c.c);
    if (tc.span >= 0) toks[tc.span].raw = setAttr(setAttr(toks[tc.span].raw, 'rowSpan', c.rs), 'colSpan', c.cs);
    if (tc.csz >= 0) toks[tc.csz].raw = setAttr(setAttr(toks[tc.csz].raw, 'width', c.w), 'height', c.h);
    // 칸 속성: 바탕색(테두리·채우기 모양을 복제해 바꾼다) · 세로 정렬
    if (c.props) {
      if (c.props.fill && hdr) { const bf = attr(toks[tc.open].raw, 'borderFillIDRef'); if (bf) toks[tc.open].raw = setAttr(toks[tc.open].raw, 'borderFillIDRef', hdr.borderFill(bf, c.props.fill)); }
      if (c.props.va && tc.sub >= 0) toks[tc.sub].raw = setAttr(toks[tc.sub].raw, 'vertAlign', c.props.va);
      stats.cellProps = (stats.cellProps || 0) + 1;
    }
  }
  // 2) 합쳐져 없어진 원본 칸
  for (const rc of grid.gone) { const tc = tb.cells.get(key(rc)); if (tc) for (let k = tc.open; k <= tc.close; k++) toks[k].raw = ''; }
  // 2-1) 지운 원본 행: <hp:tr> 째로 없앤다(그 높이만큼 표도 줄인다)
  let goneH = 0;
  for (const row of grid.goneRows || []) { const tr = tb.trs[row]; if (!tr || tr.close < 0) { stats.missing++; continue; } for (const [k, tc] of tb.cells) if (tc.tr === row && Number(k.split(',')[0]) === row && tc.csz >= 0) goneH = Math.max(goneH, Number(attr(toks[tc.csz].raw, 'height')) || 0); for (let k = tr.open; k <= tr.close; k++) toks[k].raw = ''; stats.rowsGone = (stats.rowsGone || 0) + 1; }
  // 새 칸 하나의 XML. 내용은 새로 쓴 글({text}) 또는 다른 칸에서 옮겨 온 원래 문단({xi} — 고친 뒤의 XML 을 통째로 떼어 온다)
  const byXi = new Map(paras.map((p) => [p.xi, p])); const lost = new Set();
  const cellXml = (c) => {
    const tpl = tb.cells.get(key(c.tplOrig)); if (!tpl) { stats.missing++; return ''; }
    const fp = tpl.firstP || { openRaw: '<hp:p paraPrIDRef="0" styleIDRef="0">', cp: '0' };
    const mk = (text, it) => { const pp = attr(fp.openRaw, 'paraPrIDRef') || '0'; const segs = it && it.segs ? it.segs : (text ? [{ t: text }] : []);
      return `<hp:p id="${ids.next++}" paraPrIDRef="${it && it.align && hdr ? hdr.paraPr(pp, it.align) : pp}" styleIDRef="${attr(fp.openRaw, 'styleIDRef') || '0'}" pageBreak="0" columnBreak="0" merged="0">${runsXml(segs, fp.cp || '0', hdr)}</hp:p>`; };
    let ps = '';
    for (const it of c.paras.length ? c.paras : [{ text: '' }]) {
      if (typeof it === 'string') { ps += mk(it); continue; }
      if (it.xi === undefined) { ps += mk(it.text || '', it); continue; }
      const p = byXi.get(it.xi); if (!p) { stats.missing++; continue; }
      for (let k = p.open; k <= p.close; k++) { ps += toks[k].raw; toks[k].raw = ''; }
      for (const tc of tb.cells.values()) if (tc.open < p.open && tc.close > p.close) lost.add(tc);
      stats.moved = (stats.moved || 0) + 1;
    }
    if (!/<hp:p[\s>]/.test(ps)) ps += mk('');
    const tail = tpl.tailRaw.replace(/<hp:cellAddr\b[^>]*>/, (m) => setAttr(setAttr(m, 'rowAddr', c.r), 'colAddr', c.c))
      .replace(/<hp:cellSpan\b[^>]*>/, (m) => setAttr(setAttr(m, 'rowSpan', c.rs), 'colSpan', c.cs))
      .replace(/<hp:cellSz\b[^>]*>/, (m) => setAttr(setAttr(m, 'width', c.w), 'height', c.h));
    return tpl.openRaw + tpl.subOpenRaw + ps + '</hp:subList>' + tail;
  };
  // 3-가) 원본 행 안에 생긴 새 칸(나눈 칸의 조각): 그 행에서 왼쪽에 있는 원본 칸 바로 뒤에
  for (const c of grid.cells.filter((x) => x.isNew && typeof grid.rows[x.r] === 'number').sort((x, y) => x.r - y.r || x.c - y.c)) {
    const row = grid.rows[c.r]; const tr = tb.trs[row]; if (!tr || tr.close < 0) { stats.missing++; continue; }
    let left = null, leftCol = -1;
    for (const [k, tc] of tb.cells) { const [r0, c0] = k.split(',').map(Number); if (tc.tr === row && r0 === row && c0 < c.c && c0 > leftCol) { left = tc; leftCol = c0; } }
    const xml = cellXml(c);
    if (left) toks[left.close].raw += xml; else toks[tr.open].raw += xml;
    stats.split = (stats.split || 0) + 1;
  }
  // 3) 새 행: 바로 위 원본 행 뒤에 차례로
  let lastOrig = -1; let addedH = 0;
  grid.rows.forEach((row, ri) => {
    if (typeof row === 'number') { lastOrig = row; return; }
    const cells = grid.cells.filter((c) => c.isNew && c.r === ri).sort((x, y) => x.c - y.c);
    let xml = '<hp:tr>';
    for (const c of cells) xml += cellXml(c);
    xml += '</hp:tr>';
    addedH += Math.max(0, ...cells.filter((c) => c.rs === 1).map((c) => c.h));
    const tr = tb.trs[lastOrig]; if (!tr || tr.close < 0) { stats.missing++; return; }
    toks[tr.close].raw += xml; stats.rows = (stats.rows || 0) + 1;
  });
  // 문단을 모두 내준 칸이 비지 않게 빈 문단 하나를 둔다
  for (const tc of lost) { let has = false; for (let k = tc.sub + 1; k < tc.subClose; k++) if (/^<hp:p[\s>]/.test(toks[k].raw)) { has = true; break; } if (!has) toks[tc.sub].raw += `<hp:p id="${ids.next++}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"/></hp:p>`; }
  // 4) 표의 행 수·높이, 표를 안은 문단의 줄 배치(다시 계산되게 지운다)
  toks[tb.open].raw = setAttr(toks[tb.open].raw, 'rowCnt', grid.rows.length);
  addedH -= goneH;
  if (tb.sz >= 0 && addedH) { const h = Number(attr(toks[tb.sz].raw, 'height')); if (Number.isFinite(h)) toks[tb.sz].raw = setAttr(toks[tb.sz].raw, 'height', h + addedH); }
  const host = paras.filter((p) => p.open < tb.open && p.close > tb.close).sort((x, y) => y.open - x.open)[0];
  if (host && host.lineseg && host.lineseg[1] >= 0) for (let k = host.lineseg[0]; k <= host.lineseg[1]; k++) toks[k].raw = '';
  if (grid.gone.length) stats.merged = (stats.merged || 0) + grid.gone.length;
}

// 한 구역을 고친다. edits: Map(xi → segs), added: Map(xi → [{segs}] 기준 문단 뒤에 넣을 새 문단들, 위에서 아래 순서)
function rewriteSection(src, edits, added, stats, tables, remove, aligns, hdr) {
  const toks = tokenize(src);
  const paras = mapParagraphs(toks);
  const tmap = tables && tables.size ? mapTables(toks) : [];   // 표는 글을 고치기 전의 원본 꼬리표로 읽어 둔다
  const byXi = new Map(paras.map((p) => [p.xi, p]));
  const siblings = new Map();
  for (const p of paras) siblings.set(p.parent, (siblings.get(p.parent) || 0) + 1);
  let newId = 2147480000 + Math.floor(Math.random() * 1000);

  for (const [xi, segs] of edits) {
    const p = byXi.get(xi);
    if (!p) { stats.missing++; continue; }
    const chars = track.toChars(segs);
    const orig = chars.filter((c) => c.o !== undefined);
    if (orig.length !== p.len) { stats.mismatch++; continue; }       // 원본 글자 수가 다르면 건드리지 않는다(안전)
    const fin = track.finalText(segs);
    // 통째로 빼기
    if (((!fin && p.len) || (remove && remove.has(xi))) && p.plain && siblings.get(p.parent) > 1 && !(added.get(xi) || []).length) {
      for (let k = p.open; k <= p.close; k++) toks[k].raw = '';
      siblings.set(p.parent, siblings.get(p.parent) - 1); stats.removed++;
      continue;
    }
    // 서식이 걸린 문단: run 을 글자모양별로 다시 짠다(글·탭 같은 글자 요소만 있는 문단에 한해)
    if (chars.some((c) => c.f && !c.del)) {
      if (hdr && p.plain && !p.odd && p.runs.length && p.runs.every((r) => r.close >= 0)) {
        const origAt = new Array(p.len);
        for (const u of p.units) {
          const run = p.runs.find((r) => r.open <= u.idx && u.idx <= r.close) || p.runs[0];
          if (u.text || u.cdata) { const txt = u.cdata ? toks[u.idx].raw.slice(9, -3) : decode(toks[u.idx].raw); for (let k = u.a; k < u.b; k++) origAt[k] = { cp: run.cp, xml: esc(txt[k - u.a]) }; }
          else origAt[u.a] = { cp: run.cp, xml: toks.slice(u.idx, (u.end || u.idx) + 1).map((t) => t.raw).join('') };
        }
        let lastCp = (p.runs.find((r) => r.cp !== null) || { cp: '0' }).cp; const list = [];
        for (const c of chars) {
          let cp = lastCp; let xml;
          if (c.o !== undefined) { const oa = origAt[c.o] || { cp: lastCp, xml: esc(c.c) }; cp = oa.cp === null ? lastCp : oa.cp; lastCp = cp; xml = oa.xml; } else xml = esc(c.c);
          if (c.del) continue;
          const id = c.f ? hdr.charPr(cp, c.f) : cp; const l = list[list.length - 1];
          if (l && l.id === id) l.xml += xml; else list.push({ id, xml });
        }
        const first = p.runs[0].open; const last = p.runs[p.runs.length - 1].close;
        for (let k = first; k <= last; k++) toks[k].raw = '';
        toks[first].raw = list.length ? list.map((r) => `<hp:run charPrIDRef="${r.id}"><hp:t>${r.xml}</hp:t></hp:run>`).join('') : `<hp:run charPrIDRef="${lastCp}"></hp:run>`;
        if (p.lineseg && p.lineseg[1] >= 0) for (let k = p.lineseg[0]; k <= p.lineseg[1]; k++) toks[k].raw = '';
        stats.edited++; stats.formatted = (stats.formatted || 0) + 1;
        continue;
      }
      stats.fmtSkipped = (stats.fmtSkipped || 0) + 1;
    }
    // 원본 위치 o 앞에 들어갈 글, 그리고 살아남는 원본 글자
    const keep = new Array(p.len).fill(true); const insBefore = new Array(p.len + 1).fill('');
    let o = 0;
    for (const c of chars) {
      if (c.o !== undefined) { keep[c.o] = !c.del; o = c.o + 1; }
      else if (!c.del) insBefore[o] += c.c;
    }
    if (!p.units.length) {
      const text = insBefore[0];
      if (text) {
        const r = p.runs[0];
        const piece = `<hp:t>${esc(text)}</hp:t>`;
        if (!r) toks[p.open].raw = toks[p.open].raw.endsWith('/>') ? `${toks[p.open].raw.slice(0, -2)}><hp:run charPrIDRef="0">${piece}</hp:run></hp:p>` : `${toks[p.open].raw}<hp:run charPrIDRef="0">${piece}</hp:run>`;
        else if (r.self) toks[r.open].raw = `${toks[r.open].raw.slice(0, -2)}>${piece}</hp:run>`;
        else toks[r.close].raw = piece + toks[r.close].raw;
      }
    } else {
      p.units.forEach((u, ui) => {
        let s = ui === 0 ? insBefore[u.a] : '';
        if (u.text || u.cdata) {
          const txt = u.cdata ? toks[u.idx].raw.slice(9, -3) : decode(toks[u.idx].raw);
          let res = '';
          for (let k = u.a; k < u.b; k++) { if (k > u.a) res += insBefore[k]; if (keep[k]) res += txt[k - u.a]; }
          toks[u.idx].raw = esc(s + res + insBefore[u.b]);
        } else {
          const el = keep[u.a] ? toks.slice(u.idx, (u.end || u.idx) + 1).map((t) => t.raw).join('') : '';
          for (let k = u.idx + 1; k <= (u.end || u.idx); k++) toks[k].raw = '';
          toks[u.idx].raw = esc(s) + el + esc(insBefore[u.b]);
        }
      });
    }
    if (p.lineseg && p.lineseg[1] >= 0) for (let k = p.lineseg[0]; k <= p.lineseg[1]; k++) toks[k].raw = '';
    stats.edited++;
  }
  for (const [xi, list] of added) {
    const p = byXi.get(xi);
    if (!p) { stats.missing++; continue; }
    const openRaw = p.openRaw;
    const lastRun = [...p.runs].reverse().find((r) => r.cp !== null) || { cp: '0' };
    let xml = '';
    for (const a of list) {
      const pp = attr(openRaw, 'paraPrIDRef') || '0';
      xml += `<hp:p id="${newId++}" paraPrIDRef="${a.align && hdr ? hdr.paraPr(pp, a.align) : pp}" styleIDRef="${attr(openRaw, 'styleIDRef') || '0'}" pageBreak="0" columnBreak="0" merged="0">${runsXml(a.segs, lastRun.cp, hdr)}</hp:p>`;
      stats.added++;
    }
    toks[p.close].raw += xml;
  }
  // 문단 정렬: 정렬만 바꾼 새 문단모양으로 갈아 끼운다
  for (const [xi, al] of aligns || []) {
    const p = byXi.get(xi); if (!p || !hdr || !toks[p.open].raw) continue;
    const cur = attr(toks[p.open].raw, 'paraPrIDRef'); if (cur === null) continue;
    toks[p.open].raw = setAttr(toks[p.open].raw, 'paraPrIDRef', hdr.paraPr(cur, al));
    if (p.lineseg && p.lineseg[1] >= 0) for (let k = p.lineseg[0]; k <= p.lineseg[1]; k++) toks[k].raw = '';
    stats.aligned = (stats.aligned || 0) + 1;
  }
  const ids = { next: newId + 5000 };
  for (const [xt, grid] of tables || []) { const tb = tmap.find((x) => x.xt === xt); if (!tb) { stats.missing++; continue; } rewriteTable(toks, tb, grid, paras, stats, ids, hdr); }
  return toks.map((t) => t.raw).join('');
}

// buf: 원본 HWPX. plan: [{sec, edits: Map, added: Map}] → { data: Buffer, stats }
function buildFinal(buf, plan) {
  const z = zip.parse(buf);
  const stats = { edited: 0, removed: 0, added: 0, missing: 0, mismatch: 0 };
  const secNames = z.list().filter((n) => /^Contents\/section\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const replaced = new Map(); const hdr = headerEditor(z);
  for (const item of plan) {
    const name = secNames[item.sec];
    if (!name) continue;
    replaced.set(name, Buffer.from(rewriteSection(z.read(name).toString('utf8'), item.edits, item.added, stats, item.tables, item.remove, item.aligns, hdr), 'utf8'));
  }
  const h = hdr.result(); if (h) replaced.set(h.name, h.data);
  const entries = z.list().map((name) => ({ name, data: replaced.get(name) || z.read(name), store: name === 'mimetype' }));
  return { data: zipw.build(entries), stats };
}

module.exports = { buildFinal, rewriteSection, tokenize, mapParagraphs, mapTables };

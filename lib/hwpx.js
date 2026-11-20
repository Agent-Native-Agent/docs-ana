'use strict';
// hwpx.js — HWPX(OWPML, .hwpx) 파서. (hwp-ana 에서 복사 · nrf: 문단에 xi(문서 순서 번호)를 붙인다) ZIP + XML을 직접 읽는다(의존성 없음).
// 산출물은 hwp5.js와 같은 문서 모델(model.js). hp:lineseg(줄 배치)를 그대로 보존한다.
const zip = require('./zip');
const xml = require('./xml');
const { newDoc, newSection, newParagraph } = require('./model');

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

function parseHeader(root, doc) {
  const head = xml.descendants(root, 'hh:head')[0] || root;
  for (const f of xml.descendants(head, 'hh:font')) doc.fonts.push(f.attrs.face || '');
  // 글꼴은 언어별 목록(hh:fontface lang=…)이 따로 있다. charPr의 fontRef.hangul은 한글 목록의 id.
  const faces = {};
  for (const ff of xml.descendants(head, 'hh:fontface')) faces[ff.attrs.lang] = xml.findAll(ff, 'hh:font').map((f) => f.attrs.face || '');
  doc.fontFaces = faces;
  for (const cp of xml.descendants(head, 'hh:charPr')) {
    const ref = xml.find(cp, 'hh:fontRef');
    doc.charShapes[num(cp.attrs.id, doc.charShapes.length)] = {
      fontId: ref ? num(ref.attrs.hangul) : 0,
      fontName: ref && faces.HANGUL ? faces.HANGUL[num(ref.attrs.hangul)] : undefined,
      height: num(cp.attrs.height, 1000),
      bold: !!xml.find(cp, 'hh:bold'), italic: !!xml.find(cp, 'hh:italic'),
      underline: xml.find(cp, 'hh:underline') && xml.find(cp, 'hh:underline').attrs.type !== 'NONE' ? 1 : 0,
      color: cp.attrs.textColor,
    };
  }
  // nrf: 테두리·배경(hh:borderFill) → 칸에 붙일 CSS. 진한 바탕에 흰 글씨(장 번호 칸 등)가 보이려면 배경색이 있어야 한다.
  doc.borderFills = {};
  const LINE = { NONE: 'none', SOLID: 'solid', DASH: 'dashed', DOT: 'dotted', DASH_DOT: 'dashed', DASH_DOT_DOT: 'dashed', LONG_DASH: 'dashed', CIRCLE: 'dotted', DOUBLE_SLIM: 'double', SLIM_THICK: 'double', THICK_SLIM: 'double', SLIM_THICK_SLIM: 'double' };
  const mm = (w) => { const n = parseFloat(w); return Number.isFinite(n) ? Math.max(0.5, Math.round(n * 96 / 25.4 * 100) / 100) : 1; };
  for (const bf of xml.descendants(head, 'hh:borderFill')) {
    let css = '';
    for (const [tag, side] of [['hh:leftBorder', 'left'], ['hh:rightBorder', 'right'], ['hh:topBorder', 'top'], ['hh:bottomBorder', 'bottom']]) {
      const b = xml.find(bf, tag); if (!b) continue;
      const t = LINE[b.attrs.type] || 'solid'; const c = /^#[0-9a-f]{6}$/i.test(b.attrs.color || '') ? b.attrs.color : '#000000';
      const w = t === 'double' ? Math.max(3, mm(b.attrs.width)) : mm(b.attrs.width);
      css += t === 'none' ? `border-${side}:none;` : `border-${side}:${w}px ${t} ${c};`;
    }
    const brush = xml.descendants(bf, 'hc:winBrush')[0];
    const face = brush && brush.attrs.faceColor;
    if (face && /^#[0-9a-f]{6}$/i.test(face) && face.toUpperCase() !== '#FFFFFF') css += `background:${face};`;
    doc.borderFills[bf.attrs.id] = css;
  }
  // nrf: 탭 설정 — 오른쪽 탭(목차의 쪽 번호)과 채움(점·선)
  const tabRight = {};
  for (const tp of xml.descendants(head, 'hh:tabPr')) {
    const it = xml.descendants(tp, 'hh:tabItem').find((x) => String(x.attrs.type || '').toUpperCase() === 'RIGHT');
    if (it) tabRight[tp.attrs.id] = { leader: it.attrs.leader && it.attrs.leader !== 'NONE' ? 1 : 0 };
  }
  for (const pp of xml.descendants(head, 'hh:paraPr')) {
    const align = xml.find(pp, 'hh:align');
    const heading = xml.find(pp, 'hh:heading');
    const brk = xml.find(pp, 'hh:breakSetting');
    // hp:switch/hp:case 안에 margin·lineSpacing이 중복될 수 있다 — 첫 번째(case)를 쓴다.
    const margin = xml.descendants(pp, 'hh:margin')[0];
    const ls = xml.descendants(pp, 'hh:lineSpacing')[0];
    const mv = (n) => { const e = margin && xml.find(margin, n); return e ? num(e.attrs.value) : 0; };
    doc.paraShapes[num(pp.attrs.id, doc.paraShapes.length)] = {
      align: align ? String(align.attrs.horizontal || 'JUSTIFY').toLowerCase() : 'justify',
      headingType: heading ? ({ NONE: 0, OUTLINE: 1, NUMBER: 2, BULLET: 3 }[heading.attrs.type] || 0) : 0,
      headingLevel: heading ? num(heading.attrs.level) : 0,
      marginLeft: mv('hc:left'), marginRight: mv('hc:right'), indent: mv('hc:intent'), spaceBefore: mv('hc:prev'), spaceAfter: mv('hc:next'),
      lineSpacingType: ls ? ({ PERCENT: 'percent', FIXED: 'fixed', BETWEEN_LINES: 'spaceonly', AT_LEAST: 'minimum' }[ls.attrs.type] || 'percent') : 'percent',
      lineSpacing: ls ? num(ls.attrs.value, 160) : 160,
      pageBreakBefore: brk ? brk.attrs.pageBreakBefore === '1' : false,
      keepWithNext: brk ? brk.attrs.keepWithNext === '1' : false,
      ...(tabRight[pp.attrs.tabPrIDRef] ? { rtab: tabRight[pp.attrs.tabPrIDRef] } : {}),
    };
  }
  for (const st of xml.descendants(head, 'hh:style')) {
    doc.styles[num(st.attrs.id, doc.styles.length)] = {
      name: st.attrs.name || '', engName: st.attrs.engName || '', kind: st.attrs.type === 'CHAR' ? 1 : 0,
      paraShapeId: num(st.attrs.paraPrIDRef), charShapeId: num(st.attrs.charPrIDRef),
    };
  }
}

function parseLineSegs(p) {
  const arr = xml.find(p, 'hp:linesegarray');
  if (!arr) return [];
  return xml.findAll(arr, 'hp:lineseg').map((l) => ({
    textpos: num(l.attrs.textpos), vertpos: num(l.attrs.vertpos), vertsize: num(l.attrs.vertsize), textheight: num(l.attrs.textheight),
    baseline: num(l.attrs.baseline), spacing: num(l.attrs.spacing), horzpos: num(l.attrs.horzpos), horzsize: num(l.attrs.horzsize), flags: num(l.attrs.flags),
  }));
}

function parseSecPr(secPr, sec) {
  const pagePr = xml.find(secPr, 'hp:pagePr');
  if (pagePr) {
    const m = xml.find(pagePr, 'hp:margin') || { attrs: {} };
    sec.page = {
      width: num(pagePr.attrs.width, 59528), height: num(pagePr.attrs.height, 84186),
      left: num(m.attrs.left), right: num(m.attrs.right), top: num(m.attrs.top), bottom: num(m.attrs.bottom),
      header: num(m.attrs.header), footer: num(m.attrs.footer), gutter: num(m.attrs.gutter),
      landscape: pagePr.attrs.landscape === 'NARROWLY', // WIDELY=세로(기본), NARROWLY=가로
    };
  }
  const sn = xml.find(secPr, 'hp:startNum');
  if (sn) sec.pageStartNo = num(sn.attrs.page);
}

function parseTable(tbl, doc, ctx) {
  const table = {
    type: 'table', rows: num(tbl.attrs.rowCnt), cols: num(tbl.attrs.colCnt), cells: [], rowHeights: [],
    pageBreak: String(tbl.attrs.pageBreak || 'CELL').toLowerCase(), repeatHeader: tbl.attrs.repeatHeader === '1',
    width: 0, height: 0, treatAsChar: true, vertRelTo: 2, vOffset: 0, hOffset: 0,
  };
  table.xt = tbl._xt;
  table.cellSpacing = num(tbl.attrs.cellSpacing);
  const sz = xml.find(tbl, 'hp:sz'); if (sz) { table.width = num(sz.attrs.width); table.height = num(sz.attrs.height); }
  const pos = xml.find(tbl, 'hp:pos');
  if (pos) {
    table.treatAsChar = pos.attrs.treatAsChar === '1';
    table.vertRelTo = { PAPER: 0, PAGE: 1, PARA: 2 }[pos.attrs.vertRelTo] ?? 2;
    table.horzRelTo = { PAPER: 0, PAGE: 1, COLUMN: 2, PARA: 3 }[pos.attrs.horzRelTo] ?? 3;
    table.vOffset = num(pos.attrs.vertOffset); table.hOffset = num(pos.attrs.horzOffset);
  }
  const om = xml.find(tbl, 'hp:outMargin'); if (om) table.outMargin = { left: num(om.attrs.left), right: num(om.attrs.right), top: num(om.attrs.top), bottom: num(om.attrs.bottom) };
  for (const tr of xml.findAll(tbl, 'hp:tr')) {
    for (const tc of xml.findAll(tr, 'hp:tc')) {
      const addr = xml.find(tc, 'hp:cellAddr') || { attrs: {} };
      const span = xml.find(tc, 'hp:cellSpan') || { attrs: {} };
      const csz = xml.find(tc, 'hp:cellSz') || { attrs: {} };
      const cell = {
        paragraphs: [], row: num(addr.attrs.rowAddr), col: num(addr.attrs.colAddr),
        rowspan: num(span.attrs.rowSpan, 1), colspan: num(span.attrs.colSpan, 1),
        width: num(csz.attrs.width), height: num(csz.attrs.height),
      };
      const sub = xml.find(tc, 'hp:subList');
      let css = (doc.borderFills || {})[tc.attrs.borderFillIDRef] || '';
      const va = sub && { TOP: 'top', CENTER: 'middle', BOTTOM: 'bottom' }[sub.attrs.vertAlign]; if (va) css += `vertical-align:${va};`;
      const cm = xml.find(tc, 'hp:cellMargin');
      if (cm && tc.attrs.hasMargin === '1') css += `padding:${num(cm.attrs.top) / 75}px ${num(cm.attrs.right) / 75}px ${num(cm.attrs.bottom) / 75}px ${num(cm.attrs.left) / 75}px;`;
      if (css) cell.css = css;
      if (sub) for (const p of xml.findAll(sub, 'hp:p')) cell.paragraphs.push(parseParagraph(p, doc, null, { ...ctx, inCell: true, depth: ctx.depth + 1 }));
      table.cells.push(cell);
    }
  }
  table.rowHeights = new Array(table.rows).fill(0);
  for (const c of table.cells) if (c.rowspan === 1 && c.row < table.rows) table.rowHeights[c.row] = Math.max(table.rowHeights[c.row], c.height);
  for (const c of table.cells) if (c.rowspan > 1) {
    let sum = 0; for (let r = c.row; r < c.row + c.rowspan && r < table.rows; r++) sum += table.rowHeights[r];
    if (sum < c.height) { const extra = (c.height - sum) / c.rowspan; for (let r = c.row; r < c.row + c.rowspan && r < table.rows; r++) table.rowHeights[r] += extra; }
  }
  return table;
}

function parseShapeLike(el, doc, ctx) {
  const obj = { type: 'shape', kind: el.name.replace(/^hp:/, ''), width: 0, height: 0, treatAsChar: true, vertRelTo: 2, vOffset: 0, hOffset: 0, paragraphs: [] };
  const sz = xml.find(el, 'hp:sz'); if (sz) { obj.width = num(sz.attrs.width); obj.height = num(sz.attrs.height); }
  const cur = xml.find(el, 'hp:curSz'); if (cur && !obj.width) { obj.width = num(cur.attrs.width); obj.height = num(cur.attrs.height); }
  const pos = xml.find(el, 'hp:pos');
  if (pos) {
    obj.treatAsChar = pos.attrs.treatAsChar === '1';
    obj.vertRelTo = { PAPER: 0, PAGE: 1, PARA: 2 }[pos.attrs.vertRelTo] ?? 2;
    obj.horzRelTo = { PAPER: 0, PAGE: 1, COLUMN: 2, PARA: 3 }[pos.attrs.horzRelTo] ?? 3;
    obj.textWrap = el.attrs.textWrap || '';
    obj.vOffset = num(pos.attrs.vertOffset); obj.hOffset = num(pos.attrs.horzOffset);
  }
  if (el.name === 'hp:pic') { obj.kind = 'picture'; const img = xml.descendants(el, 'hc:img')[0]; if (img) obj.binRef = img.attrs.binaryItemIDRef; }
  const dt = xml.find(el, 'hp:drawText');
  if (dt) { const sub = xml.find(dt, 'hp:subList'); if (sub) for (const p of xml.findAll(sub, 'hp:p')) obj.paragraphs.push(parseParagraph(p, doc, null, { ...ctx, inCell: true, depth: ctx.depth + 1 })); }
  return obj;
}

const SHAPE_TAGS = new Set(['hp:pic', 'hp:rect', 'hp:ellipse', 'hp:line', 'hp:arc', 'hp:polygon', 'hp:curve', 'hp:container', 'hp:ole', 'hp:equation', 'hp:textart', 'hp:connectLine', 'hp:video', 'hp:chart']);

function parseParagraph(p, doc, sec, ctx) {
  const para = newParagraph();
  para.depth = ctx.depth;
  para.xi = p._xi;                       // nrf: 구역 XML 안에서 이 hp:p 가 몇 번째인지(문서 순서) — 최종본을 쓸 때 같은 번호로 찾는다
  para.runIds = xml.findAll(p, 'hp:run').map((r) => num(r.attrs.charPrIDRef));
  para.paraShapeId = num(p.attrs.paraPrIDRef); para.styleId = num(p.attrs.styleIDRef);
  para.pageBreak = p.attrs.pageBreak === '1'; para.columnBreak = p.attrs.columnBreak === '1';
  para.lines = parseLineSegs(p);
  let text = '';
  for (const run of xml.findAll(p, 'hp:run')) {
    const csId = num(run.attrs.charPrIDRef);
    para.charShapes.push({ pos: text.length, id: csId });
    for (const c of run.children) {
      if (typeof c === 'string') continue;
      if (c.name === 'hp:t') {
        for (const t of c.children) {
          if (typeof t === 'string') text += t;
          else if (t.name === 'hp:tab') text += '\t';
          else if (t.name === 'hp:lineBreak') text += '\n';
          else if (t.name === 'hp:nbSpace' || t.name === 'hp:fwSpace') text += ' ';
          else if (t.name === 'hp:hyphen') text += '-';
        }
      } else if (c.name === 'hp:secPr') { if (sec) parseSecPr(c, sec); para.controls.push({ type: 'secd' }); }
      else if (c.name === 'hp:tbl') para.controls.push(parseTable(c, doc, ctx));
      else if (SHAPE_TAGS.has(c.name)) para.controls.push(parseShapeLike(c, doc, ctx));
      else if (c.name === 'hp:ctrl') {
        for (const k of xml.elements(c)) {
          if (k.name === 'hp:colPr') para.controls.push({ type: 'cold', colCount: num(k.attrs.colCount, 1) || 1 });
          else if (k.name === 'hp:newNum') para.controls.push({ type: 'nwno', kind: k.attrs.numType === 'PAGE' || !k.attrs.numType ? 0 : 1, number: num(k.attrs.num) });
          else if (k.name === 'hp:pageHiding') para.controls.push({ type: 'pghd', header: k.attrs.hideHeader === '1', footer: k.attrs.hideFooter === '1', pageNum: k.attrs.hidePageNum === '1' });
          else if (k.name === 'hp:pageNum') para.controls.push({ type: 'pgnp', pos: k.attrs.pos || 'BOTTOM_CENTER', side: k.attrs.sideChar || '' });
          else if (k.name === 'hp:header' || k.name === 'hp:footer' || k.name === 'hp:footNote' || k.name === 'hp:endNote') {
            const obj = { type: k.name.replace(/^hp:/, '').toLowerCase().replace('footnote', 'fn').replace('endnote', 'en'), paragraphs: [] };
            const sub = xml.find(k, 'hp:subList');
            if (sub) for (const q of xml.findAll(sub, 'hp:p')) obj.paragraphs.push(parseParagraph(q, doc, null, { ...ctx, inCell: true, depth: ctx.depth + 1 }));
            para.controls.push(obj);
          } else para.controls.push({ type: k.name.replace(/^hp:/, '') });
        }
      }
    }
  }
  para.text = text;
  if (para.charShapes.length) para.charShapeId = para.charShapes[0].id;
  return para;
}

function parse(buf) {
  const z = zip.parse(buf);
  const doc = newDoc('hwpx');
  if (z.has('mimetype')) { const mt = z.read('mimetype').toString('utf8').trim(); if (!/hwp/i.test(mt)) throw new Error(`not an HWPX (mimetype ${mt})`); }
  if (z.has('version.xml')) { const v = xml.parse(z.read('version.xml').toString('utf8')); const el = xml.descendants(v, 'hv:HCFVersion')[0]; if (el) { doc.version = `${el.attrs.major}.${el.attrs.minor}.${el.attrs.micro}.${el.attrs.buildNumber}`; doc.meta.app = el.attrs.application; doc.meta.appVersion = el.attrs.appVersion; } }
  if (z.has('Contents/header.xml')) parseHeader(xml.parse(z.read('Contents/header.xml').toString('utf8')), doc);
  const secNames = z.list().filter((n) => /^Contents\/section\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  secNames.forEach((n, i) => {
    const root = xml.parse(z.read(n).toString('utf8'));
    const sec = newSection(i);
    const secEl = xml.descendants(root, 'hs:sec')[0] || root;
    xml.descendants(root, 'hp:p').forEach((el, k) => { el._xi = k; });   // nrf: 문서 순서 번호
    xml.descendants(root, 'hp:tbl').forEach((el, k) => { el._xt = k; });  // nrf: 표의 문서 순서 번호(행 추가·칸 병합을 최종본에 쓸 때 같은 번호로 찾는다)
    for (const p of xml.findAll(secEl, 'hp:p')) sec.paragraphs.push(parseParagraph(p, doc, sec, { depth: 0 }));
    doc.sections.push(sec);
  });
  if (z.has('Preview/PrvText.txt')) { try { doc.meta.preview = z.read('Preview/PrvText.txt').toString('utf8').slice(0, 2000); } catch {} }
  doc.binNames = z.list().filter((n) => n.startsWith('BinData/'));
  doc.images = (name) => z.read(name);
  return doc;
}
module.exports = { parse };

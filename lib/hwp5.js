'use strict';
// hwp5.js — HWP 5.0 바이너리(.hwp) 파서. 의존성 없음(Node 내장 zlib).
// 산출물은 hwpx.js와 동일한 "문서 모델"(model.js 참고)이다. 레이아웃(쪽 계산)은 layout.js가 맡는다.
//
// 구조: CFB 컨테이너 → FileHeader(압축·암호 플래그) → DocInfo(글꼴·글자모양·문단모양·스타일)
//       → BodyText/Section{n}(문단 레코드 트리). 레코드 헤더는 UINT32 = tag(10b) | level(10b) | size(12b).
// 핵심: PARA_LINE_SEG(0x45)에 줄마다 "줄의 세로 위치(vertpos)"가 들어 있다 — 한/글이 저장할 때 계산한
//       실제 배치값이므로, 이 값이 줄어드는 지점이 곧 새 쪽의 시작이다(layout.js가 사용).

const zlib = require('node:zlib');
const cfb = require('./cfb');
const { newDoc, newSection, newParagraph } = require('./model');

const TAG = {
  DOCUMENT_PROPERTIES: 0x10, ID_MAPPINGS: 0x11, BIN_DATA: 0x12, FACE_NAME: 0x13, BORDER_FILL: 0x14,
  CHAR_SHAPE: 0x15, TAB_DEF: 0x16, NUMBERING: 0x17, BULLET: 0x18, PARA_SHAPE: 0x19, STYLE: 0x1A,
  PARA_HEADER: 0x42, PARA_TEXT: 0x43, PARA_CHAR_SHAPE: 0x44, PARA_LINE_SEG: 0x45, PARA_RANGE_TAG: 0x46,
  CTRL_HEADER: 0x47, LIST_HEADER: 0x48, PAGE_DEF: 0x49, FOOTNOTE_SHAPE: 0x4A, PAGE_BORDER_FILL: 0x4B,
  SHAPE_COMPONENT: 0x4C, TABLE: 0x4D, SHAPE_COMPONENT_PICTURE: 0x55, CTRL_DATA: 0x57,
};
const TAG_NAME = Object.fromEntries(Object.entries(TAG).map(([k, v]) => [v, k]));

// ---------- 레코드 ----------
function readRecords(buf) {
  const out = [];
  let off = 0;
  while (off + 4 <= buf.length) {
    const h = buf.readUInt32LE(off); off += 4;
    const tag = h & 0x3FF, level = (h >>> 10) & 0x3FF;
    let size = (h >>> 20) & 0xFFF;
    if (size === 0xFFF) { size = buf.readUInt32LE(off); off += 4; }
    const data = buf.subarray(off, Math.min(buf.length, off + size));
    off += size;
    out.push({ tag, level, size, data, name: TAG_NAME[tag] || `0x${tag.toString(16)}` });
  }
  return out;
}
// 레벨로 트리 구성: children[]
function buildTree(records) {
  const root = { children: [], level: -1 };
  const stack = [root];
  for (const r of records) {
    r.children = [];
    while (stack.length > 1 && stack[stack.length - 1].level >= r.level) stack.pop();
    stack[stack.length - 1].children.push(r);
    stack.push(r);
  }
  return root.children;
}
function inflate(buf) {
  try { return zlib.inflateRawSync(buf); }
  catch { return zlib.inflateRawSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }
}

// ---------- 문자열/유틸 ----------
const ctrlIdOf = (u32) => String.fromCharCode((u32 >>> 24) & 0xFF, (u32 >>> 16) & 0xFF, (u32 >>> 8) & 0xFF, u32 & 0xFF);
function readWStr(buf, off) {
  const n = buf.readUInt16LE(off);
  return { str: buf.toString('utf16le', off + 2, off + 2 + n * 2), next: off + 2 + n * 2 };
}

// ---------- DocInfo ----------
function parseDocInfo(buf, doc) {
  const recs = readRecords(buf);
  for (const r of recs) {
    const d = r.data;
    try {
      if (r.tag === TAG.FACE_NAME) {
        const { str } = readWStr(d, 1);
        doc.fonts.push(str);
      } else if (r.tag === TAG.CHAR_SHAPE) {
        const attr = d.readUInt32LE(7 * 2 + 7 * 4 + 4); // 42 + 4 = 46
        doc.charShapes.push({
          fontId: d.readUInt16LE(0),
          height: d.readInt32LE(42),          // 1/100 pt (HWPUNIT)
          italic: !!(attr & 1), bold: !!(attr & 2),
          underline: (attr >>> 2) & 3,
          color: d.length >= 56 ? d.readUInt32LE(52) : 0,
        });
      } else if (r.tag === TAG.PARA_SHAPE) {
        const a1 = d.readUInt32LE(0);
        const ps = {
          align: ['justify', 'left', 'right', 'center', 'distribute', 'distribute-space'][(a1 >>> 2) & 7] || 'justify',
          headingType: (a1 >>> 23) & 3,      // 0 none, 1 outline, 2 number, 3 bullet
          headingLevel: (a1 >>> 25) & 7,
          marginLeft: d.readInt32LE(4), marginRight: d.readInt32LE(8), indent: d.readInt32LE(12),
          spaceBefore: d.readInt32LE(16), spaceAfter: d.readInt32LE(20),
          lineSpacingType: ['percent', 'fixed', 'spaceonly', 'minimum'][a1 & 3],
          lineSpacing: d.readInt32LE(24),
        };
        if (d.length >= 54) { // 5.0.2.5+: 줄 간격 종류·값이 뒤에 다시 온다
          ps.lineSpacingType = ['percent', 'fixed', 'spaceonly', 'minimum'][d.readUInt32LE(46) & 3] || ps.lineSpacingType;
          ps.lineSpacing = d.readInt32LE(50);
        }
        if (d.length >= 44) { const a2 = d.readUInt32LE(38); ps.pageBreakBefore = !!((a2 >>> 2) & 1); ps.keepWithNext = !!((a2 >>> 1) & 1); }
        doc.paraShapes.push(ps);
      } else if (r.tag === TAG.STYLE) {
        const a = readWStr(d, 0); const b = readWStr(d, a.next);
        let off = b.next;
        const kind = d[off]; off += 2; off += 2; // attr, next style id, lang id
        doc.styles.push({ name: a.str, engName: b.str, kind: kind & 7, paraShapeId: d.readUInt16LE(off), charShapeId: d.readUInt16LE(off + 2) });
      } else if (r.tag === TAG.DOCUMENT_PROPERTIES) {
        doc.meta.sectionCount = d.readUInt16LE(0);
        doc.meta.pageStartNo = d.readUInt16LE(2);
      } else if (r.tag === TAG.BIN_DATA) {
        const attr = d.readUInt16LE(0);
        const type = attr & 3; // 0 link, 1 embedding, 2 storage
        let off = 2;
        const item = { type };
        if (type === 0) { const a = readWStr(d, off); off = a.next; const b = readWStr(d, off); off = b.next; item.link = a.str; }
        else {
          item.id = d.readUInt16LE(off); off += 2;
          if (type === 1) { const e = readWStr(d, off); item.ext = e.str; }
        }
        doc.binData.push(item);
      }
    } catch (e) { doc.warnings.push(`DocInfo ${r.name}: ${e.message}`); }
  }
}

// ---------- BodyText ----------
// 텍스트 안의 제어문자. 확장/인라인 제어는 8 WCHAR(16바이트)를 차지한다.
const CHAR_ONE = new Set([10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);
function parseText(d, para, doc) {
  let text = '', i = 0;
  const n = Math.floor(d.length / 2);
  const ctrls = []; // {pos(WCHAR 위치), code, id}
  while (i < n) {
    const c = d.readUInt16LE(i * 2);
    if (c >= 32) { text += String.fromCharCode(c); i++; continue; }
    if (CHAR_ONE.has(c)) {
      if (c === 10) text += '\n';
      else if (c === 13) { /* 문단 끝 */ }
      else if (c === 24) text += '-';
      else if (c === 30) text += ' ';
      else if (c === 31) text += ' ';
      i++; continue;
    }
    // 8 WCHAR 제어 — 인라인(4~8, 19, 20)은 위치만, 확장은 ctrl id를 기록
    let id = null;
    if (i + 8 <= n) id = ctrlIdOf(d.readUInt32LE(i * 2 + 2));
    if (c === 9) text += '\t';
    ctrls.push({ pos: i, code: c, id, textPos: text.length });
    i += 8;
  }
  para.text = text;
  para.ctrlChars = ctrls;
}

function parseLineSegs(d) {
  const lines = [];
  for (let off = 0; off + 36 <= d.length; off += 36) {
    lines.push({
      textpos: d.readUInt32LE(off), vertpos: d.readInt32LE(off + 4), vertsize: d.readInt32LE(off + 8),
      textheight: d.readInt32LE(off + 12), baseline: d.readInt32LE(off + 16), spacing: d.readInt32LE(off + 20),
      horzpos: d.readInt32LE(off + 24), horzsize: d.readInt32LE(off + 28), flags: d.readUInt32LE(off + 32),
    });
  }
  return lines;
}

function parsePageDef(d) {
  const attr = d.readUInt32LE(36);
  return {
    width: d.readUInt32LE(0), height: d.readUInt32LE(4),
    left: d.readUInt32LE(8), right: d.readUInt32LE(12), top: d.readUInt32LE(16), bottom: d.readUInt32LE(20),
    header: d.readUInt32LE(24), footer: d.readUInt32LE(28), gutter: d.readUInt32LE(32),
    landscape: !!(attr & 1),
  };
}

// 형제 레코드 열에서 [LIST_HEADER, PARA_HEADER…] 묶음을 모은다. TABLE 등 다른 레코드는 header만 가진 묶음으로 돌려준다.
function collectLists(children) {
  const out = [];
  let cur = null;
  for (const c of children) {
    if (c.tag === TAG.PARA_HEADER && cur && cur.header.tag === TAG.LIST_HEADER) { cur.paras.push(c); continue; }
    cur = { header: c, paras: [] };
    out.push(cur);
  }
  return out;
}

// 표 컨트롤: CTRL_HEADER('tbl ') → [캡션 리스트] TABLE [셀 리스트 + 문단]…
function parseTable(ctrlRec, doc, sec, ctx) {
  const d = ctrlRec.data;
  const table = { type: 'table', rows: 0, cols: 0, cells: [], rowHeights: [], width: 0, height: 0 };
  try {
    table.attr = d.readUInt32LE(4);
    table.vOffset = d.readInt32LE(8); table.hOffset = d.readInt32LE(12);
    table.width = d.readUInt32LE(16); table.height = d.readUInt32LE(20);
    // 개체 공통 속성 attr: bit0 like-letter(글자처럼 취급), bits 3-4 세로 기준(0 paper,1 page,2 para) 등
    table.treatAsChar = !!(table.attr & 1);
    table.vertRelTo = (table.attr >>> 3) & 3;
    table.horzRelTo = (table.attr >>> 7) & 3;
    table.outMargin = { left: d.readInt16LE(28), right: d.readInt16LE(30), top: d.readInt16LE(32), bottom: d.readInt16LE(34) };
  } catch {}
  const tblRec = ctrlRec.children.find((c) => c.tag === TAG.TABLE);
  if (tblRec) {
    const t = tblRec.data;
    const attr = t.readUInt32LE(0);
    table.pageBreak = ['none', 'cell', 'table'][attr & 3] || 'cell'; // 0 나누지 않음, 1 셀 단위, 2 표 단위
    table.repeatHeader = !!((attr >>> 2) & 1);
    table.rows = t.readUInt16LE(4); table.cols = t.readUInt16LE(6);
    table.cellSpacing = t.readInt16LE(8);
    table.inMargin = { left: t.readInt16LE(10), right: t.readInt16LE(12), top: t.readInt16LE(14), bottom: t.readInt16LE(16) };
  }
  // 레코드 배치(실제 파일로 확인): CTRL_HEADER 아래에 [LIST_HEADER(캡션,30B) PARA_HEADER…] TABLE
  // [LIST_HEADER(셀,47B) PARA_HEADER…]… 가 모두 '같은 레벨의 형제'로 이어진다. 리스트 헤더 뒤의
  // PARA_HEADER들이 그 리스트(셀/캡션)의 문단이다.
  let seenTable = false;
  for (const list of collectLists(ctrlRec.children)) {
    if (list.header.tag === TAG.TABLE) { seenTable = true; continue; }
    const l = list.header.data;
    if (!seenTable || l.length < 34) { // 캡션
      table.caption = list.paras.map((pr) => parseParagraph(pr, doc, sec, { ...ctx, inCell: true, depth: ctx.depth + 1 }));
      continue;
    }
    const cell = { paragraphs: [], row: 0, col: 0, rowspan: 1, colspan: 1, width: 0, height: 0 };
    try {
      // LIST_HEADER: 문단 수 u16 @0, 속성 u32 @2, (미상 u16 @6) | 셀: col u16 @8, row @10, colspan @12, rowspan @14,
      // width u32 @16, height u32 @20, 안쪽 여백 4×i16 @24, 테두리/배경 id u16 @32 — 실제 파일 바이트로 확인한 배치.
      cell.col = l.readUInt16LE(8); cell.row = l.readUInt16LE(10);
      cell.colspan = l.readUInt16LE(12); cell.rowspan = l.readUInt16LE(14);
      cell.width = l.readUInt32LE(16); cell.height = l.readUInt32LE(20);
      cell.margin = { left: l.readInt16LE(24), right: l.readInt16LE(26), top: l.readInt16LE(28), bottom: l.readInt16LE(30) };
    } catch {}
    for (const pr of list.paras) cell.paragraphs.push(parseParagraph(pr, doc, sec, { ...ctx, inCell: true, depth: ctx.depth + 1 }));
    table.cells.push(cell);
  }
  // 행 높이: 각 행에서 rowspan==1 셀의 높이 최댓값
  table.rowHeights = new Array(table.rows).fill(0);
  for (const c of table.cells) if (c.rowspan === 1 && c.row < table.rows) table.rowHeights[c.row] = Math.max(table.rowHeights[c.row], c.height);
  // rowspan>1 셀만 있는 행 보정
  for (const c of table.cells) if (c.rowspan > 1) {
    let sum = 0; for (let r = c.row; r < c.row + c.rowspan && r < table.rows; r++) sum += table.rowHeights[r];
    if (sum < c.height) { const extra = (c.height - sum) / c.rowspan; for (let r = c.row; r < c.row + c.rowspan && r < table.rows; r++) table.rowHeights[r] += extra; }
  }
  return table;
}

function parseShape(ctrlRec, doc) {
  const d = ctrlRec.data;
  const obj = { type: 'shape', width: 0, height: 0 };
  try {
    obj.attr = d.readUInt32LE(4); obj.vOffset = d.readInt32LE(8); obj.hOffset = d.readInt32LE(12);
    obj.width = d.readUInt32LE(16); obj.height = d.readUInt32LE(20);
    obj.treatAsChar = !!(obj.attr & 1);
    obj.vertRelTo = (obj.attr >>> 3) & 3; obj.horzRelTo = (obj.attr >>> 7) & 3;
    obj.outMargin = { left: d.readInt16LE(28), right: d.readInt16LE(30), top: d.readInt16LE(32), bottom: d.readInt16LE(34) };
  } catch {}
  const comp = ctrlRec.children.find((c) => c.tag === TAG.SHAPE_COMPONENT);
  if (comp) {
    const c = comp.data;
    try { obj.shapeKind = ctrlIdOf(c.readUInt32LE(0)); } catch {}
    const pic = comp.children.find((x) => x.tag === TAG.SHAPE_COMPONENT_PICTURE);
    if (pic) {
      obj.kind = 'picture';
      // 그림 정보: 테두리(12B) + 사각형 4점(32B) + 자르기(16B) + 안쪽 여백(8B) 뒤에 밝기 i8·대비 i8·효과 u8·BinData id u16 → @71
      try { obj.binId = pic.data.readUInt16LE(71); } catch {}
    }
    // 글상자(텍스트 박스)의 문단들 — LIST_HEADER 뒤에 PARA_HEADER가 형제로 이어진다
    obj.paragraphs = [];
    for (const list of collectLists(comp.children)) if (list.header.tag === TAG.LIST_HEADER) for (const pr of list.paras) obj.paragraphs.push(parseParagraph(pr, doc, null, { inCell: true, depth: 1 }));
    // 묶음(container) 안의 하위 개체
    for (const sub of comp.children.filter((x) => x.tag === TAG.SHAPE_COMPONENT)) for (const list of collectLists(sub.children)) if (list.header.tag === TAG.LIST_HEADER) for (const pr of list.paras) obj.paragraphs.push(parseParagraph(pr, doc, null, { inCell: true, depth: 1 }));
  }
  return obj;
}

function parseParagraph(rec, doc, sec, ctx) {
  const d = rec.data;
  const para = newParagraph();
  para.depth = ctx.depth;
  try {
    para.nchars = d.readUInt32LE(0) & 0x7FFFFFFF;
    para.ctrlMask = d.readUInt32LE(4);
    para.paraShapeId = d.readUInt16LE(8);
    para.styleId = d[10];
    const brk = d[11];
    para.sectionBreak = !!(brk & 1); para.columnDef = !!(brk & 2); para.pageBreak = !!(brk & 4); para.columnBreak = !!(brk & 8);
    para.lineCount = d.readUInt16LE(16);
  } catch {}
  for (const c of rec.children) {
    try {
      if (c.tag === TAG.PARA_TEXT) parseText(c.data, para, doc);
      else if (c.tag === TAG.PARA_CHAR_SHAPE) {
        for (let off = 0; off + 8 <= c.data.length; off += 8) para.charShapes.push({ pos: c.data.readUInt32LE(off), id: c.data.readUInt32LE(off + 4) });
      } else if (c.tag === TAG.PARA_LINE_SEG) para.lines = parseLineSegs(c.data);
      else if (c.tag === TAG.CTRL_HEADER) {
        const id = ctrlIdOf(c.data.readUInt32LE(0));
        if (id === 'secd') {
          const pd = c.children.find((x) => x.tag === TAG.PAGE_DEF);
          if (pd && sec) { sec.page = parsePageDef(pd.data); }
          if (sec) { try { sec.pageStartNo = c.data.readUInt16LE(16); } catch {} }
          para.controls.push({ type: 'secd' });
        } else if (id === 'tbl ') para.controls.push(parseTable(c, doc, sec, ctx));
        else if (id === 'gso ') para.controls.push(parseShape(c, doc));
        else if (id === 'cold') para.controls.push({ type: 'cold', colCount: (() => { try { return (c.data.readUInt16LE(4) >>> 2) & 0xFF; } catch { return 1; } })() || 1 });
        else if (id === 'nwno') { // 새 번호 지정: 속성 u32(bits 0-3 번호 종류: 0 쪽) + 번호 u16
          let kind = 0, number = 0; try { kind = c.data.readUInt32LE(4) & 0xF; number = c.data.readUInt16LE(8); } catch {}
          para.controls.push({ type: 'nwno', kind, number });
        }
        else if (id === 'head' || id === 'foot' || id === 'fn  ' || id === 'en  ') {
          const obj = { type: id.trim(), paragraphs: [] };
          for (const list of collectLists(c.children)) if (list.header.tag === TAG.LIST_HEADER) for (const pr of list.paras) obj.paragraphs.push(parseParagraph(pr, doc, null, { inCell: true, depth: ctx.depth + 1 }));
          para.controls.push(obj);
        } else para.controls.push({ type: id.trim() || id });
      }
    } catch (e) { doc.warnings.push(`para ${c.name}: ${e.message}`); }
  }
  // 이 문단의 텍스트가 어떤 글자 모양(크기)인지 — 첫 글자 모양 기준
  if (para.charShapes.length) para.charShapeId = para.charShapes[0].id;
  return para;
}

function parseSection(buf, doc, index) {
  const sec = newSection(index);
  const tree = buildTree(readRecords(buf));
  for (const rec of tree) {
    if (rec.tag !== TAG.PARA_HEADER) continue;
    sec.paragraphs.push(parseParagraph(rec, doc, sec, { depth: 0 }));
  }
  return sec;
}

// ---------- 진입점 ----------
function parse(buf, opts = {}) {
  const ole = cfb.parse(buf);
  const doc = newDoc('hwp');
  const fh = ole.read('FileHeader');
  if (fh.toString('latin1', 0, 17) !== 'HWP Document File') throw new Error('not an HWP 5.0 file');
  const ver = fh.readUInt32LE(32);
  doc.version = `${ver >>> 24}.${(ver >>> 16) & 0xFF}.${(ver >>> 8) & 0xFF}.${ver & 0xFF}`;
  const flags = fh.readUInt32LE(36);
  const compressed = !!(flags & 1);
  if (flags & 2) throw new Error('암호가 걸린 문서는 열 수 없습니다');
  if (flags & 4) throw new Error('배포용 문서(DRM)는 열 수 없습니다');
  const open = (name) => { const b = ole.read(name); return compressed ? inflate(b) : b; };
  parseDocInfo(open('DocInfo'), doc);
  const secNames = ole.list().filter((n) => /^BodyText\/Section\d+$/.test(n)).sort((a, b) => Number(a.match(/\d+$/)[0]) - Number(b.match(/\d+$/)[0]));
  secNames.forEach((n, i) => doc.sections.push(parseSection(open(n), doc, i)));
  if (ole.has('PrvText')) { try { doc.meta.preview = ole.read('PrvText').toString('utf16le').slice(0, 2000); } catch {} }
  if (opts.binData !== false) {
    doc.images = (name) => { // 지연 로더: BinData/BIN0001.png 등
      const b = ole.read(name); return compressed ? (() => { try { return inflate(b); } catch { return b; } })() : b;
    };
    doc.binNames = ole.list().filter((n) => n.startsWith('BinData/'));
  }
  return doc;
}

module.exports = { parse, readRecords, buildTree, TAG, TAG_NAME };

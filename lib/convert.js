'use strict';
// convert.js — 한/글·Word 가 아닌 문서를 '작업용 DOCX' 로 바꾼다(올릴 때 한 번). npm 의존성 없음.
//   doc · odt · rtf      → LibreOffice Writer(/usr/bin/soffice) 로 DOCX (서식·표·그림 유지)
//   pdf                  → pdftotext 로 글만 뽑아 DOCX (서식·그림은 없다)
//   pptx                 → 슬라이드마다 글·표를 뽑아 DOCX
//   xlsx · csv           → 시트마다 표 하나인 DOCX
//   txt · md             → 줄마다 문단인 DOCX
//   html · htm           → 스크립트 등을 걷어 낸 뒤 LibreOffice Writer 로 DOCX (제목·굵기·목록·표·그림 유지)
// 이 서버의 LibreOffice 는 Writer 만 깔려 있어 PPT/XLS(옛 바이너리)는 바꿀 수 없다.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const zip = require('./zip');
const xml = require('./xml');
const docx = require('./docx');

const NATIVE = ['hwp', 'hwpx', 'docx'];
const VIA_OFFICE = ['doc', 'odt', 'rtf'];
const HTML = ['html', 'htm'];
const OTHER = ['pdf', 'pptx', 'xlsx', 'csv', 'txt', 'md', ...HTML];
const EXTS = [...NATIVE, ...VIA_OFFICE, ...OTHER];
const MAX_CELLS = 20000;       // 표 하나에 그리는 칸 수 한도(화면이 버틸 만큼)
const MAX_PARAS = 20000;

const run = (cmd, args, opts) => new Promise((res, rej) => execFile(cmd, args, { timeout: 120000, maxBuffer: 64 << 20, ...opts }, (err, stdout) => (err ? rej(err) : res(stdout))));
// 무거운 변환은 한 번에 하나씩(다른 ANA 와 함께 쓰는 서버)
let chain = Promise.resolve();
const queued = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

function decodeText(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* 옛 한글 인코딩 */ }
  try { return new TextDecoder('euc-kr').decode(buf); } catch { return buf.toString('latin1'); }
}
const lines = (text) => text.replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_PARAS).map((l) => ({ p: l }));

// HTML: 선언된 문자셋으로 읽고(없으면 UTF-8/EUC-KR 추정), 실행되는 것(스크립트·프레임·폼 등)을 걷어 내고 UTF-8 로 다시 쓴다
function cleanHtml(buf) {
  const head = buf.subarray(0, 4096).toString('latin1');
  const cs = (head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i) || [])[1];
  let t = null;
  if (cs && !/^utf-?8$/i.test(cs)) { try { t = new TextDecoder(cs.toLowerCase()).decode(buf); } catch {} }
  if (t == null) t = decodeText(buf);
  t = t.replace(/<(script|noscript|iframe|object|embed|template|form|button|select|textarea)\b[\s\S]*?<\/\1\s*>/gi, '')
       .replace(/<(script|iframe|object|embed|input|link|base)\b[^>]*>/gi, '')
       .replace(/<meta[^>]*(charset|http-equiv)[^>]*>/gi, '')
       .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  if (!/<html[\s>]/i.test(t)) t = `<html><body>${t}</body></html>`;
  t = /<head[\s>]/i.test(t) ? t.replace(/<head([^>]*)>/i, '<head$1><meta charset="utf-8">') : t.replace(/<html([^>]*)>/i, '<html$1><head><meta charset="utf-8"></head>');
  if (!t.replace(/<[^>]*>/g, '').trim()) throw new Error('글자를 찾지 못했습니다');
  return Buffer.from(t, 'utf8');
}

function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  const s = text.replace(/\r\n?/g, '\n');
  const sep = (s.split('\n')[0].match(/\t/g) || []).length > (s.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
// 너무 큰 표는 앞부분만
function tableBlocks(rows, title) {
  while (rows.length && rows[rows.length - 1].every((c) => !String(c || '').trim())) rows.pop();
  if (!rows.length) return [];
  const cols = Math.min(60, Math.max(...rows.map((r) => r.length)));
  const keep = Math.max(1, Math.floor(MAX_CELLS / cols));
  const out = [];
  if (title) out.push({ h: title });
  out.push({ table: rows.slice(0, keep).map((r) => Array.from({ length: cols }, (_, i) => (r[i] === undefined || r[i] === null ? '' : String(r[i])))) });
  if (rows.length > keep) out.push({ p: `(표가 커서 앞 ${keep}행만 가져왔습니다 — 전체 ${rows.length}행)` });
  return out;
}

// ---------- XLSX ----------
const relMap = (z, name, base) => {
  const out = {};
  if (z.has(name)) for (const r of xml.descendants(xml.parse(z.read(name).toString('utf8')), 'Relationship')) { const t = String(r.attrs.Target || ''); out[r.attrs.Id] = t[0] === '/' ? t.slice(1) : path.posix.normalize(`${base}/${t}`); }
  return out;
};
function xlsxBlocks(buf) {
  const z = zip.parse(buf);
  if (!z.has('xl/workbook.xml')) throw new Error('Excel 문서(XLSX)가 아닙니다');
  const read = (n) => xml.parse(z.read(n).toString('utf8'));
  const strings = [];
  if (z.has('xl/sharedStrings.xml')) {
    const t = (n) => { let s = ''; for (const c of n.children) { if (typeof c === 'string') continue; if (c.name === 't') s += xml.text(c); else if (c.name === 'r') s += t(c); } return s; };
    for (const si of xml.descendants(read('xl/sharedStrings.xml'), 'si')) strings.push(t(si));
  }
  const dateFmt = [];             // 셀 모양 번호 → 날짜인가
  if (z.has('xl/styles.xml')) {
    const st = read('xl/styles.xml');
    const custom = {}; for (const f of xml.descendants(st, 'numFmt')) custom[f.attrs.numFmtId] = f.attrs.formatCode || '';
    const xfs = xml.descendants(st, 'cellXfs')[0];
    for (const xf of xfs ? xml.findAll(xfs, 'xf') : []) {
      const id = Number(xf.attrs.numFmtId || 0);
      const code = custom[id];
      dateFmt.push(code !== undefined ? /[ymdhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) : (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58));
    }
  }
  const p2 = (n) => String(n).padStart(2, '0');
  const dateOf = (v) => {
    const d = new Date(Math.round((v - 25569) * 86400000));
    const day = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; const time = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
    return v < 1 ? time : v % 1 ? `${day} ${time}` : day;
  };
  const rels = relMap(z, 'xl/_rels/workbook.xml.rels', 'xl');
  const blocks = [];
  for (const sh of xml.descendants(read('xl/workbook.xml'), 'sheet')) {
    const file = rels[sh.attrs['r:id']];
    if (!file || !z.has(file)) continue;
    const rows = [];
    for (const row of xml.descendants(read(file), 'row')) {
      const ri = Number(row.attrs.r || rows.length + 1) - 1;
      if (ri > 100000) break;
      let ci = 0;
      for (const c of xml.findAll(row, 'c')) {
        const ref = /^([A-Z]+)/.exec(c.attrs.r || '');
        if (ref) { ci = 0; for (const ch of ref[1]) ci = ci * 26 + ch.charCodeAt(0) - 64; ci -= 1; }
        const v = xml.find(c, 'v'); const is = xml.find(c, 'is');
        let s = v ? xml.text(v) : is ? xml.text(is) : '';
        if (c.attrs.t === 's') s = strings[Number(s)] || '';
        else if (c.attrs.t === 'b') s = s === '1' ? 'TRUE' : 'FALSE';
        else if (s && !c.attrs.t || c.attrs.t === 'n') { const n = Number(s); if (Number.isFinite(n)) s = dateFmt[Number(c.attrs.s || 0)] && n > 0 ? dateOf(n) : String(+n.toPrecision(12)); }
        if (s && ci < 60) { (rows[ri] = rows[ri] || [])[ci] = s; }
        ci++;
      }
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    blocks.push(...tableBlocks(rows, sh.attrs.name || '시트'));
  }
  if (!blocks.length) throw new Error('내용이 있는 시트가 없습니다');
  return blocks;
}

// ---------- PPTX ----------
function pptxBlocks(buf) {
  const z = zip.parse(buf);
  if (!z.has('ppt/presentation.xml')) throw new Error('PowerPoint 문서(PPTX)가 아닙니다');
  const read = (n) => xml.parse(z.read(n).toString('utf8'));
  const rels = relMap(z, 'ppt/_rels/presentation.xml.rels', 'ppt');
  let slides = xml.descendants(read('ppt/presentation.xml'), 'p:sldId').map((s) => rels[s.attrs['r:id']]).filter((n) => n && z.has(n));
  if (!slides.length) slides = z.list().filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const paraText = (p) => { let s = ''; (function go(n) { for (const c of n.children) { if (typeof c === 'string') continue; if (c.name === 'a:t') s += xml.text(c); else if (c.name === 'a:br') s += '\n'; else go(c); } })(p); return s; };
  const blocks = [];
  slides.forEach((name, i) => {
    blocks.push({ h: `슬라이드 ${i + 1}` });
    const tree = xml.descendants(read(name), 'p:spTree')[0];
    (function go(n) {
      for (const c of n ? n.children : []) {
        if (typeof c === 'string') continue;
        if (c.name === 'p:sp') { for (const p of xml.descendants(c, 'a:p')) { const t = paraText(p); if (t.trim()) blocks.push({ p: t }); } }
        else if (c.name === 'p:graphicFrame') { for (const t of xml.descendants(c, 'a:tbl')) blocks.push(...tableBlocks(xml.findAll(t, 'a:tr').map((tr) => xml.findAll(tr, 'a:tc').map((tc) => xml.descendants(tc, 'a:p').map(paraText).join('\n'))))); }
        else if (c.name === 'p:grpSp') go(c);
      }
    })(tree);
  });
  if (!slides.length) throw new Error('슬라이드가 없습니다');
  return blocks;
}

// ---------- PDF (글만) ----------
function pdfBlocks(text) {
  const blocks = [];
  for (const page of text.split('\f')) {
    const ls = page.replace(/\r/g, '').split('\n');
    const max = Math.max(0, ...ls.map((l) => l.length));
    let cur = '';
    const flush = () => { if (cur) blocks.push({ p: cur }); cur = ''; };
    for (const raw of ls) {
      const l = raw.trim();
      if (!l) { flush(); continue; }
      cur = cur ? `${cur} ${l}` : l;
      if (raw.length < max * 0.75 || max < 20) flush();          // 줄 끝까지 차지 않은 줄 = 문단의 끝
    }
    flush();
  }
  if (!blocks.some((b) => b.p.trim())) throw new Error('글자를 찾지 못했습니다 — 스캔한 PDF(그림)는 고칠 글이 없습니다');
  return blocks.slice(0, MAX_PARAS);
}

// ext 문서를 작업용 DOCX(Buffer)로. opts.profile = LibreOffice 사용자 폴더(데이터 폴더 아래)
async function toDocx(ext, buf, opts = {}) {
  if (ext === 'txt' || ext === 'md') return docx.build(lines(decodeText(buf)));
  if (ext === 'csv') { const b = tableBlocks(parseCsv(decodeText(buf))); if (!b.length) throw new Error('내용이 없습니다'); return docx.build(b); }
  if (ext === 'xlsx') return docx.build(xlsxBlocks(buf));
  if (ext === 'pptx') return docx.build(pptxBlocks(buf));
  const dir = fs.mkdtempSync(path.join(opts.tmp || os.tmpdir(), 'conv-'));
  try {
    const src = path.join(dir, `src.${ext}`);
    fs.writeFileSync(src, buf);
    if (ext === 'pdf') {
      const text = await queued(() => run('pdftotext', ['-enc', 'UTF-8', src, '-'], { encoding: 'utf8' })).catch((e) => { throw new Error(e.code === 'ENOENT' ? 'PDF 를 읽는 도구(pdftotext)가 이 서버에 없습니다' : 'PDF 를 읽지 못했습니다(암호가 걸렸거나 손상된 파일)'); });
      return docx.build(pdfBlocks(text));
    }
    const isHtml = HTML.includes(ext);
    if (isHtml) fs.writeFileSync(path.join(dir, 'src.html'), cleanHtml(buf));
    if (VIA_OFFICE.includes(ext) || isHtml) {
      const profile = opts.profile || path.join(dir, 'lo');
      const file = isHtml ? path.join(dir, 'src.html') : src;
      await queued(() => run(opts.soffice || '/usr/bin/soffice', [`-env:UserInstallation=file://${profile}`, '--headless', '--norestore', ...(isHtml ? ['--infilter=HTML (StarWriter)'] : []), '--convert-to', 'docx:MS Word 2007 XML', '--outdir', dir, file])).catch(() => { throw new Error('문서를 바꾸지 못했습니다(LibreOffice 변환 실패)'); });
      const out = path.join(dir, 'src.docx');
      if (!fs.existsSync(out)) throw new Error('문서를 바꾸지 못했습니다 — 열 수 없는 파일입니다');
      return fs.readFileSync(out);
    }
    throw new Error(`지원하지 않는 형식입니다(.${ext})`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// 쪽마다의 첫머리 글: LibreOffice 로 PDF 를 만들고 pdftotext 로 쪽별 글을 뽑는다(Word 가 쪽 나눔을 적어 두지 않은 문서의 쪽 나누기용)
async function pageTexts(ext, buf, opts = {}) {
  const dir = fs.mkdtempSync(path.join(opts.tmp || os.tmpdir(), 'pages-'));
  try {
    const src = path.join(dir, `src.${ext}`);
    fs.writeFileSync(src, buf);
    const profile = opts.profile || path.join(dir, 'lo');
    await queued(() => run(opts.soffice || '/usr/bin/soffice', [`-env:UserInstallation=file://${profile}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, src]));
    const pdf = path.join(dir, 'src.pdf');
    if (!fs.existsSync(pdf)) return [];
    const text = await queued(() => run('pdftotext', ['-enc', 'UTF-8', pdf, '-'], { encoding: 'utf8' }));
    const pages = text.split('\f'); if (pages.length && !pages[pages.length - 1].trim()) pages.pop();
    return pages.map((t) => t.trim().slice(0, 500));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { toDocx, pageTexts, EXTS, NATIVE, VIA_OFFICE, HTML, decodeText, pptxBlocks, xlsxBlocks };

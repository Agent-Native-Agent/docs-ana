'use strict';
// docxexport.js — 인쇄 화면(쪽마다 나눈 HTML)을 Word(DOCX)로 바꾼다. PDF 로 바로 내보낸 것과 쪽 수 · 서식이 같게:
//   1) 쪽마다 「쪽 나눔」을 박은 HTML → LibreOffice 로 DOCX
//   2) DOCX 의 용지 크기 · 여백 · 머리말/꼬리말(로고 · 쪽 번호)을 원본 쪽 설정대로 고친다
//   3) 그 DOCX 를 다시 PDF 로 바꿔 쪽 수를 세고, 많으면 글자를 조금씩 줄여 다시 만든다(같아질 때까지, 4번까지)
// 의존성: /usr/bin/soffice, /usr/bin/pdfinfo(없으면 쪽 수 확인을 건너뛴다)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const zip = require('./zip');
const zipw = require('./zipw');

const run = (cmd, args, opts = {}) => new Promise((res, rej) => execFile(cmd, args, { timeout: 180000, maxBuffer: 64 << 20, ...opts }, (e, out) => (e ? rej(e) : res(out))));
let chain = Promise.resolve();
const queued = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
const xe = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FONT = 'Malgun Gothic';                    // Word(Windows)에 있는 고딕. 이 서버의 검사에서는 fonts.conf 로 PDF 와 같은 Noto Sans CJK KR 로 그린다
const LOENV = { ...process.env, FONTCONFIG_FILE: path.join(__dirname, 'fonts', 'fonts.conf') };
const TW = (hwp) => Math.round(hwp / 5);          // HWPUNIT(1/7200 in) → twip(1/1440 in)
const EMU = (px) => Math.round(px * 9525);        // CSS px(1/96 in) → EMU

// 쪽마다의 HTML → 한 HTML. 둘째 쪽부터 첫 덩어리에 page-break-before. scale<1 이면 글자 크기를 줄인다.
function buildHtml(ex, scale) {
  // scale<1: 줄 간격 · 문단 위아래 간격 · 칸 위아래 여백을 scale 만큼, 글자는 그 절반만큼 줄인다(쪽 수를 맞추려고)
  const fsS = 1 - (1 - scale) / 2;
  const sc = (h) => (scale === 1 ? h : h.replace(/(font-size):([\d.]+)px/g, (m, k, v) => `${k}:${(v * fsS).toFixed(2)}px`)
    .replace(/(line-height|margin-top|margin-bottom|padding-top|padding-bottom):([\d.]+)px/g, (m, k, v) => `${k}:${(v * scale).toFixed(2)}px`));
  const body = ex.pages.map((h, i) => {
    h = sc(h);
    if (i === 0) return h;
    // 문단으로 시작하면 그 문단에 쪽 나눔. 표로 시작하면(앞 쪽에서 이어지는 표일 수 있다 — LibreOffice 가 붙여 버린다) 1px 짜리 빈 문단으로 끊는다
    const m = /^\s*<(\w+)([^>]*)>/.exec(h); if (!m) return h;
    if (m[1] === 'p') return h.replace(/^\s*<p([^>]*)>/, (x, at) => (/style="/.test(at) ? `<p${at.replace('style="', 'style="page-break-before:always;')}>` : `<p style="page-break-before:always"${at}>`));
    return `<p style="page-break-before:always;margin:0;font-size:1px;line-height:1px">&nbsp;</p>${h}`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0} p{margin:0} table{border-collapse:collapse}</style></head><body>${body}</body></html>`;
}

// 머리말/꼬리말 XML — 왼쪽 · 가운데 · 오른쪽 자리를 탭으로 나눈다. 그림은 inline, 쪽 번호는 PAGE 필드.
function hfXml(tag, items, widthTw, rels) {
  const run = (it) => {
    if (it.img) {
      const rid = `rIdHf${rels.length + 1}`; const name = `media/hf${rels.length + 1}.${/^data:image\/(png|jpe?g)/.exec(it.img)?.[1].replace('jpeg', 'jpg') || 'png'}`;
      rels.push({ rid, name, data: Buffer.from(it.img.split(',')[1] || '', 'base64'), part: tag });
      const cx = EMU(it.w), cy = EMU(it.h);
      return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${900 + rels.length}" name="hf${rels.length}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${900 + rels.length}" name="hf${rels.length}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    }
    const rpr = `<w:rPr>${it.b ? '<w:b/>' : ''}<w:sz w:val="${Math.round((it.fs || 12) * 1.5)}"/></w:rPr>`;      // px → 반 포인트(1px = 0.75pt)
    if (it.pn) {
      const side = it.side ? `<w:r>${rpr}<w:t xml:space="preserve">${xe(it.side)} </w:t></w:r>` : '';
      return `${side}<w:r>${rpr}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rpr}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r>${rpr}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rpr}<w:t>1</w:t></w:r><w:r>${rpr}<w:fldChar w:fldCharType="end"/></w:r>${it.side ? `<w:r>${rpr}<w:t xml:space="preserve"> ${xe(it.side)}</w:t></w:r>` : ''}`;
    }
    return `<w:r>${rpr}<w:t xml:space="preserve">${xe(it.text || '')}</w:t></w:r>`;
  };
  const at = (p) => items.filter((x) => x.pos === p).map(run).join('<w:r><w:t xml:space="preserve"> </w:t></w:r>');
  const tabs = `<w:tabs><w:tab w:val="center" w:pos="${Math.round(widthTw / 2)}"/><w:tab w:val="right" w:pos="${widthTw}"/></w:tabs>`;
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${tag} ${ns}><w:p><w:pPr><w:pStyle w:val="Normal"/>${tabs}<w:spacing w:before="0" w:after="0"/></w:pPr>${at('l')}<w:r><w:tab/></w:r>${at('c')}<w:r><w:tab/></w:r>${at('r')}</w:p></w:${tag}>`;
}

// LibreOffice 가 만든 DOCX 에 용지 · 여백 · 머리말/꼬리말을 박는다
function patchDocx(buf, ex) {
  const z = zip.parse(buf); const files = new Map(z.list().map((n) => [n, z.read(n)]));
  let doc = files.get('word/document.xml').toString('utf8');
  const pg = ex.page || { w: 59528, h: 84189, l: 5669, r: 5669, t: 5669, b: 4252, hd: 2835, ft: 2835 };
  const widthTw = TW(pg.w - pg.l - pg.r);
  const rels = []; const hasH = (ex.hf.head || []).length, hasF = (ex.hf.foot || []).length;
  let ref = '';
  if (hasH) { files.set('word/headerExp1.xml', Buffer.from(hfXml('hdr', ex.hf.head, widthTw, rels))); ref += '<w:headerReference w:type="default" r:id="rIdHdrExp"/>'; }
  if (hasF) { files.set('word/footerExp1.xml', Buffer.from(hfXml('ftr', ex.hf.foot, widthTw, rels))); ref += '<w:footerReference w:type="default" r:id="rIdFtrExp"/>'; }
  if (ex.firstNoHf && (hasH || hasF)) {
    files.set('word/headerExp0.xml', Buffer.from(hfXml('hdr', [], widthTw, []))); files.set('word/footerExp0.xml', Buffer.from(hfXml('ftr', [], widthTw, [])));
    ref += '<w:headerReference w:type="first" r:id="rIdHdrExp0"/><w:footerReference w:type="first" r:id="rIdFtrExp0"/>';
  }
  const sect = `<w:sectPr>${ref}<w:pgSz w:w="${TW(pg.w)}" w:h="${TW(pg.h)}"/><w:pgMar w:top="${TW(pg.t)}" w:right="${TW(pg.r)}" w:bottom="${TW(pg.b)}" w:left="${TW(pg.l)}" w:header="${TW(pg.hd || 0)}" w:footer="${TW(pg.ft || 0)}" w:gutter="0"/>${ex.firstNoHf && (hasH || hasF) ? '<w:titlePg/>' : ''}</w:sectPr>`;
  // 본문 중간의 sectPr(쪽 나눔 대신 구역으로 나뉜 경우)은 지우고 맨 끝 하나만 남긴다
  // 오른쪽 탭(목차 쪽 번호): 표시 글자를 진짜 탭으로, 그 문단에 오른쪽 · 점 채움 탭 자리를 준다
  doc = doc.replace(/<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?@@RTAB@@[\s\S]*?<\/w:p>/g, (p) => {
    p = p.replace(/@@RTAB@@/g, '</w:t><w:tab/><w:t xml:space="preserve">');
    const ind = /<w:ind\b[^>]*w:(?:left|start)="(-?\d+)"/.exec(p); const pos = widthTw - 30 - (ind ? Math.max(0, +ind[1]) : 0);      // LibreOffice 는 들여쓰기 기준 · Word 는 여백 기준 — 둘 다 넘치지 않게 안쪽으로
    const tabs = `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${pos}"/></w:tabs>`;
    return /<w:pPr>/.test(p) ? p.replace('<w:pPr>', `<w:pPr>${tabs}`) : p.replace(/(<w:p\b[^>]*>)/, `$1<w:pPr>${tabs}</w:pPr>`);
  });
  doc = doc.replace(/w:lineRule="atLeast"/g, 'w:lineRule="exact"');      // 화면(브라우저)처럼 줄 간격을 그 값 그대로 — 「최소」면 키 큰 한글 글꼴 때문에 줄마다 늘어난다
  doc = doc.replace(/<w:rFonts\b[^>]*\/>/g, `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/>`);      // 글꼴은 하나로(화면·PDF 와 같은 고딕)
  doc = doc.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, '').replace('</w:body>', `${sect}</w:body>`);
  if (!/xmlns:r=/.test(doc.slice(0, 2000))) doc = doc.replace('<w:document ', '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  files.set('word/document.xml', Buffer.from(doc));
  // 기본 글꼴(rFonts 가 없는 글자): 맑은 고딕
  if (files.has('word/styles.xml')) {
    let st = files.get('word/styles.xml').toString('utf8'); const rf = `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/>`;
    st = st.replace(/<w:rFonts\b[^>]*\/>/g, rf);
    if (!/<w:docDefaults>/.test(st)) st = st.replace(/(<w:styles\b[^>]*>)/, `$1<w:docDefaults><w:rPrDefault><w:rPr>${rf}</w:rPr></w:rPrDefault></w:docDefaults>`);
    else if (!/<w:rPrDefault>[\s\S]*?<w:rFonts/.test(st)) st = st.replace(/<w:rPrDefault>\s*<w:rPr>/, `<w:rPrDefault><w:rPr>${rf}`);
    files.set('word/styles.xml', Buffer.from(st));
  }
  // 관계 · 콘텐츠 형식
  let dr = files.get('word/_rels/document.xml.rels').toString('utf8');
  const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  let add = '';
  if (hasH) add += `<Relationship Id="rIdHdrExp" Type="${RT}/header" Target="headerExp1.xml"/>`;
  if (hasF) add += `<Relationship Id="rIdFtrExp" Type="${RT}/footer" Target="footerExp1.xml"/>`;
  if (ex.firstNoHf && (hasH || hasF)) add += `<Relationship Id="rIdHdrExp0" Type="${RT}/header" Target="headerExp0.xml"/><Relationship Id="rIdFtrExp0" Type="${RT}/footer" Target="footerExp0.xml"/>`;
  files.set('word/_rels/document.xml.rels', Buffer.from(dr.replace('</Relationships>', `${add}</Relationships>`)));
  for (const part of ['hdr', 'ftr']) {
    const list = rels.filter((r) => r.part === part); if (!list.length) continue;
    files.set(`word/_rels/${part === 'hdr' ? 'headerExp1' : 'footerExp1'}.xml.rels`, Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((r) => `<Relationship Id="${r.rid}" Type="${RT}/image" Target="${r.name}"/>`).join('')}</Relationships>`));
  }
  for (const r of rels) files.set(`word/${r.name}`, r.data);
  let ct = files.get('[Content_Types].xml').toString('utf8');
  const ov = (n, t) => (ct.includes(`PartName="/word/${n}"`) ? '' : `<Override PartName="/word/${n}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${t}+xml"/>`);
  let ins = '';
  if (hasH) ins += ov('headerExp1.xml', 'header'); if (hasF) ins += ov('footerExp1.xml', 'footer');
  if (ex.firstNoHf && (hasH || hasF)) ins += ov('headerExp0.xml', 'header') + ov('footerExp0.xml', 'footer');
  for (const e of ['png', 'jpg']) if (!new RegExp(`Extension="${e}"`, 'i').test(ct)) ins += `<Default Extension="${e}" ContentType="image/${e === 'jpg' ? 'jpeg' : e}"/>`;
  files.set('[Content_Types].xml', Buffer.from(ct.replace('</Types>', `${ins}</Types>`)));
  const order = ['[Content_Types].xml', ...[...files.keys()].filter((n) => n !== '[Content_Types].xml')];
  return zipw.build(order.map((name) => ({ name, data: files.get(name) })));
}

async function pdfPages(file) {
  try { const out = await run('/usr/bin/pdfinfo', [file], { encoding: 'utf8' }); const m = /Pages:\s+(\d+)/.exec(out); return m ? +m[1] : 0; } catch { return 0; }
}

// ex = 화면의 __exportDoc() 결과. 돌려주는 값: { data, pages, target, scale, tries }
async function toDocx(ex, opts = {}) {
  return queued(async () => {
    const dir = fs.mkdtempSync(path.join(opts.tmp || os.tmpdir(), 'dxe-')); const profile = path.join(dir, 'lo');
    const say = opts.onStep || (() => {}); const target = ex.pages.length;
    try {
      let scale = 1, best = null;
      for (let t = 1; t <= (opts.maxTries || 4); t++) {
        fs.writeFileSync(path.join(dir, 'doc.html'), buildHtml(ex, scale));
        say(`Word 로 바꾸는 중${t > 1 ? ` (${t}번째 — 글자 ${Math.round(scale * 100)}%)` : ''}`);
        await run('/usr/bin/soffice', [`-env:UserInstallation=file://${profile}`, '--headless', '--norestore', '--infilter=HTML (StarWriter)', '--convert-to', 'docx:MS Word 2007 XML', '--outdir', dir, path.join(dir, 'doc.html')], { env: LOENV });
        const data = patchDocx(fs.readFileSync(path.join(dir, 'doc.docx')), ex);
        fs.writeFileSync(path.join(dir, 'out.docx'), data);
        say('쪽 수 확인 — Word 파일을 다시 PDF 로 바꿔 세는 중');
        fs.rmSync(path.join(dir, 'out.pdf'), { force: true });
        await run('/usr/bin/soffice', [`-env:UserInstallation=file://${profile}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, path.join(dir, 'out.docx')], { env: LOENV }).catch(() => {});
        const pages = await pdfPages(path.join(dir, 'out.pdf'));
        // 쪽마다 첫 글자가 PDF 의 같은 쪽 첫 글자와 같은지(쪽 수만 같고 중간에서 밀린 것을 잡는다)
        let off = [];
        if (pages && ex.starts) {
          let txt = ''; try { txt = await run('/usr/bin/pdftotext', [path.join(dir, 'out.pdf'), '-'], { encoding: 'utf8' }); } catch {}
          const nz = (x) => String(x).replace(/[^가-힣A-Za-z0-9]/g, ''); const pp = txt.split('\f').map(nz);
          off = ex.starts.map((st, i) => { const k = nz(st).slice(0, 3); return k.length >= 3 && !(pp[i] || '').includes(k) ? i + 1 : 0; }).filter(Boolean);
        }
        const ok = pages === target && !off.length;
        const cand = { data, pages, target, scale, tries: t, off, ok };
        if (!best || ok || (!best.ok && Math.abs(pages - target) + off.length < Math.abs(best.pages - target) + best.off.length)) best = cand;
        say(`쪽 수: Word ${pages || '?'}쪽 · PDF ${target}쪽${off.length ? ` · 어긋난 쪽 ${off.slice(0, 6).join(', ')}` : ''}`);
        if (!pages || ok) break;
        scale = +(scale - 0.05).toFixed(2);
      }
      return best;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

module.exports = { toDocx, buildHtml, patchDocx };

// HWPX 쪽 맞춤: 최종본 HWPX 의 본문 맨 위 문단 가운데, PDF 의 각 쪽 첫 글자로 시작하는 문단에 「쪽 나눔」(pageBreak="1")을 단다.
// 앞 쪽에서 이어지는 표(쪽 중간에서 나뉜 표)는 한/글이 스스로 나누므로 건너뛴다. 돌려주는 값: { data, set, skipped }
function lockHwpxPages(buf, starts) {
  const z = zip.parse(buf); const names = z.list(); const secName = names.find((n) => /^Contents\/section0\.xml$/.test(n));
  let sec = z.read(secName).toString('utf8');
  const nz = (x) => String(x).replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^가-힣A-Za-z0-9]/g, '');
  // 맨 위 문단(표 안이 아닌)의 자리
  const tops = []; let depth = 0, st = -1; const re = /<hp:p\b[^>]*>|<\/hp:p>|<hp:tbl\b|<\/hp:tbl>/g; let m;
  while ((m = re.exec(sec))) {
    const t = m[0];
    if (t.startsWith('<hp:tbl')) depth++; else if (t === '</hp:tbl>') depth--;
    else if (t.startsWith('<hp:p') && depth === 0) st = m.index; else if (t === '</hp:p>' && depth === 0 && st >= 0) { tops.push([st, re.lastIndex]); st = -1; }
  }
  const txt = tops.map(([a, b]) => nz(sec.slice(a, b))); const toc = tops.map(([a, b]) => /<hp:tab\b[^>]*leader="[1-9]/.test(sec.slice(a, b)));      // 목차 줄(점 채움 탭)은 본문 제목과 글이 같아 쪽 시작으로 잡지 않는다
  let from = 0; const hits = []; const skipped = [];
  for (let i = 1; i < starts.length; i++) {
    const k = String(starts[i]).replace(/[^가-힣A-Za-z0-9]/g, '').slice(0, 8);      // 화면 글(「< 표 1 >」을 꼬리표로 지우지 않게 글자만) if (k.length < 3) { skipped.push(i + 1); continue; }
    let j = -1;
    for (let q = from; q < txt.length; q++) { if (!txt[q] || toc[q]) continue; let w = ''; for (let e = q; e < txt.length && w.length < k.length; e++) w += txt[e]; if (w.startsWith(k)) { j = q; break; } }      // 짧은 문단(제목 상자)은 뒤 문단과 이어 붙여 견준다
    if (j < 0) { skipped.push(i + 1); continue; }
    hits.push(j); from = j + 1;
  }
  for (const j of hits.sort((a, b) => b - a)) {
    const [a] = tops[j]; const open = /^<hp:p\b[^>]*>/.exec(sec.slice(a))[0];
    const nw = /pageBreak="\d"/.test(open) ? open.replace(/pageBreak="\d"/, 'pageBreak="1"') : open.replace('<hp:p', '<hp:p pageBreak="1"');
    sec = sec.slice(0, a) + nw + sec.slice(a + open.length);
  }
  const out = names.map((name) => ({ name, data: name === secName ? Buffer.from(sec, 'utf8') : z.read(name), store: name === 'mimetype' }));
  return { data: zipw.build(out), set: hits.length, skipped, hits: hits.map((j) => txt[j].slice(0, 12)) };
}
module.exports.lockHwpxPages = lockHwpxPages;

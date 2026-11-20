'use strict';
// fixedexport.js — 「쪽 고정」 내보내기: 인쇄 화면(PDF 와 같은 화면)의 쪽마다 그려진 자리를 그대로 옮겨 수정 가능한 파일을 만든다.
//   입력 = 화면의 window.__layoutDoc() 결과 { pages: [{ w, h, items }], mm: { w, h } }
//   글은 줄 단위 글상자(줄바꿈이 다시 일어나지 않게), 칸 바탕 · 테두리 · 점 채움은 도형, 그림은 그림으로.
//   PPTX: 쪽 = 슬라이드(용지 크기). DOCX: 쪽 = 구역, 글상자 · 도형을 쪽 기준 절대 위치로.
// verify(): 바로 뽑은 PDF 와, 만든 파일을 LibreOffice 로 다시 PDF 로 바꾼 것을 쪽 수 · 쪽마다 글 · 쪽마다 그림 차이로 비교한다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const zipw = require('./zipw');

const run = (cmd, args, opts = {}) => new Promise((res, rej) => execFile(cmd, args, { timeout: 300000, maxBuffer: 256 << 20, ...opts }, (e, out) => (e ? rej(e) : res(out))));
const LOENV = { ...process.env, FONTCONFIG_FILE: path.join(__dirname, 'fonts', 'fonts.conf') };
const xe = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main', NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
// 점 채움(목차): 화면처럼 점과 점 사이를 5px 로 — 점 길이는 거의 0, 둥근 끝(선 굵기만 한 점)
const DOTS = (it) => { const w = Math.max(it.w, 1.5); return `<a:custDash><a:ds d="1000" sp="${Math.round((5 - w) / w * 100000)}"/></a:custDash>`; };
const FONT = (f) => (!f || /pretendard|apple|system|sans-serif|inherit/i.test(f) ? '맑은 고딕' : f);

function dataUri(d) { const m = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,(.*)$/s.exec(d || ''); if (!m) return null; return { ext: m[1] === 'jpeg' ? 'jpg' : m[1] === 'jpg' ? 'jpg' : m[1], buf: Buffer.from(m[2], 'base64') }; }

// ---------- 공통: 한 쪽의 도형 목록 → DrawingML 조각(PPTX 슬라이드용) ----------
function slideShapes(page, k, mediaRel) {
  // k = px → EMU
  const E = (v) => Math.round(v * k); let id = 2; const out = [];
  const pt = (px) => Math.max(100, Math.round(px * k / 12700 * 100));      // 글자 크기(1/100 pt): px → EMU → pt
  for (const it of page.items) {
    if (it.t === 'rect') {
      out.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="r${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${E(it.x)}" y="${E(it.y)}"/><a:ext cx="${Math.max(1, E(it.w))}" cy="${Math.max(1, E(it.h))}"/></a:xfrm><a:prstGeom prst="${it.rad > 1 ? 'roundRect' : 'rect'}"><a:avLst>${it.rad > 1 ? `<a:gd name="adj" fmla="val ${Math.min(50000, Math.round(it.rad / Math.min(it.w, it.h) * 100000))}"/>` : ''}</a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="${it.fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`);
    } else if (it.t === 'line') {
      const x = Math.min(it.x1, it.x2), y = Math.min(it.y1, it.y2), w = Math.abs(it.x2 - it.x1), h = Math.abs(it.y2 - it.y1);
      const dash = it.dash === 'dot' ? DOTS(it) : it.dash === 'dash' ? '<a:prstDash val="dash"/>' : '';
      out.push(`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id++}" name="l${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="${E(x)}" y="${E(y)}"/><a:ext cx="${E(w)}" cy="${E(h)}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${Math.max(3175, E(it.dash === 'dot' ? Math.max(it.w, 1.5) : it.w))}"${it.dash === 'dot' ? ' cap="rnd"' : ''}><a:solidFill><a:srgbClr val="${it.color}"/></a:solidFill>${dash}</a:ln></p:spPr></p:cxnSp>`);
    } else if (it.t === 'img') {
      const rid = mediaRel(it.data); if (!rid) continue;
      out.push(`<p:pic><p:nvPicPr><p:cNvPr id="${id++}" name="p${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${E(it.x)}" y="${E(it.y)}"/><a:ext cx="${E(it.w)}" cy="${E(it.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
    } else if (it.t === 'text') {
      const f = xe(FONT(it.font));
      const rpr = `<a:rPr lang="ko-KR" altLang="en-US" sz="${pt(it.size)}"${it.bold ? ' b="1"' : ' b="0"'}${it.italic ? ' i="1"' : ''}${it.under ? ' u="sng"' : ''}${it.ls ? ` spc="${Math.round(it.ls * k / 12700 * 100)}"` : ''} dirty="0"><a:solidFill><a:srgbClr val="${it.color}"/></a:solidFill><a:latin typeface="${f}"/><a:ea typeface="${f}"/><a:cs typeface="${f}"/></a:rPr>`;
      out.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="t${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${E(it.x)}" y="${E(it.y)}"/><a:ext cx="${E(it.w + it.size * 0.6)}" cy="${E(it.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" anchorCtr="0"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr marL="0" indent="0" algn="l"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft><a:buNone/></a:pPr><a:r>${rpr}<a:t>${xe(it.s)}</a:t></a:r></a:p></p:txBody></p:sp>`);
    }
  }
  return out.join('');
}

const THEME = `${XML}<a:theme xmlns:a="${NS_A}" name="Docs"><a:themeElements><a:clrScheme name="Docs"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="EEF2F8"/></a:lt2><a:accent1><a:srgbClr val="3B6BB5"/></a:accent1><a:accent2><a:srgbClr val="C8843A"/></a:accent2><a:accent3><a:srgbClr val="3C8D5A"/></a:accent3><a:accent4><a:srgbClr val="8C97A8"/></a:accent4><a:accent5><a:srgbClr val="24406E"/></a:accent5><a:accent6><a:srgbClr val="B7832F"/></a:accent6><a:hlink><a:srgbClr val="2F5A9E"/></a:hlink><a:folHlink><a:srgbClr val="6E8DBF"/></a:folHlink></a:clrScheme><a:fontScheme name="Docs"><a:majorFont><a:latin typeface="맑은 고딕"/><a:ea typeface="맑은 고딕"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="맑은 고딕"/><a:ea typeface="맑은 고딕"/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Docs"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
const SPTREE0 = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

// ---------- PPTX ----------
function toPptx(L) {
  const W = Math.round(L.mm.w * 36000), H = Math.round(L.mm.h * 36000);
  const files = []; const add = (name, data) => files.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8') });
  const n = L.pages.length; const media = new Map(); let mi = 0; const exts = new Set();
  const slides = L.pages.map((pg, i) => {
    const k = W / pg.w; const rels = [`<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`]; let ri = 1; const local = new Map();
    const mediaRel = (d) => { const u = dataUri(d); if (!u) return null; let key = media.get(d); if (!key) { key = `image${++mi}.${u.ext}`; media.set(d, key); add(`ppt/media/${key}`, u.buf); exts.add(u.ext); } if (!local.has(key)) { local.set(key, `rId${++ri}`); rels.push(`<Relationship Id="rId${ri}" Type="${REL}/image" Target="../media/${key}"/>`); } return local.get(key); };
    const body = slideShapes(pg, k, mediaRel);
    add(`ppt/slides/slide${i + 1}.xml`, `${XML}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${SPTREE0}${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    add(`ppt/slides/_rels/slide${i + 1}.xml.rels`, `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
    return i + 1;
  });
  const ct = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...exts].map((e) => `<Default Extension="${e}" ContentType="image/${e === 'jpg' ? 'jpeg' : e}"/>`).join('')}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((i) => `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const out = [{ name: '[Content_Types].xml', data: Buffer.from(ct) }];
  out.push({ name: '_rels/.rels', data: Buffer.from(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`) });
  out.push({ name: 'docProps/app.xml', data: Buffer.from(`${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Docs</Application><Slides>${n}</Slides></Properties>`) });
  out.push({ name: 'docProps/core.xml', data: Buffer.from(`${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xe(L.title || '')}</dc:title></cp:coreProperties>`) });
  out.push({ name: 'ppt/presentation.xml', data: Buffer.from(`${XML}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((i) => `<p:sldId id="${255 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="${H}" cy="${W}"/></p:presentation>`) });
  out.push({ name: 'ppt/_rels/presentation.xml.rels', data: Buffer.from(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="theme/theme1.xml"/>${slides.map((i) => `<Relationship Id="rId${i + 2}" Type="${REL}/slide" Target="slides/slide${i}.xml"/>`).join('')}</Relationships>`) });
  out.push({ name: 'ppt/slideMasters/slideMaster1.xml', data: Buffer.from(`${XML}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${SPTREE0}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`) });
  out.push({ name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: Buffer.from(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`) });
  out.push({ name: 'ppt/slideLayouts/slideLayout1.xml', data: Buffer.from(`${XML}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1"><p:cSld name="빈 쪽"><p:spTree>${SPTREE0}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`) });
  out.push({ name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: Buffer.from(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`) });
  out.push({ name: 'ppt/theme/theme1.xml', data: Buffer.from(THEME) });
  return zipw.build([...out, ...files]);
}

// ---------- 비교: 바로 뽑은 PDF ↔ 만든 파일을 다시 PDF 로 ----------
async function officeToPdf(file, dir) {
  const profile = path.join(dir, 'lo');
  await run('/usr/bin/soffice', [`-env:UserInstallation=file://${profile}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, file], { env: LOENV });
  return path.join(dir, path.basename(file).replace(/\.[^.]+$/, '.pdf'));
}
async function pdfInfo(file) { const out = await run('/usr/bin/pdfinfo', [file], { encoding: 'utf8' }); return { pages: +((/Pages:\s+(\d+)/.exec(out) || [])[1] || 0) }; }
function readPgm(buf) {      // P5 회색조
  let i = 0; const tok = () => { while (/\s/.test(String.fromCharCode(buf[i]))) i++; if (buf[i] === 35) { while (buf[i] !== 10) i++; return tok(); } let s = ''; while (!/\s/.test(String.fromCharCode(buf[i]))) s += String.fromCharCode(buf[i++]); return s; };
  if (tok() !== 'P5') throw new Error('PGM 아님'); const w = +tok(), h = +tok(); tok(); i++; return { w, h, px: buf.subarray(i, i + w * h) };
}
async function pageImages(pdf, dir, tag, dpi) {
  await run('/usr/bin/pdftoppm', ['-r', String(dpi), '-gray', pdf, path.join(dir, tag)]);
  return fs.readdirSync(dir).filter((f) => f.startsWith(tag + '-') && f.endsWith('.pgm')).sort((a, b) => parseInt(a.split('-').pop(), 10) - parseInt(b.split('-').pop(), 10)).map((f) => path.join(dir, f));
}
const norm = (s) => String(s).replace(/[^가-힣A-Za-z0-9]/g, '');
function textSim(a, b) {      // 글자 2개 묶음(바이그램) 겹침 비율
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const A = bg(a), B = bg(b); let inter = 0, tot = 0; for (const [k, v] of A) { inter += Math.min(v, B.get(k) || 0); tot += v; } for (const v of B.values()) tot += v; return tot ? (2 * inter) / tot : 1;
}
async function verify(pdfDirect, fileOut, opts = {}) {
  const dir = fs.mkdtempSync(path.join(opts.tmp || os.tmpdir(), 'fxv-'));
  try {
    const pdfB = fileOut.endsWith('.pdf') ? fileOut : await officeToPdf(fileOut, dir);
    const [ia, ib] = [await pdfInfo(pdfDirect), await pdfInfo(pdfB)];
    const ta = String(await run('/usr/bin/pdftotext', [pdfDirect, '-'], { encoding: 'utf8' })).split('\f').map(norm);
    const tb = String(await run('/usr/bin/pdftotext', [pdfB, '-'], { encoding: 'utf8' })).split('\f').map(norm);
    const n = Math.min(ia.pages, ib.pages); const per = [];
    const imA = await pageImages(pdfDirect, dir, 'a', opts.dpi || 40), imB = await pageImages(pdfB, dir, 'b', opts.dpi || 40);
    for (let i = 0; i < n; i++) {
      let diff = null;
      try {      // 잉크(어두운 점)가 상대 쪽의 같은 자리 ±1점(40dpi 에서 약 0.6mm) 안에도 있으면 같은 것으로 센다 — 글자 테두리 번짐 · 1점 밀림은 같다고 본다
        const A = readPgm(fs.readFileSync(imA[i])), B = readPgm(fs.readFileSync(imB[i])); const w = Math.min(A.w, B.w), h = Math.min(A.h, B.h);
        const near = (P, x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && P.px[yy * P.w + xx] < 170) return true; } return false; };
        let ink = 0, miss = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (A.px[y * A.w + x] < 170) { ink++; if (!near(B, x, y)) miss++; } if (B.px[y * B.w + x] < 170) { ink++; if (!near(A, x, y)) miss++; } }
        diff = ink ? miss / ink : 0;
      } catch {}
      per.push({ page: i + 1, text: +textSim(ta[i] || '', tb[i] || '').toFixed(3), pixel: diff === null ? null : +(1 - diff).toFixed(3) });
    }
    const avg = (k) => +(per.reduce((a, p) => a + (p[k] || 0), 0) / Math.max(1, per.length)).toFixed(3);
    return { pagesDirect: ia.pages, pagesOut: ib.pages, samePages: ia.pages === ib.pages, text: avg('text'), pixel: avg('pixel'), worst: [...per].sort((a, b) => a.pixel - b.pixel).slice(0, 3), per };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}


// ---------- DOCX(쪽 고정) ----------
// 쪽 = 구역(용지 크기 · 여백 0). 쪽마다 빈 문단 하나에 글상자 · 도형 · 그림을 「쪽 기준 절대 위치」로 붙인다(글은 줄 단위 글상자 — Word 에서 고칠 수 있다).
function toDocxFixed(L) {
  const W = Math.round(L.mm.w * 36000), H = Math.round(L.mm.h * 36000);
  const twW = Math.round(L.mm.w / 25.4 * 1440), twH = Math.round(L.mm.h / 25.4 * 1440);
  const media = new Map(); const rels = []; const files = []; let rid = 10, did = 1; const exts = new Set();
  const imgRel = (d) => { const u = dataUri(d); if (!u) return null; let r = media.get(d); if (!r) { const name = `image${media.size + 1}.${u.ext}`; r = `rId${++rid}`; media.set(d, r); files.push({ name: `word/media/${name}`, data: u.buf }); rels.push(`<Relationship Id="${r}" Type="${REL}/image" Target="media/${name}"/>`); exts.add(u.ext); } return r; };
  const anchor = (x, y, cx, cy, inner, z) => `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${z}" behindDoc="0" locked="1" layoutInCell="0" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${x}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${y}</wp:posOffset></wp:positionV><wp:extent cx="${Math.max(1, cx)}" cy="${Math.max(1, cy)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${did}" name="o${did++}"/><wp:cNvGraphicFramePr/>${inner}</wp:anchor></w:drawing></w:r>`;
  const wsp = (geom, spPr, body) => `<a:graphic xmlns:a="${NS_A}"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr${body ? ' txBox="1"' : ''}/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${geom[0]}" cy="${geom[1]}"/></a:xfrm>${spPr}</wps:spPr>${body || '<wps:bodyPr/>'}</wps:wsp></a:graphicData></a:graphic>`;
  const pages = L.pages.map((pg, pi) => {
    const k = W / pg.w, E = (v) => Math.round(v * k); let z = 1; const runs = [];
    for (const it of pg.items) {
      z++;
      if (it.t === 'rect') { const g = [E(it.w), E(it.h)]; runs.push(anchor(E(it.x), E(it.y), g[0], g[1], wsp(g, `<a:prstGeom prst="${it.rad > 1 ? 'roundRect' : 'rect'}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${it.fill}"/></a:solidFill><a:ln><a:noFill/></a:ln>`), z)); }
      else if (it.t === 'line') { const x = Math.min(it.x1, it.x2), y = Math.min(it.y1, it.y2), g = [E(Math.abs(it.x2 - it.x1)), E(Math.abs(it.y2 - it.y1))]; const dash = it.dash === 'dot' ? DOTS(it) : it.dash === 'dash' ? '<a:prstDash val="dash"/>' : ''; runs.push(anchor(E(x), E(y), g[0], g[1], wsp(g, `<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${Math.max(3175, E(it.dash === 'dot' ? Math.max(it.w, 1.5) : it.w))}"${it.dash === 'dot' ? ' cap="rnd"' : ''}><a:solidFill><a:srgbClr val="${it.color}"/></a:solidFill>${dash}</a:ln>`), z)); }
      else if (it.t === 'img') { const r = imgRel(it.data); if (!r) continue; const g = [E(it.w), E(it.h)]; runs.push(anchor(E(it.x), E(it.y), g[0], g[1], `<a:graphic xmlns:a="${NS_A}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${did}" name="i${did}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${r}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${g[0]}" cy="${g[1]}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`, z)); }
      else if (it.t === 'text') {
        const f = xe(FONT(it.font)); const hp = Math.max(2, Math.round(it.size * k / 12700 * 2));      // 반 포인트
        const g = [E(it.w + it.size * 0.6), E(it.h)];
        const rpr = `<w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/>${it.bold ? '<w:b/><w:bCs/>' : ''}${it.italic ? '<w:i/>' : ''}${it.under ? '<w:u w:val="single"/>' : ''}<w:color w:val="${it.color}"/>${it.ls ? `<w:spacing w:val="${Math.round(it.ls * k / 12700 * 20)}"/>` : ''}<w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/></w:rPr>`;
        const body = `<wps:txbx><w:txbxContent><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:r>${rpr}<w:t xml:space="preserve">${xe(it.s)}</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr rot="0" vert="horz" wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr>`;
        runs.push(anchor(E(it.x), E(it.y), g[0], g[1], wsp(g, `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln>`, body), z));
      }
    }
    const last = pi === L.pages.length - 1;
    const sect = `<w:sectPr><w:pgSz w:w="${twW}" w:h="${twH}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/><w:cols w:space="0"/></w:sectPr>`;
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>${last ? '' : sect}</w:pPr>${runs.join('')}</w:p>` + (last ? sect : '');
  });
  const doc = `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${NS_R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="${NS_A}" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>${pages.join('')}</w:body></w:document>`;
  const ct = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...exts].map((e) => `<Default Extension="${e}" ContentType="image/${e === 'jpg' ? 'jpeg' : e}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const styles = `${XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕" w:cs="맑은 고딕"/><w:sz w:val="20"/><w:lang w:val="en-US" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
  return zipw.build([
    { name: '[Content_Types].xml', data: Buffer.from(ct) },
    { name: '_rels/.rels', data: Buffer.from(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { name: 'word/document.xml', data: Buffer.from(doc) },
    { name: 'word/styles.xml', data: Buffer.from(styles) },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>${rels.join('')}</Relationships>`) },
    ...files,
  ]);
}

// 이 서버의 LibreOffice 가 그 형식을 열 수 있는가(PPTX 는 Impress 가 있어야 다시 PDF 로 바꿔 잴 수 있다)
function canOpen(kind) { if (kind === 'pptx') return fs.existsSync('/usr/lib/libreoffice/program/libsdlo.so'); return true; }
module.exports = { toPptx, toDocxFixed, verify, officeToPdf, canOpen };

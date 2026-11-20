'use strict';
// sources.js — 출처 대조. 참고 파일에서 글을 문장 단위로 뽑고(어디에 있는지 함께), 기획서 문장마다 가장 가까운 참고 문장을 찾는다. npm 의존성 없음.
//   extract(ext, buf, opts) → [{loc, t}]      loc = '3쪽' · '슬라이드 4' · 가장 가까운 제목 등 사람이 찾아갈 수 있는 자리
//   buildIndex(files) → index                 files = [{fid, name, sents:[{loc,t}]}]
//   match(index, text) → {score, fid, name, loc, t, nums}   score = 기획서 문장의 글자 3개 묶음 중 참고 글에 있는 비율(0~1)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const hwpx = require('./hwpx');
const hwp5 = require('./hwp5');
const docx = require('./docx');
const convert = require('./convert');

const MAX_SENTS = 20000;
const run = (cmd, args, opts) => new Promise((res, rej) => execFile(cmd, args, { timeout: 120000, maxBuffer: 64 << 20, ...opts }, (err, out) => (err ? rej(err) : res(out))));

// 글 덩어리 → 문장들. 개조식 머리표(○ □ ◈ - • ※)와 문장 끝(. ! ? 다. 함. 임.)에서 나눈다.
function sentences(text) {
  const out = [];
  for (const line of String(text || '').replace(/\r/g, '').split(/\n+/)) {
    const parts = line.split(/(?<=[.!?。])\s+(?=\S)|\s+(?=[○□◈•▶■◆※]\s)/);
    for (const p of parts) { const t = p.replace(/\s+/g, ' ').trim(); if (norm(t).length >= 6) out.push(t); }
  }
  return out;
}
const norm = (t) => String(t || '').replace(/[\s ·・,.()[\]{}「」『』《》〈〉<>"'“”‘’:;!?\-–—~∼○□◈•▶■◆※→←↔+=/|_*#…]/g, '').toLowerCase();

// 한/글·Word 문서 모델 → 문단 글(표 칸·글상자 안까지) + 자리(가장 가까운 제목)
function modelSents(doc) {
  const out = []; let head = '';
  const isHead = (t) => t.length <= 40 && /^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]|\d+\.\s|\d+(\.\d+)+\s|[□◈■]|\(\d+\)|제\s*\d+\s*[장절조]|\[그림|<\s*표)/.test(t);
  const walk = (paras) => {
    for (const p of paras || []) {
      const t = String(p.text || '').replace(/[\u0000-\u001f]/g, ' ').trim();
      if (t && isHead(t)) head = t.slice(0, 40);
      for (const s of sentences(t)) out.push({ loc: head || '앞부분', t: s });
      for (const c of p.controls || []) {
        if (c.type === 'table') for (const cell of c.cells || []) walk(cell.paragraphs);
        else if (c.paragraphs) walk(c.paragraphs);
      }
      if (out.length > MAX_SENTS) return;
    }
  };
  for (const sec of doc.sections || []) walk(sec.paragraphs);
  return out;
}

function blockSents(blocks) {
  const out = []; let loc = '';
  for (const b of blocks) {
    if (b.h) { loc = b.h; continue; }
    if (b.p) for (const s of sentences(b.p)) out.push({ loc: loc || '앞부분', t: s });
    if (b.table) for (const row of b.table) { const t = row.filter((c) => String(c).trim()).join(' | '); if (norm(t).length >= 6) out.push({ loc: loc || '표', t: t.slice(0, 400) }); }
  }
  return out;
}

async function extract(ext, buf, opts = {}) {
  ext = String(ext || '').toLowerCase().replace(/^\./, '');
  if (ext === 'hwpx') return modelSents(hwpx.parse(buf));
  if (ext === 'hwp') return modelSents(hwp5.parse(buf));
  if (ext === 'docx') return modelSents(docx.parse(buf));
  if (ext === 'pptx') return blockSents(convert.pptxBlocks(buf));
  if (ext === 'xlsx') return blockSents(convert.xlsxBlocks(buf));
  if (ext === 'txt' || ext === 'md' || ext === 'csv') return blockSents([{ p: convert.decodeText(buf) }]);
  if (ext === 'pdf') {
    const dir = fs.mkdtempSync(path.join(opts.tmp || os.tmpdir(), 'src-'));
    try {
      const f = path.join(dir, 'a.pdf'); fs.writeFileSync(f, buf);
      const text = await run('pdftotext', ['-enc', 'UTF-8', f, '-'], { encoding: 'utf8' });
      const out = [];
      text.split('\f').forEach((pg, i) => { for (const s of sentences(pg.replace(/([^\n])\n(?=[^\n○□◈•※\-])/g, '$1 '))) out.push({ loc: `${i + 1}쪽`, t: s }); });
      return out.slice(0, MAX_SENTS);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  if (['doc', 'odt', 'rtf', 'html', 'htm'].includes(ext)) return modelSents(docx.parse(await convert.toDocx(ext, buf, opts)));
  return null;      // 그림·압축 등: 글이 없다
}

// 숫자(+단위): 수치가 서로 다른지 보려고
const NUM = /(\d[\d,]*(?:\.\d+)?)\s*(%|퍼센트|억\s*원|억|백만\s*원|백만|천만|만\s*원|만|원|건|개|명|종|대|배|년|개월|월|일|시간|분|초|노드|회|곳|쪽|과제)/g;
function numsOf(t) { const out = []; let m; NUM.lastIndex = 0; while ((m = NUM.exec(t))) out.push({ v: m[1].replace(/,/g, ''), u: m[2].replace(/\s+/g, '') }); return out; }

function grams(s) { const g = new Set(); for (let i = 0; i + 3 <= s.length; i++) g.add(s.slice(i, i + 3)); return g; }

// 참고 글 색인: 문장 하나와 그 뒤 두 문장까지 묶은 창(기획서 한 문장이 참고 글 여러 문장을 줄인 것일 때)
function buildIndex(files) {
  const wins = []; const post = new Map();
  for (const f of files) {
    const S = f.sents || [];
    for (let i = 0; i < S.length; i++) {
      for (const w of [1, 3]) {
        if (w > 1 && i + 1 >= S.length) continue;
        const t = S.slice(i, i + w).map((x) => x.t).join(' ');
        const id = wins.length; wins.push({ fid: f.fid, name: f.name, loc: S[i].loc, t, n: norm(t) });
        for (const g of grams(wins[id].n)) { let a = post.get(g); if (!a) post.set(g, (a = [])); a.push(id); }
      }
    }
  }
  return { wins, post };
}

function match(index, text) {
  const G = grams(norm(text)); if (G.size < 4) return null;
  const hit = new Map();
  for (const g of G) { const a = index.post.get(g); if (!a || a.length > 4000) continue; for (const id of a) hit.set(id, (hit.get(id) || 0) + 1); }
  let best = null, bs = 0;
  for (const [id, c] of hit) { const w = index.wins[id]; const s = c / G.size - (w.t.length > text.length * 4 ? 0.05 : 0); if (s > bs || (s === bs && best && w.t.length < best.t.length)) { bs = s; best = w; } }
  if (!best) return { score: 0 };
  return { score: Math.round(Math.min(1, bs) * 100) / 100, fid: best.fid, name: best.name, loc: best.loc, t: best.t.slice(0, 600) };
}

// 같은 단위의 수치가 기획서에는 있는데 참고 글에는 다른 값만 있으면 '수치가 다름'
function numConflict(docText, refText) {
  const a = numsOf(docText), b = numsOf(refText); if (!a.length || !b.length) return null;
  const diff = [];
  for (const x of a) {
    const same = b.filter((y) => y.u === x.u); if (!same.length) continue;
    if (same.some((y) => y.v === x.v)) continue;
    diff.push(`${x.v}${x.u} ↔ ${[...new Set(same.map((y) => y.v + y.u))].slice(0, 3).join('·')}`);
  }
  return diff.length ? diff.slice(0, 3).join(', ') : null;
}

const has = (refText, quote) => { const q = norm(quote); return q.length >= 4 && norm(refText).includes(q); };

module.exports = { extract, sentences, buildIndex, match, numConflict, numsOf, norm, has };

'use strict';
// pdfexport.js — 문서 화면을 '지금 보기대로'(메모 · 수정사항) PDF 로 만든다. npm 의존성 없음.
// 이 서버에 이미 있는 Chromium 을 한 번 띄워(DevTools 프로토콜) 인쇄용 화면(nrf.html?print=1…)을 열고 Page.printToPDF 로 뽑은 뒤 바로 닫는다.
// 무거운 일이라 한 번에 하나씩만 한다(다른 ANA 와 함께 쓰는 서버).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const run = require('node:util').promisify(execFile);

const CANDIDATES = ['/snap/chromium/current/usr/lib/chromium-browser/chrome', '/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'];
const chromePath = () => CANDIDATES.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let chain = Promise.resolve();
const queued = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

async function render(url, { timeout = 90000, onStep = () => {}, evaluate = null } = {}) {
  const bin = chromePath();
  if (!bin) throw new Error('이 서버에서 PDF 를 만들 브라우저(Chromium)를 찾지 못했습니다');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-pdf-'));
  const port = 9400 + Math.floor(Math.random() * 400);
  const ch = spawn(bin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${dir}`, '--disk-cache-size=1', `--remote-debugging-port=${port}`, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
  const t0 = Date.now(); let ws = null;
  try {
    for (let i = 0; i < 60 && !ws; i++) {
      await sleep(250);
      try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = l.find((x) => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
    }
    if (!ws) throw new Error('브라우저를 띄우지 못했습니다');
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('브라우저에 붙지 못했습니다')); });
    let id = 0; const pend = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result || {}); } };
    const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Page.enable'); await send('Runtime.enable');
    onStep('문서 화면 여는 중');
    await send('Page.navigate', { url });
    let ready = null;
    while (!ready) {
      if (Date.now() - t0 > timeout) throw new Error('문서를 그리는 데 너무 오래 걸립니다');
      await sleep(400);
      const r = await send('Runtime.evaluate', { expression: 'window.__printReady || window.__printError || null', returnByValue: true });
      const v = r.result && r.result.value; if (v && v.error) throw new Error(v.error); if (v) ready = v;
    }
    if (evaluate) {      // PDF 대신 화면에서 값을 받아 온다(Word 내보내기: 쪽마다의 HTML)
      onStep(`쪽 ${ready.pages || 1}장의 서식을 읽는 중`);
      const r = await send('Runtime.evaluate', { expression: evaluate, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '화면에서 읽지 못했습니다');
      return { value: r.result && r.result.value, pages: ready.pages || 0, ms: Date.now() - t0 };
    }
    onStep(`쪽 ${ready.pages || 1}장을 PDF 로 쓰는 중`);
    const pdf = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
    return { data: Buffer.from(pdf.data, 'base64'), pages: ready.pages || 0, ms: Date.now() - t0 };
  } finally {
    try { ws && ws.close(); } catch {}
    try { ch.kill('SIGKILL'); } catch {}
    await sleep(300);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Use the exact PDF bytes as the source for both office formats. The same queue
// covers printing and packaging so concurrent downloads do not pile up raster jobs.
function renderOffice(url, format, opts) {
  if (!['docx', 'hwpx'].includes(format)) throw new Error('지원하지 않는 문서 형식');
  return queued(async () => {
    const pdf = await render(url, opts);
    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'docs-layout-'));
    try {
      const source = path.join(work, 'print.pdf');
      const target = path.join(work, 'print.' + format);
      await fs.promises.writeFile(source, pdf.data);
      opts.onStep('인쇄된 각 쪽을 문서에 배치하는 중');
      const { stdout } = await run('python3', [path.join(__dirname, 'print-layout', 'package.py'), source, target], { timeout: 300000 });
      return { data: await fs.promises.readFile(target), pages: Number(stdout.trim()) };
    } finally {
      await fs.promises.rm(work, { recursive: true, force: true });
    }
  });
}

module.exports = { renderOffice, renderPdf: (url, opts) => queued(() => render(url, opts)), readPage: (url, expression, opts = {}) => queued(() => render(url, { ...opts, evaluate: expression })), chromePath };

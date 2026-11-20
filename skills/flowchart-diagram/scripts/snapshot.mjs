#!/usr/bin/env node
// 그린 HTML을 PC(1280px)·휴대폰(390px) × 밝은·어두운 화면으로 찍어 PNG 4장을 만든다. 눈으로 확인하는 단계.
//   node scripts/snapshot.mjs <page.html> [--out <폴더>]
// Playwright가 필요하다(없으면 설치 방법을 알려 주고 끝난다):
//   npm i -D playwright && npx playwright install chromium
// 실행 위치(현재 폴더)의 node_modules에서 playwright를 찾는다.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2), file = args.find((a) => !a.startsWith('--'));
const oi = args.indexOf('--out'), out = oi >= 0 ? args[oi + 1] : path.dirname(path.resolve(file || '.'));
if (!file) { console.error('사용법: node scripts/snapshot.mjs <page.html> [--out <폴더>]'); process.exit(2); }
let chromium;
try { ({ chromium } = createRequire(path.join(process.cwd(), 'x.js'))('playwright')); }
catch { console.error('playwright가 없습니다. 이 폴더에서: npm i -D playwright && npx playwright install chromium'); process.exit(3); }

const base = path.basename(file, '.html');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const problems = [];
for (const [tag, width] of [['pc', 1280], ['phone', 390]]) {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
    page.on('pageerror', (e) => problems.push(`${tag}/${scheme}: ${e.message}`));
    await page.goto(pathToFileURL(path.resolve(file)).href);
    await page.waitForTimeout(150);
    // 보이는 그림 안에서 글자가 상자·그림 밖으로 나가는지, 화면이 옆으로 넘치는지
    const r = await page.evaluate(() => {
      const out = [];
      if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`가로 넘침 ${document.documentElement.scrollWidth}px > ${innerWidth}px`);
      for (const svg of document.querySelectorAll('svg.dg')) {
        if (!svg.getBoundingClientRect().width) continue;
        const vb = svg.viewBox.baseVal;
        for (const t of svg.querySelectorAll('text')) {
          const b = t.getBBox();
          if (b.x < vb.x - 0.5 || b.y < vb.y - 0.5 || b.x + b.width > vb.x + vb.width + 0.5 || b.y + b.height > vb.y + vb.height + 0.5) out.push(`그림 밖 글자: "${t.textContent}"`);
        }
      }
      return out;
    });
    problems.push(...r.map((x) => `${tag}/${scheme}: ${x}`));
    const target = await page.$('main') || page;
    const png = path.join(out, `${base}-${tag}-${scheme}.png`);
    await target.screenshot({ path: png });
    console.log('찍음: ' + png);
    await page.close();
  }
}
await browser.close();
console.log(problems.length ? '확인할 것:\n  ' + [...new Set(problems)].join('\n  ') : '문제 없음(가로 넘침·그림 밖 글자·페이지 오류 0)');

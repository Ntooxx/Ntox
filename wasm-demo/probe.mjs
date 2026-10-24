import puppeteer from 'puppeteer-core';
import path from 'path';
import { pathToFileURL } from 'url';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({
  executablePath: edge,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu']
});
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
page.on('console', m => console.log('CONSOLE:', m.type(), m.text()));
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
const url = pathToFileURL(path.resolve('race.html')).href;
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise(r => setTimeout(r, 1500));

const status = await page.evaluate(() => document.getElementById('status').textContent);
console.log('---- STATUS ----\n' + status);

// Run the race
await page.click('#run');
console.log('clicked run, waiting for race to finish...');
try {
  await page.waitForFunction(
    () => document.getElementById('status').textContent.includes('complete') ||
          document.getElementById('status').textContent.includes('Error'),
    { timeout: 120000 }
  );
} catch (e) {
  console.log('TIMEOUT waiting for race:', e.message);
}

const results = await page.evaluate(() => {
  const g = id => document.getElementById(id)?.textContent || '';
  return {
    status: g('status'),
    prime: { js: g('p-js-t'), wasm: g('p-wasm-t'), win: g('p-win') },
    mandel: { js: g('m-js-t'), wasm: g('m-wasm-t'), win: g('m-win') },
    nbody: { js: g('n-js-t'), wasm: g('n-wasm-t'), win: g('n-win') },
    fib: { js: g('f-js-t'), wasm: g('f-wasm-t'), win: g('f-win') },
  };
});
console.log('---- RESULTS ----');
console.log(JSON.stringify(results, null, 2));

await page.screenshot({ path: 'race-shot.png', fullPage: true });
await browser.close();
console.log('screenshot saved: race-shot.png');
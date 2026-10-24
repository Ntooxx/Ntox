import puppeteer from 'puppeteer-core';
import path from 'path';
import { pathToFileURL } from 'url';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({ executablePath: edge, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
const url = pathToFileURL(path.resolve('race.html')).href;
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.click('#run');
await page.waitForFunction(
  () => document.getElementById('status').textContent.includes('complete'),
  { timeout: 120000 }
);

const check = await page.evaluate(() => {
  const out = {};
  // bar widths non-zero
  for (const id of ['p-js','p-wasm','m-js','m-wasm','n-js','n-wasm','f-js','f-wasm']) {
    out['bar_' + id] = document.getElementById(id).style.width;
  }
  // canvases have non-uniform pixels (not blank)
  const canvasCheck = cid => {
    const c = document.getElementById(cid);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] < min) min = d[i]; if (d[i] > max) max = d[i]; }
    return { min, max, range: max - min };
  };
  out.canvas_js = canvasCheck('c-js');
  out.canvas_wasm = canvasCheck('c-wasm');
  // canvases identical?
  const a = document.getElementById('c-js').getContext('2d').getImageData(0,0,640,480).data;
  const b = document.getElementById('c-wasm').getContext('2d').getImageData(0,0,640,480).data;
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i]) diff++;
  out.identical_pixel_diffs = diff;
  // horizontal overflow?
  out.body_scroll_w = document.body.scrollWidth;
  out.viewport_w = window.innerWidth;
  return out;
});
console.log(JSON.stringify(check, null, 2));
await browser.close();
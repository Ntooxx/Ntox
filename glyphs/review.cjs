const { chromium } = require('playwright-core');
const { pathToFileURL } = require('node:url');
const { join } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');

async function review() {
  const output = join(__dirname, 'previews');
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    const remoteRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); });
    await page.addInitScript(() => {
      window.previewFrames = 0;
      const requestFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => requestFrame(time => { window.previewFrames++; callback(time); });
    });
    await page.goto(pathToFileURL(join(__dirname, 'index.html')).href);
    assert.equal(await page.locator('.glyph-card').count(), 21);
    await page.waitForFunction(() => [...document.querySelectorAll('.glyph-grid img')].every(image => image.complete && image.naturalWidth > 0));
    assert.equal(await page.locator('#motion-toggle').isDisabled(), true);
    await page.screenshot({ path: join(output, 'collection.png'), fullPage: true });
    const ids = await page.locator('.glyph-card').evaluateAll(cards => cards.map(card => card.dataset.glyph));
    for (const id of ids) {
      await page.locator(`[data-glyph="${id}"]`).click();
      await page.waitForFunction(glyph => location.hash === '#' + glyph, id);
      assert.equal(await page.locator(`[data-glyph="${id}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#download-artwork').getAttribute('href'), `artwork/${id}.svg`);
      await page.locator('.studio').screenshot({ path: join(output, `${id}.png`) });
    }
    await page.locator('[data-filter="Agent identities"]').click();
    assert.equal(await page.locator('.glyph-card').count(), 4);
    await page.locator('#search').fill('research');
    assert.equal(await page.locator('.glyph-card').count(), 1);
    await page.locator('#search').fill('missing glyph');
    assert.equal(await page.locator('#empty-results').isVisible(), true);
    await page.locator('#search').fill('');
    await page.locator('[data-filter="All"]').click();
    await page.locator('[data-transition="chat"]').click();
    assert.equal(await page.locator('#selected-label').innerText(), 'Chat');
    assert.equal(await page.locator('#stage').getAttribute('data-transition'), 'complete');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#stage').scrollIntoViewIfNeeded();
    await page.locator('[data-transition="agents"]').click();
    await page.waitForTimeout(350);
    await page.locator('.studio').screenshot({ path: join(output, 'transition-midpoint.png') });
    await page.waitForFunction(() => document.querySelector('#stage').dataset.transition === 'complete');
    assert.equal(await page.locator('#selected-label').innerText(), 'Agents');
    await page.locator('#motion-toggle').click();
    await page.waitForTimeout(100);
    const pausedFrames = await page.evaluate(() => window.previewFrames);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.previewFrames), pausedFrames);
    await page.locator('#motion-toggle').click();
    await page.locator('.page-footer').scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    const hiddenFrames = await page.evaluate(() => window.previewFrames);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.previewFrames), hiddenFrames);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const viewports = [];
    for (const [width, height] of [[1440, 1000], [760, 800], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: join(output, `preview-${width}.png`) });
      viewports.push({ width, height, horizontalOverflow: false });
    }
    await page.locator('#next').focus();
    const before = await page.locator('#selected-label').innerText();
    await page.keyboard.press('Enter');
    assert.notEqual(await page.locator('#selected-label').innerText(), before);
    assert.deepEqual(errors, []);
    assert.deepEqual(remoteRequests, []);
    const fallbackPage = await browser.newPage();
    fallbackPage.on('pageerror', error => errors.push(error.message));
    await fallbackPage.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; });
    await fallbackPage.goto(pathToFileURL(join(__dirname, 'index.html')).href);
    assert.equal(await fallbackPage.locator('#stage-fallback').isVisible(), true);
    assert.equal(await fallbackPage.locator('#motion-toggle').innerText(), 'Static preview');
    await fallbackPage.locator('[data-transition="chat"]').click();
    assert.equal(await fallbackPage.locator('#stage-fallback').getAttribute('src'), 'artwork/chat.svg');
    assert.deepEqual(errors, []);
    await fallbackPage.close();
    const result = { glyphs: ids.length, exports: ids.length * 2, viewports, checks: ['all glyph selections', 'all artwork images decoded', 'asset links', 'filters and search', 'reduced-motion transitions', 'animated transition completion', 'pause stops frames', 'offscreen stops frames', 'keyboard selection', 'static fallback without canvas', 'no network requests'], pageErrors: errors };
    writeFileSync(join(output, 'review.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}
review().catch(error => { console.error(error); process.exitCode = 1; });

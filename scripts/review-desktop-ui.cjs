const { chromium } = require('playwright-core');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

async function run() {
  process.chdir(path.resolve(__dirname, ".."));
  fs.mkdirSync(".ntox-desktop-smoke", { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 960 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const agents = [
      { id: 'ntox-coordinator', name: 'NTOX Coordinator', role: 'Primary assistant', status: 'available', tools: ['memory', 'subagent'] },
      { id: 'run-1', name: 'Architecture researcher', role: 'Research worker', status: 'running', currentTask: 'Inspect the event pipeline and document its boundaries', tools: ['read', 'search'] },
      { id: 'run-2', name: 'Implementation analyst', role: 'Research worker', status: 'completed', currentTask: 'Compare the proposed integration approaches', tools: ['read'] },
    ];
    const records = Array.from({ length: 100 }, (_, i) => ({ id: 'm' + i, type: i % 2 ? 'semantic' : 'episodic', text: `Research note ${i}: coordination and durable memory behavior.`, source: 'review-session', createdAt: Date.now() - i * 3600000 }));
    const config = { provider: 'openrouter', model: 'openrouter/auto', temperature: .7, maxTokens: 4096, memoryEnabled: true, apiPort: 3100 };
    window.fixture = { offline: false, empty: false, tick: 0, agents };
    window.ntoxDesktop = {
      request: async ({ route }) => {
        if (window.fixture.offline) throw new Error('Runtime connection unavailable');
        const data = {
          '/api/desktop/bootstrap': { runtime: { status: 'operational', uptimeSeconds: 5000 + window.fixture.tick++, cpuCount: 16, memoryTotalBytes: 34359738368, memoryFreeBytes: 17179869184 + window.fixture.tick * 100000000 }, config },
          '/api/agents': { agents: window.fixture.empty ? [] : window.fixture.agents },
          '/api/tasks': { workflows: [], tasks: window.fixture.empty ? [] : [{ id: 'task-1', workflowId: 'review-workflow', runId: 'run-1', title: 'Inspect the event pipeline', status: 'running' }] },
          '/api/memory?limit=100': { records: window.fixture.empty ? [] : records, total: window.fixture.empty ? 0 : 100, stats: {} },
          '/api/memory/graph': { nodes: [], links: [], total: 100 },
          '/api/tools': { tools: [{ name: 'read', description: 'Read files inside the configured workspace.', category: 'Filesystem', enabled: true }] },
          '/api/evaluations': { suites: [], runs: [] },
          '/api/settings': { settings: config, providers: [{ id: 'openrouter', name: 'OpenRouter', apiKeyRequired: true }], credentials: [] },
        };
        return structuredClone(data[route] || {});
      },
      getSecretStoreStatus: async () => ({ encrypted: true }),
      loadConversations: async () => [{ id: 'review-long', title: 'An intentionally long conversation title that must truncate without displacing the Context and Clear controls '.repeat(3), updatedAt: Date.now(), messages: [{ role: 'assistant', content: 'This is a fixture conversation for the interface review.' }] }],
      saveConversations: async () => {},
      onChatEvent: () => {},
      sendMessage: async () => 'Fixture response',
      cancelMessage: async () => {},
    };
  });
  await page.goto(pathToFileURL(path.resolve('desktop/index.html')).href);
  await page.locator('#ntox-console[data-runtime-state=connected]').waitFor();
  await page.screenshot({ path: '.ntox-desktop-smoke/final-intro.png' });
  await page.locator('[data-launch-dashboard]').click();
  assert.equal(await page.locator('.nav-item.active').getAttribute('data-page'), 'Agents');
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H1');
  await page.screenshot({ path: '.ntox-desktop-smoke/final-agents.png', fullPage: true });
  await page.locator('#agent-search').fill('no-such-agent');
  assert.match(await page.locator('#agent-rows').innerText(), /No agents match/);
  await page.locator('#agent-search').fill('');
  await page.locator('[data-page=Overview]').click();
  await page.evaluate(() => { window.overviewElement = document.querySelector('.overview-grid'); document.querySelector('[data-go=Agents]').focus(); });
  await page.waitForTimeout(5500);
  assert.equal(await page.evaluate(() => window.overviewElement === document.querySelector('.overview-grid')), true);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.go), 'Agents');
  await page.screenshot({ path: '.ntox-desktop-smoke/final-overview.png', fullPage: true });
  await page.locator('[data-page=Tasks]').click();
  await page.locator('#workflow-goal').fill('An unsaved workflow goal');
  await page.locator('#workflow-subtasks').fill('First unsaved subtask');
  await page.evaluate(() => { window.fixture.agents[1].currentTask = 'Updated runtime task'; });
  await page.waitForTimeout(5500);
  assert.equal(await page.locator('#workflow-goal').inputValue(), 'An unsaved workflow goal');
  assert.equal(await page.locator('#workflow-subtasks').inputValue(), 'First unsaved subtask');
  await page.locator('[data-page=Memory]').click();
  assert.equal(await page.locator('[data-memory-select]').count(), 30);
  await page.locator('[data-memory-more]').click();
  assert.equal(await page.locator('[data-memory-select]').count(), 60);
  await page.locator('[data-memory-more]').click();
  await page.locator('[data-memory-more]').click();
  assert.equal(await page.locator('[data-memory-select]').count(), 100);
  await page.locator('[data-memory-select=m99]').click();
  assert.match(await page.locator('.memory-record-detail').innerText(), /Research note 99/);
  for (const destination of ['Memory', 'Tools', 'Evaluations', 'Settings']) {
    await page.locator(`[data-page=${destination}]`).click();
    await page.screenshot({ path: `.ntox-desktop-smoke/final-${destination.toLowerCase()}.png`, fullPage: true });
  }
  await page.locator('[data-open-chat]').click();
  assert.equal(await page.locator('#desktop-message-input').evaluate(element => element === document.activeElement), true);
  await page.locator('[data-conversation=review-long]').click();
  const viewports = [];
  for (const [width, height] of [[1500, 960], [1280, 800], [760, 640]]) {
    await page.setViewportSize({ width, height });
    const context = await page.locator('#desktop-context-toggle').boundingBox();
    const clear = await page.locator('#desktop-clear-chat').boundingBox();
    assert.ok(context.x + context.width <= clear.x);
    assert.ok(clear.x + clear.width <= width);
    assert.ok(context.height >= 36 && clear.height >= 36);
    const note = await page.locator('.desktop-chat-note').boundingBox();
    assert.ok(note.y + note.height <= height);
    assert.ok(await page.locator('#desktop-new-chat').isVisible());
    await page.screenshot({ path: `.ntox-desktop-smoke/final-chat-${width}x${height}.png` });
    viewports.push({ width, height, context, clear, note });
  }
  await page.locator('#desktop-context-toggle').click();
  assert.equal(await page.locator('#desktop-context').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#desktop-context').isVisible(), false);
  assert.equal(await page.locator('#desktop-context-toggle').getAttribute('aria-expanded'), 'false');
  await page.locator('#desktop-context-toggle').click();
  await page.locator('[data-context-destination=Agents]').click();
  assert.equal(await page.locator('.nav-item.active').getAttribute('data-page'), 'Agents');
  await page.screenshot({ path: '.ntox-desktop-smoke/final-agents-760x640.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const destination of ['Overview', 'Tasks', 'Memory', 'Tools', 'Evaluations', 'Settings']) {
    await page.locator('.console-mobile-menu').click();
    await page.locator(`[data-page=${destination}]`).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${destination} overflows at minimum width`);
    await page.screenshot({ path: `.ntox-desktop-smoke/final-${destination.toLowerCase()}-760x640.png`, fullPage: true });
  }
  await page.locator('.console-brand').click();
  await page.locator('[data-launch-chat]').click();
  await page.locator('[data-back-console]').click();
  assert.equal(await page.locator('.nav-item.active').getAttribute('data-page'), 'Agents');
  await page.setViewportSize({ width: 1500, height: 960 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await page.locator('.system-state>i').evaluate(element => getComputedStyle(element).animationName), 'live-breathe');
  await page.evaluate(() => { window.fixture.offline = true; });
  await page.waitForTimeout(5500);
  await page.locator('.connection-banner.warning').waitFor();
  assert.equal(await page.locator('.system-state>i').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.screenshot({ path: '.ntox-desktop-smoke/final-offline.png', fullPage: true });
  await page.evaluate(() => { window.fixture.offline = false; window.fixture.empty = true; });
  await page.locator('[data-retry]').click();
  await page.locator('.connection-banner.warning').waitFor({ state: 'detached' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: '.ntox-desktop-smoke/final-empty.png', fullPage: true });
  assert.equal(await page.locator('.system-state>i').evaluate(element => getComputedStyle(element).animationName), 'none');
  assert.deepEqual(errors, []);
  const result = { data: 'Controlled fixtures; no real provider calls or user-data mutations', checks: ['navigation and focus', 'search empty state', 'poll preserves Overview DOM and focus', 'poll preserves workflow drafts', '100 memory records reachable', 'chat context Escape and destination', 'long titles and minimum targets', 'offline and retry recovery', 'reduced motion'], viewports, pageErrors: errors };
  fs.writeFileSync('.ntox-desktop-smoke/ui-review-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
run().catch(error => { console.error(error); process.exit(1); });

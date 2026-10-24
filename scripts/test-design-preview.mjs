// Preview QA only. Never confirms a design selection on behalf of the user.
import assert from 'node:assert/strict';
import electron from 'electron';
import { _electron as playwright } from 'playwright-core';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const url = new URL(process.argv[2]);
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Pass a local preview URL.');
const profile = await mkdtemp(join(tmpdir(), 'huawei-preview-'));
let app;
try {
  const main = join(profile, 'main.cjs');
  await writeFile(main, `const { app, BrowserWindow } = require('electron');
    app.setPath('userData', ${JSON.stringify(join(profile, 'data'))});
    app.whenReady().then(() => {
      const window = new BrowserWindow({ width: 1440, height: 1100, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.loadURL(${JSON.stringify(url.href)});
    });
    app.on('window-all-closed', () => app.quit());`);
  app = await playwright.launch({ executablePath: electron, args: ['--no-sandbox', main] });
  const page = await app.firstWindow();
  await page.locator('.qmdp-frame').waitFor();
  assert.equal(await page.locator('.option').count(), 4);
  assert.equal(await page.locator('.qmdp-pick-button').count(), 4, 'duplicated selection controls');
  for (const viewport of [{ width: 1440, height: 1100 }, { width: 390, height: 844 }]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), viewport);
    await page.waitForTimeout(150);
    const geometry = await page.evaluate(() => ({ noOverflow: document.documentElement.scrollWidth <= innerWidth,
      stagesFit: [...document.querySelectorAll('.mock')].every(mock => {
        const outer = mock.getBoundingClientRect(); const inner = mock.querySelector('.stage').getBoundingClientRect();
        return Math.abs(outer.width - inner.width) < 2 && Math.abs(outer.height - inner.height) < 2;
      }) }));
    assert.deepEqual(geometry, { noOverflow: true, stagesFit: true });
    await mkdir(resolve('release/qa'), { recursive: true });
    await page.screenshot({ path: resolve(`release/qa/design-preview-${viewport.width}.png`), fullPage: true });
  }
  await page.locator('[data-qmdp-dial="density"]').fill('8');
  assert.equal(await page.locator('[data-qmdp-output="density"]').innerText(), '8');
  await page.getByRole('button', { name: '选择 A · 日光馆藏', exact: true }).click();
  await page.locator('.qmdp-confirm.open').waitFor();
  assert.match(await page.locator('[data-qmdp-confirm-meta]').innerText(), /信息密度 8/);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.locator('.qmdp-confirm.open').count(), 0);
  const result = await page.request.get(new URL('/api/selection', url).href);
  assert.equal((await result.json()).selection, null, 'QA must not select a direction');
  console.log('Preview QA passed: 4 directions, desktop/mobile layout, one selection button per option, live dials and cancellable confirmation. No design selected.');
} finally { if (app) await app.close(); await rm(profile, { recursive: true, force: true }); }

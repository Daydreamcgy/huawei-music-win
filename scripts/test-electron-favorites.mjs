// 965 synthetic favorites through the actual renderer. No personal account access.
import assert from 'node:assert/strict';
import electron from 'electron';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as playwright } from 'playwright-core';

const profile = await mkdtemp(join(tmpdir(), 'huawei-favorites-'));
let app;
try {
  app = await playwright.launch({ executablePath: electron,
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), `--user-data-dir=${profile}`, 'out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '打开官方登录' }).waitFor();
  await app.evaluate(({ ipcMain }) => {
    const tracks = Array.from({ length: 965 }, (_, index) => ({ id: `synthetic-${index}`, title: `测试收藏 ${String(index + 1).padStart(4, '0')}`,
      artists: [{ name: '合成测试数据' }], durationSeconds: 180 + index % 90, available: true }));
    const state = globalThis.__favoritesTest = { starts: [], inflight: 0, maxInflight: 0, fail100: true, summaryFails: true, resolved: [], favoritesWrites: 0 };
    const ok = data => ({ ok: true, data });
    for (const channel of ['auth:status', 'music:favorites', 'music:favorites-summary', 'music:resolve-playback']) ipcMain.removeHandler(channel);
    ipcMain.handle('auth:status', () => ok({ authenticated: true, persistence: 'memory-only' }));
    ipcMain.handle('music:favorites', async (_event, input) => {
      state.starts.push(input.start); state.inflight++; state.maxInflight = Math.max(state.maxInflight, state.inflight);
      await new Promise(resolve => setTimeout(resolve, 70));
      state.inflight--;
      if (input.start === 100 && state.fail100) return { ok: false, error: { kind: 'network', message: '合成断网：重试加载收藏', retryable: true } };
      const page = tracks.slice(input.start, input.start + input.limit);
      return ok({ tracks: page, nextStart: input.start + input.limit, hasMore: page.length === input.limit });
    });
    ipcMain.handle('music:favorites-summary', () => state.summaryFails
      ? { ok: false, error: { kind: 'network', message: '合成统计失败', retryable: true } } : ok({ total: tracks.length }));
    ipcMain.handle('music:resolve-playback', (_event, input) => { state.resolved.push(input.trackId); return { ok: false, error: { kind: 'unsupported', message: '合成数据：仅验证收藏分页与队列，不提供实际音源。', retryable: false } }; });
  });
  await page.reload();
  await page.getByText('已加载 50 首', { exact: true }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: '总数统计失败，重试' }).waitFor();
  assert.equal(await page.getByText('共 50 首收藏', { exact: true }).count(), 0, 'a page count was falsely presented as the total');
  await app.evaluate(() => { globalThis.__favoritesTest.summaryFails = false; });
  await page.getByRole('button', { name: '总数统计失败，重试' }).click();
  await page.getByText('共 965 首收藏', { exact: true }).waitFor();
  assert.equal(await page.locator('.favorites-library .track-row').count(), 50, 'counting rendered every row eagerly');
  await mkdir(join(process.cwd(), 'release', 'qa'), { recursive: true });
  await page.screenshot({ path: join(process.cwd(), 'release', 'qa', 'linux-favorites-965-first-page.png') });

  // Near-end scrolling loads one page; duplicate observer notifications must coalesce.
  await page.locator('.main-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.getByText('已加载 100 首', { exact: true }).waitFor();
  await page.locator('.main-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.getByRole('alert').getByText('合成断网：重试加载收藏', { exact: true }).waitFor();
  assert.equal(await page.locator('.favorites-library .track-row').count(), 100, 'a failed page cleared already loaded favorites');
  await page.waitForTimeout(400);
  const failuresBeforeRetry = await app.evaluate(() => globalThis.__favoritesTest.starts.filter(start => start === 100).length);
  assert.equal(failuresBeforeRetry, 1, 'auto-loading repeatedly retried a failed page');
  await app.evaluate(() => { globalThis.__favoritesTest.fail100 = false; });
  await page.getByRole('button', { name: '重试加载收藏' }).click();
  await page.getByText('已加载 150 首', { exact: true }).waitFor();
  const beforeNavigation = await page.locator('.main-content').evaluate(element => { element.scrollTop = 2800; return element.scrollTop; });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByText(/当前版本/).waitFor();
  await page.getByRole('button', { name: '我的收藏', exact: true }).click();
  await page.getByText('已加载 150 首', { exact: true }).waitFor();
  const restored = await page.locator('.main-content').evaluate(element => element.scrollTop);
  assert.ok(Math.abs(restored - beforeNavigation) < 3, `scroll position was not restored (${beforeNavigation} -> ${restored})`);
  const starts = await app.evaluate(() => globalThis.__favoritesTest.starts.slice());
  assert.deepEqual(starts, [0, 50, 100, 100], 'returning to favorites restarted pagination');

  // "Play all" obtains every remaining page first; the eventual queue must contain all 965.
  await page.locator('.main-content').evaluate(element => { element.scrollTop = 0; });
  await page.getByRole('button', { name: '播放全部', exact: true }).click();
  await page.getByRole('button', { name: '播放队列' }).waitFor({ timeout: 15000 });
  await page.getByText('已加载 965 首', { exact: true }).waitFor();
  await page.getByText('已加载全部收藏', { exact: true }).waitFor();
  await page.getByRole('button', { name: '播放队列' }).click();
  assert.equal(await page.locator('.queue-item').count(), 965, 'play all silently truncated to an initial page');
  await page.waitForTimeout(2000);
  const saved = JSON.parse(await readFile(join(profile, 'queue.json'), 'utf8'));
  assert.equal(saved.data.tracks.length, 965, 'on-disk queue truncated the library to 500');
  assert.equal(JSON.stringify(saved).includes('blob:'), false, 'queue persisted a playback URL');
  const state = await app.evaluate(() => ({ starts: globalThis.__favoritesTest.starts, maxInflight: globalThis.__favoritesTest.maxInflight }));
  assert.equal(state.maxInflight, 1, 'overlapping auto-load requests');
  assert.equal(state.starts.at(-1), 950);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.main-content').evaluate(element => { element.scrollTop = 0; });
  const qa = join(process.cwd(), 'release', 'qa');
  await mkdir(qa, { recursive: true });
  await page.screenshot({ path: join(qa, 'linux-favorites-965-synthetic.png') });
  console.log('Electron favorites regression passed: 965 SYNTHETIC rows, exact total separate from loaded count, scroll loading, failed-page stop/retry, no duplicate requests, navigation+scroll retention, play-all queue contains all 965. No real account accessed.');
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(profile, { recursive: true, force: true });
}

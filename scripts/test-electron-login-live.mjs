// Opt-in real account verification. Separate from the offline callback regression.
// Never imports research credentials, prints URLs with queries, or screenshots a personal library.
import electron from 'electron';
import { mkdtemp, mkdir, chmod, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as playwright } from 'playwright-core';

if (!process.argv.includes('--login')) {
  console.log('本人扫码复验：node scripts/test-electron-login-live.mjs --login [--qr] [--full-library]\n使用新的隔离 profile；--qr 保存临时二维码，不截取登录后的音乐库；--full-library 验证总数、完整分页及滚动加载，只输出数量。');
  process.exit(0);
}

process.umask(0o077);
const profile = await mkdtemp(join(tmpdir(), 'huawei-login-live-'));
const output = resolve('.local/login-live');
await mkdir(output, { recursive: true, mode: 0o700 });
await chmod(output, 0o700);
const run = new Date().toISOString().replace(/[:.]/g, '-');
const qrPath = join(output, `${run}-qr.png`);
let app, mainWindow, loginWindow;
let qrReceived = false, qrWritten = false, stage = 'launch';
let interrupted = false;
const interrupt = () => { interrupted = true; };
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

try {
  app = await playwright.launch({
    executablePath: electron,
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), `--user-data-dir=${profile}`, 'out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  });
  mainWindow = await app.firstWindow();
  // Install redacted observers in the test process only. Production security policy is unchanged.
  await app.evaluate(({ app }) => {
    globalThis.__redactedLoginTrace = [];
    const record = (event, target) => {
      try {
        const url = new URL(target);
        const entry = url.protocol === 'hms:'
          ? { event, kind: 'custom-scheme-callback' }
          : { event, origin: url.origin, path: url.pathname };
        const rows = globalThis.__redactedLoginTrace;
        if (rows.length < 100 && JSON.stringify(rows.at(-1)) !== JSON.stringify(entry)) rows.push(entry);
      } catch { /* Do not log malformed targets. */ }
    };
    // The official page now lives in a WebContentsView inside the main window, so watch
    // web-contents-created instead of browser-window-created.
    app.on('web-contents-created', (_event, contents) => {
      if (contents.getLastWebPreferences?.().preload) return;
      for (const event of ['will-navigate', 'will-redirect', 'did-navigate']) {
        contents.on(event, (_event, url) => record(event, url));
      }
      contents.debugger.on('message', (_event, method, params) => {
        if (method === 'Page.frameRequestedNavigation' || method === 'Page.frameScheduledNavigation') record(method, params.url);
      });
    });
  });
  // Playwright exposes the embedded view as a page; resolve it by URL and hook the QR response once.
  function attachLoginPage() {
    const candidate = app.windows().find(page => page !== mainWindow);
    if (!candidate || candidate === loginWindow) return loginWindow;
    loginWindow = candidate;
    candidate.on('response', response => {
      const url = new URL(response.url());
      if (url.hostname === 'id1.cloud.huawei.com' && url.pathname === '/DimensionalCode/getqrInfo' && response.ok()) qrReceived = true;
    });
    return loginWindow;
  }
  stage = 'open-official-login';
  await mainWindow.getByRole('button', { name: '扫码登录' }).click();
  console.log('请在华为官方页面扫码确认；服务器模式下等待 QR_READY 图片。本轮会验证真实回调、音乐会话和收藏读取，不修改音乐库。');
  const deadline = Date.now() + 10 * 60_000;
  let complete = false;
  while (!complete && Date.now() < deadline && !interrupted) {
    await mainWindow.waitForTimeout(500);
    attachLoginPage();
    if (process.argv.includes('--qr') && qrReceived && !qrWritten && loginWindow && !loginWindow.isClosed()) {
      const url = new URL(loginWindow.url());
      if (url.hostname === 'id1.cloud.huawei.com' && url.pathname === '/CAS/portal/loginAuth.html') {
        await loginWindow.screenshot({ path: qrPath, fullPage: true });
        await chmod(qrPath, 0o600);
        qrWritten = true;
        console.log(`QR_READY ${qrPath}`);
      }
    }
    stage = 'waiting-for-real-authorization';
    const state = await mainWindow.evaluate(async () => {
      const status = await window.desktop.auth.status();
      return { authenticated: status.ok && status.data.authenticated,
        persistence: status.ok ? status.data.persistence : null,
        canLogin: !!Array.from(document.querySelectorAll('button')).find(b => b.textContent === '扫码登录' && !b.disabled) };
    });
    if (state.authenticated) {
      stage = 'read-only-favorites-check';
      const favorites = await mainWindow.evaluate(async () => {
        const result = await window.desktop.music.favorites();
        return { success: result.ok, count: result.ok ? result.data.tracks.length : null, hasMore: result.ok ? result.data.hasMore : null };
      });
      let library;
      if (process.argv.includes('--full-library') && favorites.success) {
        stage = 'full-library-read-only-check';
        library = await mainWindow.evaluate(async () => {
          const summary = await window.desktop.music.favoritesSummary();
          if (!summary.ok) return { success: false, outcome: 'total-not-confirmed' };
          const ids = new Set();
          let start = 0;
          let pages = 0;
          let done = false;
          while (!done && pages < 2000) {
            const result = await window.desktop.music.favorites({ start, limit: 50 });
            if (!result.ok) return { success: false, outcome: 'page-read-failed', pages };
            const before = ids.size;
            for (const track of result.data.tracks) ids.add(track.id);
            pages++;
            done = !result.data.hasMore;
            if (!done && (ids.size === before || result.data.nextStart <= start)) return { success: false, outcome: 'pagination-stalled', pages };
            start = result.data.nextStart;
          }
          return { success: done && ids.size === summary.data.total, total: summary.data.total, readableTracks: ids.size, pages, completed: done };
        });
        if (library.success && favorites.hasMore) {
          await mainWindow.locator('.main-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
          let autoLoaded = false;
          for (let attempt = 0; attempt < 100 && !autoLoaded; attempt++) {
            autoLoaded = await mainWindow.locator('.favorites-library .track-row').count() > favorites.count;
            if (!autoLoaded) await mainWindow.waitForTimeout(100);
          }
          library.scrollAutoLoadedNextPage = autoLoaded;
          library.success = library.success && autoLoaded;
        }
      }
      const trace = await app.evaluate(() => globalThis.__redactedLoginTrace);
      const result = { realAccountAuthorization: true, authenticated: true, persistence: state.persistence,
        favorites, ...(library ? { library } : {}), trace };
      await writeFile(join(output, `${run}-result.json`), JSON.stringify(result, null, 2), { mode: 0o600 });
      console.log(JSON.stringify(result));
      if (!favorites.success || (library && !library.success)) process.exitCode = 1;
      complete = true;
    } else if (state.canLogin) {
      const trace = await app.evaluate(() => globalThis.__redactedLoginTrace);
      console.log(JSON.stringify({ realAccountAuthorization: false, authenticated: false, outcome: 'cancelled-or-failed', trace }));
      process.exitCode = 1;
      complete = true;
    }
  }
  if (!complete) {
    const trace = await app.evaluate(() => globalThis.__redactedLoginTrace).catch(() => []);
    console.log(JSON.stringify({ authenticated: false, outcome: interrupted ? 'interrupted' : 'timeout', trace }));
    process.exitCode = 1;
  }
} catch {
  console.error(JSON.stringify({ authenticated: false, stage, outcome: 'verification-failed-no-sensitive-details-logged' }));
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(profile, { recursive: true, force: true });
  if (qrWritten) await rm(qrPath, { force: true });
  console.log(JSON.stringify({ event: 'live-verification-cleanup', temporaryProfileRemoved: true, qrRemoved: qrWritten }));
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}

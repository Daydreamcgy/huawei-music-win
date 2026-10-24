import assert from 'node:assert/strict';
import electron from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as playwright } from 'playwright-core';
import { isAllowedLoginUrl } from '../src/auth.mjs';
import { APP_DISPLAY_NAME } from '../src/shared/app-name.mjs';

const userData = await mkdtemp(join(tmpdir(), 'huawei-login-cancel-'));
let app;

async function openLoginWindow(mainWindow) {
  await mainWindow.getByRole('button', { name: '扫码登录' }).click();
  let loginWindow;
  for (let attempt = 0; attempt < 60 && !loginWindow; attempt++) {
    loginWindow = app.windows().find(window => window !== mainWindow);
    if (!loginWindow) await mainWindow.waitForTimeout(250);
  }
  assert.ok(loginWindow, 'production login flow did not open its isolated window');
  // The authorize document redirects again after its first DOMContentLoaded. Wait for the
  // actual CAS page before cancellation/callback probes, otherwise that redirect discards them.
  await loginWindow.waitForURL(url => url.hostname === 'id1.cloud.huawei.com', { waitUntil: 'domcontentloaded', timeout: 25000 });
  await mainWindow.getByRole('status').getByText(/请在官方页面完成扫码和授权/).waitFor({ timeout: 10000 });
  const host = new URL(loginWindow.url()).hostname;
  assert.equal(isAllowedLoginUrl(loginWindow.url()), true, `unexpected login origin: ${host}`);
  // The whole point of the embedded host: the official page must not create a second OS window.
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1,
    'login opened an extra OS window');
  await mainWindow.getByRole('button', { name: '取消登录' }).waitFor({ timeout: 5000 });
  return { loginWindow, host };
}

async function cancelLogin(mainWindow) {
  await mainWindow.getByRole('button', { name: '取消登录' }).click();
}

async function closeAndCheckCancellation(mainWindow) {
  await cancelLogin(mainWindow);
  await mainWindow.getByRole('status').getByText(/用户取消登录/, { exact: false }).waitFor({ timeout: 5000 });
  assert.equal(app.windows().length, 1, 'embedded login view remained after cancellation');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.equal(await mainWindow.title(), APP_DISPLAY_NAME);
  assert.equal(await mainWindow.getByRole('button', { name: '扫码登录' }).isEnabled(), true);
  assert.equal(await mainWindow.getByRole('button', { name: '取消登录' }).count(), 0, 'cancel bar stayed after cancellation');
}

async function closeAndCheckStorageFailure(mainWindow) {
  await cancelLogin(mainWindow);
  await mainWindow.getByRole('status').getByText(/无法清理临时登录会话/, { exact: false }).waitFor({ timeout: 5000 });
  assert.equal(app.windows().length, 1, 'login window remained after storage cleanup failure');
  assert.equal(await mainWindow.getByRole('button', { name: '扫码登录' }).isEnabled(), true);
  assert.equal(await mainWindow.getByRole('button', { name: '退出' }).count(), 0, 'failed login was presented as authenticated');
}

async function checkInitializationFailure(mainWindow) {
  await mainWindow.getByRole('status').getByText(/synthetic-handler-install-failure/, { exact: false }).waitFor({ timeout: 5000 });
  assert.equal(app.windows().length, 1, 'partial login view remained after handler setup failure');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.equal(await mainWindow.getByRole('button', { name: '扫码登录' }).isEnabled(), true);
  assert.equal(await mainWindow.getByRole('button', { name: '退出' }).count(), 0, 'handler setup failure was presented as authenticated');
}

async function submitInvalidState(mainWindow, loginWindow) {
  // Use an actual user gesture; Chromium can suppress scripted external-protocol navigation.
  // This only adds a synthetic link to the test window, never settles the production callback.
  await loginWindow.evaluate(() => {
    const link = document.createElement('a');
    link.id = 'synthetic-state-probe';
    link.textContent = 'Offline invalid-state probe';
    link.href = 'hms://redirect_uri?code=synthetic-code&state=invalid-state';
    link.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:white;color:black';
    document.body.append(link);
  });
  await loginWindow.locator('#synthetic-state-probe').click({ noWaitAfter: true });
  await mainWindow.getByRole('status').getByText(/OAuth state 不匹配/).waitFor({ timeout: 8000 });
  assert.equal(app.windows().length, 1, 'login window remained after rejecting an invalid callback');
  assert.equal(await mainWindow.getByRole('button', { name: '扫码登录' }).isEnabled(), true);
}

async function instrumentLoginSessionCleanup() {
  await app.evaluate(({ session }) => {
    const original = session.fromPartition.bind(session);
    globalThis.__loginSessionCleanupCount = 0;
    globalThis.__loginSessionCleanupAttempts = 0;
    globalThis.__failNextLoginSessionCleanup = false;
    globalThis.__failNextPermissionCheckHandlerInstall = false;
    session.fromPartition = (...args) => {
      const isolated = original(...args);
      const clearStorageData = isolated.clearStorageData.bind(isolated);
      const setPermissionCheckHandler = isolated.setPermissionCheckHandler.bind(isolated);
      isolated.setPermissionCheckHandler = handler => {
        if (handler && globalThis.__failNextPermissionCheckHandlerInstall) {
          globalThis.__failNextPermissionCheckHandlerInstall = false;
          throw new Error('synthetic-handler-install-failure');
        }
        return setPermissionCheckHandler(handler);
      };
      isolated.clearStorageData = async (...clearArgs) => {
        globalThis.__loginSessionCleanupAttempts++;
        if (globalThis.__failNextLoginSessionCleanup) {
          globalThis.__failNextLoginSessionCleanup = false;
          throw new Error('synthetic-session-cleanup-failure');
        }
        await clearStorageData(...clearArgs);
        globalThis.__loginSessionCleanupCount++;
      };
      return isolated;
    };
  });
}

async function cleanupCount() {
  return app.evaluate(() => globalThis.__loginSessionCleanupCount);
}

async function cleanupAttempts() {
  return app.evaluate(() => globalThis.__loginSessionCleanupAttempts);
}

try {
  app = await playwright.launch({
    executablePath: electron,
    args: ['--no-sandbox', `--user-data-dir=${userData}`, 'out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  });

  const mainWindow = await app.firstWindow();
  await instrumentLoginSessionCleanup();
  const first = await openLoginWindow(mainWindow);
  await closeAndCheckCancellation(mainWindow);
  assert.equal(await cleanupCount(), 1, 'first temporary login partition was not cleared');
  const second = await openLoginWindow(mainWindow);
  await closeAndCheckCancellation(mainWindow);
  assert.equal(await cleanupCount(), 2, 'second temporary login partition was not cleared');
  const third = await openLoginWindow(mainWindow);
  await submitInvalidState(mainWindow, third.loginWindow);
  assert.equal(await cleanupCount(), 3, 'invalid callback partition was not cleared');
  await app.evaluate(() => { globalThis.__failNextLoginSessionCleanup = true; });
  const fourth = await openLoginWindow(mainWindow);
  await closeAndCheckStorageFailure(mainWindow);
  assert.equal(await cleanupAttempts(), 4, 'storage cleanup failure was not exercised');
  assert.equal(await cleanupCount(), 3, 'failed storage cleanup was counted as successful');
  await app.evaluate(() => { globalThis.__failNextPermissionCheckHandlerInstall = true; });
  await mainWindow.getByRole('button', { name: '扫码登录' }).click();
  await checkInitializationFailure(mainWindow);
  assert.equal(await cleanupAttempts(), 5, 'handler initialization failure skipped session cleanup');
  assert.equal(await cleanupCount(), 4, 'handler initialization failure did not clean its temporary partition');

  console.log(JSON.stringify({
    productionLoginFlowAttemptedFiveTimes: true,
    officialLoginOrigins: [first.host, second.host, third.host, fourth.host],
    cancellationSettledTwice: true,
    invalidCallbackRejectedBeforeTokenExchange: true,
    temporaryPartitionsCleared: await cleanupCount(),
    cleanupFailureRejectedLogin: true,
    handlerSetupFailureCleanedPartition: true,
    retriesAfterCancellation: true,
    mainWindowResponsive: true,
    accountAuthorizationAttempted: false,
  }));
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}

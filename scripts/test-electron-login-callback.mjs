// Offline regression of the production openLogin navigation policy. No personal login,
// no synthetic success, no token exchange: the terminal fixture deliberately has invalid state.
import assert from 'node:assert/strict';
import electron from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as playwright } from 'playwright-core';

const profile = await mkdtemp(join(tmpdir(), 'huawei-login-callback-'));
let app;
const serviceOrigin = 'https://oauth-login1.cloud.huawei.com';
const servicePath = '/oauth2/v3/loginCallback';

async function openFixture(mainWindow, mode) {
  await app.evaluate((_electron, mode) => { globalThis.__loginFixtureMode = mode; }, mode);
  await mainWindow.getByRole('button', { name: '扫码登录' }).click();
  let login;
  for (let i = 0; i < 100 && !login; i++) {
    login = app.windows().find(page => page !== mainWindow);
    if (!login) await mainWindow.waitForTimeout(50);
  }
  assert.ok(login, 'production login window must open');
  await login.getByRole('button', { name: 'Continue offline fixture' }).waitFor({ timeout: 10000 });
  return login;
}

try {
  app = await playwright.launch({
    executablePath: electron,
    args: ['--no-sandbox', `--user-data-dir=${profile}`, 'out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  });
  const mainWindow = await app.firstWindow();
  await app.evaluate(({ session }) => {
    const originalFromPartition = session.fromPartition.bind(session);
    const records = globalThis.__loginFixtureRecords = [];
    const installed = new WeakSet();
    session.fromPartition = (...args) => {
      const isolated = originalFromPartition(...args);
      if (!String(args[0]).startsWith('login-') || installed.has(isolated)) return isolated;
      installed.add(isolated);
      const record = { mode: globalThis.__loginFixtureMode, requests: [], serviceReached: false,
        bindingsPreserved: false, callbackRequested: false, cleaned: false };
      records.push(record);
      let authorize;
      const html = content => new Response(content, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      const pageWithNavigation = (target, button) => html(`<meta charset="utf-8">${button
        ? '<button id="go">Continue offline fixture</button>' : '<p>Offline service callback fixture</p>'}
        <script>${button ? 'document.getElementById("go").onclick = () => ' : ''}{location.href = ${JSON.stringify(target)};}</script>`);
      // Handle only this test's ephemeral login partition. Production code has no fixture switch.
      // Using HTTPS scheme handlers avoids networking and certificate bypass flags entirely.
      isolated.protocol.handle('https', request => {
        const url = new URL(request.url);
        record.requests.push({ origin: url.origin, path: url.pathname });
        if (url.origin === 'https://oauth-login.platform.hicloud.com' && url.pathname === '/oauth2/v3/authorize') {
          authorize = url;
          const service = new URL('https://oauth-login1.cloud.huawei.com/oauth2/v3/loginCallback');
          for (const key of ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method']) {
            service.searchParams.set(key, url.searchParams.get(key));
          }
          service.searchParams.set('ticket', 'synthetic-cas-ticket');
          const cas = new URL('https://id1.cloud.huawei.com/CAS/portal/loginAuth.html');
          cas.searchParams.set('service', service.href);
          return new Response(null, { status: 302, headers: { Location: cas.href } });
        }
        if (url.origin === 'https://id1.cloud.huawei.com' && url.pathname === '/CAS/portal/loginAuth.html') {
          const service = new URL(url.searchParams.get('service'));
          if (record.mode === 'unknown-service') service.hostname = 'oauth-login1.cloud.huawei.com.attacker.invalid';
          if (record.mode === 'unknown-path') service.pathname = '/not-an-oauth-callback';
          const target = record.mode === 'http-redirect'
            ? `https://id1.cloud.huawei.com/CAS/fixture-hop?service=${encodeURIComponent(service.href)}` : service.href;
          return pageWithNavigation(target, true);
        }
        if (url.origin === 'https://id1.cloud.huawei.com' && url.pathname === '/CAS/fixture-hop') {
          return new Response(null, { status: 302, headers: { Location: url.searchParams.get('service') } });
        }
        if (url.origin === 'https://oauth-login1.cloud.huawei.com' && url.pathname === '/oauth2/v3/loginCallback') {
          record.serviceReached = true;
          record.bindingsPreserved = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method']
            .every(key => url.searchParams.get(key) === authorize.searchParams.get(key));
          const callback = new URL(authorize.searchParams.get('redirect_uri'));
          callback.searchParams.set('code', 'synthetic-invalid-state-code');
          callback.searchParams.set('state', 'intentionally-wrong-state');
          record.callbackRequested = true;
          return pageWithNavigation(callback.href, false);
        }
        return new Response('Unexpected fixture request', { status: 403 });
      });
      const originalClear = isolated.clearStorageData.bind(isolated);
      isolated.clearStorageData = async (...clearArgs) => {
        await originalClear(...clearArgs);
        record.cleaned = true;
        isolated.protocol.unhandle('https');
      };
      return isolated;
    };
  });

  for (const mode of ['script-navigation', 'http-redirect']) {
    const login = await openFixture(mainWindow, mode);
    const isolation = await login.evaluate(() => ({ process: typeof process, require: typeof require, desktop: typeof window.desktop }));
    assert.deepEqual(isolation, { process: 'undefined', require: 'undefined', desktop: 'undefined' });
    await login.getByRole('button', { name: 'Continue offline fixture' }).click({ noWaitAfter: true });
    await mainWindow.getByRole('status').getByText(/OAuth state 不匹配/).waitFor({ timeout: 6000 }).catch(async () => {
      const record = await app.evaluate(() => globalThis.__loginFixtureRecords.at(-1));
      const current = app.windows().includes(login) ? new URL(login.url()) : null;
      assert.fail(JSON.stringify({ mode, serviceReached: record.serviceReached, bindingsPreserved: record.bindingsPreserved,
        callbackRequested: record.callbackRequested, stillAt: current ? current.origin + current.pathname : null }));
    });
    const record = await app.evaluate(() => globalThis.__loginFixtureRecords.at(-1));
    assert.equal(record.serviceReached, true, 'CAS must reach the real regional service host/path');
    assert.equal(record.bindingsPreserved, true, 'state/PKCE/redirect bindings must survive intermediate navigation');
    assert.equal(record.callbackRequested, true);
    assert.equal(record.cleaned, true);
    assert.equal(record.requests.some(r => r.path.includes('/token')), false, 'invalid state must never reach token exchange');
    assert.equal(app.windows().length, 1);
    const status = await mainWindow.evaluate(() => window.desktop.auth.status());
    assert.equal(status.data.authenticated, false, 'a navigation fixture is not a successful login');
    console.log(JSON.stringify({ mode, serviceOrigin, servicePath, intermediateReached: true,
      stateAndPkcePreserved: true, invalidStateRejected: true, authenticated: false, temporarySessionCleaned: true }));
  }
  for (const mode of ['unknown-service', 'unknown-path']) {
    const login = await openFixture(mainWindow, mode);
    await login.getByRole('button', { name: 'Continue offline fixture' }).click({ noWaitAfter: true });
    await mainWindow.waitForTimeout(300);
    assert.equal(new URL(login.url()).hostname, 'id1.cloud.huawei.com');
    const record = await app.evaluate(() => globalThis.__loginFixtureRecords.at(-1));
    assert.equal(record.requests.length, 2, 'untrusted destination must be blocked before request');
    assert.equal(record.serviceReached, false);
    await mainWindow.getByRole('button', { name: '取消登录' }).click();
    await mainWindow.getByRole('status').getByText(/用户取消登录/).waitFor({ timeout: 5000 });
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1,
      'cancelling the embedded login must not leave an OS window');
    console.log(JSON.stringify({ mode, blockedBeforeRequest: true, authenticated: false, extraWindow: false }));
  }
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(profile, { recursive: true, force: true });
}

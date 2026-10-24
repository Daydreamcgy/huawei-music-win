import { app, BrowserWindow, session } from 'electron';
import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAttempt, isAllowedLoginUrl } from '../src/auth.mjs';
import { createDevToolsCallbackObserver, createLoginCallback } from '../src/login-callback.mjs';
import { electronBypassRules, proxyConfigurationProblem, proxyRules, readProxySettings } from '../src/main/proxy.mjs';

const hosts = new Set();
const navigationEvents = new Set();
const committedHosts = new Set();
const preventedHosts = new Set();
const deniedPopupHosts = new Set();
const userData = await mkdtemp(join(tmpdir(), 'huawei-login-navigation-'));
let loginWindow;
let loginSession;
let timer;
let verificationStarted = false;
let casService;
app.setPath('userData', userData);

function observedHost(value) {
  try { return new URL(value).hostname; } catch { return undefined; }
}

function report(result) {
  console.log(JSON.stringify({
    ...result,
    casService,
    hosts: [...hosts],
    navigationEvents: [...navigationEvents],
    committedHosts: [...committedHosts],
    preventedHosts: [...preventedHosts],
    deniedPopupHosts: [...deniedPopupHosts],
    allowedHosts: [...hosts].filter(host => isAllowedLoginUrl(`https://${host}/`)),
    blockedHosts: [...hosts].filter(host => !isAllowedLoginUrl(`https://${host}/`)),
  }));
}

async function exitWithCleanup(code) {
  if (timer) clearTimeout(timer);
  if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
  if (loginSession) await loginSession.clearStorageData().catch(() => undefined);
  rmSync(userData, { recursive: true, force: true });
  app.exit(code);
}

app.whenReady().then(async () => {
  const proxyProblem = proxyConfigurationProblem();
  if (proxyProblem) throw new Error(`proxy-${proxyProblem}`);
  const proxy = readProxySettings();
  const rules = proxyRules(proxy);
  const partition = `login-trace-${Date.now()}`;
  loginSession = session.fromPartition(partition, { cache: false });
  if (rules) await loginSession.setProxy({
    mode: 'fixed_servers', proxyRules: rules, proxyBypassRules: electronBypassRules(proxy.bypass),
  });

  const attempt = createAttempt();
  // Validate the current official CAS service target BEFORE any account interaction.
  // A direct synthetic hms:// navigation alone cannot catch a blocked intermediate hop.
  const response = await loginSession.fetch('https://oauth-login.platform.hicloud.com/oauth2/ajax/getLoginWay', {
    method: 'POST', body: new URL(attempt.authorizeUrl).searchParams.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', interfaceVersion: 'v3', fromLoginAuth: 'false' },
    redirect: 'error', signal: AbortSignal.timeout(25000),
  });
  const data = await response.json();
  const casUrl = new URL(data.loginInteractInfo.cas.casLoginRedirectUrl);
  const serviceUrl = new URL(casUrl.searchParams.get('service'));
  casService = {
    origin: serviceUrl.origin, path: serviceUrl.pathname,
    allowed: isAllowedLoginUrl(serviceUrl.href),
    statePreserved: serviceUrl.searchParams.get('state') === attempt.state,
    redirectPreserved: serviceUrl.searchParams.get('redirect_uri') === attempt.redirectUri,
    pkcePreserved: serviceUrl.searchParams.get('code_challenge') === new URL(attempt.authorizeUrl).searchParams.get('code_challenge'),
  };
  if (!response.ok || !isAllowedLoginUrl(casUrl.href) || !casService.allowed
    || !casService.statePreserved || !casService.redirectPreserved || !casService.pkcePreserved) {
    throw new Error('official-cas-service-route-or-bindings-rejected');
  }

  loginWindow = new BrowserWindow({
    show: false,
    width: 460,
    height: 720,
    webPreferences: {
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  // Use the same isolated session explicitly, without adding an app preload.
  loginWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  loginWindow.webContents.session.setPermissionCheckHandler(() => false);
  loginWindow.webContents.on('will-navigate', (event, url) => {
    navigationEvents.add('will-navigate');
    const host = observedHost(url);
    if (host) hosts.add(host);
    if (!isAllowedLoginUrl(url)) {
      preventedHosts.add(host ?? 'invalid-url');
      event.preventDefault();
    }
  });
  loginWindow.webContents.on('will-redirect', (event, url) => {
    navigationEvents.add('will-redirect');
    const host = observedHost(url);
    if (host) hosts.add(host);
    if (!isAllowedLoginUrl(url)) {
      preventedHosts.add(host ?? 'invalid-url');
      event.preventDefault();
    }
  });
  loginWindow.webContents.on('did-navigate', (_event, url) => {
    const host = observedHost(url);
    if (host) committedHosts.add(host);
  });
  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    navigationEvents.add('window-open');
    const host = observedHost(url);
    if (host) hosts.add(host);
    if (!isAllowedLoginUrl(url)) deniedPopupHosts.add(host ?? 'invalid-url');
    return { action: isAllowedLoginUrl(url) ? 'allow' : 'deny' };
  });
  loginWindow.webContents.on('did-finish-load', async () => {
    if (verificationStarted) return;
    verificationStarted = true;
    try {
      const isolated = await loginWindow.webContents.executeJavaScript(`({
        process: typeof process,
        require: typeof require,
        desktopApi: typeof window.desktop,
      })`);
      if (isolated.process !== 'undefined' || isolated.require !== 'undefined' || isolated.desktopApi !== 'undefined') {
        throw new Error('login-window-isolation-failed');
      }

      const initialHost = observedHost(loginWindow.webContents.getURL());
      if (!initialHost || !isAllowedLoginUrl(loginWindow.webContents.getURL())) {
        throw new Error('login-page-not-allowlisted');
      }
      await loginWindow.webContents.executeJavaScript(`window.location.href = 'https://example.invalid/blocked-probe'`);
      await new Promise(resolve => { timer = setTimeout(resolve, 750); });
      const navigationBlocked = preventedHosts.has('example.invalid') && !committedHosts.has('example.invalid');
      const popupBlocked = await loginWindow.webContents.executeJavaScript(
        `window.open('https://example.invalid/popup-probe') === null`,
      );
      await new Promise(resolve => { timer = setTimeout(resolve, 250); });
      if (!navigationBlocked || !popupBlocked || !deniedPopupHosts.has('example.invalid')) {
        throw new Error('login-navigation-boundary-failed');
      }

      const callbackAttempt = createAttempt();
      const callbackFlow = createLoginCallback(callbackAttempt);
      const debuggerApi = loginWindow.webContents.debugger;
      const captureCallback = createDevToolsCallbackObserver(callbackFlow);
      debuggerApi.attach('1.3');
      debuggerApi.on('message', captureCallback);
      let callbackCode;
      try {
        await debuggerApi.sendCommand('Page.enable');
        const callbackTarget = `${callbackAttempt.redirectUri}?code=synthetic-code&state=${callbackAttempt.state}`;
        await loginWindow.webContents.executeJavaScript(`window.location.href = ${JSON.stringify(callbackTarget)}`);
        callbackCode = await Promise.race([
          callbackFlow.promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('synthetic-login-callback-timeout')), 5000)),
        ]);
      } finally {
        debuggerApi.off('message', captureCallback);
        if (debuggerApi.isAttached()) debuggerApi.detach();
      }
      await new Promise(resolve => { timer = setTimeout(resolve, 150); });
      const callbackStayedOnLoginPage = isAllowedLoginUrl(loginWindow.webContents.getURL());
      if (callbackCode !== 'synthetic-code' || !callbackStayedOnLoginPage) {
        throw new Error('synthetic-login-callback-boundary-failed');
      }
      report({
        loaded: true,
        finalHost: observedHost(loginWindow.webContents.getURL()),
        nodeUnavailable: isolated.process === 'undefined' && isolated.require === 'undefined',
        businessPreloadUnavailable: isolated.desktopApi === 'undefined',
        unknownNavigationBlocked: navigationBlocked,
        popupBlocked,
        syntheticCallbackAccepted: callbackCode === 'synthetic-code',
        callbackNavigationBlocked: callbackStayedOnLoginPage,
      });
      await exitWithCleanup(0);
    } catch (error) {
      report({ loaded: false, error: error instanceof Error ? error.message : 'boundary-check-failed' });
      await exitWithCleanup(1);
    }
  });
  loginWindow.webContents.on('did-fail-load', (_event, code) => {
    if (code === -3) return;
    if (timer) clearTimeout(timer);
    report({ loaded: false, errorCode: code });
    void exitWithCleanup(1);
  });
  await loginWindow.loadURL(attempt.authorizeUrl);
}).catch(error => {
  report({ loaded: false, error: error instanceof Error ? error.message : 'trace-failed' });
  void exitWithCleanup(1);
});

app.on('will-quit', () => {
  if (timer) clearTimeout(timer);
  rmSync(userData, { recursive: true, force: true });
});

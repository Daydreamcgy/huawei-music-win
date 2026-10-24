import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttempt } from '../src/auth.mjs';
import { createDevToolsCallbackObserver, createLoginCallback, loginLoadFailure, prepareLoginPage, waitForLoginPage } from '../src/login-callback.mjs';

const callbackUrl = attempt => `${attempt.redirectUri}?code=synthetic-code&state=${attempt.state}`;

test('callback settles once and ignores later close or duplicate callback events', async () => {
  const attempt = createAttempt();
  const flow = createLoginCallback(attempt);
  assert.equal(flow.accept(callbackUrl(attempt)), true);
  assert.equal(flow.settled, true);
  assert.equal(flow.reject(new Error('登录窗口已关闭')), false);
  assert.equal(flow.accept(callbackUrl(attempt)), false);
  assert.equal(await flow.promise, 'synthetic-code');
  assert.equal(attempt.consumed, true);
});

test('DevTools observer handles requested, scheduled and committed navigation without consuming the CAS service URL', async () => {
  for (const method of ['Page.frameRequestedNavigation', 'Page.frameScheduledNavigation', 'Page.frameNavigated']) {
    const attempt = createAttempt();
    const flow = createLoginCallback(attempt);
    const observe = createDevToolsCallbackObserver(flow);
    const target = callbackUrl(attempt);
    const params = url => method === 'Page.frameNavigated' ? { frame: { id: 'frame', url } } : { frameId: 'frame', url };
    const service = new URL('https://oauth-login1.cloud.huawei.com/oauth2/v3/loginCallback');
    service.searchParams.set('service', target);
    observe({}, method, params(service.href));
    observe({}, 'Network.requestWillBeSent', { request: { url: target } });
    observe({}, method, {});
    assert.equal(flow.settled, false, 'intermediate/nested/unsupported URLs are not terminal callbacks');
    observe({}, method, params(target));
    assert.equal(flow.settled, true);
    assert.equal(attempt.consumed, true);
    assert.equal(await flow.promise, 'synthetic-code');
  }
});

test('close or timeout settles once and prevents later callback consumption', async () => {
  for (const message of ['登录窗口已关闭', '登录等待超时，请重新发起']) {
    const attempt = createAttempt();
    const flow = createLoginCallback(attempt);
    const expected = new Error(message);
    assert.equal(flow.reject(expected), true);
    assert.equal(flow.reject(new Error('other terminal event')), false);
    assert.equal(flow.accept(callbackUrl(attempt)), false);
    await assert.rejects(flow.promise, error => error === expected);
    assert.equal(attempt.consumed, false);
  }
});

test('invalid state at the exact callback destination fails closed and settles the flow', async () => {
  const attempt = createAttempt();
  const flow = createLoginCallback(attempt);
  const invalidUrl = `${attempt.redirectUri}?code=synthetic-code&state=wrong`;
  assert.equal(flow.accept(invalidUrl), true);
  await assert.rejects(flow.promise, /state/);
  assert.equal(attempt.consumed, false);
  assert.equal(flow.settled, true);
  assert.equal(flow.accept(callbackUrl(attempt)), false);
});

test('loadURL failure is sanitized unless callback or cancellation already settled', async () => {
  const attempt = createAttempt();
  const flow = createLoginCallback(attempt);
  const loadFailure = loginLoadFailure(flow);
  await assert.rejects(loadFailure, error => {
    assert.equal(error.message, '无法打开华为官方登录页面，请检查网络或代理后重试。');
    assert.equal(error.message.includes(attempt.state), false);
    assert.equal(error.message.includes(attempt.authorizeUrl), false);
    return true;
  });

  const callbackAttempt = createAttempt();
  const flowWithCallback = createLoginCallback(callbackAttempt);
  flowWithCallback.accept(callbackUrl(callbackAttempt));
  assert.equal(await loginLoadFailure(flowWithCallback), 'synthetic-code');

  const closeFirst = createLoginCallback(createAttempt());
  const closed = new Error('登录窗口已关闭');
  closeFirst.reject(closed);
  await assert.rejects(loginLoadFailure(closeFirst), error => error === closed);
});

test('closing or timing out releases login while loadURL is still pending', async () => {
  for (const message of ['登录窗口已关闭', '登录等待超时，请重新发起']) {
    const flow = createLoginCallback(createAttempt());
    const result = waitForLoginPage(() => new Promise(() => {}), flow);
    const expected = new Error(message);
    flow.reject(expected);
    await assert.rejects(result, error => error === expected);
  }
});

test('callback can win while loadURL remains pending', async () => {
  const attempt = createAttempt();
  const flow = createLoginCallback(attempt);
  const result = waitForLoginPage(() => new Promise(() => {}), flow);
  flow.accept(callbackUrl(attempt));
  assert.equal(await result, 'synthetic-code');
});

test('loadURL failure returns a sanitized error without waiting for callback', async () => {
  const attempt = createAttempt();
  const flow = createLoginCallback(attempt);
  await assert.rejects(
    waitForLoginPage(() => Promise.reject(new Error(`failed URL ${attempt.authorizeUrl}`)), flow),
    error => error.message === '无法打开华为官方登录页面，请检查网络或代理后重试。'
      && !error.message.includes(attempt.state)
      && !error.message.includes(attempt.authorizeUrl),
  );
});

test('cancellation during proxy setup prevents showing or loading the login page', async () => {
  const flow = createLoginCallback(createAttempt());
  let finishConfiguration;
  const configuration = new Promise(resolve => { finishConfiguration = resolve; });
  let shown = false;
  let loaded = false;
  const page = prepareLoginPage(
    () => configuration,
    () => { shown = true; },
    async () => { loaded = true; },
    flow,
  );
  const waiting = waitForLoginPage(() => page, flow);
  const cancelled = new Error('登录窗口已关闭');
  flow.reject(cancelled);
  await assert.rejects(waiting, error => error === cancelled);
  finishConfiguration();
  await assert.rejects(page, error => error === cancelled);
  assert.equal(shown, false);
  assert.equal(loaded, false);
});

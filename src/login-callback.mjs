import { consumeCallback, isCallback } from './auth.mjs';

export function createLoginCallback(attempt) {
  let settled = false;
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    get settled() { return settled; },
    accept(url, now) {
      if (settled || !isCallback(url, attempt)) return false;
      settled = true;
      try { resolvePromise(consumeCallback(url, attempt, now)); }
      catch (error) { rejectPromise(error instanceof Error ? error : new Error('授权回调无效')); }
      return true;
    },
    reject(error) {
      if (settled) return false;
      settled = true;
      rejectPromise(error);
      return true;
    },
  };
}

export function createDevToolsCallbackObserver(callback) {
  return (_event, method, params) => {
    let url;
    if (method === 'Page.frameRequestedNavigation' || method === 'Page.frameScheduledNavigation') {
      url = params?.url;
    } else if (method === 'Page.frameNavigated') {
      url = params?.frame?.url;
    }
    if (typeof url === 'string') callback.accept(url);
  };
}

export function loginLoadFailure(callback, fallback = '无法打开华为官方登录页面，请检查网络或代理后重试。') {
  if (callback.settled) return callback.promise;
  return Promise.reject(new Error(fallback));
}

export async function waitForLoginPage(loadPage, callback) {
  const loadResult = Promise.resolve().then(loadPage).then(
    () => ({ kind: 'loaded' }),
    () => ({ kind: 'failed' }),
  );
  const callbackResult = callback.promise.then(
    code => ({ kind: 'callback', code }),
    error => ({ kind: 'callback-error', error }),
  );
  const result = await Promise.race([loadResult, callbackResult]);
  if (result.kind === 'callback') return result.code;
  if (result.kind === 'callback-error') throw result.error;
  if (result.kind === 'failed') return loginLoadFailure(callback);
  return undefined;
}

export async function prepareLoginPage(configure, show, load, callback) {
  await configure();
  if (callback.settled) return callback.promise;
  show();
  return load();
}

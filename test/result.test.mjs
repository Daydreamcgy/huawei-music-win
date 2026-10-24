import test from 'node:test';
import assert from 'node:assert/strict';
import { errorFrom } from '../src/shared/result.ts';

test('network errors remain retryable and are not treated as an expired session', () => {
  const error = errorFrom(new Error('音乐只读请求网络失败'));
  assert.equal(error.kind, 'network');
  assert.equal(error.retryable, true);
});

test('unknown provider HTTP failures do not imply authentication failure', () => {
  const error = errorFrom(new Error('音乐只读请求失败（HTTP 400）'));
  assert.equal(error.kind, 'unknown');
  assert.equal(error.retryable, true);
});

test('only an explicit missing-session error is classified as authentication', () => {
  const error = errorFrom(new Error('此操作需要音乐会话'));
  assert.equal(error.kind, 'auth');
  assert.equal(error.retryable, false);
});

test('login cancellation and timeout do not imply an expired music session', () => {
  for (const message of ['登录窗口已关闭', '登录等待超时，请重新发起', '用户取消授权或授权服务拒绝请求']) {
    const error = errorFrom(new Error(message));
    assert.equal(error.kind, 'unknown', message);
    assert.equal(error.retryable, true, message);
  }
});

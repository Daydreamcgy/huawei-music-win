import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionEpoch } from '../src/main/session-epoch.mjs';

test('a pending authenticated result becomes stale after logout or account replacement', () => {
  const epoch = createSessionEpoch();
  const requestEpoch = epoch.capture();
  assert.equal(epoch.isCurrent(requestEpoch), true);
  epoch.advance();
  assert.equal(epoch.isCurrent(requestEpoch), false);
});

test('requests remain valid while their account session is unchanged', () => {
  const epoch = createSessionEpoch();
  const requestEpoch = epoch.capture();
  assert.equal(epoch.isCurrent(requestEpoch), true);
  assert.equal(epoch.isCurrent(requestEpoch), true);
});

test('logout invalidates requests as soon as cleanup starts', () => {
  const epoch = createSessionEpoch();
  const requestEpoch = epoch.capture();
  epoch.advance();
  assert.equal(epoch.isCurrent(requestEpoch), false);
});

test('logout invalidates requests started while cleanup is pending when cleanup commits', () => {
  const epoch = createSessionEpoch();
  epoch.beginTransition();
  const requestDuringLogout = epoch.capture();
  assert.equal(epoch.isTransitioning(), true);
  assert.equal(epoch.isCurrent(requestDuringLogout), false);
  epoch.endTransition();
  assert.equal(epoch.isCurrent(requestDuringLogout), false);
});

test('login can detect and refuse to start during logout cleanup', () => {
  const epoch = createSessionEpoch();
  assert.equal(epoch.isTransitioning(), false);
  epoch.beginTransition();
  assert.equal(epoch.isTransitioning(), true);
  epoch.endTransition();
  assert.equal(epoch.isTransitioning(), false);
});

test('failed logout resumes the preserved session without reviving earlier requests', () => {
  const epoch = createSessionEpoch();
  const requestBeforeLogout = epoch.capture();
  epoch.beginTransition();
  assert.equal(epoch.isCurrent(requestBeforeLogout), false);
  epoch.endTransition();
  assert.equal(epoch.isTransitioning(), false);
  assert.equal(epoch.isCurrent(requestBeforeLogout), false);
  assert.equal(epoch.isCurrent(epoch.capture()), true);
});

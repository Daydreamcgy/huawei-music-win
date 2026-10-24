import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthManagerLifecycle } from '../src/main/auth-manager-lifecycle.mjs';

test('auth manager and restored memory session live across main window recreation', async () => {
  let constructions = 0;
  const lifecycle = createAuthManagerLifecycle(async () => {
    constructions++;
    return { session: { token: 'memory-session' } };
  });

  const [firstWindow, secondWindow] = await Promise.all([lifecycle.get(), lifecycle.get()]);
  assert.equal(firstWindow, secondWindow);
  assert.equal(secondWindow.session.token, 'memory-session');
  assert.equal(constructions, 1);
});

test('failed auth restoration can be retried without creating concurrent managers', async () => {
  let attempts = 0;
  const lifecycle = createAuthManagerLifecycle(async () => {
    attempts++;
    if (attempts === 1) throw new Error('restore failed');
    return { session: null };
  });

  await assert.rejects(lifecycle.get(), /restore failed/);
  const manager = await lifecycle.get();
  assert.equal(manager.session, null);
  assert.equal(attempts, 2);
});

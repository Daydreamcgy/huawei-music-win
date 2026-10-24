import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionSaveOutcome } from '../src/main/session-transition.mjs';

test('failed replacement preserves an existing session', () => {
  assert.equal(sessionSaveOutcome(true, false), 'preserve');
});

test('first login may remain memory-only when secure persistence is unavailable', () => {
  assert.equal(sessionSaveOutcome(false, false), 'memory-only');
});

test('persisted candidate replaces the previous session', () => {
  assert.equal(sessionSaveOutcome(true, true), 'replace');
});

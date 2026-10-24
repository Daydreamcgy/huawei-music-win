import test from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedRendererUrl } from '../src/main/renderer-origin.mjs';

const renderer = 'file:///opt/music/out/renderer/index.html';

test('only the exact local renderer document is trusted for IPC', () => {
  assert.equal(isTrustedRendererUrl(renderer, renderer), true);
  for (const value of [
    'file:///etc/passwd',
    'file:///opt/music/out/renderer/other.html',
    `${renderer}?injected=1`,
    `${renderer}?`,
    `${renderer}#untrusted`,
    `${renderer}#`,
    'https://example.invalid/index.html',
    'file://attacker/opt/music/out/renderer/index.html',
  ]) assert.equal(isTrustedRendererUrl(value, renderer), false, value);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { fontStackFor, hexToRgb, hslToHex, rgbToHsl, tintFromHex } from '../src/renderer/theme.mjs';

test('hex parsing accepts with and without the leading hash, rejects junk', () => {
  assert.deepEqual(hexToRgb('#c8202e'), [200, 32, 46]);
  assert.deepEqual(hexToRgb('c8202e'), [200, 32, 46]);
  assert.equal(hexToRgb('#c8202'), null);
  assert.equal(hexToRgb('red'), null);
  assert.equal(hexToRgb(null), null);
});

test('hsl round trip keeps a hue and always returns a valid hex colour', () => {
  const [h, s, l] = rgbToHsl([200, 32, 46]);
  assert.equal(hslToHex(h, s, l), '#c8202e');
  for (const hex of ['#000000', '#ffffff', '#15803d', '#6d28d9']) {
    assert.match(tintFromHex(hex).accent, /^#[0-9a-f]{6}$/);
  }
});

test('a custom tint derives light, deep, soft and shadow from the picked colour', () => {
  const tint = tintFromHex('#2563eb');
  assert.equal(tint.accent, '#2563eb');
  assert.notEqual(tint.light, tint.accent);
  assert.notEqual(tint.deep, tint.accent);
  assert.match(tint.soft, /^rgba\(37, 99, 235, 0\.10\)$/);
  assert.match(tint.line, /^rgba\(37, 99, 235, 0\.30\)$/);
  // light is lighter than the base, deep is darker
  const lightness = hex => { const [r, g, b] = hexToRgb(hex); return rgbToHsl([r, g, b])[2]; };
  assert.ok(lightness(tint.light) > lightness(tint.accent));
  assert.ok(lightness(tint.deep) < lightness(tint.accent));
});

test('an invalid custom colour falls back to the default red', () => {
  assert.equal(tintFromHex('not-a-colour').accent, '#c8202e');
});

test('a chosen font family is quoted first, with the fallback stack appended', () => {
  assert.equal(fontStackFor('Source Han Sans', 'system-ui, sans-serif'), '"Source Han Sans", system-ui, sans-serif');
  // Quotes and CSS-breaking characters cannot escape the quoted string.
  assert.equal(fontStackFor('Bad"Name;}', 'sans-serif'), '"BadName", sans-serif');
  assert.equal(fontStackFor('   ', 'sans-serif'), 'sans-serif');
  assert.equal(fontStackFor(undefined, 'sans-serif'), 'sans-serif');
});

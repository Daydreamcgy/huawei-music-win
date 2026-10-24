import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeLyricsFile, lyricsCacheKey, sanitizeLyricsDoc } from '../src/main/lyrics-store.mjs';

test('lyric files decode as UTF-8 with or without BOM, and UTF-16 with BOM', () => {
  const text = '[00:01.00]第一句';
  assert.equal(decodeLyricsFile(Buffer.from(text, 'utf8')), text);
  assert.equal(decodeLyricsFile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])), text);
  assert.equal(decodeLyricsFile(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])), text);
  assert.equal(decodeLyricsFile(Buffer.from([0xfe, 0xff, 0x00, 0x5b])), '[', 'big endian BOM is byte-swapped');
});

test('GBK lyric files fall back instead of turning into replacement characters', () => {
  // "中文" in GBK
  assert.equal(decodeLyricsFile(Buffer.from([0xd6, 0xd0, 0xce, 0xc4])), '中文');
  assert.equal(decodeLyricsFile(Buffer.alloc(0)), '');
});

test('cache keys are stable, collision-resistant and filesystem safe', () => {
  assert.equal(lyricsCacheKey('track:123/abc'), lyricsCacheKey('track:123/abc'));
  assert.notEqual(lyricsCacheKey('a'), lyricsCacheKey('b'));
  assert.match(lyricsCacheKey('anything'), /^[0-9a-f]{32}$/);
});

test('cached documents are re-validated before use', () => {
  assert.deepEqual(sanitizeLyricsDoc({ synced: true, lines: [{ timeMs: 1000, text: 'a' }] }), { synced: true, lines: [{ timeMs: 1000, text: 'a' }] });
  assert.equal(sanitizeLyricsDoc(null), null);
  assert.equal(sanitizeLyricsDoc({ synced: 'yes', lines: [] }), null);
  assert.equal(sanitizeLyricsDoc({ synced: true, lines: [{ text: 42 }] }), null);
  assert.equal(sanitizeLyricsDoc({ synced: true, lines: [] }), null);
  // Unknown shapes are stripped, not passed through.
  const doc = sanitizeLyricsDoc({ synced: false, lines: [{ timeMs: null, text: 'x', evil: 'x'.repeat(10) }], extra: { a: 1 } });
  assert.deepEqual(doc, { synced: false, lines: [{ timeMs: null, text: 'x' }] });
});

test('cached translations, segments and source survive validation', () => {
  const doc = sanitizeLyricsDoc({
    synced: true,
    source: 'kugou',
    matchedTitle: '安静',
    lines: [{ timeMs: 1000, text: '第一句', translation: 'line one', segments: [{ timeMs: 1000, text: '第一' }, { timeMs: 1200, text: '句' }] }],
  });
  assert.equal(doc.source, 'kugou');
  assert.equal(doc.matchedTitle, '安静');
  assert.equal(doc.lines[0].translation, 'line one');
  assert.equal(doc.lines[0].segments.length, 2);
});

test('absurdly long cached payloads are truncated', () => {
  const lines = Array.from({ length: 5000 }, (_, index) => ({ timeMs: index * 1000, text: `line ${index}` }));
  const doc = sanitizeLyricsDoc({ synced: true, lines });
  assert.equal(doc.lines.length, 4000);
  const long = sanitizeLyricsDoc({ synced: false, lines: [{ timeMs: null, text: 'x'.repeat(5000) }] });
  assert.equal(long.lines[0].text.length, 2000);
});

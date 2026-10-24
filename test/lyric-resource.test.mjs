import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineLyricsFrom, lyricAddressFrom } from '../src/main/lyric-resource.mjs';

test('lyric addresses must come from the Huawei CDN allowlist', () => {
  assert.equal(lyricAddressFrom({ lyricAddress: 'https://cdn.dbankcdn.cn/lrc/1.lrc' }), 'https://cdn.dbankcdn.cn/lrc/1.lrc');
  assert.equal(lyricAddressFrom({ lyricAddres: 'https://cdn.tingmall.com/lrc/1.lrc' }), 'https://cdn.tingmall.com/lrc/1.lrc');
  assert.equal(lyricAddressFrom({ contentExInfo: JSON.stringify({ lyricAddress: 'https://cdn.kuke.com/a.lrc' }) }), 'https://cdn.kuke.com/a.lrc');
  // A nested shape from the public H5 bundle is accepted too.
  assert.equal(lyricAddressFrom({ contentExInfo: { lyrics: { lineByLineLyric: 'https://cdn.dbankcdn.cn/b.lrc' } } }), 'https://cdn.dbankcdn.cn/b.lrc');
});

test('unsafe or malformed lyric addresses are rejected, not passed to fetch', () => {
  for (const value of [
    'http://cdn.dbankcdn.cn/lrc/1.lrc',
    'https://dbankcdn.cn/lrc/1.lrc.evil.test/a.lrc',
    'https://user:pass@cdn.dbankcdn.cn/a.lrc',
    'https://cdn.dbankcdn.cn:8443/a.lrc',
    'file:///etc/passwd',
    'javascript:alert(1)',
    '',
    null,
  ]) {
    assert.equal(lyricAddressFrom({ lyricAddress: value }), undefined, String(value));
  }
});

test('inline lyrics are read from both plain and wrapped response shapes', () => {
  assert.equal(inlineLyricsFrom({ lyrics: '[00:01.00]正文' }), '[00:01.00]正文');
  assert.equal(inlineLyricsFrom({ contentExInfo: { lyrics: '第一行\n第二行' } }), '第一行\n第二行');
  assert.equal(inlineLyricsFrom({ contentExInfo: JSON.stringify({ Lyrics: '[00:02.00]嵌套' }) }), '[00:02.00]嵌套');
});

test('a JSON blob nested in the lyric field is unwrapped once', () => {
  assert.equal(inlineLyricsFrom({ lyrics: JSON.stringify({ lyric: '[00:03.00]解包' }) }), '[00:03.00]解包');
  assert.equal(inlineLyricsFrom({ lyrics: JSON.stringify({ unrelated: true }) }), null);
  assert.equal(inlineLyricsFrom({ lyrics: '{not json' }), null);
});

test('empty, oversized and non string lyric payloads are ignored', () => {
  assert.equal(inlineLyricsFrom({ lyrics: '   ' }), null);
  assert.equal(inlineLyricsFrom({ lyrics: 42 }), null);
  assert.equal(inlineLyricsFrom({}), null);
  assert.equal(inlineLyricsFrom({ lyrics: 'x'.repeat(512 * 1024 + 1) }), null);
});

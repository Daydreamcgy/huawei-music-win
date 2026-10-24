import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedLibraryData, updateLibraryCache, CACHE_MAX_BYTES } from '../src/main/library-cache.mjs';
import { lyricAddressFrom, readBoundedText } from '../src/main/lyric-resource.mjs';

test('cached library data is explicitly stale and bounded to five megabytes', () => {
  let cache = updateLibraryCache(null, 'favorites:0:50', { tracks: [{ id: 'synthetic' }], nextStart: 50, hasMore: false }, 100);
  assert.match(cachedLibraryData(cache, 'favorites:0:50').cacheHint, /离线缓存/);
  assert.equal(cachedLibraryData(cache, 'absent'), null);
  for (let index = 0; index < 8; index++) cache = updateLibraryCache(cache, `page:${index}`, { synthetic: 'x'.repeat(900000) }, 200 + index);
  assert.ok(Buffer.byteLength(JSON.stringify(cache)) <= CACHE_MAX_BYTES);
  assert.equal(cache['favorites:0:50'], undefined);
  assert.ok(cache['page:7']);
});

test('lyrics recognize observed nested fields but reject non-whitelisted destinations', () => {
  assert.equal(lyricAddressFrom({ contentExInfo: JSON.stringify({ lyrics: { lineByLineLyric: 'https://audio.dbankcdn.cn/lrc' } }) }), 'https://audio.dbankcdn.cn/lrc');
  assert.equal(lyricAddressFrom({ lyricAddress: 'http://127.0.0.1/lrc' }), undefined);
  assert.equal(lyricAddressFrom({ contentExInfo: '{' }), undefined);
});

test('lyrics download is byte-limited even without content-length', async () => {
  assert.equal(await readBoundedText(new Response('中文歌词'), 20), '中文歌词');
  await assert.rejects(readBoundedText(new Response('中文歌词'), 3), /过大/);
  await assert.rejects(readBoundedText(new Response('x', { headers: { 'content-length': '99999' } }), 20), /过大/);
});

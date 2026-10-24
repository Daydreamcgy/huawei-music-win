import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeMediaUrl, shouldBlockMediaRequest } from '../src/safe-media-url.mjs';

test('media URL accepts HTTPS on known Huawei music CDNs', () => {
  assert.equal(isSafeMediaUrl('https://audio.dbankcdn.cn/path/song.flac?token=x'), true);
  assert.equal(isSafeMediaUrl('https://lyric.tingmall.com/path/song.lrc'), true);
  assert.equal(isSafeMediaUrl('https://image.kuke.com/cover.jpg'), true);
});

test('media URL rejects HTTP, credentials, ports and lookalike suffixes', () => {
  for (const value of [
    'http://audio.dbankcdn.cn/song.mp3',
    'https://user:pass@audio.dbankcdn.cn/song.mp3',
    'https://audio.dbankcdn.cn:8443/song.mp3',
    'https://dbankcdn.cn.evil.example/song.mp3',
    'https://notdbankcdn.cn/song.mp3',
    'file:///tmp/song.mp3',
    'javascript:alert(1)',
    'https://127.0.0.1/song.mp3',
  ]) assert.equal(isSafeMediaUrl(value), false, value);
});

test('redirected media requests are checked again while unrelated requests are unaffected', () => {
  assert.equal(shouldBlockMediaRequest('media', 'https://audio.dbankcdn.cn/song.mp3'), false);
  assert.equal(shouldBlockMediaRequest('media', 'https://attacker.invalid/song.mp3'), true);
  assert.equal(shouldBlockMediaRequest('media', 'http://audio.dbankcdn.cn/song.mp3'), true);
  assert.equal(shouldBlockMediaRequest('xhr', 'https://api.example.invalid/data'), false);
  assert.equal(shouldBlockMediaRequest('image', 'https://images.example.invalid/cover.jpg'), false);
});

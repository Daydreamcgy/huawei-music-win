import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedPlaybackQuality } from '../src/main/track-quality.mjs';

test('confirms standard and lossless only when quality and declared codec agree', () => {
  assert.equal(confirmedPlaybackQuality('1', 'audio/mpeg'), 'standard');
  assert.equal(confirmedPlaybackQuality('3', 'audio/flac'), 'lossless');
});

test('unknown, missing, or conflicting codec evidence is not advertised as confirmed quality', () => {
  for (const [quality, type] of [
    ['3', 'application/json'],
    ['3', 'audio/mpeg'],
    ['1', 'audio/flac'],
    ['1', undefined],
    ['7', 'audio/flac'],
  ]) assert.equal(confirmedPlaybackQuality(quality, type), 'unknown');
});

test('codec matching is case-insensitive and accepts explicit codec labels', () => {
  assert.equal(confirmedPlaybackQuality('3', 'FLAC'), 'lossless');
  assert.equal(confirmedPlaybackQuality('1', 'audio/mpeg; codecs=MP3'), 'standard');
});

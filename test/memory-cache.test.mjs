import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryCache } from '../src/main/memory-cache.mjs';

test('cache serves fresh entries, drops expired ones and keeps keys independent', () => {
  let clock = 1000;
  const cache = createMemoryCache({ ttlMs: 100, now: () => clock });
  assert.equal(cache.get('playlists'), null);
  cache.set('playlists', { playlists: [{ id: 'p1' }] });
  cache.set('playlist:owned:p1:0:50', { tracks: [] });
  assert.deepEqual(cache.get('playlists').data, { playlists: [{ id: 'p1' }] });
  assert.equal(cache.get('playlists').savedAt, 1000);
  clock += 99;
  assert.ok(cache.get('playlists'), 'entry inside the ttl must stay');
  cache.set('playlist:owned:p1:0:50', { tracks: ['refreshed'] });
  clock += 2;
  assert.equal(cache.get('playlists'), null, 'expired entry must be dropped');
  assert.deepEqual(cache.get('playlist:owned:p1:0:50').data, { tracks: ['refreshed'] }, 'expiry of one key must not clear another');
});

test('prefix invalidation clears playlist reads but keeps unrelated entries', () => {
  const cache = createMemoryCache({ now: () => 0 });
  cache.set('playlists', 1);
  cache.set('playlist:owned:p1:0:50', 2);
  cache.set('favorites:0:50', 3);
  cache.invalidatePrefix('playlist');
  assert.equal(cache.get('playlists'), null);
  assert.equal(cache.get('playlist:owned:p1:0:50'), null);
  assert.equal(cache.get('favorites:0:50').data, 3);
  cache.invalidate('favorites:0:50');
  assert.equal(cache.size, 0);
  cache.set('playlists', 4);
  cache.clear();
  assert.equal(cache.size, 0);
});

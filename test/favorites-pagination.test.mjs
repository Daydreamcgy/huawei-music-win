import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFavoritesPage } from '../src/renderer/favorites-pagination.mjs';

const track = id => ({ id, title: id });

test('a full first page keeps the continuation marker', () => {
  const page = {
    tracks: [track('a'), track('b')],
    nextStart: 2,
    hasMore: true,
  };
  assert.deepEqual(mergeFavoritesPage([], page), {
    tracks: page.tracks,
    nextStart: 2,
    hasMore: true,
  });
});

test('a later page appends new tracks and removes duplicate ids', () => {
  const result = mergeFavoritesPage([track('a'), track('b')], {
    tracks: [track('b'), track('c')],
    nextStart: 4,
    hasMore: true,
  });
  assert.deepEqual(result.tracks.map(item => item.id), ['a', 'b', 'c']);
  assert.equal(result.nextStart, 4);
  assert.equal(result.hasMore, true);
});

test('a page with no new ids stops pagination even if the provider says more exists', () => {
  const result = mergeFavoritesPage([track('a')], {
    tracks: [track('a')],
    nextStart: 2,
    hasMore: true,
  });
  assert.deepEqual(result.tracks.map(item => item.id), ['a']);
  assert.equal(result.hasMore, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFavoritesCatalog } from '../src/main/favorites-catalog.mjs';
const track = id => ({ id: String(id), title: `Song ${id}`, artists: [], available: true });

function fixture(count) {
  const all = Array.from({ length: count }, (_, index) => track(index));
  const calls = [];
  const read = async (start, limit) => {
    calls.push(start);
    const tracks = all.slice(start, start + limit);
    return { tracks, entryIds: tracks.map(item => item.id), nextStart: start + limit, hasMore: tracks.length === limit };
  };
  return { catalog: createFavoritesCatalog(read), calls, all };
}

test('965-song total is counted in twenty 50-item requests, shared with scrolling pages', async () => {
  const { catalog, calls } = fixture(965);
  const first = await catalog.page();
  assert.equal(first.tracks.length, 50);
  assert.equal(first.total, undefined);
  assert.equal('entryIds' in first, false);
  assert.deepEqual(await catalog.summary(), { total: 965 });
  assert.equal(calls.length, 20);
  assert.deepEqual(calls, Array.from({ length: 20 }, (_, index) => index * 50));
  assert.equal((await catalog.page(50)).total, 965);
  assert.equal((await catalog.page(950)).tracks.length, 15);
  assert.equal(calls.length, 20, 'scrolling repeated an indexed request');
});

test('concurrent UI and total requests share the same in-flight page', async () => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  let calls = 0;
  const catalog = createFavoritesCatalog(async () => {
    calls++; await gate;
    return { tracks: [track('a')], nextStart: 50, hasMore: false };
  });
  const counting = catalog.summary();
  const first = catalog.page();
  finish();
  assert.deepEqual(await counting, { total: 1 });
  assert.equal((await first).tracks.length, 1);
  assert.equal(calls, 1);
});

test('network failure never publishes a partial total and retry resumes cached pages', async () => {
  let fail = true;
  const calls = [];
  const catalog = createFavoritesCatalog(async start => {
    calls.push(start);
    if (start && fail) throw new Error('offline');
    return { tracks: [track(start)], nextStart: start + 50, hasMore: start === 0 };
  });
  await assert.rejects(catalog.summary(), /offline/);
  assert.equal((await catalog.page()).total, undefined);
  fail = false;
  assert.deepEqual(await catalog.summary(), { total: 2 });
  assert.deepEqual(calls, [0, 50, 50]);
});

test('refresh invalidates old count and pending results', async () => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  let first = true;
  const catalog = createFavoritesCatalog(async () => {
    if (first) { first = false; await gate; return { tracks: [track('old')], nextStart: 50, hasMore: false }; }
    return { tracks: [track('new')], nextStart: 50, hasMore: false };
  });
  const old = catalog.summary();
  await Promise.resolve();
  catalog.invalidate();
  assert.deepEqual(await catalog.summary(), { total: 1 });
  finish();
  await assert.rejects(old, /刷新/);
  assert.equal((await catalog.page()).tracks[0].id, 'new');
});

test('a full final page requires the terminal empty page, and repeated pages fail counting', async () => {
  const { catalog, calls } = fixture(100);
  assert.deepEqual(await catalog.summary(), { total: 100 });
  assert.deepEqual(calls, [0, 50, 100]);
  const repeating = createFavoritesCatalog(async start => ({ tracks: [track('a')], nextStart: start + 50, hasMore: true }));
  await assert.rejects(repeating.summary(), /没有进展/);
  assert.equal((await repeating.page()).total, undefined);
});

test('empty libraries count as zero and malformed display rows still count by raw ids', async () => {
  assert.deepEqual(await fixture(0).catalog.summary(), { total: 0 });
  const catalog = createFavoritesCatalog(async () => ({ tracks: [], entryIds: ['missing-title'], nextStart: 50, hasMore: false }));
  assert.deepEqual(await catalog.summary(), { total: 1 });
});

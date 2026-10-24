import test from 'node:test';
import assert from 'node:assert/strict';
import { createWriteController } from '../src/main/writes.mjs';

function fixture(overrides = {}) {
  let items = [{ id: 'owned', title: 'Original', kind: 'owned' }];
  let favorite = false;
  let description = '';
  const writes = [];
  const api = {
    playlists: async () => ({ playlists: items, truncated: false }),
    playlistDetail: async () => ({ playlist: { description } }),
    favoriteExist: async () => favorite,
    setFavorite: async (id, target) => { writes.push(['favorite', id]); favorite = target; },
    createPlaylist: async name => { writes.push(['create']); items = [...items, { id: 'new', title: name, kind: 'owned' }]; return 'new'; },
    updateDescription: async (id, value) => { writes.push(['description', id]); description = value; },
    deletePlaylist: async id => { writes.push(['delete', id]); items = items.filter(item => item.id !== id); },
    ...overrides,
  };
  return { api, writes, controller: createWriteController(api) };
}

test('favorite writes are idempotent and verified by read-back', async () => {
  const { controller, writes } = fixture();
  assert.deepEqual(await controller.setFavorite('song', false), { favorite: false });
  assert.equal(writes.length, 0);
  assert.deepEqual(await controller.setFavorite('song', true), { favorite: true });
  assert.deepEqual(await controller.setFavorite('song', true), { favorite: true });
  assert.equal(writes.length, 1);
});

test('a timed-out applied favorite write is confirmed without a second write', async () => {
  let current = false;
  let count = 0;
  const { controller } = fixture({ favoriteExist: async () => current,
    setFavorite: async () => { count++; current = true; throw new Error('timeout'); } });
  assert.deepEqual(await controller.setFavorite('song', true), { favorite: true });
  assert.equal(count, 1);
});

test('unconfirmed favorite writes cannot be blindly repeated', async () => {
  let writes = 0;
  const { controller } = fixture({ setFavorite: async () => { writes++; throw new Error('timeout'); } });
  await assert.rejects(controller.setFavorite('song', true), /待确认/);
  await assert.rejects(controller.setFavorite('song', true), /待确认/);
  assert.equal(writes, 1);
});

test('description and deletion reject non-owned ids before issuing any write', async () => {
  const { controller, writes } = fixture();
  await assert.rejects(controller.updateDescription('collected', 'text'), error => error.kind === 'permission');
  await assert.rejects(controller.deletePlaylist('collected'), error => error.kind === 'permission');
  assert.deepEqual(writes, []);
});

test('description writes require exact read-back, not HTTP success', async () => {
  const { controller } = fixture({ updateDescription: async () => undefined });
  await assert.rejects(controller.updateDescription('owned', 'changed'), /待确认/);
});

test('playlist deletion verifies disappearance using a complete list', async () => {
  const { controller, writes } = fixture();
  assert.deepEqual(await controller.deletePlaylist('owned'), { id: 'owned' });
  assert.deepEqual(writes, [['delete', 'owned']]);
  const unchanged = fixture({ deletePlaylist: async () => undefined });
  await assert.rejects(unchanged.controller.deletePlaylist('owned'), /待确认/);
});

test('creation uses a baseline and confirms the new owned id', async () => {
  const { controller, writes } = fixture();
  assert.deepEqual(await controller.createPlaylist('Temporary', ['song']), { id: 'new' });
  assert.equal(writes.length, 1);
});

test('a creation timeout blocks every repeat until the previous object can be identified', async () => {
  let count = 0;
  let visible = false;
  const { controller } = fixture({
    playlists: async () => ({ playlists: visible ? [{ id: 'new', title: 'Temporary', kind: 'owned' }] : [], truncated: false }),
    createPlaylist: async () => { count++; throw new Error('timeout'); },
  });
  await assert.rejects(controller.createPlaylist('Temporary', ['song']), /待确认/);
  await assert.rejects(controller.createPlaylist('Another', ['song']), /待确认/);
  assert.equal(count, 1);
  visible = true;
  assert.deepEqual(await controller.createPlaylist('Temporary', ['song']), { id: 'new' });
  assert.equal(count, 1);
});

test('an unresolved creation intent survives controller/process replacement', async () => {
  let intent = null;
  let writes = 0;
  const store = { load: async () => intent, save: async value => { intent = value; } };
  const { api } = fixture({ playlists: async () => ({ playlists: [], truncated: false }),
    createPlaylist: async () => { writes++; throw new Error('timeout'); } });
  await assert.rejects(createWriteController(api, store).createPlaylist('Temporary', ['song']), /待确认/);
  assert.deepEqual(intent, { name: 'Temporary', baseline: [] });
  await assert.rejects(createWriteController(api, store).createPlaylist('Temporary', ['song']), /待确认/);
  assert.equal(writes, 1);
});

test('concurrent writes are rejected instead of duplicating a pending mutation', async () => {
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const { controller } = fixture({ favoriteExist: async () => { await waiting; return true; } });
  const first = controller.setFavorite('song', true);
  assert.equal(controller.busy, true);
  await assert.rejects(controller.setFavorite('song', false), /正在进行/);
  finish();
  await first;
  assert.equal(controller.busy, false);
});

test('a truncated list cannot prove a creation baseline or deletion', async () => {
  const { controller, writes } = fixture({ playlists: async () => ({ playlists: [{ id: 'owned', kind: 'owned' }], truncated: true }) });
  await assert.rejects(controller.createPlaylist('Temporary', ['song']), /基线/);
  assert.equal(writes.length, 0);
  await assert.rejects(controller.deletePlaylist('owned'), /待确认/);
});

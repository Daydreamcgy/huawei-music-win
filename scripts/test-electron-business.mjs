// Offline production-path integration. No business IPC replacement, real credentials, or live API.
// Only the temporary login page and undici transport are synthetic; all application logic runs.
import assert from 'node:assert/strict';
import electron from 'electron';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as playwright } from 'playwright-core';

const profile = await mkdtemp(join(tmpdir(), 'huawei-business-'));
let app;
try {
  app = await playwright.launch({ executablePath: electron,
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), `--user-data-dir=${profile}`, 'out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } });
  const page = await app.firstWindow();
  await app.evaluate(({ session }) => {
    const require = process.getBuiltinModule('node:module').createRequire(process.cwd() + '/package.json');
    const { MockAgent, setGlobalDispatcher } = require('undici');
    const mock = new MockAgent();
    mock.disableNetConnect();
    setGlobalDispatcher(mock);
    globalThis.__businessMock = mock;
    globalThis.__business = { favorite: true, description: 'Original', created: false, removed: false,
      creates: 0, mutations: 0, favoritesRead: 0, libraryReads: 0, historyReports: [], historyFail: false,
      offline: false, badHttp: false, bulk: false, bulkStarts: [] };
    const state = globalThis.__business;
    const success = value => JSON.stringify({ result: { resultCode: '000000' }, ...value });
    const song = { contentID: 'synthetic-song', contentName: 'Synthetic Song', contentType: '1', duration: '60', artistName: 'Fixture', artistID: ['artist'], albumID: 'album', albumName: 'Album' };
    const owned = () => ({ contentID: 'owned', contentName: 'Original', contentType: '5', listDesc: state.description });
    const created = () => ({ contentID: 'created', contentName: 'Synthetic Temporary', contentType: '5' });
    mock.get('https://oauth-login.cloud.huawei.com').intercept({ path: '/oauth2/v3/token', method: 'POST' })
      .reply(200, { access_token: 'SYNTHETIC-ACCOUNT-TOKEN', expires_in: 3600 });
    const api = mock.get('https://api-drcn.music.dbankcloud.cn');
    api.intercept({ path: '/music-odpapp-service/v5/service/userinfo/loginex', method: 'POST' })
      .reply(200, success({ token: 'SYNTHETIC-MUSIC-TOKEN', snsUserID: 'SYNTHETIC-SELF' }));
    api.intercept({ path: /^\/music-/, method: /GET|POST/ }).reply(options => {
      const path = new URL(options.path, 'https://api-drcn.music.dbankcloud.cn');
      const body = options.body ? JSON.parse(String(options.body)) : {};
      let data = {};
      if (path.pathname.endsWith('/favorite/simple/all')) {
        state.favoritesRead++;
        // Playlist discovery is the multi-type read; the playlist cache must collapse repeats of it.
        if (Array.isArray(body.contentTypes) && body.contentTypes.length > 1) state.libraryReads++;
        if (body.targetSnsUserID !== 'SYNTHETIC-SELF') throw new Error('Wrong account boundary');
        if (state.offline) throw new Error('Synthetic network failure');
        if (state.badHttp) return { statusCode: 400, data: '' };
        if (state.bulk && body.contentTypes.length === 1) {
          state.bulkStarts.push(body.start);
          data = { favoriteInfos: Array.from({ length: Math.max(0, Math.min(body.limit, 965 - body.start)) }, (_, index) => ({ ...song, contentID: `bulk-${body.start + index}`, contentName: `合成收藏 ${body.start + index}` })) };
        } else data = { favoriteInfos: body.contentTypes.length === 1 ? [song] : [song, owned(), ...(state.created && !state.removed ? [created()] : [])] };
      } else if (path.pathname.endsWith('/recentlyplayed/create')) {
        if (state.historyFail) return { statusCode: 500, data: '' };
        state.historyReports.push(body);
      } else if (path.pathname.endsWith('/favorite/simple/exist')) data = { exist: state.favorite ? '1' : '0' };
      else if (path.pathname.endsWith('/favorite/create')) { state.favorite = true; state.mutations++; }
      else if (path.pathname.endsWith('/favorite/delete')) { state.favorite = false; state.mutations++; }
      else if (path.pathname.endsWith('/playlist/create')) { state.creates++; state.created = true; state.mutations++; data = { playListID: 'created' }; }
      else if (path.pathname.endsWith('/playlist/update')) { state.description = body.listDesc; state.mutations++; }
      else if (path.pathname.endsWith('/playlist/delete')) { state.removed = true; state.mutations++; }
      else if (path.pathname.endsWith('/playlist/detail/all')) data = { playListInfoEx: { playListInfo: path.searchParams.get('playListID') === 'created' ? created() : owned(), playListSongInfoList: [song] } };
      else if (path.pathname.endsWith('/fuzzysearch')) data = { songSimpleInfos: [song], hasNextPage: '0', totalNum: '1' };
      else if (path.pathname.endsWith('/recentlyplayed/query')) data = { contentSimpleInfos: [song] };
      else if (path.pathname.endsWith('/album/detail/byalbumcode')) data = { albumInfoEx: { albumInfo: { albumCode: 'album', albumName: 'Album' }, songSimpleInfos: [song] } };
      else if (path.pathname.endsWith('/artist/detail/byartistcode')) data = { artistInfoEx: { artistInfo: { artistCode: 'artist', artistName: 'Fixture' }, songSimpleInfos: [song] } };
      else if (path.pathname.endsWith('/file/bycontentcode')) data = { fileURL: 'https://audio.dbankcdn.cn/synthetic-only.mp3', playQuality: '1', type: 'MP3', songInfo: { duration: '60' } };
      else throw new Error('Unexpected production request');
      return { statusCode: 200, data: success(data) };
    }).persist();
    const original = session.fromPartition.bind(session);
    session.fromPartition = (...args) => {
      const isolated = original(...args);
      isolated.protocol.handle('https', request => {
        const url = new URL(request.url);
        if (url.hostname !== 'oauth-login.platform.hicloud.com') return new Response('Denied', { status: 403 });
        const callback = new URL(url.searchParams.get('redirect_uri'));
        callback.searchParams.set('state', url.searchParams.get('state'));
        callback.searchParams.set('code', 'synthetic-code');
        return new Response(`<button id="authorize">Authorize synthetic fixture</button><script>document.querySelector('button').onclick=()=>{location.href=${JSON.stringify(callback.href)}}</script>`, { headers: { 'content-type': 'text/html' } });
      });
      return isolated;
    };
  });
  await page.getByRole('button', { name: '扫码登录' }).click();
  let login;
  for (let i = 0; i < 100 && !login; i++) { login = app.windows().find(item => item !== page); if (!login) await page.waitForTimeout(50); }
  await login.getByRole('button', { name: 'Authorize synthetic fixture' }).click({ noWaitAfter: true });
  await page.getByRole('button', { name: '退出', exact: true }).waitFor({ timeout: 10000 });
  const results = await page.evaluate(async () => {
    const api = window.desktop.music;
    const status = await window.desktop.auth.status();
    const favorites = await api.favorites();
    const list = await api.playlists();
    const search = await api.search({ query: 'synthetic' });
    const album = await api.album({ id: 'album' });
    const artist = await api.artist({ id: 'artist' });
    const history = await api.history();
    const playback = await api.resolvePlayback({ trackId: 'synthetic-song', quality: 'standard' });
    const deniedDelete = await api.deletePlaylist({ id: 'not-owned' });
    const deniedEdit = await api.updatePlaylistDescription({ id: 'not-owned', description: 'blocked' });
    const favorite = await api.setFavorite({ trackId: 'synthetic-song', favorite: false });
    const favoriteAgain = await api.setFavorite({ trackId: 'synthetic-song', favorite: false });
    const create = await api.createPlaylist({ name: 'Synthetic Temporary', trackIds: ['synthetic-song'] });
    const edit = await api.updatePlaylistDescription({ id: 'owned', description: 'Verified description' });
    const remove = await api.deletePlaylist({ id: 'created' });
    await window.desktop.queue.save({ tracks: favorites.data.tracks, index: 0, positionSeconds: 10 });
    localStorage.setItem('local-play-history', JSON.stringify(favorites.data.tracks));
    return { authenticated: status.ok && status.data.authenticated,
      noCredentialDto: !JSON.stringify([status, favorites, list, search, album, artist, history]).includes('SYNTHETIC-MUSIC-TOKEN'),
      reads: [favorites, list, search, album, artist, history, playback].every(item => item.ok),
      denied: !deniedDelete.ok && deniedDelete.error.kind === 'permission' && !deniedEdit.ok,
      favorite: favorite.ok && !favorite.data.favorite && favoriteAgain.ok,
      writes: create.ok && create.data.id === 'created' && edit.ok && remove.ok };
  });
  assert.deepEqual(results, { authenticated: true, noCredentialDto: true, reads: true, denied: true, favorite: true, writes: true });
  const writes = await app.evaluate(() => ({ creates: globalThis.__business.creates, mutations: globalThis.__business.mutations }));
  assert.deepEqual(writes, { creates: 1, mutations: 4 }, 'idempotent favorite or rejected ids issued an extra write');
  // Playlists are cached in-process: repeats must not re-request, only an explicit refresh may.
  await page.evaluate(() => window.desktop.music.playlists());
  const readsAfterFirst = await app.evaluate(() => globalThis.__business.libraryReads);
  await page.evaluate(() => window.desktop.music.playlists());
  assert.equal(await app.evaluate(() => globalThis.__business.libraryReads), readsAfterFirst, 'a cached playlist read requested again');
  await page.evaluate(() => window.desktop.music.playlists({ refresh: true }));
  assert.equal(await app.evaluate(() => globalThis.__business.libraryReads), readsAfterFirst + 1, 'explicit refresh must bypass the cache');

  // History sync reports real seconds through the production path and stays silent when it fails.
  const reported = await page.evaluate(() => window.desktop.music.reportPlayback({ trackId: 'synthetic-song', title: 'Synthetic Song', listenedSeconds: 30, songDurationSeconds: 60 }));
  assert.equal(reported.ok, true);
  const reports = await app.evaluate(() => globalThis.__business.historyReports.slice());
  assert.equal(reports.length, 1, JSON.stringify(reports));
  assert.match(reports[0].createRecentPlayInfos[0].createTime, /^\d{14}$/, 'createTime must use the documented 14-digit form');
  assert.deepEqual({ ...reports[0].createRecentPlayInfos[0], createTime: 'normalized' }, {
    songCode: 'synthetic-song', contentCode: 'synthetic-song', contentType: '1', songName: 'Synthetic Song',
    listenType: '1', duration: 30, createTime: 'normalized', playCount: 1, songDuration: 60,
  });
  const invalidReport = await page.evaluate(() => window.desktop.music.reportPlayback({ trackId: '', title: 'x', listenedSeconds: 5 }).then(() => 'resolved', () => 'rejected'));
  assert.equal(invalidReport, 'rejected', 'an invalid history payload must be rejected before any request');
  await app.evaluate(() => { globalThis.__business.historyFail = true; });
  const failedReport = await page.evaluate(async () => {
    const result = await window.desktop.music.reportPlayback({ trackId: 'synthetic-song', title: 'Synthetic Song', listenedSeconds: 30 });
    return { ok: result.ok, loggedIn: (await window.desktop.auth.status()).data.authenticated };
  });
  assert.deepEqual(failedReport, { ok: false, loggedIn: true }, 'a failed history report must stay silent and keep the session');
  await app.evaluate(() => { globalThis.__business.historyFail = false; });

  await app.evaluate(() => { globalThis.__business.bulk = true; });
  const indexed = await page.evaluate(async () => {
    const first = await window.desktop.music.favorites({ refresh: true });
    const summary = await window.desktop.music.favoritesSummary();
    const last = await window.desktop.music.favorites({ start: 950, limit: 50 });
    return { first: first.data.tracks.length, total: summary.data.total, last: last.data.tracks.length };
  });
  assert.deepEqual(indexed, { first: 50, total: 965, last: 15 });
  assert.deepEqual(await app.evaluate(() => globalThis.__business.bulkStarts), Array.from({ length: 20 }, (_, index) => index * 50), 'production catalog repeated counted pages');
  await app.evaluate(() => { globalThis.__business.offline = true; });
  const offline = await page.evaluate(async () => {
    const data = await window.desktop.music.favorites({ refresh: true });
    const status = await window.desktop.auth.status();
    return { cached: data.ok && !!data.data.cacheHint, loggedIn: status.data.authenticated };
  });
  assert.deepEqual(offline, { cached: true, loggedIn: true });
  await app.evaluate(() => { globalThis.__business.offline = false; globalThis.__business.badHttp = true; });
  const invalid = await page.evaluate(async () => ({ result: await window.desktop.music.favorites({ refresh: true }), status: await window.desktop.auth.status() }));
  assert.equal(invalid.result.ok, false);
  assert.equal(invalid.result.error.kind, 'unknown');
  assert.equal(invalid.status.data.authenticated, true);
  // Synthetic corrupt backups must also disappear, while non-personal settings survive.
  await writeFile(join(profile, 'queue.json.bak'), 'synthetic-private-backup');
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await page.getByRole('button', { name: '打开官方登录' }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(1800);
  for (const name of ['queue.json', 'queue.json.bak', 'cache.json', 'session.enc', 'write-intent.json']) {
    await readFile(join(profile, name)).then(() => assert.fail(`${name} remained after logout`), error => assert.equal(error.code, 'ENOENT'));
  }
  assert.equal(await page.evaluate(() => localStorage.getItem('local-play-history')), null);
  assert.equal(await page.getByRole('button', { name: '播放', exact: true }).isDisabled(), true);
  console.log('Linux Electron production business integration passed: synthetic OAuth -> real AuthManager/IPC/HTTP -> library/playback DTO; owned-id restrictions, idempotency and write read-back; offline cache and HTTP 400 keep session; logout removes queue/cache/history/intent. No real account or live API used.');
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(profile, { recursive: true, force: true });
}

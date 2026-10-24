// Local UI screenshot harness.
//
// Launches the real Electron app against synthetic IPC fixtures (fake library, generated cover
// art, local sine-wave audio) and writes screenshots to /tmp/shots. No Huawei network, no account,
// no personal data. Requires ffmpeg on PATH. Run with a display, or `xvfb-run -a`.
//
//   npm run capture:ui
import electron from 'electron';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as playwright } from 'playwright-core';

process.umask(0o077);
if (process.platform === 'linux' && !process.env.FONTCONFIG_FILE && existsSync('/usr/share/fonts')) {
  const dir = mkdtempSync(join(tmpdir(), 'hw-shot-fontconfig-'));
  const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  writeFileSync(join(dir, 'fonts.conf'), `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig>
    <dir>/usr/share/fonts</dir><dir>/usr/local/share/fonts</dir><cachedir>${xml(join(dir, 'cache'))}</cachedir>
    <alias><family>sans-serif</family><prefer><family>Noto Sans CJK SC</family><family>WenQuanYi Zen Hei</family><family>DejaVu Sans</family></prefer></alias>
  </fontconfig>`);
  process.env.FONTCONFIG_FILE = join(dir, 'fonts.conf');
}

const profile = await mkdtemp(join(tmpdir(), 'hw-shot-profile-'));
const media = await mkdtemp(join(tmpdir(), 'hw-shot-media-'));
const out = '/tmp/shots';
await mkdir(out, { recursive: true });

const cover = (hue, label) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 52% 66%)"/><stop offset="1" stop-color="hsl(${hue + 26} 44% 34%)"/></linearGradient></defs><rect width="360" height="360" fill="url(#g)"/><circle cx="180" cy="180" r="84" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="10"/><text x="180" y="200" font-size="58" font-family="sans-serif" font-weight="600" fill="rgba(255,255,255,0.92)" text-anchor="middle">${label}</text></svg>`)}`;

const LYRICS = [
  ['凌晨四点的街灯还亮着', 'Streetlights still on at four in the morning', 0],
  ['空调把夏天吹成了灰色', 'The air conditioner turns summer grey', 0.6],
  ['我把耳机塞进耳朵里', 'I push the earphones into my ears', 1.2],
  ['让城市退到身后去', 'And let the city fall behind', 1.8],
  ['你说过的话还在耳边', 'The words you said are still beside my ear', 2.4],
  ['像一段没播完的和弦', 'Like a chord that never finished playing', 3],
  ['我在副歌里等你回头', "I'm waiting in the chorus for you to look back", 3.6],
  ['可是风只带来了雨', 'But the wind only brought rain', 4.2],
  ['如果时间可以倒着流', 'If time could flow backwards', 9],
  ['我会不会还在那个路口', 'Would I still be at that crossing', 14],
  ['把没说出口的温柔', 'All the tenderness left unsaid', 20],
  ['都唱进这一首歌', 'Sung into this one song', 26],
];

const tracks = Array.from({ length: 40 }, (_, index) => ({
  id: `demo-${index + 1}`,
  title: ['夜航', '落日之后', '北方来信', '雨幕', '午后三点', '候鸟', '静音模式', '旧磁带'][index % 8] + ` ${String(index + 1).padStart(2, '0')}`,
  artists: [{ id: `artist-${(index % 5) + 1}`, name: ['林屿', '南岸乐队', '陈述', '白噪', '梁小满'][index % 5] }],
  album: { id: `album-${(index % 6) + 1}`, title: ['夜色练习册', '海边旅馆', '慢速生活', '无人区', '回声'][index % 5] },
  coverUrl: cover((index * 37) % 360, String(index + 1)),
  durationSeconds: 180 + (index % 7) * 23,
  available: true,
}));

async function installHandlers(instance, urls) {
  await instance.evaluate(({ ipcMain }, { urls: mediaUrls, tracks: rows, lyrics }) => {
    const ok = data => ({ ok: true, data });
    const channels = ['auth:status', 'music:favorites', 'music:favorites-summary', 'music:resolve-playback', 'music:lyrics', 'music:set-favorite',
      'music:playlists', 'music:playlist-detail', 'music:search', 'music:history', 'music:album', 'music:artist', 'music:favorite-state', 'music:report-playback',
      'music:create-playlist', 'music:update-playlist-description', 'music:delete-playlist'];
    for (const channel of channels) ipcMain.removeHandler(channel);
    ipcMain.handle('auth:status', () => ok({ authenticated: true, persistence: 'memory-only' }));
    ipcMain.handle('music:favorites', (_event, input = {}) => {
      const start = input.start ?? 0;
      const page = rows.slice(start, start + 50);
      return ok({ tracks: page, nextStart: start + page.length, hasMore: start + page.length < rows.length, total: rows.length });
    });
    ipcMain.handle('music:favorites-summary', () => ok({ total: rows.length }));
    ipcMain.handle('music:report-playback', () => ok(undefined));
    ipcMain.handle('music:resolve-playback', () => ok({ url: mediaUrls[0], actualQuality: 'lossless' }));
    ipcMain.handle('music:lyrics', () => ok({
      synced: true,
      lines: lyrics.map(([text, translation, time], index) => ({
        timeMs: Math.round(time * 1000),
        text,
        ...(index < 8 ? { segments: text.match(/.{1,3}/gu).map((part, at) => ({ timeMs: Math.round(time * 1000) + at * 120, text: part })) } : {}),
        translation,
      })),
    }));
    ipcMain.handle('music:favorite-state', () => ok({ favorite: true }));
    ipcMain.handle('music:set-favorite', (_event, input) => ok({ favorite: input.favorite }));
    ipcMain.handle('music:playlists', () => ok({ playlists: rows.slice(0, 6).map((track, index) => ({
      id: `owned-${index + 1}`,
      title: ['夜里听的歌', '通勤路上', '安静下来', '写代码时', '雨天循环', '慢慢收藏'][index],
      kind: index < 2 ? 'owned' : 'collected',
      coverUrl: track.coverUrl,
      count: 12 + index * 7,
    })), truncated: false }));
    ipcMain.handle('music:playlist-detail', (_event, input) => ok({
      playlist: { id: input.id, title: '夜里听的歌', kind: input.kind, count: rows.length, description: '凌晨写代码时的背景音。', coverUrl: rows[0].coverUrl },
      tracks: rows.slice(0, 14), nextStart: 14, hasMore: false,
    }));
    ipcMain.handle('music:search', () => ok({ tracks: rows.filter((_, index) => index % 3 === 0).slice(0, 8), nextStart: 8, hasMore: false, total: 8 }));
    ipcMain.handle('music:history', () => ok({ tracks: rows.slice(2, 10) }));
    ipcMain.handle('music:album', () => ok({
      album: { id: 'album-1', title: '夜色练习册', coverUrl: rows[0].coverUrl, artists: [{ name: '林屿' }] },
      tracks: rows.slice(0, 10), nextStart: 10, hasMore: false,
    }));
    ipcMain.handle('music:artist', () => ok({
      artist: { id: 'artist-1', name: '林屿', coverUrl: rows[3].coverUrl },
      tracks: rows.slice(0, 8),
      albums: rows.slice(8, 14).map(track => ({ id: track.album.id, title: track.album.title, coverUrl: track.coverUrl })),
    }));
    ipcMain.handle('music:create-playlist', () => ok({ id: 'created-1' }));
    ipcMain.handle('music:update-playlist-description', (_event, input) => ok({ id: input.id }));
    ipcMain.handle('music:delete-playlist', (_event, input) => ok({ id: input.id }));
  }, { urls, tracks, lyrics: LYRICS });
}

let instance;
let page;
try {
  const wav = join(media, 'tone.wav');
  const mp3 = join(media, 'tone.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-ar', '44100', wav]);
  execFileSync('ffmpeg', ['-v', 'error', '-i', wav, '-c:a', 'libmp3lame', '-q:a', '6', mp3]);
  const samples = [{ type: 'audio/mpeg', bytes: (await readFile(mp3)).toString('base64') }];

  instance = await playwright.launch({
    executablePath: electron,
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), `--user-data-dir=${profile}`, 'out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  });
  page = await instance.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const shot = async name => { await page.mouse.move(2, 2); await page.waitForTimeout(450); await page.screenshot({ path: join(out, name) }); };
  await page.waitForTimeout(1200);
  await shot('01-welcome.png');

  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.__testAudioInstances = [];
    window.Audio = new Proxy(NativeAudio, {
      construct(target, args) {
        const element = Reflect.construct(target, args);
        window.__testAudioInstances.push(element);
        return element;
      },
    });
  });
  await installHandlers(instance, []);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  const urls = await page.evaluate(list => list.map(({ type, bytes }) => {
    const binary = atob(bytes);
    const data = Uint8Array.from(binary, character => character.charCodeAt(0));
    return URL.createObjectURL(new Blob([data], { type }));
  }), samples);
  await installHandlers(instance, [urls[0]]);
  await page.getByRole('button', { name: /^夜航 01/ }).waitFor({ timeout: 15000 });
  await shot('02-favorites.png');

  await page.getByRole('button', { name: '我的歌单', exact: true }).click();
  await page.getByRole('button', { name: /夜里听的歌/ }).waitFor({ timeout: 10000 });
  await shot('03-playlists.png');
  await page.getByRole('button', { name: /夜里听的歌/ }).click();
  await page.waitForTimeout(500);
  await shot('04-playlist-detail.png');

  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索歌曲' }).fill('夜');
  await page.locator('.search-bar button[type=submit]').click();
  await page.getByRole('button', { name: /^夜航 01/ }).waitFor({ timeout: 10000 });
  await shot('05-search.png');

  await page.getByRole('button', { name: '播放历史' }).click();
  await page.getByRole('button', { name: '华为历史（只读）' }).click();
  await page.locator('.library:not(.favorites-library) .track-name').first().waitFor({ timeout: 10000 });
  await shot('06-history.png');

  await page.getByRole('button', { name: '设置' }).click();
  await shot('07-settings-playback.png');
  await page.locator('.cache-block').scrollIntoViewIfNeeded();
  await shot('07b-settings-lyrics-cache.png');
  await page.locator('.settings-nav-item', { hasText: '外观' }).click();
  await shot('08-settings-appearance.png');
  await page.getByRole('button', { name: '衬线', exact: true }).click();
  await shot('09-settings-appearance-serif.png');
  await page.getByRole('button', { name: '恢复默认外观' }).click();

  // Installed fonts: queryLocalFonts() is allowed through the Electron local-fonts permission.
  await page.getByRole('button', { name: '系统字体…' }).click();
  const fontList = page.locator('.font-list button');
  await page.waitForFunction(() => document.querySelectorAll('.font-list button').length > 0, { timeout: 20000 }).catch(() => undefined);
  const fontCount = await fontList.count();
  if (fontCount) {
    await page.getByRole('textbox', { name: '搜索系统字体' }).fill('Sans');
    await page.waitForTimeout(200);
    await page.locator('.font-list').scrollIntoViewIfNeeded();
    await shot('10-settings-system-fonts.png');
    const target = fontList.filter({ hasText: /Noto Sans CJK|WenQuanYi|Liberation Sans|DejaVu Sans/i }).first();
    const chosen = await target.count() ? target : fontList.first();
    const chosenName = ((await chosen.textContent()) ?? '').trim();
    await chosen.click();
    await page.waitForTimeout(400);
    await page.locator('.font-list').scrollIntoViewIfNeeded();
    await shot('11-settings-font-applied.png');
    console.log('font applied:', chosenName);
  } else {
    console.log('font list empty — queryLocalFonts unavailable');
    await shot('10-settings-system-fonts.png');
  }

  // Custom accent through the native colour input.
  await page.locator('input[aria-label="自定义主题色"]').evaluate(el => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '#1f7a5a');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await shot('12-settings-custom-accent.png');

  await page.getByRole('button', { name: '恢复默认外观' }).click();
  await page.locator('.settings-nav-item', { hasText: '关于' }).click();
  await shot('13-settings-about.png');

  await page.getByRole('button', { name: '我的收藏' }).click();
  await page.locator('.favorites-library .track-row').first().hover();
  await page.getByRole('button', { name: '播放 夜航 01' }).click();
  await page.getByRole('button', { name: '暂停' }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(2400);
  await shot('14-now-playing.png');
  await page.getByRole('button', { name: '歌词' }).click();
  await page.getByText('我在副歌里等你回头').waitFor({ timeout: 5000 });
  await shot('15-lyrics-panel.png');
  await page.getByRole('button', { name: '沉浸歌词' }).click();
  await shot('16-lyrics-stage.png');
  await page.getByRole('button', { name: '退出歌词页' }).click();
  await page.getByRole('button', { name: '播放队列' }).click();
  await shot('17-queue.png');
  await page.getByRole('button', { name: '关闭' }).click();

  await page.getByRole('button', { name: '设置' }).click();
  await page.locator('.settings-nav-item', { hasText: '外观' }).click();
  await page.getByRole('button', { name: '主题色 靛蓝' }).click();
  await page.getByRole('slider', { name: '圆角' }).focus();
  for (let i = 0; i < 5; i += 1) await page.getByRole('slider', { name: '圆角' }).press('ArrowRight');
  await page.getByRole('slider', { name: '面板透明度' }).focus();
  for (let i = 0; i < 5; i += 1) await page.getByRole('slider', { name: '面板透明度' }).press('ArrowLeft');
  await shot('18-settings-appearance-blue.png');
  await page.getByRole('button', { name: '我的收藏' }).click();
  await shot('19-favorites-blue.png');

  await page.getByRole('button', { name: '设置' }).click();
  await page.locator('.settings-nav-item', { hasText: '外观' }).click();
  await page.getByRole('button', { name: '恢复默认外观' }).click();
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 640));
  await page.getByRole('button', { name: '我的收藏' }).click();
  await shot('20-favorites-960.png');

  console.log('screenshots written to', out);
} finally {
  await instance?.close().catch(() => undefined);
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  await rm(media, { recursive: true, force: true }).catch(() => undefined);
}

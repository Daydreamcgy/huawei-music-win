// 布局评审用：按 960 / 1322 / 2048 三个视口抓各页面，输出到 docs/review/<尺寸>/。
// 用法：先带 --remote-debugging-port=9222 启动，再 node tools/review-shots.mjs
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const SIZES = [
  { label: '960', width: 960, height: 620 },
  { label: '1322', width: 1322, height: 842 },
  { label: '2048', width: 2048, height: 1104 },
];

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0].pages()[0];
await page.waitForSelector('.app', { timeout: 15000 });

const click = async label => {
  await page.evaluate(text => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent?.includes(text));
    button?.click();
  }, label);
  await page.waitForTimeout(1200);
};

const shot = async (dir, name) => {
  for (let i = 0; i < 3; i += 1) {
    try {
      await page.screenshot({ path: `${dir}/${name}.png`, timeout: 90000 });
      console.log('shot', `${dir}/${name}.png`);
      return;
    } catch {
      await page.waitForTimeout(1500);
    }
  }
};

// 先确保迷你播放条有歌，播放页才抓得到内容
const needsTrack = await page.evaluate(() => Boolean(document.querySelector('.mini-player.is-idle')));
if (needsTrack) {
  await click('我的收藏');
  await page.evaluate(() => document.querySelector('.track-row')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await page.waitForTimeout(5000);
  // 点歌会同时打开播放页，先收起来，不然后面每张截图都是它
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
}

for (const size of SIZES) {
  const dir = `docs/review/${size.label}`;
  await mkdir(dir, { recursive: true });
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await click('首页');
  await shot(dir, '01-home');

  await click('音乐厅');
  await shot(dir, '02-hall');

  await click('我的收藏');
  await shot(dir, '03-favorites');

  await click('我的歌单');
  await shot(dir, '04-playlists');

  await page.evaluate(() => document.querySelector('.card')?.click());
  await page.waitForTimeout(2200);
  await shot(dir, '05-playlist');
  await page.evaluate(() => document.querySelector('.detail-back')?.click());
  await page.waitForTimeout(900);

  await click('设置');
  await shot(dir, '06-settings');
  await page.evaluate(() => document.querySelector('.main')?.scrollTo({ top: 400 }));
  await page.waitForTimeout(600);
  await shot(dir, '07-settings-scrolled');

  await page.evaluate(() => {
    const input = document.querySelector('.titlebar-search input');
    input?.focus();
  });
  await page.keyboard.type('林俊杰');
  await page.waitForTimeout(2600);
  await shot(dir, '08-search');

  await page.evaluate(() => {
    document.querySelector('.titlebar-search input')?.blur();
    document.querySelector('.search-clear')?.click();
  });
  await page.waitForTimeout(800);

  await page.evaluate(() => document.querySelector('.mini-track')?.click());
  await page.waitForTimeout(1800);
  await shot(dir, '09-player');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await shot(dir, '10-home-playing');
}

console.log('done');
process.exit(0);

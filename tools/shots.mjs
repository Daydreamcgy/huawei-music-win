// 用 CDP 连接已启动的 Electron 窗口，抓 README 用的截图。
// 交互统一走 DOM 事件：窗口可能被其他程序遮挡，Playwright 的「可点击」检查会因此超时。
// 用法：electron out/main/index.js --remote-debugging-port=9222 后执行
//   node tools/shots.mjs            → docs/screenshots/*.png（1322 宽）
//   node tools/shots.mjs fullscreen → docs/screenshots/fullscreen-*.png（2048 宽）
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const mode = process.argv[2] ?? '';
const prefix = mode ? `${mode}-` : '';
const viewport = mode === 'fullscreen' ? { width: 2048, height: 1104 } : { width: 1322, height: 860 };
const outDir = 'docs/screenshots';
await mkdir(outDir, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0].pages()[0];
await page.setViewportSize(viewport);

// 窗口被挡时 Chromium 会停止产帧，screenshot 会一直等到超时。
// 开一个 screencast 让合成器持续出帧，抓完再关。
const cdp = await page.context().newCDPSession(page);
cdp.on('Page.screencastFrame', event => {
  cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 2, maxWidth: 2048 });

const shoot = async name => {
  await page.screenshot({ path: `${outDir}/${prefix}${name}.png`, timeout: 60000 });
  console.log('shot', `${prefix}${name}`);
};
const clickText = async (text, selector = 'button') => {
  const ok = await page.evaluate(
    ({ label, scope }) => {
      const button = [...document.querySelectorAll(scope)].find(item => item.textContent?.includes(label));
      if (!button) return false;
      button.click();
      return true;
    },
    { label: text, scope: selector },
  );
  if (!ok) throw new Error(`找不到按钮：${text}`);
  await page.waitForTimeout(800);
};
const press = async (key, wait = 600) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(wait);
};

// 每次从干净的首页开始：重载会重置路由
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2600);
await shoot('home');

if (mode !== 'fullscreen') {
  await clickText('音乐厅');
  await page.waitForTimeout(1200);
  await shoot('hall');

  await clickText('我的歌单');
  await page.waitForTimeout(1200);
  await shoot('playlists');
  await page.evaluate(() => document.querySelector('.card')?.click());
  await page.waitForTimeout(2200);
  await shoot('playlist');

  await clickText('我的收藏');
  await page.waitForTimeout(900);
  await shoot('favorites');

  await clickText('设置');
  await page.waitForTimeout(1000);
  await shoot('settings');
}

// 播放一首：双击收藏里的第一行
await clickText('我的收藏');
await page.waitForTimeout(900);
if (mode === 'fullscreen') await shoot('favorites');
await page.evaluate(() => {
  document.querySelector('.track-row')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
});
await page.waitForTimeout(6000);
await shoot('player');

if (mode !== 'fullscreen') {
  // 队列抽屉（播放页开着也能开）
  await page.evaluate(() => {
    document.querySelector('.bar-right button[aria-label="播放队列"]')?.click();
  });
  await page.waitForTimeout(900);
  await shoot('queue');
  await page.evaluate(() => {
    document.querySelector('.bar-right button[aria-label="播放队列"]')?.click();
  });
  await page.waitForTimeout(600);
}

await press('Escape', 900);
await shoot('home-playing');

if (mode !== 'fullscreen') {
  // 右键菜单：在收藏列表里右键一行
  await clickText('我的收藏');
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const row = document.querySelector('.track-row');
    if (!row) return;
    const rect = row.getBoundingClientRect();
    row.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 240,
        clientY: rect.top + 26,
      }),
    );
  });
  await page.waitForTimeout(700);
  await shoot('track-menu');
}

console.log('done');
process.exit(0);

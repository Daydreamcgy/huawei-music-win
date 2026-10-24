// 用 CDP 连接已启动的 Electron 窗口，抓各页面截图。
// 交互统一走 DOM 事件：窗口可能被其他程序遮挡，Playwright 的「可点击」检查会因此超时。
// 用法：electron out/main/index.js --remote-debugging-port=9222 后执行
//   node tools/shots.mjs            → docs/screenshots/*.png
//   node tools/shots.mjs fullscreen → docs/screenshots/fullscreen-*.png
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const prefix = process.argv[2] ? `${process.argv[2]}-` : '';
const outDir = 'docs/screenshots';
await mkdir(outDir, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const page = context.pages()[0];

const shoot = async name => {
  await page.screenshot({ path: `${outDir}/${prefix}${name}.png` });
  const size = await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`);
  console.log('shot', `${prefix}${name}`, size);
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
  await page.waitForTimeout(700);
};

// 每次从干净的首页开始：重载会重置路由。
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2600);
await shoot('home');

await clickText('音乐厅');
await page.waitForTimeout(1200);
await shoot('hall');

// 侧栏第一个歌单：进去抓详情
await page.evaluate(() => document.querySelector('.side-playlist')?.click());
await page.waitForTimeout(2000);
await shoot('playlist');

await clickText('我的收藏');
await page.waitForTimeout(800);
await shoot('favorites');

await clickText('设置');
await page.waitForTimeout(1000);
await shoot('settings');

await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2600);
await clickText('我的收藏');
await page.waitForTimeout(800);
await page.evaluate(() => {
  const row = document.querySelector('.track-row');
  row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
});
await page.waitForTimeout(7000);
await shoot('player');

await page.keyboard.press('Escape');
await page.waitForTimeout(700);
await shoot('home-playing');

console.log('done');
process.exit(0);

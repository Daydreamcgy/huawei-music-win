// 把 build/icon-src.svg 栅格化成 build/icon-src.png（1024×1024，透明底）。
// 运行：Remove-Item Env:ELECTRON_RUN_AS_NODE; node_modules\electron\dist\electron.exe tools\rasterize-icon.mjs
// 图标唯一的源是 SVG；改图标只改 SVG，然后重跑本脚本 + scripts/make-icon.mjs。
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;
const input = process.argv[2] ?? 'build/icon-src.svg';
const output = process.argv[3] ?? 'build/icon-src.png';

async function main() {
  const svg = readFileSync(join(root, input), 'utf8');
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true, sandbox: false },
  });
  win.webContents.setFrameRate(30);

  const painted = new Promise(resolve => {
    win.webContents.once('paint', (_event, _dirty, image) => resolve(image));
  });

  const html = `<body style="margin:0;background:transparent;overflow:hidden">${svg}</body>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  const image = await Promise.race([
    painted,
    new Promise((_, reject) => setTimeout(() => reject(new Error('paint timeout')), 10_000)),
  ]);

  const { width, height } = image.getSize();
  writeFileSync(join(root, output), image.toPNG());
  process.stdout.write(`${output} ${width}x${height}\n`);
  win.destroy();
}

const guard = setTimeout(() => {
  process.stderr.write('rasterize timed out\n');
  app.exit(1);
}, 20_000);

app.whenReady().then(main).then(
  () => {
    clearTimeout(guard);
    setTimeout(() => app.exit(0), 100);
  },
  error => {
    clearTimeout(guard);
    process.stderr.write(`rasterize failed: ${error?.message ?? error}\n`);
    app.exit(1);
  },
);

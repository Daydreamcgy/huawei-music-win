// Launch the real Linux AppImage/unpacked binary in an isolated HOME/profile.
// No login or saved-account import; this is package integrity/startup, not real media acceptance.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { _electron as playwright } from 'playwright-core';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const supplied = process.argv[2];
if (!supplied) throw new Error('Pass the AppImage or unpacked executable path.');
const artifact = resolve(supplied);
const root = await mkdtemp(join(tmpdir(), 'huawei-packaged-'));
const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'),
  XDG_DATA_HOME: join(root, 'data'), ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' };
let instance;
try {
  let binary = artifact;
  if (artifact.endsWith('.AppImage')) {
    assert.equal(process.platform, 'linux');
    const extraction = join(root, 'extracted');
    await mkdir(extraction);
    execFileSync(artifact, ['--appimage-extract'], { cwd: extraction, env, stdio: 'ignore' });
    binary = join(extraction, 'squashfs-root', 'huawei-music-desktop');
  }
  const resources = process.platform === 'darwin' ? resolve(dirname(binary), '../Resources') : join(dirname(binary), 'resources');
  const archive = join(resources, 'app.asar');
  const entries = asar.listPackage(archive).map(path => path.replaceAll('\\', '/'));
  assert.deepEqual(entries.filter(path => /(^|\/)(\.local|research|docs|test|scripts|src|design-previews|\.git)(\/|$)/.test(path)), []);
  for (const required of ['out/main/index.js', 'out/preload/index.cjs', 'out/renderer/index.html']) {
    assert.ok(entries.includes(`/${required}`));
    assert.deepEqual(asar.extractFile(archive, required), await readFile(required), `packaged ${required} differs from current build`);
  }
  const main = asar.extractFile(archive, 'out/main/index.js').toString();
  assert.equal(main.includes('[dbg]'), false, 'temporary diagnostics in package');
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  instance = await playwright.launch({ executablePath: binary,
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), `--user-data-dir=${join(root, 'profile')}`], env });
  const page = await instance.firstWindow();
  await page.getByRole('button', { name: '打开官方登录' }).waitFor({ timeout: 15000 });
  const isolated = await page.evaluate(() => ({ node: typeof process, require: typeof require,
    genericIpc: typeof window.desktop.invoke, auth: typeof window.desktop.auth.status }));
  assert.deepEqual(isolated, { node: 'undefined', require: 'undefined', genericIpc: 'undefined', auth: 'function' });
  const status = await page.evaluate(() => window.desktop.auth.status());
  assert.equal(status.data.authenticated, false);
  assert.equal(await page.getByRole('button', { name: '播放', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByText(/当前版本/).waitFor();
  await page.getByRole('combobox', { name: '默认音质' }).selectOption('lossless');
  await page.waitForTimeout(150);
  const saved = JSON.parse(await readFile(join(root, 'profile', 'settings.json'), 'utf8'));
  assert.equal(saved.data.quality, 'lossless');
  const qa = resolve('release/qa');
  await mkdir(qa, { recursive: true });
  await page.screenshot({ path: join(qa, 'linux-packaged-settings.png') });
  await instance.close(); instance = undefined;
  await readFile(join(root, 'profile', 'session.enc')).then(() => assert.fail('unexpected session file'), error => assert.equal(error.code, 'ENOENT'));
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, version: pkg.version,
    appImageExtracted: artifact.endsWith('.AppImage'), packagedArchiveChecked: true, matchesCurrentBuild: true,
    isolatedProfile: true, rendererBoundary: true, settingsPersisted: true, loginNotAttempted: true,
    accountAndMediaAcceptance: 'pending' }));
} finally {
  if (instance) await instance.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}

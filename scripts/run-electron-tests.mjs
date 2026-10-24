// Xvfb is only needed on headless Linux; Windows/macOS use their native desktop session.
import { spawnSync } from 'node:child_process';
import electron from 'electron';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const suites = {
  smoke: [['node', 'scripts/test-electron-smoke.mjs'], ['node', 'scripts/test-electron-proxy.mjs']],
  ui: [['node', 'scripts/test-electron-ui.mjs']],
  business: [['node', 'scripts/test-electron-business.mjs']],
  favorites: [['node', 'scripts/test-electron-favorites.mjs']],
  packaged: [['node', 'scripts/test-packaged.mjs', ...process.argv.slice(3)]],
  callback: [['node', 'scripts/test-electron-login-callback.mjs']],
  cancel: [['node', 'scripts/test-electron-login-cancel.mjs']],
  navigation: [[electron, '--no-sandbox', 'scripts/test-electron-login-navigation.mjs']],
  storage: [['node', 'scripts/test-electron-safe-storage-restart.mjs']],
  live: [['node', 'scripts/test-electron-login-live.mjs', ...process.argv.slice(3)]],
};
const commands = suites[process.argv[2]];
if (!commands) throw new Error('Unknown Electron test suite.');
const env = { ...process.env };
let fontDirectory;
// Host caches can be newer than Electron's fontconfig. A fresh test-only cache keeps Chinese
// screenshots meaningful; production still uses the desktop's own fonts and configuration.
if (process.platform === 'linux' && !env.FONTCONFIG_FILE && existsSync('/usr/share/fonts')) {
  fontDirectory = mkdtempSync(join(tmpdir(), 'huawei-fontconfig-'));
  const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const config = join(fontDirectory, 'fonts.conf');
  writeFileSync(config, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig>
    <dir>/usr/share/fonts</dir><dir>/usr/local/share/fonts</dir><cachedir>${xml(join(fontDirectory, 'cache'))}</cachedir>
    <alias><family>sans-serif</family><prefer><family>Noto Sans CJK SC</family><family>WenQuanYi Zen Hei</family><family>DejaVu Sans</family></prefer></alias>
    <alias><family>system-ui</family><prefer><family>Noto Sans CJK SC</family><family>WenQuanYi Zen Hei</family><family>DejaVu Sans</family></prefer></alias>
  </fontconfig>`);
  env.FONTCONFIG_FILE = config;
}
try {
  for (const [command, ...args] of commands) {
    const executable = command === 'node' ? process.execPath : command;
    const headless = process.platform === 'linux' && !env.DISPLAY;
    const result = spawnSync(headless ? 'xvfb-run' : executable, headless ? ['-a', executable, ...args] : args, { stdio: 'inherit', env });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  }
} finally { if (fontDirectory) rmSync(fontDirectory, { recursive: true, force: true }); }

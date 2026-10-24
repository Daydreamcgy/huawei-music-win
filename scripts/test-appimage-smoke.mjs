import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appImage = join(process.cwd(), 'release/Huawei Music Desktop-0.0.1.AppImage');
const profileDir = await mkdtemp(join(tmpdir(), 'huawei-music-appimage-profile-'));
const homeDir = await mkdtemp(join(tmpdir(), 'huawei-music-appimage-home-'));
let child;

try {
  child = spawn('xvfb-run', ['-a', 'env', `HOME=${homeDir}`, `XDG_CONFIG_HOME=${join(homeDir, '.config')}`,
    `XDG_CACHE_HOME=${join(homeDir, '.cache')}`, appImage, '--appimage-extract-and-run', '--no-sandbox',
    `--user-data-dir=${profileDir}`], { stdio: 'ignore' });

  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const outcome = await Promise.race([
    exit,
    new Promise(resolve => setTimeout(() => resolve({ stayedOpen: true }), 10_000)),
  ]);
  assert.equal(outcome.stayedOpen, true, `AppImage exited during startup: ${JSON.stringify(outcome)}`);
  console.log('Linux AppImage stayed running for the isolated 10-second startup smoke.');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  }
  await rm(profileDir, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
}

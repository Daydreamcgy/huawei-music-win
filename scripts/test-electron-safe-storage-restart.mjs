import assert from 'node:assert/strict';
import electron from 'electron';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as playwright } from 'playwright-core';

const root = await mkdtemp(join(tmpdir(), 'huawei-safe-storage-restart-'));
const appDirectory = join(root, 'electron-app');
const userData = join(root, 'user-data');
const chromiumProfile = join(root, 'chromium-profile');
const temporaryHome = join(root, 'home');
const workerScript = fileURLToPath(new URL('./test-electron-safe-storage-worker.mjs', import.meta.url));
const storePath = fileURLToPath(new URL('../src/main/session-store.cjs', import.meta.url));
await mkdir(appDirectory, { recursive: true });
await mkdir(userData, { recursive: true });
await mkdir(chromiumProfile, { recursive: true });
await mkdir(temporaryHome, { recursive: true });
await writeFile(join(appDirectory, 'package.json'), JSON.stringify({ name: 'safe-storage-smoke', version: '1.0.0', type: 'module', main: workerScript }));
const candidate = {
  version: 1,
  music: {
    token: 'SAFE-STORAGE-RESTART-SMOKE-ONLY',
    snsUserID: 'SAFE-STORAGE-SMOKE-USER',
    expireTime: '20990101000000',
  },
};
const env = {
  ...process.env,
  HOME: temporaryHome,
  XDG_CONFIG_HOME: join(temporaryHome, '.config'),
  XDG_DATA_HOME: join(temporaryHome, '.local', 'share'),
  XDG_CACHE_HOME: join(temporaryHome, '.cache'),
  ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
};
let app;

async function launchWorker(operation, payload = {}) {
  app = await playwright.launch({
    executablePath: electron,
    args: ['--no-sandbox', `--user-data-dir=${chromiumProfile}`, appDirectory, userData],
    env,
  });
  try {
    await app.firstWindow();
    return await app.evaluate(async ({ safeStorage, app: electronApp }, input) => {
      const fs = process.getBuiltinModule('node:fs/promises');
      const path = process.getBuiltinModule('node:path');
      const moduleApi = process.getBuiltinModule('node:module');
      const store = moduleApi.createRequire(path.join(path.dirname(input.storePath), 'index.js'))(input.storePath);
      const directory = electronApp.getPath('userData');
      const persistence = store.persistenceMode(safeStorage);
      const backend = safeStorage.getSelectedStorageBackend?.() ?? 'unknown';
      if (input.operation === 'save') {
        const written = await store.saveSession(directory, input.candidate, safeStorage, fs);
        if (persistence !== 'secure') return { persistence, backend, written };
        const filePath = path.join(directory, 'session.enc');
        const [bytes, metadata] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
        return {
          persistence, backend, written,
          plaintextAbsent: !bytes.includes(Buffer.from(input.candidate.music.token)),
          fileMode: metadata.mode & 0o777,
        };
      }
      if (input.operation === 'load') return { persistence, backend, session: await store.loadSession(directory, safeStorage, fs) };
      if (input.operation === 'clear') {
        await store.clearSession(directory, fs);
        return { cleared: true };
      }
      throw new Error('Unsupported safeStorage restart smoke operation');
    }, { operation, storePath, candidate: payload.candidate ?? candidate });
  } finally {
    await app.close().catch(() => undefined);
    app = undefined;
  }
}

try {
  const saved = await launchWorker('save');
  assert.equal(saved.persistence, 'secure', `Electron selected ${saved.backend}; secure OS storage is unavailable`);
  assert.equal(saved.written, true);
  assert.equal(saved.plaintextAbsent, true);
  if (process.platform !== 'win32') assert.equal(saved.fileMode, 0o600);

  const bytes = await readFile(join(userData, 'session.enc'));
  assert.equal(bytes.includes(Buffer.from(candidate.music.token)), false);
  const restored = await launchWorker('load');
  assert.equal(restored.persistence, 'secure', `fresh Electron process selected ${restored.backend}`);
  assert.deepEqual(restored.session, candidate, 'fresh Electron process could not decrypt the stored session');

  assert.deepEqual(await launchWorker('clear'), { cleared: true });
  await stat(join(userData, 'session.enc')).then(
    () => assert.fail('synthetic session file remained after cleanup'),
    error => assert.equal(error.code, 'ENOENT'),
  );
  console.log(JSON.stringify({
    backend: saved.backend,
    encryptedFileWritten: true,
    plaintextAbsent: true,
    fileMode: process.platform === 'win32' ? 'platform-managed' : '0600',
    restoredByFreshElectronProcess: true,
    syntheticSessionRemoved: true,
  }));
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}

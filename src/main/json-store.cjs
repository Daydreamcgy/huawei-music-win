const { randomBytes } = require('node:crypto');
const { join } = require('node:path');

// Small schema-versioned JSON store with atomic writes and one backup for corrupt files.
async function loadJson(directory, name, fallback, fs) {
  const file = join(directory, `${name}.json`);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch { return fallback; }
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== 1 || !('data' in parsed)) throw new Error('unexpected shape');
    return parsed.data;
  } catch {
    await fs.rename(file, `${file}.bak`).catch(() => undefined);
    return fallback;
  }
}

async function writeJson(directory, name, data, fs) {
  await fs.mkdir(directory, { recursive: true });
  const file = join(directory, `${name}.json`);
  const temporary = join(directory, `${name}-${randomBytes(8).toString('hex')}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, data }), { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

const pendingWrites = new Map();

function saveJson(directory, name, data, fs) {
  const key = join(directory, name);
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => writeJson(directory, name, data, fs));
  pendingWrites.set(key, next);
  void next.finally(() => { if (pendingWrites.get(key) === next) pendingWrites.delete(key); }).catch(() => undefined);
  return next;
}

async function clearJson(directory, name, fs) {
  const key = join(directory, name);
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    for (const suffix of ['.json', '.json.bak']) {
      await fs.unlink(join(directory, `${name}${suffix}`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  });
  pendingWrites.set(key, next);
  try { await next; } finally { if (pendingWrites.get(key) === next) pendingWrites.delete(key); }
}

module.exports = { loadJson, saveJson, clearJson };

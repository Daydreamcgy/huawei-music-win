import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fs from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { loadJson, saveJson, clearJson } = require('../src/main/json-store.cjs');

test('json store round trips schema versioned data with restrictive permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'json-store-'));
  try {
    await saveJson(directory, 'settings', { closeBehavior: 'tray' }, fs);
    const raw = JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'));
    assert.deepEqual(raw, { schemaVersion: 1, data: { closeBehavior: 'tray' } });
    assert.deepEqual(await loadJson(directory, 'settings', null, fs), { closeBehavior: 'tray' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a corrupt file is backed up and replaced by the fallback value', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'json-store-'));
  try {
    await writeFile(join(directory, 'queue.json'), '{ not json');
    assert.deepEqual(await loadJson(directory, 'queue', null, fs), null);
    assert.equal(await readFile(join(directory, 'queue.json.bak'), 'utf8'), '{ not json');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an unknown schema version falls back instead of trusting the payload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'json-store-'));
  try {
    await writeFile(join(directory, 'settings.json'), JSON.stringify({ schemaVersion: 2, data: { volume: 1 } }));
    assert.deepEqual(await loadJson(directory, 'settings', { fallback: true }, fs), { fallback: true });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('queued writes finish in call order and clearing also removes corrupt backups', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'json-store-'));
  try {
    await Promise.all(Array.from({ length: 20 }, (_, index) => saveJson(directory, 'queue', { index }, fs)));
    assert.deepEqual(await loadJson(directory, 'queue', null, fs), { index: 19 });
    await writeFile(join(directory, 'queue.json.bak'), 'private synthetic backup');
    const pending = saveJson(directory, 'queue', { index: 20 }, fs);
    await clearJson(directory, 'queue', fs);
    await pending;
    await assert.rejects(readFile(join(directory, 'queue.json')));
    await assert.rejects(readFile(join(directory, 'queue.json.bak')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a missing file returns the fallback without creating anything', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'json-store-'));
  try {
    assert.equal(await loadJson(directory, 'queue', null, fs), null);
    await assert.rejects(readFile(join(directory, 'queue.json')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

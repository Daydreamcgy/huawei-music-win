// Disk persistence for lyrics: a shared network-result cache plus per-track local imports.
//
// Lyrics rarely change, so the cache is long lived (90 days) and survives restarts and account
// switches. Local imports always win over anything fetched from the network.
import { app } from 'electron';
import * as fs from 'node:fs/promises';
import { basename, join } from 'node:path';
import { decodeLyricsFile, lyricsCacheKey, sanitizeLyricsDoc } from './lyrics-store.mjs';
import type { LyricsDoc } from '../shared/types';

export type LyricsCacheInfo = {
  bytes: number;
  entries: number;
  localBytes: number;
  localEntries: number;
};

export type LocalLyrics = { doc: LyricsDoc; fileName: string; importedAt: number };

const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 3000;

const cacheDirectory = () => join(app.getPath('userData'), 'lyrics-cache');
const localDirectory = () => join(app.getPath('userData'), 'lyrics-local');

type StoredJson = Record<string, unknown>;

async function readJsonFile(path: string): Promise<StoredJson | null> {
  try {
    const stat = await fs.stat(path);
    if (stat.size > MAX_FILE_BYTES * 2) return null;
    const parsed: unknown = JSON.parse(await fs.readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed as StoredJson : null;
  } catch { return null; }
}

async function writeAtomic(path: string, text: string): Promise<void> {
  await fs.mkdir(join(path, '..'), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await fs.writeFile(temporary, text, { mode: 0o600 });
  await fs.rename(temporary, path);
}

async function directoryStats(directory: string): Promise<{ bytes: number; entries: number }> {
  let bytes = 0;
  let entries = 0;
  let names: string[];
  try { names = await fs.readdir(directory); } catch { return { bytes: 0, entries: 0 }; }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const stat = await fs.stat(join(directory, name));
      if (!stat.isFile()) continue;
      bytes += stat.size;
      entries += 1;
    } catch { /* A file may vanish between readdir and stat. */ }
  }
  return { bytes, entries };
}

export async function lyricsCacheInfo(): Promise<LyricsCacheInfo> {
  const cache = await directoryStats(cacheDirectory());
  const local = await directoryStats(localDirectory());
  return { ...cache, localBytes: local.bytes, localEntries: local.entries };
}

/** Reads a cached remote document, ignoring entries that are malformed or too old. */
export async function readCachedLyrics(trackId: string): Promise<LyricsDoc | null> {
  const path = join(cacheDirectory(), `${lyricsCacheKey(trackId)}.json`);
  const stored = await readJsonFile(path);
  if (!stored || stored.trackId !== trackId || typeof stored.savedAt !== 'number') return null;
  if (Date.now() - stored.savedAt > CACHE_TTL_MS) return null;
  return sanitizeLyricsDoc(stored.doc) as LyricsDoc | null;
}

export async function writeCachedLyrics(trackId: string, doc: LyricsDoc): Promise<void> {
  if (!doc.lines.length) return; // never persist "no lyrics" so a later provider attempt can win
  const path = join(cacheDirectory(), `${lyricsCacheKey(trackId)}.json`);
  const payload = JSON.stringify({ version: 1, trackId, savedAt: Date.now(), doc });
  if (Buffer.byteLength(payload) > MAX_FILE_BYTES) return;
  await writeAtomic(path, payload).catch(() => undefined);
  await pruneCache().catch(() => undefined);
}

/** Keeps the cache directory bounded without an index file. */
async function pruneCache(): Promise<void> {
  let names: string[];
  try { names = (await fs.readdir(cacheDirectory())).filter(name => name.endsWith('.json')); } catch { return; }
  if (names.length <= MAX_FILES) return;
  const stats = [];
  for (const name of names) {
    try { stats.push({ name, mtime: (await fs.stat(join(cacheDirectory(), name))).mtimeMs }); } catch { /* skip */ }
  }
  stats.sort((a, b) => a.mtime - b.mtime);
  for (const entry of stats.slice(0, Math.max(1, stats.length - MAX_FILES))) {
    await fs.rm(join(cacheDirectory(), entry.name), { force: true }).catch(() => undefined);
  }
}

export async function readLocalLyrics(trackId: string): Promise<LocalLyrics | null> {
  const stored = await readJsonFile(join(localDirectory(), `${lyricsCacheKey(trackId)}.json`));
  if (!stored || stored.trackId !== trackId) return null;
  const rawDoc = stored.doc && typeof stored.doc === 'object' ? stored.doc as Record<string, unknown> : null;
  if (!rawDoc) return null;
  const doc = sanitizeLyricsDoc({ ...rawDoc, source: 'local' }) as LyricsDoc | null;
  if (!doc) return null;
  return {
    doc,
    fileName: typeof stored.fileName === 'string' ? stored.fileName : '',
    importedAt: typeof stored.importedAt === 'number' ? stored.importedAt : 0,
  };
}

export async function writeLocalLyrics(trackId: string, text: string, fileName: string, doc: LyricsDoc): Promise<void> {
  const payload = JSON.stringify({
    version: 1,
    trackId,
    fileName: fileName.slice(0, 200),
    importedAt: Date.now(),
    doc: { ...doc, source: 'local' },
  });
  await writeAtomic(join(localDirectory(), `${lyricsCacheKey(trackId)}.json`), payload);
}

export async function removeLocalLyrics(trackId: string): Promise<boolean> {
  const path = join(localDirectory(), `${lyricsCacheKey(trackId)}.json`);
  try { await fs.access(path); } catch { return false; }
  await fs.rm(path, { force: true });
  return true;
}

/** Reads and decodes a user-picked lyric file (dialog is handled by the caller). */
export async function readLyricsFile(path: string): Promise<{ text: string; fileName: string }> {
  const stat = await fs.stat(path);
  if (!stat.isFile()) throw new Error('请选择一个歌词文件');
  if (stat.size > MAX_FILE_BYTES) throw new Error('歌词文件过大（上限 512 KB）');
  const text = decodeLyricsFile(await fs.readFile(path)).trim();
  if (!text) throw new Error('歌词文件是空的');
  return { text, fileName: basename(path) };
}

export async function clearLyricsCache(options: { local?: boolean } = {}): Promise<LyricsCacheInfo> {
  await fs.rm(cacheDirectory(), { recursive: true, force: true }).catch(() => undefined);
  if (options.local) await fs.rm(localDirectory(), { recursive: true, force: true }).catch(() => undefined);
  return lyricsCacheInfo();
}

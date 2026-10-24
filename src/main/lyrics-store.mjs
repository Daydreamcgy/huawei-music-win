// Pure helpers for the on-disk lyric cache and local lyric imports.
import { createHash } from 'node:crypto';

/** Stable, filesystem-safe key for a track id (the raw id may contain slashes or colons). */
export function lyricsCacheKey(trackId) {
  return createHash('sha256').update(String(trackId ?? '')).digest('hex').slice(0, 32);
}

/**
 * Decodes a lyric file: BOM-aware UTF-16 / UTF-8, falling back to GBK because a lot of Chinese
 * .lrc files in the wild are still GBK encoded.
 */
export function decodeLyricsFile(buffer) {
  if (!buffer || !buffer.length) return '';
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    // Swap to little endian before decoding.
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  try { return new TextDecoder('gbk').decode(buffer); } catch { return utf8; }
}

const MAX_LINES = 4000;
const MAX_LINE_TEXT = 2000;

/** Validates a lyrics document that came back from disk before it is trusted again. */
export function sanitizeLyricsDoc(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.synced !== 'boolean' || !Array.isArray(value.lines)) return null;
  const lines = [];
  for (const line of value.lines.slice(0, MAX_LINES)) {
    if (!line || typeof line.text !== 'string') return null;
    const text = line.text.slice(0, MAX_LINE_TEXT);
    const timeMs = typeof line.timeMs === 'number' && Number.isFinite(line.timeMs) && line.timeMs >= 0 ? line.timeMs : null;
    const entry = { timeMs, text };
    if (typeof line.translation === 'string' && line.translation) entry.translation = line.translation.slice(0, MAX_LINE_TEXT);
    if (Array.isArray(line.segments)) {
      const segments = line.segments
        .filter(segment => segment && typeof segment.text === 'string')
        .slice(0, 400)
        .map(segment => ({
          timeMs: typeof segment.timeMs === 'number' && Number.isFinite(segment.timeMs) ? segment.timeMs : null,
          text: segment.text.slice(0, MAX_LINE_TEXT),
        }));
      if (segments.length) entry.segments = segments;
    }
    lines.push(entry);
  }
  if (!lines.length) return null;
  const doc = { synced: value.synced, lines };
  for (const key of ['source', 'matchedTitle', 'matchedArtist']) {
    if (typeof value[key] === 'string' && value[key]) doc[key] = String(value[key]).slice(0, 200);
  }
  return doc;
}

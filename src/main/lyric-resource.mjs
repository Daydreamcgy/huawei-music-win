import { isSafeResourceUrl } from '../safe-media-url.mjs';

export function lyricAddressFrom(response) {
  let extra = response?.contentExInfo;
  if (typeof extra === 'string') { try { extra = JSON.parse(extra); } catch { extra = null; } }
  const values = [response?.lyricAddress, response?.lyricAddres, extra?.lyricAddress, extra?.lyricAddres,
    extra?.lyrics?.lyricAddress, extra?.lyrics?.lineByLineLyric, response?.lyrics?.lineByLineLyric];
  return values.find(value => typeof value === 'string' && isSafeResourceUrl(value));
}

// Some playback responses embed the lyric text instead of pointing at a resource. The public H5
// shape wraps it in contentExInfo and sometimes nests another JSON blob inside, so unwrap at most
// a couple of levels and reject anything that is not plainly a lyric string.
function unwrapLyricValue(value, depth = 0) {
  if (typeof value !== 'string' || depth > 2) return null;
  const text = value.trim();
  if (!text || text.length > 512 * 1024) return null;
  if (!text.startsWith('{')) return text;
  try {
    const parsed = JSON.parse(text);
    return unwrapLyricValue(parsed?.lyric ?? parsed?.lyrics ?? parsed?.content ?? parsed?.lrc, depth + 1);
  } catch { return null; }
}

export function inlineLyricsFrom(response) {
  let extra = response?.contentExInfo;
  if (typeof extra === 'string') { try { extra = JSON.parse(extra); } catch { extra = null; } }
  const values = [extra?.lyrics, extra?.Lyrics, response?.lyrics, response?.Lyrics];
  for (const value of values) {
    const text = unwrapLyricValue(value);
    if (text) return text;
  }
  return null;
}

export async function readBoundedText(response, maxBytes = 512 * 1024) {
  const size = Number(response.headers.get('content-length'));
  if (Number.isFinite(size) && size > maxBytes) { await response.body?.cancel(); throw new Error('歌词资源过大'); }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error('歌词资源过大'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

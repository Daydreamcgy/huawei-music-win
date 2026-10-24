// Third-party lyric fallback. The provider returns no lyrics for a large part of the library, so
// we match against public lyric libraries using title + artist + duration. Matching is strict
// (see lyrics-provider.mjs): showing the wrong song's lyrics is worse than showing none.
import { fetch as httpFetch } from 'undici';
import { parseLyrics } from '../lyrics.mjs';
import {
  decodeKugouLyrics, kugouCandidates, kugouCandidatesById, kugouDownloadUrl, kugouLyricSearchUrl,
  kugouSearchUrl, lrclibCandidates, lrclibSearchUrl, pickCandidate,
} from './lyrics-provider.mjs';
import type { LyricsDoc } from '../shared/types';

export type LyricsQuery = {
  title?: string;
  artist?: string;
  album?: string;
  durationSeconds?: number;
};

const USER_AGENT = 'HuaweiMusicDesktop/0.0.1 (unofficial study client)';
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 8_000;

async function readJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await httpFetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
    headers: { accept: 'application/json,text/plain,*/*', 'user-agent': USER_AGENT, ...headers },
  });
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); return null; }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) { await response.body?.cancel().catch(() => undefined); return null; }
  const text = await response.text();
  if (text.length > MAX_BYTES) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function fromKugou(query: LyricsQuery): Promise<LyricsDoc | null> {
  const headers = { referer: 'https://www.kugou.com/' };
  const search = await readJson(kugouSearchUrl(query), headers);
  const match = pickCandidate(kugouCandidates(search), query);
  if (!match?.hash) return null;
  const index = await readJson(kugouLyricSearchUrl(match.hash), headers);
  const lyrics = kugouCandidatesById(index);
  // The hash pins the recording, so the first lyric entry belongs to the same song even when its
  // title carries extra suffixes (Live, remaster, …) that would fail a strict re-match.
  const picked = pickCandidate(lyrics, query) ?? lyrics[0];
  if (!picked) return null;
  const downloaded = await readJson(kugouDownloadUrl(picked.id, picked.accesskey), headers);
  const text = decodeKugouLyrics(downloaded);
  if (!text) return null;
  const doc = parseLyrics(text) as LyricsDoc;
  if (!doc.lines.length) return null;
  return { ...doc, source: 'kugou', matchedTitle: match.title, matchedArtist: match.artists?.join(' / ') };
}

async function fromLrclib(query: LyricsQuery): Promise<LyricsDoc | null> {
  const search = await readJson(lrclibSearchUrl(query));
  const match = pickCandidate(lrclibCandidates(search), query);
  if (!match) return null;
  const text = match.syncedLyrics ?? match.plainLyrics;
  if (!text) return null;
  const doc = parseLyrics(text) as LyricsDoc;
  if (!doc.lines.length) return null;
  return { ...doc, source: 'lrclib', matchedTitle: match.title, matchedArtist: match.artists?.join(' / ') };
}

/** Tries each public lyric library in order; any failure falls through to the next one. */
export async function thirdPartyLyrics(query: LyricsQuery): Promise<LyricsDoc | null> {
  if (!query.title?.trim()) return null;
  for (const provider of [fromKugou, fromLrclib]) {
    try {
      const doc = await provider(query);
      if (doc) return doc;
    } catch { /* A lyric service outage must never interrupt playback. */ }
  }
  return null;
}

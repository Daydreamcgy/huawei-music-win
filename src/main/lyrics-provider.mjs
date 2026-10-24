// Pure helpers for matching a third-party lyric entry against what we know about a track.
// Network access lives in lyrics-fallback.ts; everything here is deterministic and unit tested.

const BRACKETS = /[([【（][^)\]】）]*[)\]】）]/g;
const NOISE = /[\s\-_·・.,，。!！?？'"“”‘’:：/\\|、]/g;

/** Normalizes a title or artist for comparison: drop bracket notes, case, punctuation, spaces. */
export function normalizeName(value) {
  return String(value ?? '')
    .replace(BRACKETS, '')
    .toLowerCase()
    .replace(NOISE, '');
}

function splitArtists(value) {
  return String(value ?? '')
    .split(/[、/&,;]| feat\.? | ft\.? /i)
    .map(part => normalizeName(part))
    .filter(Boolean);
}

/**
 * Scores a candidate (0 = unusable, higher = better). Returns null when the candidate is a hard
 * mismatch: a wrong title or a wrong artist must never be shown, even if nothing else matched.
 *
 * A non-exact title is only accepted when the duration also agrees, so "安静下来" can never stand
 * in for "安静" just because it contains the substring.
 */
export function scoreCandidate(candidate, query) {
  const candidateTitle = normalizeName(candidate?.title);
  const wantedTitle = normalizeName(query?.title);
  if (!candidateTitle || !wantedTitle) return null;
  const exactTitle = candidateTitle === wantedTitle;
  const looseTitle = candidateTitle.includes(wantedTitle) || wantedTitle.includes(candidateTitle);
  if (!exactTitle && !looseTitle) return null;

  const wantedArtists = splitArtists(query?.artist);
  const candidateArtists = Array.isArray(candidate?.artists)
    ? candidate.artists.map(name => normalizeName(name)).filter(Boolean)
    : splitArtists(candidate?.artist);
  const artistExact = wantedArtists.length > 0 && candidateArtists.some(name => wantedArtists.includes(name));
  const artistLoose = wantedArtists.length > 0 && candidateArtists.some(name => wantedArtists.some(wanted => name.includes(wanted) || wanted.includes(name)));
  if (wantedArtists.length && !artistLoose) return null;

  const wantedDuration = Number(query?.durationSeconds);
  const candidateDuration = Number(candidate?.durationSeconds);
  const bothDurations = Number.isFinite(wantedDuration) && wantedDuration > 30 && Number.isFinite(candidateDuration) && candidateDuration > 30;
  const delta = bothDurations ? Math.abs(candidateDuration - wantedDuration) : null;
  const durationClose = delta !== null && delta <= 8;
  if (!exactTitle && !durationClose) return null;

  let score = exactTitle ? 1.3 : 0.9;
  if (artistExact) score += 0.9;
  else if (artistLoose) score += 0.6;
  if (delta !== null) {
    if (delta <= 3) score += 0.6;
    else if (delta <= 8) score += 0.3;
    else if (delta > 25) score -= 0.5;
  }
  return score;
}

/** Minimum score we are willing to display; wrong lyrics are worse than no lyrics. */
export const MIN_SCORE = 1.5;

export function pickCandidate(candidates, query) {
  if (!Array.isArray(candidates)) return null;
  let best = null;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, query);
    if (score === null || score < MIN_SCORE) continue;
    if (!best || score > best.score) best = { score, candidate };
  }
  return best ? { ...best.candidate, score: best.score } : null;
}

export function kugouSearchUrl(query) {
  const params = new URLSearchParams({
    keyword: [query?.title, query?.artist].filter(Boolean).join(' ').trim(),
    page: '1',
    pagesize: '20',
    platform: 'WebFilter',
    userid: '0',
    clientver: '2000',
    iscorrection: '1',
    privilege_filter: '0',
    filter: '10',
  });
  return `https://songsearch.kugou.com/song_search_v2?${params}`;
}

/** Maps the Kugou search payload onto the common candidate shape. */
export function kugouCandidates(payload) {
  const lists = payload?.data?.lists;
  if (!Array.isArray(lists)) return [];
  return lists
    .map(row => ({
      title: typeof row?.SongName === 'string' ? row.SongName : '',
      artists: typeof row?.SingerName === 'string' ? row.SingerName.split(/[、/&,]/).map(name => name.trim()).filter(Boolean) : [],
      durationSeconds: Number(row?.Duration) || undefined,
      hash: typeof row?.FileHash === 'string' ? row.FileHash : '',
    }))
    .filter(candidate => candidate.title && candidate.hash);
}

export function kugouLyricSearchUrl(hash) {
  const params = new URLSearchParams({ ver: '1', man: 'yes', client: 'mobi', keyword: '', duration: '', hash: String(hash ?? '') });
  return `https://krcs.kugou.com/search?${params}`;
}

export function kugouCandidatesById(payload) {
  const candidates = payload?.candidates;
  if (!Array.isArray(candidates)) return [];
  return candidates
    .map(row => ({
      id: String(row?.id ?? ''),
      accesskey: String(row?.accesskey ?? ''),
      title: typeof row?.song === 'string' ? row.song : '',
      artists: typeof row?.singer === 'string' ? row.singer.split(/[、/&,]/).map(name => name.trim()).filter(Boolean) : [],
      durationSeconds: Number(row?.duration) ? Number(row.duration) / 1000 : undefined,
    }))
    .filter(candidate => candidate.id && candidate.accesskey);
}

export function kugouDownloadUrl(id, accesskey) {
  const params = new URLSearchParams({ ver: '1', client: 'pc', id: String(id ?? ''), accesskey: String(accesskey ?? ''), fmt: 'lrc', charset: 'utf8' });
  return `https://lyrics.kugou.com/download?${params}`;
}

/** The download endpoint answers with base64 in `content`; older builds even prepend a BOM. */
export function decodeKugouLyrics(payload) {
  const content = payload?.content;
  if (typeof content !== 'string' || !content) return null;
  try {
    const text = Buffer.from(content, 'base64').toString('utf8').replace(/^\uFEFF/, '');
    return text.trim() ? text : null;
  } catch { return null; }
}

export function lrclibSearchUrl(query) {
  const params = new URLSearchParams({ q: [query?.title, query?.artist].filter(Boolean).join(' ').trim() });
  return `https://lrclib.net/api/search?${params}`;
}

export function lrclibCandidates(payload) {
  if (!Array.isArray(payload)) return [];
  return payload
    .map(row => ({
      title: typeof row?.trackName === 'string' ? row.trackName : '',
      artists: typeof row?.artistName === 'string' ? row.artistName.split(/[、/&,]/).map(name => name.trim()).filter(Boolean) : [],
      durationSeconds: Number(row?.duration) || undefined,
      syncedLyrics: typeof row?.syncedLyrics === 'string' ? row.syncedLyrics : null,
      plainLyrics: typeof row?.plainLyrics === 'string' ? row.plainLyrics : null,
      instrumental: row?.instrumental === true,
    }))
    .filter(candidate => candidate.title && !candidate.instrumental && (candidate.syncedLyrics || candidate.plainLyrics));
}

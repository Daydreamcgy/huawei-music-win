import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeKugouLyrics, kugouCandidates, kugouCandidatesById, kugouDownloadUrl, kugouLyricSearchUrl,
  kugouSearchUrl, lrclibCandidates, lrclibSearchUrl, normalizeName, pickCandidate, scoreCandidate,
} from '../src/main/lyrics-provider.mjs';

const query = { title: '假如', artist: '信乐团', durationSeconds: 264 };

test('an exact title, artist and duration scores highest', () => {
  const score = scoreCandidate({ title: '假如', artists: ['信乐团'], durationSeconds: 264 }, query);
  assert.ok(score >= 2.8, String(score));
});

test('bracket suffixes and punctuation are ignored when comparing titles', () => {
  assert.equal(normalizeName('安静 (Live)'), normalizeName('安静'));
  assert.equal(normalizeName('Bohemian Rhapsody'), 'bohemianrhapsody');
  const score = scoreCandidate({ title: '假如（Live版）', artists: ['信乐团'], durationSeconds: 259 }, query);
  assert.ok(score !== null && score >= 2.2, String(score));
});

test('a different song whose title merely contains the wanted one is rejected unless the duration agrees', () => {
  // "安静下来" contains "安静" but is a different recording at a different length.
  assert.equal(scoreCandidate({ title: '安静下来', artists: ['周杰伦'], durationSeconds: 240 }, { title: '安静', artist: '周杰伦', durationSeconds: 325 }), null);
  // Same substring case, but the durations line up: still only a loose match, not a false negative.
  assert.ok(scoreCandidate({ title: '安静 (安静下来版)', artists: ['周杰伦'], durationSeconds: 325 }, { title: '安静', artist: '周杰伦', durationSeconds: 325 }) !== null);
});

test('a different artist is always rejected', () => {
  assert.equal(scoreCandidate({ title: '假如', artists: ['五月天'], durationSeconds: 264 }, query), null);
  assert.equal(scoreCandidate({ title: '假如', artist: '五月天', durationSeconds: 264 }, query), null);
});

test('a cover by another artist is never accepted, but multi-artist credits still match', () => {
  assert.equal(scoreCandidate({ title: '朵', artists: ['张大为', '赵雷'], durationSeconds: 293 }, { title: '朵', artist: '赵雷', durationSeconds: 292 }) !== null, true);
  assert.equal(scoreCandidate({ title: '朵', artists: ['某个翻唱'], durationSeconds: 292 }, { title: '朵', artist: '赵雷', durationSeconds: 292 }), null);
});

test('pickCandidate returns the best grounded candidate and drops weak ones', () => {
  const candidates = [
    { title: '假如', artists: ['信乐团'], durationSeconds: 288 },        // live version, 24s off
    { title: '假如', artists: ['信乐团'], durationSeconds: 264 },        // exact
    { title: '假如爱有天意', artists: ['李健'], durationSeconds: 264 },  // wrong song
  ];
  const picked = pickCandidate(candidates, query);
  assert.equal(picked.durationSeconds, 264);
  assert.equal(pickCandidate([{ title: '别的歌', artists: ['信乐团'], durationSeconds: 264 }], query), null);
  assert.equal(pickCandidate(null, query), null);
});

test('kugou candidate mapping keeps only usable rows', () => {
  const candidates = kugouCandidates({ data: { lists: [
    { SongName: '安静', SingerName: '周杰伦', Duration: 334, FileHash: 'ABC' },
    { SongName: '安静', SingerName: '周杰伦', FileHash: 'NOHASH' },
    { SongName: '', FileHash: 'EMPTY' },
  ] } });
  assert.deepEqual(candidates.map(row => row.hash), ['ABC', 'NOHASH']);
  assert.deepEqual(candidates[0].artists, ['周杰伦']);
  assert.equal(candidates[1].durationSeconds, undefined);
  assert.deepEqual(kugouCandidates({}), []);
});

test('kugou lyric index and download urls carry the signed identifiers', () => {
  assert.match(kugouSearchUrl(query), /^https:\/\/songsearch\.kugou\.com\/song_search_v2\?/);
  assert.match(decodeURIComponent(kugouSearchUrl(query).replaceAll('+', ' ')), /keyword=假如 信乐团/);
  assert.match(kugouLyricSearchUrl('ABC'), /hash=ABC/);
  assert.match(kugouDownloadUrl('42', 'KEY'), /id=42&accesskey=KEY&fmt=lrc/);
  const rows = kugouCandidatesById({ candidates: [{ id: 1, accesskey: 'K', song: '安静', singer: '周杰伦', duration: 334417 }, { id: 2 }] });
  assert.deepEqual(rows, [{ id: '1', accesskey: 'K', title: '安静', artists: ['周杰伦'], durationSeconds: 334.417 }]);
});

test('kugou lyrics arrive base64 encoded, optionally with a BOM', () => {
  const lrc = '[00:01.00]第一句';
  assert.equal(decodeKugouLyrics({ content: Buffer.from(lrc).toString('base64') }), lrc);
  assert.equal(decodeKugouLyrics({ content: Buffer.from(`\uFEFF${lrc}`).toString('base64') }), lrc);
  assert.equal(decodeKugouLyrics({ content: '' }), null);
  assert.equal(decodeKugouLyrics({}), null);
});

test('lrclib candidates drop instrumentals and empty lyric rows', () => {
  const rows = lrclibCandidates([
    { trackName: 'Bohemian Rhapsody', artistName: 'Queen', duration: 355, syncedLyrics: '[00:01.00]x', plainLyrics: 'x', instrumental: false },
    { trackName: 'Solo', artistName: 'X', duration: 100, syncedLyrics: null, plainLyrics: null, instrumental: false },
    { trackName: 'Instrumental', artistName: 'Y', duration: 100, syncedLyrics: '[00:01.00]x', instrumental: true },
  ]);
  assert.equal(rows.length, 1);
  assert.match(decodeURIComponent(lrclibSearchUrl(query).replaceAll('+', ' ')), /q=假如 信乐团/);
});

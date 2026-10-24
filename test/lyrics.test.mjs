import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLyrics, activeLyricIndex } from '../src/lyrics.mjs';

test('multi timestamp lines expand and sort by time', () => {
  const result = parseLyrics('[00:12.00]副歌\n[00:01.50]开场\n[00:05.00][00:20.00]重复');
  assert.equal(result.synced, true);
  assert.deepEqual(result.lines.map(line => [line.timeMs, line.text]), [
    [1500, '开场'],
    [5000, '重复'],
    [12000, '副歌'],
    [20000, '重复'],
  ]);
});

test('offset shifts every timestamp and is not emitted as a lyric line', () => {
  const result = parseLyrics('[offset:-500]\n[00:02.000]歌词');
  assert.deepEqual(result.lines, [{ timeMs: 1500, text: '歌词' }]);
});

test('centisecond precision is read as hundredths, not milliseconds', () => {
  const result = parseLyrics('[00:03.25]两位小数');
  assert.equal(result.lines[0].timeMs, 3250);
});

test('plain text lyrics stay unsynced and keep their order', () => {
  const result = parseLyrics('第一行\n第二行\n');
  assert.equal(result.synced, false);
  assert.deepEqual(result.lines.map(line => line.text), ['第一行', '第二行']);
  assert.ok(result.lines.every(line => line.timeMs === null));
});

test('empty and non string payloads return an empty unsynced document', () => {
  assert.deepEqual(parseLyrics(''), { synced: false, lines: [] });
  assert.deepEqual(parseLyrics(undefined), { synced: false, lines: [] });
});

test('active lyric index tracks playback position and boundaries', () => {
  const { lines } = parseLyrics('[00:01.00]a\n[00:02.00]b\n[00:03.00]c');
  assert.equal(activeLyricIndex(lines, 0), -1);
  assert.equal(activeLyricIndex(lines, 1000), 0);
  assert.equal(activeLyricIndex(lines, 2999), 1);
  assert.equal(activeLyricIndex(lines, 99_000), 2);
  assert.equal(activeLyricIndex([], 5000), -1);
});

test('word level marks become segments without leaking into the line text', () => {
  const result = parseLyrics('[00:10.00]<00:10.00>原来<00:10.60>你<00:11.20>也在这里');
  assert.equal(result.synced, true);
  assert.equal(result.lines[0].text, '原来你也在这里');
  assert.deepEqual(result.lines[0].segments, [
    { timeMs: 10_000, text: '原来' },
    { timeMs: 10_600, text: '你' },
    { timeMs: 11_200, text: '也在这里' },
  ]);
});

test('a second line sharing the exact timestamp becomes a translation', () => {
  const result = parseLyrics('[00:05.00]Hello world\n[00:05.00]你好世界\n[00:09.00]Next');
  assert.deepEqual(result.lines.map(line => [line.timeMs, line.text, line.translation]), [
    [5000, 'Hello world', '你好世界'],
    [9000, 'Next', undefined],
  ]);
});

test('identical duplicate stamps are dropped instead of faked as a translation', () => {
  const result = parseLyrics('[00:05.00]副歌\n[00:05.00]副歌');
  assert.deepEqual(result.lines, [{ timeMs: 5000, text: '副歌' }]);
});

test('metadata headers never become lyric lines', () => {
  const result = parseLyrics('[ti:歌名]\n[ar:歌手]\n[al:专辑]\n[by:某人]\n[00:01.00]正文');
  assert.deepEqual(result.lines, [{ timeMs: 1000, text: '正文' }]);
  assert.deepEqual(parseLyrics('[ti:只有元数据]'), { synced: false, lines: [] });
});

test('word marks survive on plain text lyrics as well', () => {
  const result = parseLyrics('<00:01.00>逐字\n<00:02.00>纯文本');
  assert.equal(result.synced, false);
  assert.deepEqual(result.lines.map(line => line.text), ['逐字', '纯文本']);
  assert.equal(result.lines[0].segments[0].timeMs, 1000);
});

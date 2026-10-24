import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFcList, parseWindowsFontList } from '../src/main/fonts.mjs';

test('fc-list family output is split, deduplicated and sorted', () => {
  const output = [
    'Noto Sans CJK SC,Noto Sans CJK SC:style=Regular',
    'Noto Sans CJK SC,Noto Sans CJK SC:style=Bold',
    'WenQuanYi Zen Hei,WenQuanYi Zen Hei:style=Regular',
    'AR PL UMing CN:style=Light',
    '',
  ].join('\n');
  assert.deepEqual(parseFcList(output), ['AR PL UMing CN', 'Noto Sans CJK SC', 'WenQuanYi Zen Hei']);
  assert.deepEqual(parseFcList(''), []);
  assert.deepEqual(parseFcList(null), []);
});

test('windows font names drop legacy type suffixes and ignore blank lines', () => {
  const output = ['Arial (TrueType)', 'Segoe UI (TrueType)', 'Source Han Sans SC (OpenType)', '', '  Microsoft YaHei  '].join('\r\n');
  assert.deepEqual(parseWindowsFontList(output), ['Arial', 'Microsoft YaHei', 'Segoe UI', 'Source Han Sans SC']);
  assert.deepEqual(parseWindowsFontList(''), []);
});

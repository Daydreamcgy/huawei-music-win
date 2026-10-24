// Pure parsers for the platform font listings. Kept separate so they can be unit tested.

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** `fc-list : family` prints "Family One,Family One:style=Bold"; keep unique family names. */
export function parseFcList(output) {
  const names = new Set();
  for (const line of String(output ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const familyPart = line.split(/:style=/)[0] ?? line;
    for (const part of familyPart.split(',')) {
      const name = part.trim();
      if (name) names.add(name);
    }
  }
  return sorted(names);
}

/** PowerShell prints one family name per line; strip any legacy "(TrueType)" suffix. */
export function parseWindowsFontList(output) {
  const names = new Set();
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const name = line.replace(/\s*\((TrueType|OpenType|PostScript|Type 1)\)\s*$/i, '').trim();
    if (name) names.add(name);
  }
  return sorted(names);
}

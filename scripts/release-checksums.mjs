import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'release');
async function artifacts(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (/unpacked|\.app$/.test(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await artifacts(full));
    else if (/\.(exe|dmg|AppImage|deb)$/.test(entry.name)) paths.push(full);
  }
  return paths;
}
const lines = [];
for (const file of (await artifacts(root)).sort()) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${relative(root, file).replaceAll('\\', '/')}`);
}
if (!lines.length) throw new Error('No installer artifacts to checksum.');
await writeFile(join(root, 'SHA256SUMS'), `${lines.join('\n')}\n`);
console.log(`Wrote SHA256SUMS for ${lines.length} local artifacts. Nothing uploaded.`);

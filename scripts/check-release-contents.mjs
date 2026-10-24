// Offline release-content check.
//
// Electron packaging (electron-builder) cannot run in every sandbox because it spawns `npm`
// and downloads tooling. This script reproduces the project's `build.files` allowlist with the
// same include/exclude semantics and asserts the resulting app archive holds only shippable
// output: no .local/, research/, docs/, test/, scripts/ or unpublished project sources.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const staging = await mkdtemp(join(tmpdir(), 'huawei-release-'));

// These must never be copied into the app payload at all, regardless of build.files excludes.
const neverStaged = [
  /(^|\/)\.local(\/|$)/, /(^|\/)research(\/|$)/, /(^|\/)\.git(\/|$)/,
];
// These must not survive into the shippable payload once build.files excludes apply.
const forbiddenInPayload = [
  /(^|\/)\.local(\/|$)/, /(^|\/)research(\/|$)/, /(^|\/)\.git(\/|$)/,
  /(^|\/)docs(\/|$)/, /(^|\/)test(\/|$)/, /(^|\/)scripts(\/|$)/, /(^|\/)src(\/|$)/,
];
// Project sources must never ship from the repo; dependency type declarations (.d.ts under
// node_modules) are legitimate runtime files and are allowed.
const forbiddenSource = /\.(ts|tsx|mjs)$/;

// Translate a single electron-builder negation glob into a regex. Supports the
// `**/<name>/**` and `**/<file>` forms this project actually uses.
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\*\*\//g, '(?:.*/)?').replace(/\/\*\*$/g, '(?:/.*)?');
  return new RegExp(`^${body}$`);
}

function isExcluded(negations, file) {
  const normalized = file.replaceAll('\\', '/');
  return negations.some(regex => regex.test(normalized));
}

async function walk(directory, base = directory) {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, item.name);
    if (item.isDirectory()) entries.push(...await walk(full, base));
    else entries.push(relative(base, full));
  }
  return entries;
}

async function pruneEmptyDirs(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const full = join(directory, item.name);
    await pruneEmptyDirs(full);
    if ((await readdir(full)).length === 0) await rm(full, { recursive: true, force: true });
  }
}

try {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  await mkdir(join(staging, 'app'), { recursive: true });
  await cp(join(root, 'out'), join(staging, 'app', 'out'), { recursive: true });
  await writeFile(join(staging, 'app', 'package.json'), JSON.stringify({
    name: pkg.name, version: pkg.version, main: pkg.main, type: pkg.type,
    dependencies: pkg.dependencies,
  }, null, 2));
  // Only runtime dependencies ship; devDependencies never do.
  for (const dependency of Object.keys(pkg.dependencies ?? {})) {
    const dependencyRoot = join(root, 'node_modules', dependency);
    await stat(dependencyRoot);
    await cp(dependencyRoot, join(staging, 'app', 'node_modules', dependency), { recursive: true, dereference: true });
  }
  const staged = await walk(join(staging, 'app'));
  const stagedLeaks = staged.filter(file => neverStaged.some(pattern => pattern.test(file.replaceAll('\\', '/'))));
  assert.deepEqual(stagedLeaks, [], `app payload staged private paths: ${JSON.stringify(stagedLeaks)}`);

  // Apply the same negations electron-builder reads from build.files (e.g. !**/docs/**).
  const negations = (pkg.build?.files ?? [])
    .filter(pattern => pattern.startsWith('!'))
    .map(pattern => globToRegExp(pattern.slice(1)));
  const files = staged.filter(file => !isExcluded(negations, file));
  const leaks = files.filter(file => forbiddenInPayload.some(pattern => pattern.test(file.replaceAll('\\', '/'))));
  assert.deepEqual(leaks, [], `release archive leaked private paths: ${JSON.stringify(leaks)}`);
  const sources = files.filter(file => forbiddenSource.test(file)
    && !file.replaceAll('\\', '/').startsWith('node_modules/'));
  assert.deepEqual(sources, [], `release archive leaked unpublished sources: ${JSON.stringify(sources)}`);
  for (const required of ['out/main/index.js', 'out/preload/index.cjs', 'out/renderer/index.html', 'package.json']) {
    assert.ok(files.includes(required), `release archive is missing ${required}`);
  }

  // electron-builder packs the asar from the post-exclude file set, so prune the excluded
  // paths from staging before packing to mirror what actually lands in app.asar.
  for (const file of staged) {
    if (!files.includes(file)) await rm(join(staging, 'app', file), { recursive: true, force: true });
  }
  await pruneEmptyDirs(join(staging, 'app'));
  const archive = join(staging, 'app.asar');
  await asar.createPackage(join(staging, 'app'), archive);
  const listed = asar.listPackage(archive).map(entry => entry.replace(/^\//, ''));
  const archivedLeaks = listed.filter(file => forbiddenInPayload.some(pattern => pattern.test(file)));
  assert.deepEqual(archivedLeaks, [], `app.asar leaked private paths: ${JSON.stringify(archivedLeaks)}`);
  assert.ok(listed.includes('out/main/index.js'), 'app.asar is missing the main bundle');
  assert.ok(listed.includes('out/renderer/index.html'), 'app.asar is missing the renderer');
  console.log(`Release content check passed: ${files.length} staged files, ${listed.length} archive entries, no private directories or unpublished sources.`);
} catch (error) {
  console.error('Release content check failed:', error?.message ?? error);
  process.exitCode = 1;
} finally {
  await rm(staging, { recursive: true, force: true });
}

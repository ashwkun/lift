#!/usr/bin/env node
/**
 * Measures a release APK and compares it against a recorded baseline.
 *
 * The APK workflow already prints `du -h` to its job summary, but it prints it
 * against nothing. The minification work in that workflow (R8, plus deflating
 * the native libraries) took v0.8.0's 58.9 MB down by roughly half, and the
 * two gradle.properties lines that did it are appended by a shell step to a
 * directory `expo prebuild` regenerates on every run. Nothing fails if one of
 * them stops taking effect. The APK just gets big again, quietly, and the only
 * person who finds out is whoever is downloading it over mobile data.
 *
 *   node scripts/perf/apk-size.mjs <path-to.apk> [--abis arm64-v8a]
 *
 * Exits non-zero when the total grows past the baseline's tolerance. A shrink
 * never fails: this is a regression guard, not a target.
 *
 * Options:
 *
 *   --abis <list>      ABI set the APK was built for. Keys the baseline entry,
 *                      because an all-four-ABI build is roughly three times the
 *                      size of an arm64-only one and comparing them is noise.
 *                      Defaults to $RN_ARCHS, then arm64-v8a.
 *   --tolerance <pct>  Overrides the baseline file's own tolerancePercent.
 *   --update           Rewrites the baseline entry from this APK, then exits 0.
 *                      Run locally against a build you have opened and trust.
 *   --json             Prints the measurement as JSON and nothing else.
 *   --help
 *
 * The breakdown mirrors what the workflow's own comments itemise by hand, so
 * the numbers in those comments and the numbers here mean the same thing.
 *
 * No dependency and no `unzip`: this reads the zip central directory itself,
 * the same way audit-palette.mjs parses the tokens file rather than importing
 * it. The script has to run on a runner that has just spent forty minutes in
 * Gradle, and adding an install step to the end of that is a poor trade.
 */

import { readFileSync, writeFileSync, statSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, 'apk-baseline.json');

// ---------------------------------------------------------------- args -----

const argv = process.argv.slice(2);

if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
  console.log(
    [
      'Usage: node scripts/perf/apk-size.mjs <path-to.apk> [options]',
      '',
      '  --abis <list>      ABI set, keys the baseline entry (default $RN_ARCHS or arm64-v8a)',
      '  --tolerance <pct>  Override the baseline tolerancePercent',
      '  --update           Record this build as the new baseline and exit 0',
      '  --json             Print the measurement as JSON only',
      '  --help             This text',
      '',
      'Fails when the total grows past tolerance. A shrink never fails.',
    ].join('\n'),
  );
  process.exit(0);
}

function flag(name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 || i === argv.length - 1 ? fallback : argv[i + 1];
}

// Positional scan rather than a filter, so an APK named like a flag's value
// (--abis takes one) is never mistaken for the path.
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--abis' || argv[i] === '--tolerance') i += 1;
  else if (!argv[i].startsWith('--')) positional.push(argv[i]);
}

const apkPath = positional[0];
const abis = flag('--abis', process.env.RN_ARCHS || 'arm64-v8a');
const update = argv.includes('--update');
const asJson = argv.includes('--json');

if (!apkPath) {
  fail('No APK given. See --help.');
}

// --------------------------------------------------------------- zip -------
//
// An APK is a zip, and every size we want is in its central directory: one
// fixed-width record per entry, listing the compressed and uncompressed size
// and the method used. Reading it means no decompression and no temp files.
//
// Deliberately no zip64 support. Zip64 kicks in past 65535 entries or 4 GB,
// and an APK that reaches either has a problem this script is not the right
// place to report. It is detected and named rather than silently misread.

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;

function readEntries(file) {
  const buf = readFileSync(file);

  // The end-of-central-directory record is last, but a zip comment can follow
  // it, so it has to be found by scanning backwards rather than by offset.
  let eocd = -1;
  const floor = Math.max(0, buf.length - (0xffff + 22));
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) fail(`${file} has no zip end-of-central-directory record. Not an APK?`);

  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    fail(`${file} is a zip64 archive (>65535 entries or >4 GB), which this script does not read.`);
  }

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CD_SIG) fail(`Central directory entry ${i} in ${file} is malformed.`);
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const uncompressed = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compressed, uncompressed });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ------------------------------------------------------------ buckets ------
//
// The same five things the APK workflow's comments take the build apart into,
// in the order they matter. `stored` means method 0, which for lib/ is the
// tell that `expo.useLegacyPackaging=true` stopped being applied: STORED
// natives are what made v0.8.0's download 23.70 MB of libraries.

const BUCKETS = [
  ['dex', 'Dex (classes*.dex)', (n) => /^classes\d*\.dex$/.test(n)],
  ['lib', 'Native libraries (lib/)', (n) => n.startsWith('lib/')],
  ['bundle', 'Hermes bundle', (n) => n === 'assets/index.android.bundle'],
  ['assets', 'Other assets (assets/)', (n) => n.startsWith('assets/')],
  ['res', 'Resources (res/)', (n) => n.startsWith('res/')],
  ['arsc', 'resources.arsc', (n) => n === 'resources.arsc'],
  ['other', 'Everything else', () => true],
];

function measure(file) {
  const entries = readEntries(file);
  const buckets = {};
  for (const [key] of BUCKETS) buckets[key] = { bytes: 0, raw: 0, files: 0, stored: 0 };

  for (const e of entries) {
    const [key] = BUCKETS.find(([, , match]) => match(e.name));
    const b = buckets[key];
    b.bytes += e.compressed;
    b.raw += e.uncompressed;
    b.files += 1;
    if (e.method === 0) b.stored += e.compressed;
  }

  return {
    // The headline is the file on disk, not the sum of the entries: that is
    // what `du -h` prints in the workflow and what someone downloads.
    totalBytes: statSync(file).size,
    dexFiles: buckets.dex.files,
    buckets,
  };
}

// --------------------------------------------------------------- io --------

function fail(message) {
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=APK size::${message}`);
  console.error(`error: ${message}`);
  process.exit(1);
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function pct(now, before) {
  if (!before) return null;
  return ((now - before) / before) * 100;
}

function delta(now, before) {
  const p = pct(now, before);
  if (p === null) return 'new';
  const sign = p >= 0 ? '+' : '';
  return `${sign}${p.toFixed(1)}% (${sign}${((now - before) / 1024).toFixed(0)} kB)`;
}

function summary(lines) {
  const out = process.env.GITHUB_STEP_SUMMARY;
  if (out) appendFileSync(out, `${lines.join('\n')}\n`);
}

// -------------------------------------------------------------- main -------

const now = measure(apkPath);

if (asJson) {
  console.log(JSON.stringify({ abis, ...now }, null, 2));
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

if (update) {
  baseline.builds[abis] = {
    recordedFrom: basename(apkPath),
    recordedAt: new Date().toISOString().slice(0, 10),
    totalBytes: now.totalBytes,
    dexFiles: now.dexFiles,
    buckets: Object.fromEntries(BUCKETS.map(([k]) => [k, now.buckets[k].bytes])),
  };
  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Recorded ${abis} at ${mb(now.totalBytes)} in ${BASELINE}. Commit it.`);
  process.exit(0);
}

const before = baseline.builds[abis];
const tolerance = Number(flag('--tolerance', baseline.tolerancePercent));

console.log(`APK      ${basename(apkPath)}`);
console.log(`ABIs     ${abis}`);
console.log(`Total    ${mb(now.totalBytes)}`);
for (const [key, label] of BUCKETS) {
  const b = now.buckets[key];
  if (b.files === 0) continue;
  console.log(`  ${label.padEnd(26)} ${mb(b.bytes).padStart(9)}  (${mb(b.raw)} uncompressed, ${b.files} file${b.files === 1 ? '' : 's'})`);
}

// No baseline for this ABI set is a first run, not a regression. Printing the
// numbers and the command that records them is more use than a red job.
if (!before) {
  const line = `No baseline recorded for '${abis}'. Run 'node scripts/perf/apk-size.mjs <apk> --abis ${abis} --update' against a build you trust and commit scripts/perf/apk-baseline.json.`;
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=No APK baseline::${line}`);
  console.log(`\n${line}`);
  summary([
    '### APK size',
    '',
    `No baseline recorded for \`${abis}\`. This build is ${mb(now.totalBytes)}.`,
    '',
    `Record it with \`node scripts/perf/apk-size.mjs <apk> --abis ${abis} --update\`.`,
  ]);
  process.exit(0);
}

const growth = pct(now.totalBytes, before.totalBytes);
const regressed = growth > tolerance;

const table = [
  '### APK size',
  '',
  `Baseline: \`${abis}\` recorded from \`${before.recordedFrom}\` on ${before.recordedAt}, tolerance ${tolerance}%.`,
  '',
  '| | Baseline | This build | Change |',
  '|---|---:|---:|---:|',
  `| **Total (download)** | ${mb(before.totalBytes)} | ${mb(now.totalBytes)} | ${delta(now.totalBytes, before.totalBytes)} |`,
];
for (const [key, label] of BUCKETS) {
  const b = now.buckets[key];
  if (b.files === 0 && !before.buckets?.[key]) continue;
  table.push(`| ${label} | ${mb(before.buckets?.[key] ?? 0)} | ${mb(b.bytes)} | ${delta(b.bytes, before.buckets?.[key] ?? 0)} |`);
}

console.log(`\nBaseline ${mb(before.totalBytes)} from ${before.recordedFrom}, tolerance ${tolerance}%`);
console.log(`Change   ${delta(now.totalBytes, before.totalBytes)}`);

// Two cheap tells that name the cause rather than only the symptom, because
// "the APK grew 40%" is a much slower thing to act on than either of these.
//
// Six dex files is what an unminified build looks like: that is the count the
// workflow's own comment records for v0.8.0, before R8 was ever turned on. And
// STORED native libraries are `expo.useLegacyPackaging` back at its default.
const notes = [];
if (now.dexFiles > (before.dexFiles ?? now.dexFiles)) {
  notes.push(
    `Dex file count went from ${before.dexFiles} to ${now.dexFiles}. A jump here usually means android.enableMinifyInReleaseBuilds stopped being applied, so R8 is no longer running.`,
  );
}
if (now.buckets.lib.stored > now.buckets.lib.bytes / 2) {
  notes.push(
    'Most of lib/ is STORED rather than deflated, which means expo.useLegacyPackaging=true is not taking effect. Native code deflates by roughly half, so this alone is about 10 MB of download.',
  );
}
for (const note of notes) {
  console.log(`\nnote: ${note}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=APK size::${note}`);
}

summary([...table, ...(notes.length ? ['', ...notes.map((n) => `> ${n}`)] : [])]);

if (regressed) {
  const message = `The APK is ${mb(now.totalBytes)}, ${delta(now.totalBytes, before.totalBytes)} over the ${mb(before.totalBytes)} baseline for '${abis}', which is past the ${tolerance}% tolerance. If the growth is intended, re-record with --update and commit scripts/perf/apk-baseline.json in the same change.`;
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=APK size regression::${message}`);
  console.error(`\nerror: ${message}`);
  process.exit(1);
}

console.log('\nWithin tolerance.');

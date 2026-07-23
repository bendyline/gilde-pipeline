#!/usr/bin/env node
/**
 * Decide which @bendyline/gilde version this pipeline run should publish.
 *
 * The gilde repo commits the minor line (for example 0.1.0); the pipeline
 * owns the patch number. The next version is the highest already-published
 * patch on that major.minor plus one, or the committed base for a first
 * publish on the line.
 *
 * Skip detection: when the currently published `latest` was built from the
 * same gilde commit (npm `gitHead` equals --sha), there is nothing new to
 * publish and the script emits publish=skip with the already-published
 * version, unless --force is given.
 *
 * Usage:
 *   node scripts/compute-version.mjs --gilde=<dir> [--sha=<sha>] [--force]
 *
 * Prints `version=<v>` and `publish=<yes|skip>` on stdout, and appends the
 * same pairs to $GITHUB_OUTPUT when set.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const PACKAGE = '@bendyline/gilde';

const { values: args } = parseArgs({
  options: {
    gilde: { type: 'string' },
    sha: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
});

if (!args.gilde) {
  console.error('Usage: compute-version.mjs --gilde=<dir> [--sha=<sha>] [--force]');
  process.exit(2);
}

const gildeDir = resolve(args.gilde);
const pkg = JSON.parse(readFileSync(join(gildeDir, 'package.json'), 'utf8'));
if (pkg.name !== PACKAGE) {
  console.error(`Expected ${PACKAGE} at ${gildeDir}, found ${pkg.name ?? 'no name'}.`);
  process.exit(2);
}

const base = String(pkg.version ?? '');
const baseMatch = base.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!baseMatch) {
  console.error(`Committed gilde version "${base}" is not plain semver.`);
  process.exit(2);
}
const [, majorStr, minorStr] = baseMatch;
const line = `${majorStr}.${minorStr}`;

/**
 * Run `npm view` and return parsed JSON, or null for E404 (never published).
 * Any other failure is fatal: a flaky registry answer must not silently
 * produce a wrong version.
 */
function npmView(viewArgs) {
  const result = spawnSync('npm', ['view', ...viewArgs, '--json'], {
    encoding: 'utf8',
    env: process.env,
  });
  const stderr = result.stderr ?? '';
  if (result.status !== 0) {
    if (stderr.includes('E404') || stderr.includes('code E404')) return null;
    console.error(stderr.trim() || `npm view ${viewArgs.join(' ')} failed (${result.status}).`);
    process.exit(1);
  }
  const stdout = (result.stdout ?? '').trim();
  if (!stdout) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    console.error(`Could not parse npm view output: ${stdout.slice(0, 200)}`);
    process.exit(1);
  }
}

const rawVersions = npmView([`${PACKAGE}`, 'versions']);
const published = rawVersions == null ? [] : Array.isArray(rawVersions) ? rawVersions : [rawVersions];

const patchesOnLine = published
  .map((v) => String(v).match(/^(\d+)\.(\d+)\.(\d+)$/))
  .filter((m) => m && `${m[1]}.${m[2]}` === line)
  .map((m) => Number(m[3]));

const nextVersion =
  patchesOnLine.length === 0 ? base : `${line}.${Math.max(...patchesOnLine) + 1}`;

let version = nextVersion;
let publish = 'yes';

if (!args.force && published.length > 0 && args.sha) {
  const latest = npmView([`${PACKAGE}@latest`, 'gitHead']);
  const latestVersion = npmView([`${PACKAGE}@latest`, 'version']);
  if (typeof latest === 'string' && latest === args.sha) {
    publish = 'skip';
    version = typeof latestVersion === 'string' ? latestVersion : nextVersion;
    console.error(`Latest ${PACKAGE} was already published from ${args.sha}; skipping.`);
  }
}

const lines = [`version=${version}`, `publish=${publish}`];
for (const l of lines) console.log(l);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
}

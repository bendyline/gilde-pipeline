#!/usr/bin/env node
/**
 * Emit the gezelgilde.com update manifest and content snapshot.
 *
 * The contract lives in gilde/docs/update-manifest.md:
 *   <out>/latest.json                  mutable pointer clients poll
 *   <out>/content/<version>/data/**    verbatim mirror of gilde data/,
 *                                      minus per-item folders under
 *                                      data/community/ (their index.json
 *                                      files already embed every manifest)
 *
 * Usage:
 *   node scripts/build-update-manifest.mjs \
 *     --gilde=<dir> --version=<v> --sha=<sha> --out=<dir>
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    gilde: { type: 'string' },
    version: { type: 'string' },
    sha: { type: 'string' },
    out: { type: 'string' },
  },
});

for (const required of ['gilde', 'version', 'sha', 'out']) {
  if (!args[required]) {
    console.error(
      'Usage: build-update-manifest.mjs --gilde=<dir> --version=<v> --sha=<sha> --out=<dir>'
    );
    process.exit(2);
  }
}

const gildeDir = resolve(args.gilde);
const outDir = resolve(args.out);
const version = args.version;
const dataDir = join(gildeDir, 'data');
if (!existsSync(dataDir)) {
  console.error(`No data/ directory under ${gildeDir}.`);
  process.exit(2);
}

/**
 * Kind key -> index path, exactly as docs/update-manifest.md specifies.
 * The community kind is keyed community-toolset and keeps only its index.
 */
const KINDS = [
  ['chat-model', 'data/chat-models/index.json'],
  ['image-model', 'data/image-models/index.json'],
  ['video-model', 'data/video-models/index.json'],
  ['toolset', 'data/toolsets/index.json'],
  ['connector-type', 'data/connector-types/index.json'],
  ['project-type', 'data/project-types/index.json'],
  ['gezel-template', 'data/gezel-templates/index.json'],
  ['craftbook-template', 'data/craftbook-templates/index.json'],
  ['community-toolset', 'data/community/toolsets/index.json'],
];

const kinds = {};
for (const [kind, indexPath] of KINDS) {
  const abs = join(gildeDir, indexPath);
  if (!existsSync(abs)) {
    console.error(`Missing index for kind ${kind}: ${indexPath}`);
    process.exit(1);
  }
  const bytes = readFileSync(abs);
  const parsed = JSON.parse(bytes.toString('utf8'));
  if (typeof parsed.count !== 'number') {
    console.error(`Index ${indexPath} has no numeric count field.`);
    process.exit(1);
  }
  kinds[kind] = {
    count: parsed.count,
    indexPath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

const latest = {
  schemaVersion: 1,
  contentVersion: version,
  npmVersion: version,
  publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  gitSha: args.sha,
  baseUrl: `https://gezelgilde.com/catalog/v1/content/${version}`,
  kinds,
};

const contentDataDir = join(outDir, 'content', version, 'data');
mkdirSync(contentDataDir, { recursive: true });

// Verbatim mirror of data/, skipping the community subtree entirely; the
// community index files named in KINDS are then copied back in explicitly.
const communityRoot = join(dataDir, 'community');
cpSync(dataDir, contentDataDir, {
  recursive: true,
  filter: (src) =>
    !(src === communityRoot || (src + sep).startsWith(communityRoot + sep)),
});
for (const [, indexPath] of KINDS) {
  if (!indexPath.startsWith('data/community/')) continue;
  const target = join(outDir, 'content', version, indexPath);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(gildeDir, indexPath), target);
}

writeFileSync(join(outDir, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');

async function treeStats(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    files += 1;
    bytes += statSync(join(entry.parentPath, entry.name)).size;
  }
  return { files, bytes };
}

const stats = await treeStats(outDir);
console.log(`latest.json: contentVersion ${version}, gitSha ${args.sha}`);
for (const [kind, info] of Object.entries(kinds)) {
  console.log(`  ${kind}: count ${info.count}, sha256 ${info.sha256.slice(0, 12)}...`);
}
console.log(
  `content snapshot: ${relative(process.cwd(), outDir)} — ${stats.files} files, ` +
    `${(stats.bytes / 1e6).toFixed(1)} MB`
);

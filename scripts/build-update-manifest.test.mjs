import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('advertises knowledge catalogs and mirrors their immutable version files', async (t) => {
  const prefix = join(tmpdir(), 'gilde-manifest-test-');
  const root = await mkdtemp(prefix);
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(prefix)) && resolve(root) !== resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const gilde = join(root, 'gilde');
  const out = join(root, 'out');
  const directories = ['chat-models', 'image-models', 'video-models', 'toolsets', 'connector-types', 'project-types', 'gezel-templates', 'craftbook-templates', 'community/toolsets', 'knowledge-catalogs'];
  const write = async (path, text) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
  for (const directory of directories) await write(join(gilde, 'data', directory, 'index.json'), JSON.stringify({ count: directory === 'knowledge-catalogs' ? 1 : 0, entries: [] }) + '\n');
  const indexPath = 'data/knowledge-catalogs/index.json';
  const versionPath = 'data/knowledge-catalogs/mi/microsoft-example/versions/2026.10.16/manifest.json';
  const payload = JSON.stringify({ version: '2026.10.16', sha256: 'b'.repeat(64), huggingface: { repo: 'Bendyline/knowledge', revision: 'c'.repeat(40), path: 'example.gezk' } }) + '\n';
  await write(join(gilde, versionPath), payload);
  execFileSync(process.execPath, [fileURLToPath(new URL('./build-update-manifest.mjs', import.meta.url)), `--gilde=${gilde}`, '--version=0.1.100', `--sha=${'a'.repeat(40)}`, `--out=${out}`]);
  const latest = JSON.parse(await readFile(join(out, 'latest.json'), 'utf8'));
  const index = await readFile(join(gilde, indexPath));
  assert.deepEqual(latest.kinds['knowledge-catalog'], { count: 1, indexPath, sha256: createHash('sha256').update(index).digest('hex') });
  assert.equal(Object.keys(latest.kinds).length, 10);
  assert.equal(latest.gitSha, 'a'.repeat(40));
  assert.deepEqual(await readFile(join(out, 'content/0.1.100', indexPath)), index);
  assert.equal(await readFile(join(out, 'content/0.1.100', versionPath), 'utf8'), payload);
});

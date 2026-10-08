/**
 * Build-time readers over a local checkout of the gilde catalog
 * (github.com/bendyline/gilde). The site is now a redirect shell — the
 * catalog itself renders on gezel.com — so all it needs from gilde is the
 * id of every item that used to have a page here.
 *
 * Gilde root resolution: $GILDE_DIR, then ./gilde (CI checks the repo out
 * into the workspace), then ../gilde (local sibling checkout).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Where the catalog lives now. */
export const GEZEL_DOCS = 'https://gezel.com/docs/';

let cachedRoot: string | null = null;

export function gildeRoot(): string {
  if (cachedRoot) return cachedRoot;
  const candidates = [process.env.GILDE_DIR, './gilde', '../gilde'].filter(
    (c): c is string => Boolean(c),
  );
  for (const candidate of candidates) {
    const abs = resolve(candidate);
    if (existsSync(join(abs, 'data')) && existsSync(join(abs, 'package.json'))) {
      cachedRoot = abs;
      return abs;
    }
  }
  throw new Error(
    'Cannot find the gilde catalog checkout. Looked for: ' +
      candidates.map((c) => resolve(c)).join(', ') +
      '. Set GILDE_DIR to a checkout of github.com/bendyline/gilde, ' +
      'or clone it as a sibling directory named "gilde".',
  );
}

/**
 * Every item id of one kind. Reads `raw-index.json`, which lists every item
 * file verbatim; the legacy `index.json` silently drops items whose fields
 * gilde's schema snapshot does not know yet.
 */
export function itemIds(kindDir: string): string[] {
  const dir = join(gildeRoot(), 'data', kindDir);
  const raw = join(dir, 'raw-index.json');
  if (existsSync(raw)) {
    const parsed = JSON.parse(readFileSync(raw, 'utf8')) as { items: Array<{ id: string }> };
    return parsed.items.map((item) => item.id);
  }
  const legacy = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as {
    entries: Array<{ manifest: { id: string } }>;
  };
  return legacy.entries.map((entry) => entry.manifest.id);
}

/** Slugs of gilde's own docs, which now live on GitHub. */
export function docSlugs(): string[] {
  const dir = join(gildeRoot(), 'docs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
}

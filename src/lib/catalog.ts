/**
 * Build-time readers over a local checkout of the gilde catalog
 * (github.com/bendyline/gilde). Everything here runs inside `astro build`;
 * nothing is shipped to the client.
 *
 * Gilde root resolution: $GILDE_DIR, then ./gilde (CI checks the repo out
 * into the workspace), then ../gilde (local sibling checkout).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { marked } from 'marked';

let cachedRoot: string | null = null;

export function gildeRoot(): string {
  if (cachedRoot) return cachedRoot;
  const candidates = [
    process.env.GILDE_DIR,
    './gilde',
    '../gilde',
  ].filter((c): c is string => Boolean(c));
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
      'or clone it as a sibling directory named "gilde".'
  );
}

interface KindIndex {
  schemaVersion: number;
  kind: string;
  count: number;
  entries: Array<{ manifest: Record<string, any> }>;
}

const indexCache = new Map<string, KindIndex>();

function loadIndex(kindDir: string): KindIndex {
  const cached = indexCache.get(kindDir);
  if (cached) return cached;
  const path = join(gildeRoot(), 'data', kindDir, 'index.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as KindIndex;
  indexCache.set(kindDir, parsed);
  return parsed;
}

function manifests(kindDir: string): Record<string, any>[] {
  return loadIndex(kindDir).entries.map((e) => e.manifest);
}

export function kindCount(kindDir: string): number {
  return loadIndex(kindDir).count;
}

/** data/<kindDir>/<shard>/<id> — shard is the first two characters of the id. */
function itemDir(kindDir: string, id: string): string {
  return join(gildeRoot(), 'data', kindDir, id.slice(0, 2), id);
}

export function githubTreeUrl(kindDir: string, id: string): string {
  return `https://github.com/bendyline/gilde/tree/main/data/${kindDir}/${id.slice(0, 2)}/${id}`;
}

// ---------------------------------------------------------------------------
// Chat / image / video models

export interface ChatModel extends Record<string, any> {
  id: string;
  name: string;
  description: string;
}

export function chatModels(): ChatModel[] {
  const models = manifests('chat-models') as ChatModel[];
  return [...models].sort((a, b) => {
    const ar = typeof a.recoScore === 'number' ? a.recoScore : -1;
    const br = typeof b.recoScore === 'number' ? b.recoScore : -1;
    if (br !== ar) return br - ar;
    return String(a.name).localeCompare(String(b.name));
  });
}

export function chatModel(id: string): ChatModel | undefined {
  return chatModels().find((m) => m.id === id);
}

export function imageModels(): Record<string, any>[] {
  return manifests('image-models');
}

export function videoModels(): Record<string, any>[] {
  return manifests('video-models');
}

export function modelQuantization(m: Record<string, any>): string {
  return m.llamaCpp?.quantization ?? m.mlx?.quantization ?? m.quantization ?? '';
}

export function modelEngines(m: Record<string, any>): string[] {
  const engines: string[] = [];
  if (m.llamaCpp) engines.push('llama.cpp');
  if (m.mlx) engines.push('MLX');
  if (m.ollama) engines.push('Ollama');
  return engines;
}

export function formatGB(bytes: unknown): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '';
  return (bytes / 1e9).toFixed(1) + ' GB';
}

export function formatContext(tokens: unknown): string {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) return '';
  return tokens >= 1000 ? Math.round(tokens / 1000) + 'K' : String(tokens);
}

// ---------------------------------------------------------------------------
// Toolsets, connector types, project types

export function toolsets(): Record<string, any>[] {
  return manifests('toolsets');
}

export function connectorTypes(): Record<string, any>[] {
  return manifests('connector-types');
}

export function projectTypes(): Record<string, any>[] {
  return manifests('project-types');
}

// ---------------------------------------------------------------------------
// Roles (gezel-templates)

export interface Role extends Record<string, any> {
  id: string;
  name: string;
  aboutHtml: string;
}

export function roles(): Role[] {
  return (manifests('gezel-templates') as Role[])
    .map((m) => ({ ...m, aboutHtml: roleAboutHtml(m) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function roleAboutHtml(m: Record<string, any>): string {
  const path = join(itemDir('gezel-templates', m.id), 'versions', m.version, 'about.md');
  if (!existsSync(path)) return '';
  return renderMarkdown(readFileSync(path, 'utf8'));
}

// ---------------------------------------------------------------------------
// Craftbooks

export interface Craftbook extends Record<string, any> {
  id: string;
  name: string;
  description: string;
  logo?: string;
  logoUrl?: string;
  cardTint: string;
  steps: Array<Record<string, any>>;
  hasEval: boolean;
  family: string;
}

export function craftbooks(): Craftbook[] {
  return (manifests('craftbook-templates') as Craftbook[])
    .map((m) => ({
      ...m,
      logoUrl: craftbookLogoPath(m) ? `/craftbooks/${m.id}/logo.webp` : undefined,
      cardTint: craftbookCardTint(m),
      hasEval: existsSync(join(itemDir('craftbook-templates', m.id), 'versions', m.version, 'test.json')),
      family: familyFor(m),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function craftbook(id: string): Craftbook | undefined {
  return craftbooks().find((c) => c.id === id);
}

function craftbookLogoPath(book: Pick<Craftbook, 'id' | 'logo'>): string | undefined {
  // The published package currently uses one WebP logo per craftbook. Keep
  // the route deliberately narrow so a malformed manifest cannot read an
  // arbitrary file from the catalog checkout.
  if (book.logo !== 'logo.webp') return undefined;
  const path = join(itemDir('craftbook-templates', book.id), book.logo);
  return existsSync(path) ? path : undefined;
}

export function craftbookLogoBytes(book: Pick<Craftbook, 'id' | 'logo'>): Uint8Array | undefined {
  const path = craftbookLogoPath(book);
  return path ? readFileSync(path) : undefined;
}

const CRAFTBOOK_CARD_TINTS: Record<string, string> = {
  'analyze-measure': '#d8ccba',
  'build-code': '#d6cab8',
  'communicate-market': '#dfc9b2',
  'design-media': '#e1cbb0',
  'inspect-review': '#dccfb6',
  'operate-maintain': '#d8ceb8',
  'people-events-growth': '#dfc8b4',
  'plan-coordinate': '#dfccac',
  'research-learn': '#d9cfb5',
  'write-publish': '#ddc9b2',
};

function craftbookCardTint(book: Pick<Craftbook, 'id'>): string {
  const path = join(itemDir('craftbook-templates', book.id), 'art.json');
  if (!existsSync(path)) return '#dfceb4';

  try {
    const art = JSON.parse(readFileSync(path, 'utf8')) as { family?: unknown };
    return typeof art.family === 'string'
      ? CRAFTBOOK_CARD_TINTS[art.family] ?? '#dfceb4'
      : '#dfceb4';
  } catch {
    return '#dfceb4';
  }
}

/**
 * Gallery families, following docs/craftbook-gallery-taxonomy.md. Explicit
 * id lists come from that document; craftbooks added since (household
 * rituals, night-shift maintenance, and so on) fall through to tag rules.
 */
export const FAMILY_ORDER = [
  'Build: interactive and web',
  'Build: software and code',
  'Media: images',
  'Media: audio and video',
  'Documents and decks',
  'Content and writing',
  'Data and analysis',
  'Knowledge and research',
  'Comms and ops automation',
  'Personal and business workflows',
  'Home and everyday life',
  'Review and QA',
  'Ship and release',
  'More crafts',
] as const;

const FAMILY_IDS: Record<string, string[]> = {
  'Build: interactive and web': [
    'html-arcade-game', 'html-puzzle-game', 'board-game-web', 'idle-clicker-game', 'physics-toy',
    'branding-website', 'landing-page', 'portfolio-site', 'docs-site', 'spa-dashboard',
    'web-app-crud', 'form-wizard', 'data-viz-page', 'email-template', 'chrome-extension',
    'pwa-offline', 'interactive-quiz', 'onboarding-flow', 'pricing-page', 'micro-game-jam',
    'svg-animation', 'web-component', 'canvas-generative-art', 'accessibility-retrofit',
  ],
  'Build: software and code': [
    'rest-api', 'graphql-api', 'cli-tool', 'library-package', 'webhook-handler', 'cron-job',
    'data-pipeline-etl', 'schema-migration', 'refactor-module', 'bug-fix-tdd', 'test-suite-backfill',
    'perf-optimization', 'type-safety-pass', 'dockerize-app', 'ci-pipeline', 'config-scaffold',
    'sdk-wrapper', 'state-machine', 'parser-grammar', 'auth-flow', 'feature-flag-rollout',
    'db-index-tuning', 'regex-builder', 'script-automation', 'build-loop',
  ],
  'Media: images': [
    'image-set-index', 'logo-set', 'icon-pack', 'hero-image', 'image-batch-edit', 'alt-text-pass',
    'thumbnail-generator', 'moodboard', 'sprite-sheet', 'image-dedup-cluster', 'ocr-extract',
    'diagram-from-text', 'photo-cull', 'image-seo-rename',
  ],
  'Media: audio and video': [
    'folder-to-audio', 'transcribe-audio', 'subtitle-generator', 'narrated-slideshow',
    'podcast-chaptering', 'audio-highlight-reel', 'voiceover-script', 'meeting-summary-audio',
    'music-metadata-tag', 'video-storyboard',
  ],
  'Documents and decks': [
    'content-deck', 'pitch-deck', 'report-pdf', 'one-pager', 'whitepaper', 'resume-cv',
    'proposal-sow', 'runbook', 'spec-doc', 'contract-template', 'newsletter-issue',
    'ebook-compile', 'handbook-section', 'invoice-generator',
  ],
  'Content and writing': [
    'blog-post', 'landing-copy', 'product-descriptions', 'social-thread', 'press-release',
    'faq-from-docs', 'doc-rewrite', 'tone-rewrite', 'localize-content', 'summarize-long',
    'changelog-writeup', 'cover-letter', 'ad-variations', 'email-sequence', 'knowledge-base-article',
  ],
  'Data and analysis': [
    'dataset-clean', 'data-to-report', 'chart-pack', 'spreadsheet-model', 'sql-analysis',
    'ab-test-readout', 'csv-transformer', 'data-dictionary', 'anomaly-scan', 'forecast-model',
    'survey-analysis', 'dashboard-spec', 'cohort-analysis', 'data-quality-audit',
  ],
  'Knowledge and research': [
    'research-report', 'literature-review', 'competitive-analysis', 'market-scan', 'fact-check',
    'corpus-synthesis', 'comparison-matrix', 'due-diligence-brief', 'topic-explainer',
    'citation-audit', 'glossary-build', 'reading-list',
  ],
  'Comms and ops automation': [
    'corpus-email-digest', 'inbox-triage', 'status-report', 'standup-summary', 'calendar-brief',
    'alert-rules', 'notification-router', 'meeting-notes-to-actions', 'weekly-review',
    'escalation-playbook', 'digest-from-feeds', 'crm-update-batch',
  ],
  'Personal and business workflows': [
    'scrape-to-structured', 'form-fill-batch', 'monitor-and-alert', 'price-tracker',
    'lead-enrichment', 'expense-categorize', 'doc-intake-pipeline', 'booking-automation',
    'backup-routine', 'data-export-migrate', 'recurring-invoice-run', 'onboarding-checklist',
  ],
  'Home and everyday life': [],
  'Review and QA': [
    'pull-request-review', 'qa', 'investigate', 'security-review', 'a11y-audit', 'design-review',
    'copy-review', 'perf-audit', 'dependency-audit', 'api-contract-review', 'threat-model',
    'content-accuracy-review',
  ],
  'Ship and release': [
    'ship', 'reviewer-loop', 'office-hours', 'release-notes', 'changelog-cut', 'deploy-checklist',
    'rollback-plan', 'hotfix-flow', 'version-bump', 'postmortem',
  ],
};

const ID_TO_FAMILY = new Map<string, string>();
for (const [family, ids] of Object.entries(FAMILY_IDS)) {
  for (const id of ids) ID_TO_FAMILY.set(id, family);
}

const TAG_RULES: Array<[string, string[]]> = [
  ['Media: audio and video', ['audio', 'video', 'music', 'transcription', 'podcast']],
  ['Media: images', ['images', 'image', 'image-generation', 'favicon']],
  ['Review and QA', ['review', 'audit', 'qa', 'maintenance-review', 'night-shift', 'guardrail', 'safety', 'debugging', 'investigation']],
  ['Ship and release', ['release', 'ship', 'deploy', 'retrospective', 'postmortem', 'ideation']],
  ['Comms and ops automation', ['comms', 'email', 'automation', 'digest', 'schedule', 'calendar', 'meetings', 'oncall', 'sre']],
  ['Home and everyday life', [
    'household', 'ritual', 'family', 'home', 'kids', 'personal-care', 'health', 'caregiving',
    'event', 'celebration', 'memoir', 'memory', 'family-history', 'genealogy', 'travel', 'trip',
    'study', 'flashcards', 'puzzle',
  ]],
  ['Personal and business workflows', ['career', 'job', 'interview', 'freelance', 'invoicing', 'billing', 'finance']],
  ['Knowledge and research', ['research', 'sources', 'citations']],
  ['Data and analysis', ['data', 'analysis', 'metrics', 'spreadsheet']],
  ['Documents and decks', ['document', 'documentation', 'report', 'deck', 'slides', 'runbook', 'spec', 'planning', 'brief']],
  ['Content and writing', ['writing', 'copywriting', 'content', 'marketing', 'seo', 'newsletter']],
  ['Build: interactive and web', ['html', 'game', 'web', 'website', 'frontend', 'design']],
  ['Build: software and code', ['codebase', 'code', 'cli', 'api', 'testing', 'backend', 'queue', 'worker', 'engineering']],
];

function familyFor(m: Record<string, any>): string {
  const mapped = ID_TO_FAMILY.get(m.id);
  if (mapped) return mapped;
  const tags: string[] = Array.isArray(m.tags) ? m.tags : [];
  for (const [family, keywords] of TAG_RULES) {
    if (keywords.some((k) => tags.includes(k))) return family;
  }
  return 'More crafts';
}

export function craftbooksByFamily(): Array<{ family: string; books: Craftbook[] }> {
  const groups = new Map<string, Craftbook[]>();
  for (const book of craftbooks()) {
    const list = groups.get(book.family) ?? [];
    list.push(book);
    groups.set(book.family, list);
  }
  return FAMILY_ORDER.filter((f) => groups.has(f)).map((family) => ({
    family,
    books: groups.get(family)!,
  }));
}

/** Steps ordered by the `next` chain from entryStepId; unreachable steps appended. */
export function orderedSteps(book: Craftbook): Array<Record<string, any>> {
  const byId = new Map(book.steps.map((s) => [s.id, s]));
  const ordered: Array<Record<string, any>> = [];
  const seen = new Set<string>();
  let cursor = book.entryStepId;
  while (cursor && byId.has(cursor) && !seen.has(cursor)) {
    const step = byId.get(cursor)!;
    ordered.push(step);
    seen.add(cursor);
    cursor = typeof step.next === 'string' ? step.next : undefined;
  }
  for (const step of book.steps) {
    if (!seen.has(step.id)) ordered.push(step);
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Community toolsets

export interface CommunityEntry {
  id: string;
  name: string;
  description: string;
  license: string;
  category: string;
  url: string;
}

export function communityToolsets(): CommunityEntry[] {
  return manifests('community/toolsets').map((m) => ({
    id: String(m.id ?? ''),
    name: String(m.name ?? ''),
    description: String(m.description ?? '').slice(0, 240),
    license: String(m.license ?? ''),
    category: String(m.category ?? 'other'),
    url: communityUrl(m),
  }));
}

function communityUrl(m: Record<string, any>): string {
  const maintainer = m.maintainer?.url;
  if (typeof maintainer === 'string' && /^https?:\/\//.test(maintainer)) return maintainer;
  if (m.runtime?.kind === 'npm-package' && typeof m.runtime.package === 'string') {
    return `https://www.npmjs.com/package/${m.runtime.package}`;
  }
  return '';
}

export function communityCategories(): Array<{ category: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of communityToolsets()) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Docs (gilde/docs/*.md)

export interface Doc {
  slug: string;
  title: string;
  html: string;
}

export function docs(): Doc[] {
  const dir = join(gildeRoot(), 'docs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(dir, file), 'utf8');
      const slug = file.replace(/\.md$/, '');
      const heading = raw.match(/^#\s+(.+)$/m);
      return { slug, title: heading ? heading[1].trim() : slug, html: renderMarkdown(raw) };
    });
}

// ---------------------------------------------------------------------------
// Markdown (first-party gilde content only — never community strings)

function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

export function excerpt(text: unknown, max = 180): string {
  const s = String(text ?? '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)) + '...';
}

export function gildeVersion(): string {
  const pkg = JSON.parse(readFileSync(join(gildeRoot(), 'package.json'), 'utf8'));
  return String(pkg.version ?? '0.0.0');
}

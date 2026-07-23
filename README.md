# gilde-pipeline

The publishing pipeline for the [gilde](https://github.com/bendyline/gilde) catalog.
One workflow, three stages:

1. **Verify** — check out gilde and re-run its own validation
   (`tools/validate.mjs`, `tools/build-index.mjs --check`, `tools/lint-models.mjs`).
   Defense in depth: the pipeline never trusts that branch protection ran them.
2. **Publish npm** — compute the next patch version and publish
   `@bendyline/gilde` to npm (skipped when the commit is already published).
3. **Deploy site** — build the Astro site and the catalog update manifest, and
   deploy both to GitHub Pages at <https://gezelgilde.com>.

The site is the marketing and distribution surface for the catalog: craftbook
gallery, model tables, roles, toolsets, the community MCP directory, and the
versioned update-manifest JSON contract that gezel clients poll
(see `gilde/docs/update-manifest.md`; served at
`https://gezelgilde.com/catalog/v1/latest.json`).

## Trigger model

| Trigger | When | Notes |
| --- | --- | --- |
| `repository_dispatch` (type `gilde-updated`) | gilde pushes to main | The gilde repo fires it with `client_payload.sha`, authenticated by the `PIPELINE_DISPATCH_TOKEN` PAT stored in the **gilde** repo |
| `workflow_dispatch` | manual | Inputs: `gilde_ref` (default `main`), `force_publish` (publish even if the commit is already on npm) |
| `schedule` | weekly, Monday 05:17 UTC | Safety net so a missed dispatch never goes stale |

All runs share `concurrency: publish` with no cancel-in-progress, so deploys
serialize instead of racing.


## Local development

```bash
git clone https://github.com/bendyline/gilde        # sibling checkout
git clone https://github.com/bendyline/gilde-pipeline
cd gilde-pipeline
npm install
npm run dev
```

The site build resolves the gilde checkout in this order: `$GILDE_DIR`, then
`./gilde` (the CI layout), then `../gilde` (the sibling layout above). It fails
loudly when none exists.

Publisher scripts run standalone on plain Node (>= 24, no dependencies):

```bash
npm run compute-version -- --gilde=../gilde
npm run check-size      -- --gilde=../gilde
npm run update-manifest -- --gilde=../gilde --version=0.1.0 --sha=<sha> --out=dist/catalog/v1
```

## Versioning policy

- The gilde repo commits the **minor line** (for example `0.1.0`); bumping
  major or minor is an editorial act done in gilde.
- The pipeline owns the **patch**: each publish takes the highest published
  patch on that major.minor and adds one (or uses the committed base for the
  first publish on a line). `npm version --no-git-tag-version` applies it in
  the CI checkout only — nothing is committed back.
- Publishing is **idempotent per gilde commit**: when npm's `latest` carries a
  `gitHead` equal to the commit being built, the publish is skipped (override
  with `force_publish`). The site still deploys on every green run.
- **npm provenance is deliberately off** (`--provenance=false`). Trusted
  publishing generates provenance by default, but the attestation requires
  the publishing workflow to live in the repo that `package.json.repository`
  points at, and this pipeline publishes from a different repo. Upgrade path:
  move the `npm publish` step into a workflow inside `bendyline/gilde`, then
  drop the flag.
- **semantic-release is deliberately not used** (squisq-style). It derives
  versions from conventional commits and pushes tags/changelogs back to the
  repo it releases — the wrong shape here, where the content lives in
  `bendyline/gilde`, this pipeline commits nothing back, and the registry
  itself is the version source of truth. If we ever want it, it belongs in a
  publish workflow inside `bendyline/gilde` (same move that unlocks
  provenance).

## npm auth: trusted publishing

The publish job authenticates with [npm trusted
publishing](https://docs.npmjs.com/trusted-publishers) — the npm CLI
(>= 11.5.1) exchanges the workflow's GitHub OIDC token for short-lived
publish credentials. No `NPM_TOKEN` secret exists in this repo.

One-time setup (already done if the package publishes green):

1. **Bootstrap** — npm only lets you configure a trusted publisher on an
   existing package, so the very first `@bendyline/gilde` publish must use a
   token or a manual `npm publish` from a maintainer machine (from the gilde
   checkout: `npm publish --access public`).
2. On npmjs.com → `@bendyline/gilde` → **Settings → Trusted Publisher**:
   GitHub Actions, organization `bendyline`, repository `gilde-pipeline`,
   workflow filename `publish.yml`, environment left blank.
3. Delete any `NPM_TOKEN` repo secret and revoke the bootstrap token. In the
   package's publishing-access settings, choose *Trusted publishing and
   two-factor* to block token publishes entirely.

Hardening option: create a GitHub environment (for example `npm`), set it on
the `publish-npm` job, and name it in the npm trusted-publisher config so
only that environment can publish.

## Guardrails

- `scripts/check-package-size.mjs` fails a publish when the tarball exceeds
  60 MB or the unpacked tree exceeds 200 MB.
- `scripts/build-update-manifest.mjs` emits the exact contract described in
  `gilde/docs/update-manifest.md`: `catalog/v1/latest.json` plus a verbatim
  `data/` mirror under `catalog/v1/content/<version>/`, excluding the
  per-item folders under `data/community/` (their `index.json` files already
  embed every manifest).
- Third-party actions in the workflow are pinned to full commit SHAs.

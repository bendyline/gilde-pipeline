# gilde-pipeline

The site-deployment pipeline for the [gilde](https://github.com/bendyline/gilde)
catalog. One workflow, two stages:

1. **Verify** — check out gilde and re-run its own validation
   (`tools/validate.mjs`, `tools/build-index.mjs --check`, `tools/lint-models.mjs`).
   Defense in depth: the pipeline never trusts that branch protection ran them.
2. **Deploy site** — build the redirect pages and the catalog update manifest,
   and deploy both to GitHub Pages at <https://gezelgilde.com>.

npm publishing does **not** happen here: `@bendyline/gilde` publishes from the
`publish.yml` workflow inside [bendyline/gilde](https://github.com/bendyline/gilde)
itself, so that npm provenance attestations verify against
`package.json.repository`. This pipeline resolves the published version from
the registry (`npm view @bendyline/gilde version`).

The browsable catalog now lives on **gezel.com**: the gezel repo's Handboek
export (`pnpm docs:site`) renders every craftbook, model, role template,
project type (with its page demo) and toolset there, so the catalog adds to
gezel.com's search presence instead of splitting it. gezelgilde.com is kept as
a **redirect shell**: every page it used to serve answers with an immediate
redirect (zero-second meta refresh plus `rel=canonical`) to its gezel.com
equivalent, so old links and search results keep working.

| Old address | Now |
| --- | --- |
| `/` | `gezel.com/#catalog` |
| `/craftbooks/`, `/craftbooks/<id>/` | `gezel.com/docs/craftbooks-index/`, `/docs/craftbook/<id>/` |
| `/models/`, `/models/<id>/` | `gezel.com/docs/model-catalog/`, `/docs/model/<id>/` |
| `/roles/`, `/roles/<id>/` | `gezel.com/docs/role-catalog/`, `/docs/role-template/<id>/` |
| `/toolsets/`, `/community/` | `gezel.com/docs/toolset-catalog/` |
| `/project-types/<id>/` | `gezel.com/docs/project-type/<id>/` |
| `/docs/<slug>/` | gilde's `docs/<slug>.md` on GitHub |

Redirects are generated from gilde's `raw-index.json`, so every item id has
one. The machine-facing part of the site is unchanged: the versioned
update-manifest JSON contract (see `gilde/docs/update-manifest.md`) is still
built and served at `https://gezelgilde.com/catalog/v1/latest.json`.

## Trigger model

Both the npm publish (in gilde) and this site deploy are manual, deliberate
acts — nothing publishes or deploys as a side effect of a merge.

| Trigger | When | Notes |
| --- | --- | --- |
| `workflow_dispatch` | manual | Run after publishing `@bendyline/gilde` from the gilde repo, or when the site itself changes. Input: `gilde_ref` (default `main`) |
| `schedule` | weekly, Monday 05:17 UTC | Safety net so the site never goes stale |

All runs share `concurrency: deploy-site` with no cancel-in-progress, so
deploys serialize instead of racing.


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

The manifest script runs standalone on plain Node (>= 24, no dependencies):

```bash
npm run update-manifest -- --gilde=../gilde --version=0.1.0 --sha=<sha> --out=dist/catalog/v1
```

## Versioning policy

Versioning and publishing live in the gilde repo's `publish.yml` and
`tools/compute-version.mjs` / `tools/check-package-size.mjs`; the policy:

- The gilde repo commits the **minor line** (for example `0.1.0`); bumping
  major or minor is an editorial act done in gilde.
- The publish workflow owns the **patch**: each publish takes the highest
  published patch on that major.minor and adds one (or uses the committed base
  for the first publish on a line). `npm version --no-git-tag-version` applies
  it in the CI checkout only — nothing is committed back.
- Publishing is **idempotent per gilde commit**: when npm's `latest` carries a
  `gitHead` equal to the commit being built, the publish is skipped (override
  with `force_publish`). The site still deploys on every green run.
- **npm provenance is on** (the trusted-publishing default): the publish
  workflow lives in the repo `package.json.repository` points at, so the
  attestation verifies.
- **semantic-release is deliberately not used** (squisq-style). It derives
  versions from conventional commits and pushes tags/changelogs back to the
  repo it releases — the registry itself is the version source of truth here,
  and nothing is committed back on publish.

## npm auth: trusted publishing

The publish job in **bendyline/gilde** authenticates with [npm trusted
publishing](https://docs.npmjs.com/trusted-publishers) — the npm CLI
(>= 11.5.1) exchanges the workflow's GitHub OIDC token for short-lived
publish credentials. No `NPM_TOKEN` secret exists in either repo.

One-time setup (already done if the package publishes green):

1. **Bootstrap** — npm only lets you configure a trusted publisher on an
   existing package, so the very first `@bendyline/gilde` publish must use a
   token or a manual `npm publish` from a maintainer machine (from the gilde
   checkout: `npm publish --access public`).
2. In the **gilde** repo settings, create a GitHub environment named `npm`
   with required reviewers and a deployment-branch rule restricting it to
   `main`. gilde is the community-facing repo, so publishes gate on this
   environment.
3. On npmjs.com → `@bendyline/gilde` → **Settings → Trusted Publisher**:
   GitHub Actions, organization `bendyline`, repository `gilde`,
   workflow filename `publish.yml`, environment `npm`.
4. Delete any `NPM_TOKEN` repo secret and revoke the bootstrap token. In the
   package's publishing-access settings, choose *Trusted publishing and
   two-factor* to block token publishes entirely.

## Guardrails

- gilde's `tools/check-package-size.mjs` fails a publish when the tarball
  exceeds 60 MB or the unpacked tree exceeds 200 MB.
- `scripts/build-update-manifest.mjs` emits the exact contract described in
  `gilde/docs/update-manifest.md`: `catalog/v1/latest.json` plus a verbatim
  `data/` mirror under `catalog/v1/content/<version>/`, excluding the
  per-item folders under `data/community/` (their `index.json` files already
  embed every manifest).
- Third-party actions in the workflows are pinned to full commit SHAs.

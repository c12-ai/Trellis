# C12 fork of Trellis

`c12-ai/Trellis` is C12's fork of [mindfold-ai/trellis](https://github.com/mindfold-ai/trellis) (AGPL-3.0). It exists so that workflow customizations C12 makes to Trellis-managed files live in one source and reach every repository through the normal `trellis update`, instead of being hand-patched per repository.

| | Upstream | This fork |
|---|---|---|
| CLI package | `@mindfoldhq/trellis` | `c12-trellis` (npm, owned by a C12 maintainer's account) |
| Core package | `@mindfoldhq/trellis-core` | not forked; the CLI pins an exact upstream core version |
| Command | `trellis`, `tl` | same |
| Versions | 0.6.17 and earlier | 0.6.18 and later, our own line |

`trellis update` writes the templates bundled in the installed CLI. A project on upstream 0.6.17 upgrades to the fork by installing `c12-trellis` and running `trellis update`.

## Install

```bash
npm install -g c12-trellis      # or: npx c12-trellis@<version> update
```

BIC's iChor checkout pins a GitHub Release tarball instead (`.tools/trellis.lock`, installed by `ichor setup`).

## What the fork changes

Kept as small as possible so upstream fixes merge cleanly.

| Area | Change |
|---|---|
| `templates/trellis/workflow.md` | Planning-turn and Execution-turn exit checks; Rule 6 (new input steers the active task) |
| `templates/shared-hooks/inject-workflow-state.py` | Remaining-checklist note for in_progress tasks |
| `templates/codex/hooks/session-start.py` | Project-root discovery from a nested cwd; no repeated first-reply notice on resume/clear/compact. Still unregistered by default (upstream #240/#242) |
| Templates | Whitespace-clean, so consumer pre-commit hooks do not rewrite them |
| Package | Name, version line, release workflow (`.github/workflows/publish.yml`) |
| Tests | `packages/cli/test/scripts/c12-customizations.integration.test.ts`; the marketplace mirror equality test is skipped because the `marketplace` submodule stays upstream-owned |

Project-specific configuration (for example a repository's `.trellis/config.yaml` or `.codex/config.toml`) does not belong here; it stays in that repository.

## Change a template

1. Branch from `main`, edit `packages/cli/src/templates/...`, add or extend a test that fails without the change.
2. Run the CI chain in a non-root environment (two upstream tests use `chmod` and fail as root):
   `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm build && pnpm test`
3. Open a PR into `main`.

## Release

1. In the release PR, bump `packages/cli/package.json` `version` (patch for template fixes) and add `packages/cli/src/migrations/manifests/<version>.json` with a `changelog`. Do not use a `-suffix` on top of an upstream version: Trellis treats `0.6.17-x` as older than `0.6.17` and refuses to "downgrade".
2. After merge, tag the merge commit `v<version>` and push the tag.
3. `publish.yml` tests, packs once, publishes `c12-trellis@<version>` to npm (secret `NPM_TOKEN`, with provenance) and attaches the tarball + `.sha256` to the GitHub Release.
4. Consumers: `npm install -g c12-trellis@<version>` (or bump `.tools/trellis.lock` in BIC-meta to the new release and sha256), then `trellis update` in each repository.
5. A bad npm version cannot be overwritten: `npm deprecate c12-trellis@<version> "<reason>"` and release the next patch.

The upstream `pnpm release*` scripts and `release-preflight.js` assume CLI and core share a version; the fork does not use them.

## Pull an upstream fix

```bash
git fetch upstream
git merge upstream/main        # or cherry-pick the fix
```

Resolve conflicts in favor of upstream except for the rows in "What the fork changes"; run the CI chain; release a new fork version whose changelog names the upstream commit or version included.

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

`c12-trellis` installs the same `trellis` and `tl` commands as upstream. If upstream is installed globally, remove it first, or npm stops with `EEXIST` on the command links:

```bash
npm uninstall -g @mindfoldhq/trellis
```

An upstream CLI's `trellis upgrade` still installs `@mindfoldhq/trellis`; switch packages by hand once, as above.

Every release also attaches the same tarball and its sha256 to the GitHub Release, for consumers that pin by checksum.

## Tracked files and personal customization

Consumer repositories commit the Trellis-managed files: `.trellis/` (scripts, `workflow.md`, `.version`, `.template-hashes.json`), the Trellis hooks, `settings.json`, `commands/trellis/`, `agents/trellis-*` and `skills/trellis-*` under `.claude/`, and the corresponding files under `.codex/` and `.agents/`. The committed copy is the team's single shared version.

- **Never gitignore a Trellis-managed file.** Nothing installs these files per clone, and `trellis update` treats a hash-tracked file that is missing as "Deleted by you" and never restores it, not even with `--force`. An ignored file is therefore simply absent for everyone.
- **Change them only through the fork.** Edit the template here, release, then run `npx -y c12-trellis@<version> update` in each repository and open a PR. Do not hand-edit them in a repository.
- **Repository-specific edits** are limited to project configuration: `.codex/config.toml`, `.codex/hooks.json`, `.trellis/config.yaml`, and `AGENTS.md` outside the Trellis-managed block. They show as "Modified by you" on every update; keep them deliberate and say why in the PR.
- **Personal customization stays out of git**: Claude Code's `.claude/settings.local.json` and `CLAUDE.local.md` (both gitignored in every repository), and Codex's user-level `~/.codex/config.toml`. Never force-add them.
- **Team skills, rules and agents** delivered by teamai (`ichor team`) are excluded per clone through `.git/info/exclude` and are not committed either.

## What the fork changes

Kept as small as possible so upstream fixes merge cleanly.

| Area | Change |
|---|---|
| `templates/trellis/workflow.md` | Planning-turn and Execution-turn exit checks; Rule 6 (new input steers the active task) |
| `templates/shared-hooks/inject-workflow-state.py` | Remaining-checklist note for in_progress tasks |
| `templates/codex/hooks/session-start.py` | Project-root discovery from a nested cwd; no repeated first-reply notice on resume/clear/compact. Still unregistered by default (upstream #240/#242) |
| `templates/trellis/workflow.md`, `templates/shared-hooks/inject-workflow-state.py`, both session-start templates, `templates/trellis/scripts/common/task_handoff.py` | Task progress record: agents append milestone entries to `<task>/handoff.md` (local, travels with the branch); the per-turn breadcrumb shows when the last entry was written; Claude and Codex SessionStart each show their own task's newest entries |
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
3. `publish.yml` tests, packs once, publishes `c12-trellis@<version>` to npm (secret `NPM_TOKEN`, with provenance) and attaches the tarball + `.sha256` to the GitHub Release. A new version can take a few minutes to become visible on npm; the job waits up to 20 minutes. If npm stages a publish for approval, approve it under Staged Packages on npmjs.com and rerun the job.
4. Consumers: `npm install -g c12-trellis@<version>` (or `npx -y c12-trellis@<version> update`), then `trellis update` in each repository. When committing the result:
   - Stage the Trellis directories as a whole (`git add -A .trellis .claude .codex .agents`, only those that exist), not file by file: an update can add new files (0.6.19 added `.trellis/scripts/common/task_handoff.py`), and a file-by-file commit leaves them untracked, so a fresh clone gets hooks whose imports fail silently.
   - Before pushing, check that every file in `.trellis/.template-hashes.json` is tracked: `python3 -c "import json,subprocess,os; h=json.load(open('.trellis/.template-hashes.json'))['hashes']; t=set(subprocess.run(['git','ls-files'],capture_output=True,text=True).stdout.split()); print([p for p in h if os.path.exists(p) and p not in t])"` must print `[]`.
   - A file the update skipped as "Modified by you" may be a stale template copy (rewritten by a pre-commit hook, or never hash-tracked) rather than a real local edit: check its `git log` before keeping it.
5. A bad npm version cannot be overwritten: `npm deprecate c12-trellis@<version> "<reason>"` and release the next patch.

The upstream `pnpm release*` scripts assume CLI and core share a version: `scripts/release.js` exits with an error in the fork. `create-manifest.js` and `check-manifest-continuity.js` read the package name from `package.json`, so they query `c12-trellis`.

`publish.yml` refuses to release when `packages/core` differs from the upstream tag of the core version the CLI pins: npm users get that published core, not the workspace copy. After an upstream merge that changes core, either keep core at an upstream release or start publishing core from the fork.

## Pull an upstream fix

```bash
git fetch upstream
git merge upstream/main        # or cherry-pick the fix
```

Resolve conflicts in favor of upstream except for the rows in "What the fork changes"; run the CI chain; release a new fork version whose changelog names the upstream commit or version included.

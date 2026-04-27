# MaxQ Roo — Build & Release Runbook

This is the operational runbook for building, installing, and releasing the
MaxQ fork of Roo Code. It assumes you've already completed the one-time fork
setup (clone, remotes, branch model — see `UPSTREAM-SYNC.md`).

## Prerequisites — verify once per machine

You should already have:

- Node 20.19.2 (managed by `nvm` — the repo's `.nvmrc` will pick it up)
- pnpm 10.8.1+ (the repo enforces this in `package.json` `packageManager`)
- VS Code with the `code` CLI on `$PATH` (run `code --version` to confirm)

If `nvm use` doesn't work, run `nvm install 20.19.2` first.

## The build/install loop

This is the loop you'll run every time you make a change and want to test it
in VS Code.

```bash
cd ~/Projects/Roo-Code-MaxQ
nvm use                          # picks up .nvmrc → 20.19.2
pnpm install                     # only needed after dependency changes
pnpm clean                       # clears stale build output
pnpm vsix                        # builds the .vsix file
pnpm install:vsix                # uninstalls old version, installs new one
```

`pnpm install:vsix` also runs `pnpm install --frozen-lockfile` and `pnpm clean`
internally, so for a full clean build you can collapse to:

```bash
pnpm install:vsix
```

The first build takes 5–10 minutes. Subsequent builds are 1–3 minutes because
Turbo caches unchanged packages.

After install completes, **fully restart VS Code** (Cmd+Q, reopen) — reloading
the window is not always sufficient for extension updates.

## Verifying the install

1. Open VS Code.
2. Open the Extensions panel (Cmd+Shift+X).
3. Search for "Roo Code" — you should see exactly one entry, with the version
   matching what's in `src/package.json`.
4. The version field should show your MaxQ suffix (e.g. `3.53.0-maxq.1`).
5. If you see two entries (one MaxQ, one marketplace), uninstall the
   marketplace one. They share the same extension ID and will conflict.

## Versioning protocol

We maintain a MaxQ version on top of the upstream Roo version. The format is:

```
{upstream-version}-maxq.{maxq-counter}
```

Examples:

- `3.53.0-maxq.1` — first MaxQ build on top of upstream 3.53.0
- `3.53.0-maxq.2` — second MaxQ build on top of upstream 3.53.0
- `3.54.0-maxq.1` — first MaxQ build on top of upstream 3.54.0 (counter resets)

This is a valid semver pre-release identifier, so VSCE will package it without
complaint. The pre-release semantics also mean VS Code won't treat the
marketplace version as an upgrade if a user accidentally has both.

### When to bump the MaxQ counter

Bump it every time you:

- Add a new model or model family
- Modify the system prompt assembly
- Change reasoning budget defaults
- Add a new MaxQ-specific feature
- Patch behavior in a way you'd want documented

Don't bump it for:

- Pure documentation changes in `docs/maxq/`
- Local debugging that you're going to revert

### How to bump

The version lives in `src/package.json`. Edit the `version` field directly:

```json
{
  "version": "3.53.0-maxq.2",
  ...
}
```

Then add a one-line entry in `docs/maxq/CHANGELOG.md` (see "Cutting a release"
below). Then build and install.

## Cutting a release

A "release" is just: bump the version, document what changed, build, install,
commit, push to your fork.

```bash
# 1. Bump version in src/package.json
# 2. Add entry to docs/maxq/CHANGELOG.md
# 3. Verify the build works
pnpm install:vsix

# 4. Commit
git add src/package.json docs/maxq/CHANGELOG.md
git add [whatever files you changed]
git commit -m "maxq: <one-line description>"

# 5. Push to your fork
git push origin maxq
```

If the change involves a sprint plan in `docs/maxq/sprints/`, mark the sprint
as completed in that file when you cut the release.

## Display name customization

The extension currently displays as "Roo Code" (controlled by
`src/package.nls.json`). To make it obvious which version is installed, you
may want to change this to "Roo Code (MaxQ)".

If you do this, only modify the English locale (`src/package.nls.json`), not
the language-specific files (`package.nls.de.json`, etc.) — those are merged
from upstream and changes there will conflict on every upstream sync.

The change is one line:

```json
{
  "extension.displayName": "Roo Code (MaxQ)",
  ...
}
```

## Troubleshooting

**`pnpm install` fails on bootstrap.mjs**: Check Node version. Must be exactly
20.19.2. Run `node --version` to verify.

**`pnpm vsix` succeeds but VS Code doesn't see the new version**: Fully quit
VS Code (Cmd+Q) and reopen. Window reload is not sufficient. If still wrong,
check the Extensions panel and uninstall any duplicate Roo entries.

**Build is slow even after small change**: Run `pnpm clean` to clear
Turbo cache, then `pnpm vsix` again.

**Marketplace Roo and MaxQ Roo are both installed**: They share the extension
ID. Uninstall the marketplace one. Going forward, when you want upstream's
latest, sync your fork (see `UPSTREAM-SYNC.md`) rather than installing from
the marketplace.

**API key from VSCode settings doesn't carry over after install**: Should not
happen. Settings are stored per-user in VS Code, not per-VSIX. If it does
happen, your fork has likely changed the extension ID — search `src/package.json`
for the `name` field and ensure it's still `roo-cline`.

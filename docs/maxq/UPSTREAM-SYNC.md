# Upstream Sync Protocol

This document covers how to pull in changes from `RooCodeInc/Roo-Code` (or
the community-maintained fork, depending on which you've set as upstream)
without losing MaxQ customizations.

## One-time setup (verify it's already done)

```bash
cd ~/Projects/Roo-Code-MaxQ
git remote -v
```

You should see:

- `origin` → your personal fork on GitHub (e.g., `mattcoffman/Roo-Code`)
- `upstream` → the canonical Roo repo

If `upstream` is missing:

```bash
git remote add upstream https://github.com/RooCodeInc/Roo-Code.git
```

## Branch model

Two long-lived branches:

- **`main`** — tracks `upstream/main` exactly. Never commit here directly.
- **`maxq`** — your customization branch. All MaxQ changes live here.

## Routine sync (every 1–2 weeks)

```bash
# 1. Fetch upstream
git fetch upstream

# 2. Update your main to match upstream's main
git checkout main
git merge --ff-only upstream/main
git push origin main

# 3. Bring those changes into maxq
git checkout maxq
git merge main
```

Step 3 is where conflicts may appear. The MaxQ design tries to minimize them
by keeping changes in places upstream rarely touches:

- **`docs/maxq/`** — never conflicts (upstream doesn't write here).
- **Model definitions in `packages/types/src/providers/anthropic.ts`** —
  occasionally conflicts when upstream adds new Anthropic models. Resolution
  is usually a simple merge of two new entries side by side.
- **Switch statements in `src/api/providers/anthropic.ts`** — occasionally
  conflicts when upstream adds new Anthropic models. Add the new upstream
  model AND the MaxQ model to both switch lists.
- **`src/package.json` `version` field** — always conflicts. See protocol
  below.

## Resolving the version conflict

Every upstream sync will produce a conflict on the `version` field in
`src/package.json` because upstream bumps it on every release.

**Resolution rule:** take upstream's version and re-apply your `-maxq.N`
suffix, resetting N to 1.

Example: upstream went from `3.53.0` to `3.54.0`. Your `maxq` branch had
`3.53.0-maxq.4`. After merge, set `src/package.json` `version` to
`3.54.0-maxq.1`. Add a CHANGELOG entry noting the upstream sync.

## Resolving model-list conflicts

If upstream adds a new model in `packages/types/src/providers/anthropic.ts`
or in the switch statements in `src/api/providers/anthropic.ts`, the merge
conflict will look like two `case` statements colliding. Resolution: include
both. Make sure the model definition file and both switch statements stay
synchronized — every model in the definition file must appear in both switch
statements, or runtime behavior will be wrong.

## Resolving locale conflicts

Don't modify locale files outside English (`src/package.nls.json`). If you
already did and got conflicts, the safe resolution is "take upstream" — let
upstream's translations win. Re-apply your English-only customization
afterward if needed.

## After every sync

```bash
# Verify build still works
pnpm install:vsix

# Run a quick smoke test in VS Code
# (open a session, send a message, confirm the agent responds)

# Commit and push
git push origin maxq
```

If the smoke test fails, do NOT push the merge — investigate the conflict
resolution. The most common cause is forgetting to add a MaxQ model to one
of the two switch statements in `src/api/providers/anthropic.ts`.

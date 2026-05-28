# Sprint 003 — Zoo Code cherry-pick catch-up + Opus 4.8

## Status: COMPLETED

## Goal

Two things in one sprint, because both get new value into the daily flow fast:

1. **Cherry-pick the valuable bug fixes** from Zoo Code's post-fork work into
   our `maxq` branch — without inheriting their identity rename or the noise.
2. **Add `claude-opus-4-8`** to the native Anthropic provider, reusing the
   adaptive-thinking machinery built in Sprint 002.

## Context: why this sprint exists

The original Roo Code (`RooCodeInc/Roo-Code`) was archived in April 2026 and
the extension shut down May 15. The community successor is Zoo Code
(`Zoo-Code-Org/Zoo-Code`). Zoo Code did a full identity rename
(`RooVeterinaryInc.roo-cline` → `ZooCodeOrganization.zoo-code`), which means we
CANNOT track it as a clean upstream — their rename commits would clobber our
identity and orphan our sessions, agentic file-readers, IPC bridge, and
GlowPitch integration.

Instead, MaxQ keeps its own identity (`RooVeterinaryInc.roo-cline`) and treats
Zoo Code as a _source of selective cherry-picks_, governed by the triage rubric
in `docs/maxq/FORK-TRIAGE.md`.

As of this sprint, there were 28 real commits in Zoo Code since the fork. The
triage rubric flagged 6 as worth taking; this sprint cherry-picks them.

Separately, Opus 4.8 launched May 28 2026 — same pricing as 4.7, same
adaptive-thinking + effort-control API shape. Zoo Code does NOT yet have 4.8.
Adding it ourselves is the concrete payoff of owning our model layer.

## Design principles (NON-NEGOTIABLE)

1. **Additive only.** No existing model or provider behavior changes except the
   new opus-4-8 entry and the cherry-picked fixes (which are themselves
   additive — they gate new behavior behind flags/conditions).
2. **Reject the rename.** Do NOT cherry-pick any commit that renames, rebrands,
   or relocates identity. Our extension stays `roo-cline`.
3. **Verify clean application.** Each cherry-pick targets files our `maxq`
   branch has NOT modified (verified below). If a cherry-pick reports a
   conflict, STOP and escalate — it means our assumptions about file overlap
   were wrong.
4. **Opus 4.8 reuses Sprint 002 machinery.** Do not invent a new adaptive path.
   Same flags (`supportsAdaptiveThinking`, `supportsTemperature: false`), same
   `output_config.effort`, same `display: "summarized"`.

---

## PART A — Cherry-picks from Zoo Code

### Setup: add Zoo Code as a fetch-only remote

We need access to Zoo Code's commits without making it our tracked upstream.
Add it as a separate remote we only ever cherry-pick from.

```bash
cd ~/Projects/Roo-Code-MaxQ
git remote add zoo https://github.com/Zoo-Code-Org/Zoo-Code.git
git fetch zoo
git checkout maxq
```

### The 6 cherry-pick commits (apply oldest first)

Each is on Zoo Code's `main`. Hashes are from Zoo Code's history as of this
sprint; if a hash has changed (force-push/rebase), match by the PR number in
the commit message.

| Order | Hash        | What it fixes                                            | Files touched                                                      | Overlap w/ our customizations |
| ----- | ----------- | -------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------- |
| 1     | `7c58206d8` | uuid security + pin esbuild/rollup/vite                  | `package.json`, `pnpm-lock.yaml`                                   | None (root deps)              |
| 2     | `b5c5e2188` | repair truncated diffs with missing markers              | `src/core/diff/strategies/multi-search-replace.ts` + test          | None                          |
| 3     | `513f47d59` | omit temperature for OpenAI-compat models that reject it | `src/api/providers/openai.ts` + test                               | None                          |
| 4     | `d96cd4ce0` | terminate running process when task cancelled            | `src/integrations/terminal/TerminalRegistry.ts` + test + changeset | None                          |
| 5     | `cef0cc342` | honor custom Gemini model ids (e.g. gemini-3.5-flash)    | `src/api/providers/gemini.ts` + test                               | None                          |
| 6     | `6470431a7` | turbo v2.9.14 security bump                              | `pnpm-lock.yaml`                                                   | None                          |

**Why these 6 and not the other 22:** see `docs/maxq/FORK-TRIAGE.md`. Summary:
the others add providers/models we don't use (Opencode-Go, Fireworks, Xiaomi
MiMo), fix Windows-only behavior, do localization, or are the identity rename /
test-only / dep-refactor noise.

**Notable:** commits 3 and 5 were authored with Claude Opus 4.7 assistance and
reach the same temperature-suppression conclusion we did in Sprint 002 — they
generalize it to the OpenAI-compatible and Gemini provider paths, which our
Anthropic-only Sprint 002 didn't cover. Worth having.

### Application

```bash
git cherry-pick 7c58206d8        # 1: uuid + build-tool security
git cherry-pick b5c5e2188        # 2: diff repair
git cherry-pick 513f47d59        # 3: openai temperature
git cherry-pick d96cd4ce0        # 4: terminal cancel
git cherry-pick cef0cc342        # 5: gemini custom ids
git cherry-pick 6470431a7        # 6: turbo bump
```

**If a non-lockfile cherry-pick conflicts:** STOP. The conflict means a file we
thought was untouched by our fork actually was. Escalate to Matt rather than
resolving blind.

**If a lockfile (`pnpm-lock.yaml`) conflict occurs:** expected and safe to
resolve mechanically.

```bash
git checkout --theirs pnpm-lock.yaml
git add pnpm-lock.yaml
git cherry-pick --continue
# After all cherry-picks, regenerate to be safe:
pnpm install
```

### Part A verification

```bash
pnpm install
pnpm install:vsix --force
```

- Build succeeds.
- Quick smoke test: send one message via Anthropic provider, confirm normal
  operation. (Diff-repair and terminal-cancel fixes are defensive; just confirm
  nothing regressed.)
- If you use a custom Gemini id, confirm it now sticks instead of falling back.

---

## PART B — Add claude-opus-4-8 to native Anthropic

### B1. `packages/types/src/providers/anthropic.ts`

Add the `claude-opus-4-8` entry directly after `claude-opus-4-7`. Identical
shape to 4.7. Only the model id and comment differ.

```typescript
"claude-opus-4-8": {
    maxTokens: 128_000, // Overridden to 8k if `enableReasoningEffort` is false.
    contextWindow: 200_000, // Default 200K, extendable to 1M with beta flag
    supportsImages: true,
    supportsPromptCache: true,
    inputPrice: 5.0,
    outputPrice: 25.0,
    cacheWritesPrice: 6.25,
    cacheReadsPrice: 0.5,
    supportsReasoningBudget: true,
    // Opus 4.8 uses the same adaptive-thinking + effort-control API shape as
    // 4.7 (launched 2026-05-28, same pricing). Adaptive thinking + temperature
    // suppression must travel together — see SPRINT-002.
    supportsAdaptiveThinking: true,
    supportsTemperature: false,
    tiers: [
        {
            contextWindow: 1_000_000,
            inputPrice: 10.0,
            outputPrice: 37.5,
            cacheWritesPrice: 12.5,
            cacheReadsPrice: 1.0,
        },
    ],
},
```

**Pricing note:** Anthropic launched 4.8 at the same standard pricing as 4.7
($5/$25). The 1M-context tier pricing is assumed identical to 4.7; verify
against docs.anthropic.com/pricing before commit. If 4.8's 1M tier differs,
update the `tiers` block.

### B2. `src/api/providers/anthropic.ts` — the four-site discipline

Sprint 001 established that any new Anthropic model must appear in FOUR places
in this file. Add `claude-opus-4-8` to all four, adjacent to the
`claude-opus-4-7` entry in each:

1. **1M context beta-header conditional** (~line 70 in `createMessage`): add
   `modelId === "claude-opus-4-8"` to the OR chain.
2. **1M context pricing/ModelInfo conditional** (`getModel()`, ~line 341): add
   `id === "claude-opus-4-8"` to the OR chain. _(This is the silent-cost-bug
   site from Sprint 001 — do not skip it.)_
3. **Outer routing switch** (~line 85): add `case "claude-opus-4-8":`.
4. **Inner prompt-caching switch** (~line 149): add `case "claude-opus-4-8":`.

Because opus-4-8 has `supportsAdaptiveThinking: true`, the adaptive-thinking
branch in `reasoning.ts` and the temperature-strip in `model-params.ts` (both
from Sprint 002) apply automatically — no changes needed there. The
`output_config: { effort: "high" }` conditional spread in `createMessage` (also
Sprint 002) keys off `info.supportsAdaptiveThinking`, so it applies too.

### B3. Nothing else changes

- `reasoning.ts` — no change (Sprint 002 branch handles it).
- `model-params.ts` — no change (Sprint 002 temperature strip handles it).
- `model.ts` — no change (`supportsAdaptiveThinking` field already exists).
- Vertex provider — out of scope.

---

## What MUST NOT change

- Any model entry other than the new `claude-opus-4-8`.
- The four Sprint-001 sites for `claude-opus-4-7` — leave those, add 4.8 alongside.
- Extension identity (`name: roo-cline`, `publisher: RooVeterinaryInc`). If a
  cherry-pick touches `src/package.json` identity fields, drop that hunk.
- All locale files.
- The `default:` arm of the createMessage switch.

---

## Build & test (full sprint)

```bash
cd ~/Projects/Roo-Code-MaxQ
nvm use
pnpm install
pnpm install:vsix --force
```

Quit and reopen VS Code (Cmd+Q).

### Smoke tests

1. **opus-4-8 thinking ON:** select `claude-opus-4-8`, thinking enabled, send
   "Explain why the sum of two even numbers is always even." Expect: streams
   normally, reasoning text visible (confirms `display: summarized`), no 400.
2. **opus-4-8 thinking OFF:** same model, thinking disabled, send "Capital of
   France?" Expect: normal response, no reasoning block, no 400.
3. **opus-4-8 1M context:** enable 1M beta toggle, send a message, confirm in
   dev console the `context-1m-2025-08-07` header is sent AND the cost display
   reflects 1M-tier pricing (confirms site #2 from B2).
4. **opus-4-7 regression:** confirm 4.7 still works (thinking on/off).
5. **Gemini custom id (cherry-pick 5):** if you use one, confirm it sticks.
6. **General regression:** sonnet-4-6 thinking on/off still behaves as before.

## Done criteria

### Part A (cherry-picks)

- [ ] `zoo` remote added, fetched
- [ ] All 6 commits cherry-picked cleanly (or lockfile conflicts resolved per protocol)
- [ ] No cherry-pick altered extension identity
- [ ] Build succeeds, smoke test passes

### Part B (opus-4-8)

- [ ] `claude-opus-4-8` entry added to `packages/types/src/providers/anthropic.ts`
- [ ] opus-4-8 added to all FOUR sites in `src/api/providers/anthropic.ts`
- [ ] Smoke tests 1–3 pass (thinking on, off, 1M context)
- [ ] opus-4-7 and sonnet-4-6 regression tests pass

### Release

- [ ] Version bumped to `3.53.0-maxq.3` in `src/package.json`
- [ ] Entry added to `docs/maxq/CHANGELOG.md` (note both cherry-picks and opus-4-8)
- [ ] This sprint marked COMPLETED
- [ ] Committed to `maxq` and pushed

## Risk

**Part A: Low.** All 6 cherry-picks target files our fork hasn't modified, so
clean application is expected. Only expected friction is `pnpm-lock.yaml`
conflicts (mechanical). The escalation rule (stop on any non-lockfile conflict)
catches the one scenario where our overlap analysis was wrong.

**Part B: Low.** opus-4-8 reuses fully-tested Sprint 002 machinery. The only
new-model risk is the four-site discipline; smoke test 3 catches a missed 1M
site, and a missed switch site produces an immediate 400 on first message
(smoke test 1).

**Cross-cutting:** the deps cherry-picks change build tooling. If the build
behaves oddly after Part A, that's the suspect — `pnpm clean && pnpm install`
before deeper investigation.

## Notes for future fork management

This is the first execution of the cherry-pick workflow in
`docs/maxq/FORK-TRIAGE.md`. After completing, record the last Zoo Code commit
hash processed (`6470431a7`) in that doc so the next triage cycle starts from
there rather than re-reviewing these 28 commits.

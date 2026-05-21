# Sprint 004 — Deploy Bundle 1 (gemini-3.5-flash + flash35 mode + reasoning=low) into Glowpitch

## Status: READY TO DEPLOY

## Summary

Bundle 1 — pinned `gemini-3.5-flash` model entry, `flash35` mode, and `reasoningTokens` measurement plumbing — was measured against a synthetic Glowpitch-style designer task (build an HTML page from two reference screenshots). The full A→C treatment (`gemini-3.5-flash` + `flash35` mode + `--reasoning-effort low`) delivered **−27% cost, −45% turns, −83% reasoning tokens, and +1 quality point** versus the `gemini-flash-latest` + `code` + `medium` baseline. A clean isolation test (Run B-clean: `gemini-flash-latest` + `flash35` + `low`) proved the optimization **cannot** be deployed as pure config: `gemini-flash-latest` ignores the `--reasoning-effort low` signal and performs no better than baseline. The fork model entry is required. The next step is **one real Glowpitch outbound build** to validate against historical baseline before any further fork work (Bundles 2/3, cache investigation, image pruning).

Raw measurements: [`~/tmp/roo-img-experiment/RESULTS.md`](../../../../../tmp/roo-img-experiment/RESULTS.md).

## The measurement table

Four runs, identical brief ([`brief.md`](../../../../../tmp/roo-img-experiment/brief.md)), identical reference screenshots (~1.8MB combined). All numbers reproduced verbatim from [`~/tmp/roo-img-experiment/RESULTS.md`](../../../../../tmp/roo-img-experiment/RESULTS.md).

| Metric                | Run A (baseline)      | Run B (contaminated) | Run B-clean (isolation) | Run C (full Bundle 1) | A→C delta  |
| --------------------- | --------------------- | -------------------- | ----------------------- | --------------------- | ---------- |
| **Model**             | `gemini-flash-latest` | `gemini-3.5-flash`   | `gemini-flash-latest`   | `gemini-3.5-flash`    | —          |
| **Mode**              | `code`                | `code`               | `flash35`               | `flash35`             | —          |
| **Reasoning**         | `medium`              | `medium`             | `low`                   | `low`                 | —          |
| **turns**             | 11                    | 16                   | 16                      | **6**                 | **−45.5%** |
| **tokensIn**          | 387,142               | 517,543              | 494,028                 | **124,320**           | **−67.9%** |
| **cacheReads**        | 233,865               | 352,479              | 347,974                 | **26,885**            | **−88.5%** |
| **tokensOut**         | 15,924                | 15,194               | 16,100                  | **12,689**            | **−20.3%** |
| **reasoningTokens**   | 9,402                 | 9,293                | 10,147                  | **1,635**             | **−82.6%** |
| **cost ($)**          | $0.127                | $0.174               | $0.136                  | **$0.093**            | **−26.8%** |
| **image_payload_pct** | 94.2%                 | 92.9%                | (n/a)                   | 97.6%                 | —          |
| **quality (1–5)**     | 4                     | 4                    | 4                       | **5**                 | **+1**     |

**Key isolation finding (Run B-clean):** `gemini-flash-latest + flash35 + reasoning-effort low` performed identically to baseline (16 turns, $0.136, 10,147 reasoning tokens — actually slightly _worse_ than Run A). The `-latest` alias does not honor the `low` effort signal. The optimization requires the new fork SHA that vendors the `gemini-3.5-flash` model entry. **Pure config is not a viable shortcut.**

## The Glowpitch deployment changes

Three changes. Show actual values, not prose.

### 1. Bump `ROO_FORK_SHA`

The new SHA carries:

- A pinned `gemini-3.5-flash` model entry in [`packages/types/src/providers/gemini.ts`](../../../packages/types/src/providers/gemini.ts:123) — `supportsTemperature: false`, `supportsReasoningEffort: ["minimal", "low", "medium", "high"]`, `inputPrice: 0.5`, `outputPrice: 3.0`, `cacheReadsPrice: 0.05`.
- The `flash35` mode in `DEFAULT_MODES` in [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:215) — `groups: ["read", "edit", "command", "mcp"]`, with the action-budget / observe-once / output-discipline / tool-selection / reasoning `customInstructions` block.
- `reasoningTokens` plumbing through [`src/core/task/Task.ts`](../../../src/core/task/Task.ts:2677) so the per-turn reasoning-token count surfaces in `api_req_started.text` for diagnostic tooling (`diag-token-curve.js`) to read.

**SHA to vendor:** at time of writing, the tip of this fork's `maxq` branch is `d4da877af` (same SHA that built the binary at `~/.local/bin/roo` used to produce the RESULTS measurements above). Before bumping, **confirm** this is still the commit you want — if Bundle 1 has since merged forward, use the current `HEAD` of `maxq`:

```bash
cd ~/Projects/Roo-Code-MaxQ
git rev-parse --short HEAD
```

**Mechanism:** Update `ROO_FORK_SHA` in Glowpitch's vendoring config to that SHA. The exact mechanism (git submodule update, `pnpm` workspace pin, `pnpm patch` regeneration, vendored tarball, prebuilt binary swap, etc.) is whatever Glowpitch uses today — that's outside the visibility of this doc. Run whatever Glowpitch's existing fork-bump procedure is and rebuild.

### 2. Set model + mode + effort env overrides

Glowpitch presumably has a runtime config (likely `model-config.js` or similar) that sets environment variables for the spawned `roo` subprocess. The deployment must set:

```bash
ROO_MODEL=gemini-3.5-flash
ROO_REASONING_EFFORT=low
ROO_MODE=flash35
```

**Critical:** `ROO_MODEL` must be **`gemini-3.5-flash`**, not `gemini-flash-latest`. The Run B-clean isolation test proved the `-latest` alias does not benefit from `reasoning-effort low`. The optimization only works against the pinned `3.5-flash` entry.

**Variable-name caveat:** the names `ROO_MODEL` / `ROO_REASONING_EFFORT` / `ROO_MODE` above mirror the CLI flag conventions from the experiment harness (`--model`, `--reasoning-effort`, `--mode`). Glowpitch's actual env var names may differ — possibly `MODEL_ID`, `GEMINI_MODEL`, `ROO_REASONING`, etc. **Verify the names against Glowpitch's actual `model-config.js`** before pushing. The _content_ of the settings is what matters; the variable names are local to Glowpitch.

### 3. Decide on the mode strategy — pick one

**Option (a) — use the upstream `flash35` mode as-is.**

```bash
ROO_MODE=flash35
```

- Pros: simplest deploy; no Glowpitch-specific mode file to maintain; mode definition travels with the fork SHA.
- Cons: `flash35`'s `customInstructions` are generic. If Glowpitch already has a designer-specific brief-shaping prompt (likely — it's a designer product), that brief-shaping is lost.

**Option (b) — layer flash35's instructions onto Glowpitch's existing `designer` mode.** _(recommended for Glowpitch)_

Glowpitch ships its own `.roomodes` file at the task workspace level with a `designer` mode entry. Append the verbatim `flash35` `customInstructions` block (below) to Glowpitch's existing `designer` mode `customInstructions`, then keep `ROO_MODE=designer` (whatever Glowpitch currently sets).

- Pros: preserves Glowpitch's existing brief-shaping language while picking up the action-budget / observe-once-then-stop / output-discipline / tool-selection / reasoning nudges that drove the Run C improvement.
- Cons: one more Glowpitch-local file to keep in sync with upstream `flash35` evolution.

**Recommendation: Option (b).** Glowpitch almost certainly has crafted designer instructions worth preserving (brief shape, gate questions, brand language), and the `flash35` behavioral contract is small enough to append cleanly without conflict.

**Verbatim `customInstructions` block to append**, extracted from [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:232):

```markdown
# Action budget

You have a limited action budget of approximately 12 tool calls per turn. Use them efficiently. Prefer one larger read or write over many smaller ones. Do not call the same tool twice on the same file unless the file has changed.

# Visual inputs

When you receive a screenshot or image, observe it ONCE and write a concise textual summary of what you see (layout, colors, hierarchy, copy, noteworthy patterns). After that summary exists, treat the image as consumed — your written observation is the durable record, not the pixels. Do not request the image again.

# Output discipline

Produce the requested artifact directly. Do not narrate what you are about to do before doing it. Do not summarize what you just did unless asked. If you need clarification, ask one specific question and stop; do not speculate across multiple branches.

# Tool selection

Prefer the edit tool over apply_diff. Prefer read_file with a specific offset/limit over reading whole files. Prefer search_files over listing directories when you know what you're looking for.

# Reasoning

Think enough to plan the next 1-2 steps. Do not pre-plan an entire multi-turn workflow before acting; observation is cheaper than speculation.
```

For reference, the `flash35` `roleDefinition` (kept upstream, not duplicated into Glowpitch's `designer` mode unless desired) is:

> You are a focused, action-oriented engineer operating on Gemini 3.5 Flash. You produce high-quality code and content in as few iterations as possible. You prefer doing over deliberating: read what you need, act, observe, adjust. You do not re-read information already gathered, and you treat your action budget as a real constraint, not a guideline.

## Verification — confirm the deploy worked

Hit all three checkpoints on a single small Glowpitch task before running production traffic.

### Checkpoint 1 — Bundle 1 plumbing is live

Spawn one Glowpitch task. After the first API request completes, grep the task's `ui_messages.json` `api_req_started` records for `"reasoningTokens"`:

```bash
grep -l '"reasoningTokens"' ~/.vscode-mock/global-storage/tasks/<task-id>/ui_messages.json
```

- **Present** → Bundle 1's measurement plumbing is live; the fork SHA picked up correctly.
- **Absent** → the SHA bump didn't take. The vendored fork is older than `d4da877af` (or wherever Bundle 1 landed). Re-do step 1 of the deployment.

### Checkpoint 2 — model routing is correct

In the same task's `api_req_started.text`, the model name being hit should be `gemini-3.5-flash`:

```bash
grep -o '"model":"[^"]*"' ~/.vscode-mock/global-storage/tasks/<task-id>/ui_messages.json | sort -u
```

- **`"model":"gemini-3.5-flash"`** → env var override took.
- **`"model":"gemini-flash-latest"`** (or anything else) → `ROO_MODEL` is not being honored. The optimization is silently disabled and you'll see Run-B-clean-shaped numbers (no improvement). Re-check Glowpitch's actual env var name.

### Checkpoint 3 — reasoning-token budget collapse

Run C showed `reasoningTokens` of 1,635 total across 6 turns (≈270/turn average). The signature of a working deployment is **single-digit thousands at most, often hundreds per turn**:

```bash
grep -o '"reasoningTokens":[0-9]*' ~/.vscode-mock/global-storage/tasks/<task-id>/ui_messages.json
```

- Per-turn `reasoningTokens` in the low hundreds to low thousands → `--reasoning-effort low` is being honored end-to-end.
- Per-turn `reasoningTokens` of 8k+ (Run A / B / B-clean territory) → `low` is being ignored. Most likely cause: `ROO_MODE` is not routing to `flash35` (or to Glowpitch's flash35-augmented `designer`), so the model is running on the default `code`-mode instructions and Gemini's effort flag is being underweighted.

## Known risks — the gate-hang

**This is the unmitigated risk for the first real run.**

The synthetic designer task used for the RESULTS measurements had no `ask_followup_question` gate — the brief was self-contained, the model produced HTML, done. Real Glowpitch outbound builds **do** have such gates (clarifying questions about brand voice, scope, asset choices). The `flash35` mode's `customInstructions` say "If you need clarification, ask one specific question and stop" — that instruction has never been pressure-tested at `--reasoning-effort low` against a real ambiguous brief.

**Two failure modes are possible at `low` effort:**

1. **Skip-the-gate:** the model proceeds straight to other tool calls without asking the clarifying question, producing output that misses the brief's actual intent.
2. **Hang-on-gate:** the model triggers `ask_followup_question` but at the wrong moment (after partial tool work, not before), and the turn sits idle waiting for a user response that the harness never produces.

### What to monitor on the first real Glowpitch run

- **Idle turns.** Does any turn sit > 60 seconds with no API call in flight and no tool execution? That's a gate-hang signature.
- **Misordered gate.** Does an `ask_followup_question` tool call appear _after_ other tool calls in the same turn, rather than as the first action? That's the gate being triggered at the wrong moment.
- **Skipped gate.** Does the model proceed to file writes without asking a clarification question that a historical `high`-effort run on the same brief _did_ ask? Compare turn-by-turn against the historical baseline.

### Mitigation if gate-hang surfaces

Strengthen the gate prompt in Glowpitch's `designer` mode `customInstructions` — make the gate the explicit first action when the brief is ambiguous. Suggested language:

> **Gate question first.** Before any other tool calls in this turn, ask exactly ONE specific clarifying question via `ask_followup_question` if the brief is ambiguous on scope, brand voice, or required assets. Do not call other tools first and then ask. If the brief is unambiguous, proceed without asking.

This is what `high` reasoning effort was implicitly buying (longer planning → noticing the ambiguity → asking first). The strengthened prompt is the explicit replacement at `low` effort.

## What's NOT in this deploy (scope discipline)

**Bundle 1 ships** (and only ships):

- New model entry: `gemini-3.5-flash` in [`packages/types/src/providers/gemini.ts`](../../../packages/types/src/providers/gemini.ts:123).
- New mode: `flash35` in [`packages/types/src/mode.ts`](../../../packages/types/src/mode.ts:215).
- `reasoningTokens` measurement plumbing through [`src/core/task/Task.ts`](../../../src/core/task/Task.ts:2677) into `api_req_started.text`.

**Bundle 1 does NOT ship:**

- **Bundle 2 — image-nesting fix.** Images are currently emitted as siblings _after_ `functionResponse` rather than nested inside, per [`src/api/transform/gemini-format.ts`](../../../src/api/transform/gemini-format.ts:131). Article-mandated correctness fix; not blocking on the measurement data, but deferred so this deploy stays config-only on the Glowpitch side.
- **Bundle 3 — `mediaResolution: low` config.** Would cut per-image tokenization. All four runs showed 93–98% image payload share of total context; this is the biggest remaining structural lever, but not in this deploy.
- **Cache investigation.** `cacheWrites: 0` across all four runs — Gemini's context caching never activated despite a 1.8MB image payload re-injected every turn. A major unsolved question, but it requires Glowpitch-scale data to diagnose: synthetic tasks may not trip Gemini's 32k minimum-tokens cache threshold, or the harness may not be enabling caching at all.
- **Image pruning.** Replacing consumed image `inlineData` with text breadcrumbs after N turns. The highest-leverage structural change for designer-style multi-turn workflows, but should be informed by real Glowpitch data on how images compound across turns.

The post-Glowpitch-validation decision is **which of these to prioritize next**, based on what the first real run's numbers show. If image_payload_pct stays at 93–98% and cacheWrites stays at 0, Bundle 3 + cache investigation jump to the top. If the gate-hang surfaces, the gate-prompt strengthening is the priority instead.

## Rollback

If the first Glowpitch run is materially worse than baseline — higher cost, more turns, broken output, or a gate-hang — the rollback is **one env var change**:

```bash
ROO_MODEL=gemini-flash-latest
```

That single override disables the optimization without re-vendoring the fork, without rebuilding, and without touching the `flash35`/`designer` mode files. The new model entry and the `flash35` mode remain installed but dormant — Glowpitch is back to its current behavior. No panic deploy needed. That's the practical advantage of having the optimization gated by config rather than baked into a behavior change at build time.

If a deeper rollback is needed (e.g. the new fork SHA broke something unrelated), drop `ROO_FORK_SHA` back to its prior value and rebuild via Glowpitch's normal mechanism. The new mode and model entry vanish with it.

## Done criteria

- [ ] Confirmed which SHA to vendor (`d4da877af` or current `HEAD` of `maxq`)
- [ ] `ROO_FORK_SHA` bumped in Glowpitch's vendoring config and rebuild completed
- [ ] `ROO_MODEL=gemini-3.5-flash` (or Glowpitch's equivalent env var) set in runtime config
- [ ] `ROO_REASONING_EFFORT=low` set
- [ ] Mode strategy chosen: Option (a) `ROO_MODE=flash35`, OR Option (b) `flash35` `customInstructions` appended to Glowpitch's `designer` mode
- [ ] Checkpoint 1: `reasoningTokens` field present in `api_req_started` records
- [ ] Checkpoint 2: model name in `api_req_started.text` is `gemini-3.5-flash`
- [ ] Checkpoint 3: per-turn `reasoningTokens` in the low hundreds to low thousands range
- [ ] Gate-hang monitors in place for the first real outbound build (idle turns, misordered gate, skipped gate)
- [ ] Rollback procedure (`ROO_MODEL=gemini-flash-latest`) tested at least once in a non-production task
- [ ] First real Glowpitch outbound build executed and metrics captured against historical baseline

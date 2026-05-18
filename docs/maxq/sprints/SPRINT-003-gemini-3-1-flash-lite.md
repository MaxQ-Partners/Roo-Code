# Sprint 003 — Add gemini-3.1-flash-lite to native Gemini provider

## Status: COMPLETED

## Goal

Add `gemini-3.1-flash-lite` as a selectable model in the native Gemini
provider, mirroring the configuration shape of the existing
`gemini-3.1-pro-preview` entry but with flash-lite pricing.

## Background

Google released `gemini-3.1-flash-lite` as the cost-optimized tier of the
3.1 generation — targeted at high-volume agentic tasks, translation, and
simple data processing. Our current `packages/types/src/providers/gemini.ts`
has `gemini-3.1-pro-preview` and `gemini-3-flash-preview` but no flash-lite
variant in the 3.1 line. The closest existing entries are
`gemini-2.5-flash-lite-preview-09-2025` (right pricing band, older
generation) and `gemini-3.1-pro-preview` (right generation, wrong cost).

Pricing per Google's published rates (paid tier, standard):

| Field         | Price                                       |
| ------------- | ------------------------------------------- |
| Input         | $0.25 per 1M tokens (text/image/video)      |
| Output        | $1.50 per 1M tokens (incl. thinking tokens) |
| Context cache | $0.025 per 1M tokens (text/image/video)     |

Source: <https://ai.google.dev/gemini-api/docs/pricing> and the Gemini API
reference at <https://ai.google.dev/api>.

## Why this sprint is short

Unlike Sprint 001 (which had four sites to update across two files in the
Anthropic provider), the Gemini provider has **no per-model switch
statements**. `src/api/providers/gemini.ts` looks up the model purely via a
dictionary read:

```typescript
// src/api/providers/gemini.ts:351
let id = modelId && modelId in geminiModels ? (modelId as GeminiModelId) : geminiDefaultModelId
let info: ModelInfo = geminiModels[id]
```

That means adding a new Gemini model is a **single-file change** to the
types package. No provider-code edits, no beta headers, no prompt-caching
arms, no four-site discipline. The most common silent-failure pattern from
Sprint 001 (a model entry that's selectable but disabled in a switch) does
not apply here.

## Files to modify

One location in one file.

### 1. `packages/types/src/providers/gemini.ts`

Add the `gemini-3.1-flash-lite` entry to the `geminiModels` object. Match
the shape of the existing `gemini-3.1-pro-preview` entry (same 3.1
generation, same reasoning-effort API). Place the new entry directly after
the `gemini-3.1-pro-preview-customtools` entry (around line 67), grouped
with the rest of the 3.1 family.

```typescript
"gemini-3.1-flash-lite": {
    maxTokens: 65_536,
    contextWindow: 1_048_576,
    supportsImages: true,
    supportsPromptCache: true,
    supportsReasoningEffort: ["low", "medium", "high"],
    reasoningEffort: "low",

    supportsTemperature: true,
    defaultTemperature: 1,
    inputPrice: 0.25, // $0.25 per 1M input tokens (text/image/video)
    outputPrice: 1.5, // $1.50 per 1M output tokens (incl. thinking tokens)
    cacheReadsPrice: 0.025, // $0.025 per 1M cached tokens
    // No `cacheWritesPrice` — Google publishes a per-token-hour storage
    // price ($1.00 / 1M / hr) which doesn't map onto our flat
    // cacheWritesPrice field. Leaving undefined matches how
    // gemini-2.5-flash-lite-preview-09-2025 handled this until it grew a
    // cacheWritesPrice of 1.0; if we want to mirror that convention,
    // set cacheWritesPrice: 1.0 here too. See "Open question" below.
},
```

### Notes on the entry

- **No tiers.** Unlike `gemini-3.1-pro-preview`, flash-lite has flat pricing
  with no >200K context tier change per Google's published table. The
  existing `gemini-3-flash-preview` and `gemini-2.5-flash-lite-*` entries
  also omit tiers, which matches.
- **`supportsReasoningEffort` vs. `supportsReasoningBudget`.** The 3.1
  family uses the effort-string API (`["low", "medium", "high"]`), not the
  numeric thinking-budget slider used by 2.5-flash-lite. This is the
  pattern from `gemini-3.1-pro-preview`. Flash-lite _may_ also support
  `"minimal"` like `gemini-3-flash-preview` does — confirm against the API
  reference before committing; if so, add `"minimal"` to the array and
  consider `reasoningEffort: "minimal"` as the default to match flash-lite's
  cost-optimized positioning.
- **`maxTokens: 65_536` and `contextWindow: 1_048_576`** match the rest of
  the Gemini 3.x family. Verify against the model card.
- **`supportsImages: true`** — confirmed by the pricing table including
  image input.

### Open question (resolve before committing the code, not before merging this sprint doc)

`cacheWritesPrice` is unset. The Google docs price cache _storage_ at $1.00
per 1M tokens per hour, which is a fundamentally different unit from our
flat `cacheWritesPrice` (per-token, one-shot at write time). Two acceptable
options:

1. **Leave undefined.** `calculateCost` in `src/api/providers/gemini.ts`
   doesn't reference `cacheWritesPrice` at all (only `cacheReadsPrice`), so
   omitting it has no runtime effect. This is the most honest representation
   of Google's pricing model.
2. **Set to `1.0` for parity with `gemini-2.5-flash-lite-preview-09-2025`.**
   Cosmetic only — it makes the dropdown/info panel display a writes price
   that's actually a per-hour storage rate, which is misleading.

Recommendation: option 1 (omit). If a future sprint adds proper hourly
cache-storage cost tracking, both entries can be updated together.

## Files NOT to modify

- `packages/types/src/providers/vertex.ts` — Vertex parity is out of scope.
  If/when `gemini-3.1-flash-lite` is needed via Vertex AI, that's a future
  sprint (the same single-entry pattern will apply, just mirrored).
- `src/api/providers/gemini.ts` — no code changes. The provider is fully
  table-driven for Gemini-native models.
- `src/api/providers/vertex.ts` — out of scope.
- Any locale or translation files — the new model ID will surface in
  dropdowns automatically based on the `geminiModels` entry. There are no
  per-model UI strings to translate.
- `geminiDefaultModelId` — leave it on `gemini-3.1-pro-preview`. Flash-lite
  is a cost optimization, not the default capability tier; making it the
  default would be a behavior change for every existing user.

## Build & test

```bash
cd ~/Projects/Roo-Code-MaxQ
nvm use
pnpm install:vsix --force
```

Quit and reopen VS Code.

### Smoke test 1 — model appears and responds

1. Open Roo settings → API Configuration → Gemini provider → Model dropdown.
2. Verify `gemini-3.1-flash-lite` appears in the list.
3. Select it. Send a test message: "What is the capital of France?"
4. Expected: response streams normally, no errors in the dev console.
5. Verify cost shown in the chat history is non-zero and roughly matches
   the expected $0.25/$1.50 per-million-token rates for the message size.

### Smoke test 2 — reasoning effort works

1. Same model selected. In the reasoning controls, switch between
   `low` / `medium` / `high`.
2. Send a moderately complex prompt: "Explain why the sum of two odd
   numbers is always even, step by step."
3. Expected at `high`: reasoning text appears during streaming, response
   takes longer, output token count includes a `thoughtsTokenCount`.
4. Expected at `low`: faster response, smaller `thoughtsTokenCount`.
5. No 400 errors from the Gemini API.

### Smoke test 3 — regression on gemini-3.1-pro-preview

1. Switch back to `gemini-3.1-pro-preview`.
2. Send a message. Verify behavior is identical to before the change
   (tiered pricing still in effect, reasoning effort still works).

### Smoke test 4 — regression on gemini-2.5-flash-lite-preview-09-2025

1. Switch to `gemini-2.5-flash-lite-preview-09-2025`.
2. Verify the thinking-budget slider UI still appears (it uses
   `supportsReasoningBudget`, not `supportsReasoningEffort` — the two
   shapes share no UI surface so this should be unaffected, but worth a
   visual confirmation).
3. Send a message, verify response.

## Done criteria

- [ ] `gemini-3.1-flash-lite` appears in the model dropdown for the Gemini provider
- [ ] Selecting it and sending a message succeeds
- [ ] Cost calculations show non-zero values matching the $0.25 / $1.50 / $0.025 price entries
- [ ] Reasoning effort dropdown (`low` / `medium` / `high`) is visible and changes affect response behavior
- [ ] Pricing data verified against <https://ai.google.dev/gemini-api/docs/pricing> at time of commit
- [ ] `supportsReasoningEffort` array verified — does the API accept `"minimal"`? Update entry if so.
- [ ] No regression in `gemini-3.1-pro-preview` or `gemini-2.5-flash-lite-preview-09-2025` behavior
- [ ] Version bumped to `3.53.0-maxq.3` in `src/package.json`
- [ ] Entry added to `docs/maxq/CHANGELOG.md`
- [ ] Sprint status updated to COMPLETED in this file
- [ ] Changes committed to `maxq` branch and pushed to fork

## Risk

**Low across the board.**

Single-file additive change, no provider-code edits, no switch statements to
keep in sync. The worst loud-failure mode is a typo in the model ID, in
which case the new entry simply doesn't appear in the dropdown and no
existing model is affected.

The only meaningful silent-failure risk is **incorrect pricing data**.
`calculateCost` in `src/api/providers/gemini.ts:466` reads `inputPrice`,
`outputPrice`, and `cacheReadsPrice` directly from the model entry; a typo
(e.g. `2.5` instead of `0.25`) would produce silently wrong cost numbers
that only show up when reconciling against a Google invoice. The Done
criteria above include a manual cost check on the first message to catch
this. There is no tiered-pricing branch to worry about because flash-lite
has flat pricing.

A second, smaller risk: if the Gemini API rejects `supportsReasoningEffort:
["low", "medium", "high"]` for flash-lite (e.g. because flash-lite only
accepts `"minimal"` or a different set), requests will 400 when reasoning
effort is non-default. Smoke test 2 catches this. If it fails, narrow the
`supportsReasoningEffort` array to match what the API actually accepts.

## Out of scope (deferred to future sprints)

- **Vertex AI parity** for `gemini-3.1-flash-lite`.
- **Hourly cache-storage cost tracking.** Google prices Gemini context
  caching at $1.00 / 1M tokens / hour for flash-lite, which doesn't map
  onto our flat per-token `cacheWritesPrice`. Accurate cost reporting for
  long-lived caches would require a schema change across `ModelInfo` and
  every consumer of `cacheWritesPrice`.
- **Free-tier / batch / flex / priority pricing modes.** This sprint
  reflects only the paid-tier standard rate. If Roo eventually supports
  selecting the batch or flex tier, a separate `tiers`-style structure or
  per-mode override on `ModelInfo` will be needed.
- **Promoting `gemini-3.1-flash-lite` to `geminiDefaultModelId`.** Not done
  here — would be a behavior change for every existing user.

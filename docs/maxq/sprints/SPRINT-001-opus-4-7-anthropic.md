# Sprint 001 — Add claude-opus-4-7 to native Anthropic provider

## Status: COMPLETED

## Goal

Add `claude-opus-4-7` as a selectable model in the native Anthropic provider,
mirroring the configuration that already exists in the Vertex provider.

## Background

Upstream Roo has `claude-opus-4-7` defined in
`packages/types/src/providers/vertex.ts` and listed in
`VERTEX_1M_CONTEXT_MODEL_IDS`. The native Anthropic provider
(`packages/types/src/providers/anthropic.ts` and
`src/api/providers/anthropic.ts`) does not have this model yet.

We use the native Anthropic provider in production (per
`services/roo-bridge.js` config in glowpitch-new), so we need it there.

## 1M context invariant (read this first)

> **Any time a model supports the 1M context beta, its ID must appear in
> BOTH of the following places in `src/api/providers/anthropic.ts`:**
>
> 1. The `if` block in **`createMessage`** — sends the `context-1m-2025-08-07`
>    beta header in the API request.
> 2. The `if` block in **`getModel()`** — updates the `ModelInfo` object so
>    that downstream cost-tracking and context-budgeting code sees the
>    1M-tier pricing and context window.
>
> Adding to one without the other produces a silent-corruption failure:
> the API call succeeds, the response comes back, but all cost calculations
> and context-budget decisions use the wrong (200K-tier) numbers. This does
> not show up in a smoke test. It shows up weeks later when reconciling
> against an Anthropic invoice.

## Files to modify

Four locations across two files. All changes are additive — no existing
behavior changes.

### 1. `packages/types/src/providers/anthropic.ts`

Add the `claude-opus-4-7` entry to the `anthropicModels` object. Match the
shape of the existing `claude-opus-4-6` entry, which is the most similar
model. Place the new entry directly after `claude-opus-4-6` (line 93).

The pricing data matches opus-4-6 (the assumption is that opus-4-7 launched
at the same Opus tier; verify against docs.anthropic.com/pricing before
committing).

```typescript
"claude-opus-4-7": {
    maxTokens: 128_000, // Overridden to 8k if `enableReasoningEffort` is false.
    contextWindow: 200_000, // Default 200K, extendable to 1M with beta flag
    supportsImages: true,
    supportsPromptCache: true,
    inputPrice: 5.0, // $5 per million input tokens (≤200K context)
    outputPrice: 25.0, // $25 per million output tokens (≤200K context)
    cacheWritesPrice: 6.25,
    cacheReadsPrice: 0.5,
    supportsReasoningBudget: true,
    tiers: [
        {
            contextWindow: 1_000_000, // 1M tokens with beta flag
            inputPrice: 10.0,
            outputPrice: 37.5,
            cacheWritesPrice: 12.5,
            cacheReadsPrice: 1.0,
        },
    ],
},
```

**Note on `maxTokens`**: the snippet originally provided used `8192`, but
the existing native Anthropic `claude-opus-4-6` entry uses `128_000` with
a comment that it gets overridden to 8k when reasoning is disabled. Going
with 128k matches the upstream native Anthropic pattern. The 8k cap is
enforced elsewhere in the model-params transform layer when reasoning is
off.

---

### 2. `src/api/providers/anthropic.ts` — 1M header in `createMessage` (line ~68)

Inside `createMessage`, there is an `if` block that pushes the
`context-1m-2025-08-07` beta header. Add `modelId === "claude-opus-4-7"`
adjacent to the `claude-opus-4-6` check.

```typescript
if (
	(modelId === "claude-sonnet-4-20250514" ||
		modelId === "claude-sonnet-4-5" ||
		modelId === "claude-sonnet-4-6" ||
		modelId === "claude-opus-4-6" ||
		modelId === "claude-opus-4-7") &&
	this.options.anthropicBeta1MContext
) {
	betas.push("context-1m-2025-08-07")
}
```

### 3. `src/api/providers/anthropic.ts` — 1M pricing in `getModel()` (line ~341)

Inside `getModel()`, there is a **separate** `if` block that updates the
`ModelInfo` object to reflect 1M-tier pricing and context window when the
beta is enabled. This is **not** the same block as #2 — it controls what
the rest of the system (cost tracking, context budgeting) sees, not what
header is sent.

Add `id === "claude-opus-4-7"` adjacent to the `claude-opus-4-6` check.

```typescript
if (
    (id === "claude-sonnet-4-20250514" ||
        id === "claude-sonnet-4-5" ||
        id === "claude-sonnet-4-6" ||
        id === "claude-opus-4-6" ||
        id === "claude-opus-4-7") &&
    this.options.anthropicBeta1MContext
) {
    // Use the tier pricing for 1M context
    const tier = info.tiers?.[0]
    ...
}
```

> ⚠️ Sites #2 and #3 are the paired 1M-context gates. They must always be
> updated together. See the **1M context invariant** section above.

### 4. `src/api/providers/anthropic.ts` — two switch statements in `createMessage`

Two switch statements inside `createMessage` both need `claude-opus-4-7`
added. They gate the prompt-caching code path.

**First switch** (around line ~83, the outer routing):

```typescript
switch (modelId) {
    case "claude-sonnet-4-6":
    case "claude-sonnet-4-5":
    case "claude-sonnet-4-20250514":
    case "claude-opus-4-6":
    case "claude-opus-4-7":     // ADD
    case "claude-opus-4-5-20251101":
    ...
```

**Second switch** (around line ~149, inside the IIFE that controls the
`prompt-caching-2024-07-31` beta header):

```typescript
switch (modelId) {
    case "claude-sonnet-4-6":
    case "claude-sonnet-4-5":
    case "claude-sonnet-4-20250514":
    case "claude-opus-4-6":
    case "claude-opus-4-7":     // ADD
    case "claude-opus-4-5-20251101":
    ...
        betas.push("prompt-caching-2024-07-31")
        return { headers: { "anthropic-beta": betas.join(",") } }
```

Both switches must include every model that should support cache control.
Missing the model in either one will produce broken behavior at runtime.

## Files NOT to modify

- `packages/types/src/providers/vertex.ts` — already has `claude-opus-4-7`
  and lists it in `VERTEX_1M_CONTEXT_MODEL_IDS`.
- `src/api/providers/anthropic-vertex.ts` — Vertex routing is upstream's job.
- Any locale or translation files — opus-4-7 will appear in dropdowns based
  on the model definition, no UI string changes needed.

## Build & test

```bash
cd ~/Projects/Roo-Code-MaxQ
nvm use
pnpm install:vsix
```

Quit and reopen VS Code. Open Roo settings → API Configuration → Anthropic
provider → Model dropdown. Verify `claude-opus-4-7` appears. Select it.
Send a test message. Verify it responds and the response shows correct
token accounting in the chat history.

If using 1M context: enable "Anthropic Beta 1M Context" in settings, then:

1. Verify the `context-1m-2025-08-07` beta flag is sent (confirm via API
   request logs in the dev console).
2. **Verify the model's `contextWindow` reads as `1,000,000`** in the UI or
   via `getModel()` in the debugger — not `200,000`. This confirms site #3
   (`getModel()`) was updated correctly.
3. **Verify pricing reflects the 1M tier** ($10/$37.50 input/output per
   million tokens, not $5/$25). This is the check that would catch a
   regression where #2 was updated but #3 was not.

## Done criteria

- [ ] `claude-opus-4-7` appears in the model dropdown for the Anthropic provider
- [ ] Selecting it and sending a message succeeds
- [ ] Cost calculations show non-zero values matching the price entries
- [ ] 1M context beta flag is sent when the toggle is enabled
- [ ] With 1M context enabled, `contextWindow` reads as `1,000,000` and pricing reflects the higher tier ($10/$37.50)
- [ ] Version bumped to `3.53.0-maxq.1` in `src/package.json`
- [ ] Entry added to `docs/maxq/CHANGELOG.md`
- [ ] Sprint status updated to COMPLETED in this file
- [ ] Changes committed to `maxq` branch and pushed to fork

## Risk

**Low for loud failures, medium for silent failures.**

All changes are additive. Worst case for a loud failure: a typo in the
model ID causes the new entry to not appear in the dropdown, in which case
existing models still work as before.

The silent-failure risk is higher and worth calling out explicitly. There
are **four** sites that must all be updated together. Three of them
(`createMessage` beta header, outer switch, inner switch) produce
immediate, obvious failures if missed — wrong header sent, request falls
into the `default` branch, prompt caching silently disabled. The fourth
site (`getModel()` 1M pricing update) produces a silent-corruption failure:
the API call succeeds, the response arrives, and cost calculations quietly
use 200K-tier pricing instead of 1M-tier pricing. The smoke test (send a
message) passes; only the 1M-context verification steps in the Done
criteria above would catch it.

**The four sites must stay in sync.** Adding a model to any of the four
without adding it to all four is a bug.

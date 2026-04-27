# Sprint 002 — Add adaptive thinking support for claude-opus-4-7

## Status: COMPLETED

## Goal

Make `claude-opus-4-7` actually work end-to-end with thinking enabled.
Sprint 001 made the model selectable but the API rejects all requests because
opus-4-7 introduces three breaking changes to the Anthropic Messages API:

1. **Extended thinking budgets removed** — `thinking: {type: "enabled", budget_tokens: N}` returns 400. The only thinking-on mode is `thinking: {type: "adaptive"}`.
2. **Sampling parameters removed** — setting `temperature`, `top_p`, or `top_k` to any non-default value returns 400.
3. **Thinking content omitted by default** — the `thinking` field on thinking blocks comes back empty unless `display: "summarized"` is set explicitly. Roo's UI silently goes blank during reasoning without this opt-in.

Source: https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7
and https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking

This sprint adds adaptive thinking support so opus-4-7 works correctly while
keeping all existing models (opus-4-6, sonnet-4-6, etc.) on their current code
paths unchanged.

## Design principles (NON-NEGOTIABLE)

These constraints are critical. Roo MUST honor them during implementation.

1. **Additive only.** No existing behavior changes for any model other than
   opus-4-7. Every new field is optional and defaults to the existing behavior
   when absent.
2. **Two new capability flags drive everything.** All branching is gated on
   either `model.supportsAdaptiveThinking` (new field) or
   `model.supportsTemperature` (existing field, currently unused). Models that
   don't have these flags set hit the existing code paths unchanged.
3. **No refactors.** Don't simplify, deduplicate, or "clean up" existing code
   while you're in there. If the code in the surrounding area looks like it
   could be improved, that's a separate sprint.
4. **The four-site discipline from Sprint 001 still applies.** Any time a
   model has `supportsAdaptiveThinking: true`, it MUST also have
   `supportsTemperature: false`. Models that have one without the other will
   400 in production. Document this explicitly in the model entry comment.
5. **Type casts at SDK boundaries are expected.** The Anthropic SDK's
   `BetaThinkingConfigParam` type and `MessageCreateParams` type may not yet
   include `"adaptive"`, `display`, or `output_config`. Use `as unknown as` casts
   at the call sites — do not modify the SDK types.

## Files to modify

Five locations across four files. No new files. No deletions.

### 1. `packages/types/src/model.ts`

Add a new optional capability flag to `modelInfoSchema`. Insert it adjacent to
the existing `supportsReasoningBudget` and `supportsReasoningBinary` flags so
related capability flags stay grouped.

```typescript
// Add this new field next to the other supports* reasoning flags:
supportsAdaptiveThinking: z.boolean().optional(),
```

The existing `supportsTemperature` field at the same location can be reused
without modification. No other changes to this file.

### 2. `packages/types/src/providers/anthropic.ts`

Update the existing `claude-opus-4-7` entry (added in Sprint 001) to set both
capability flags. Add a comment that flags must travel together.

Current state (post-Sprint-001):

```typescript
"claude-opus-4-7": {
    maxTokens: 128_000,
    contextWindow: 200_000,
    supportsImages: true,
    supportsPromptCache: true,
    inputPrice: 5.0,
    outputPrice: 25.0,
    cacheWritesPrice: 6.25,
    cacheReadsPrice: 0.5,
    supportsReasoningBudget: true,
    tiers: [ /* ... */ ],
},
```

New state:

```typescript
"claude-opus-4-7": {
    maxTokens: 128_000,
    contextWindow: 200_000,
    supportsImages: true,
    supportsPromptCache: true,
    inputPrice: 5.0,
    outputPrice: 25.0,
    cacheWritesPrice: 6.25,
    cacheReadsPrice: 0.5,
    supportsReasoningBudget: true,
    // Adaptive thinking + temperature suppression must travel together.
    // Opus 4.7 rejects both `thinking.type: "enabled"` (use "adaptive")
    // and any explicit `temperature` value. Setting only one flag
    // produces 400 errors. See docs/maxq/sprints/SPRINT-002.
    supportsAdaptiveThinking: true,
    supportsTemperature: false,
    tiers: [ /* ... */ ],
},
```

`supportsReasoningBudget: true` is intentionally retained — it's what makes
the existing "Enable thinking budget" UI toggle visible for this model. The
transform layer (next change) will translate that toggle into the adaptive
API shape rather than the budget API shape.

### 3. `src/api/transform/reasoning.ts`

Modify the `getAnthropicReasoning` function. The current implementation is one
line; the new implementation is a small early-branch.

Current:

```typescript
export const getAnthropicReasoning = ({
	model,
	reasoningBudget,
	settings,
}: GetModelReasoningOptions): AnthropicReasoningParams | undefined =>
	shouldUseReasoningBudget({ model, settings }) ? { type: "enabled", budget_tokens: reasoningBudget! } : undefined
```

New:

```typescript
export const getAnthropicReasoning = ({
	model,
	reasoningBudget,
	settings,
}: GetModelReasoningOptions): AnthropicReasoningParams | undefined => {
	// Adaptive-thinking models (Opus 4.7+) reject {type: "enabled", budget_tokens}.
	// When reasoning is enabled by the user, emit adaptive shape with summarized
	// display so the UI continues to show reasoning text during streaming.
	// SDK types lag the API; cast through `unknown` at the boundary.
	if (model.supportsAdaptiveThinking) {
		if (shouldUseReasoningBudget({ model, settings })) {
			return {
				type: "adaptive",
				display: "summarized",
			} as unknown as AnthropicReasoningParams
		}
		return undefined
	}

	return shouldUseReasoningBudget({ model, settings })
		? { type: "enabled", budget_tokens: reasoningBudget! }
		: undefined
}
```

The `reasoningBudget` parameter is intentionally unused in the adaptive
branch — adaptive thinking has no per-request budget. The slider value in the
UI is silently ignored on opus-4-7 (acceptable for now; future sprint can
repurpose the slider as an effort selector).

Do NOT modify `getOpenRouterReasoning`, `getRooReasoning`, `getGeminiReasoning`,
or `getOpenAiReasoning`. Only the Anthropic function changes.

### 4. `src/api/transform/model-params.ts`

In the anthropic format branch (around line ~154), honor the existing
`supportsTemperature` flag. This wires through the field that already exists
in the schema but has no consumer yet.

Current:

```typescript
if (format === "anthropic") {
	return {
		format,
		...params,
		reasoning: getAnthropicReasoning({ model, reasoningBudget, reasoningEffort, settings }),
	}
}
```

New:

```typescript
if (format === "anthropic") {
	// Models that don't support temperature (e.g. claude-opus-4-7) reject
	// any explicit temperature value with a 400 error. Strip it here so
	// it never reaches the API call site.
	if (model.supportsTemperature === false) {
		params.temperature = undefined
	}
	return {
		format,
		...params,
		reasoning: getAnthropicReasoning({ model, reasoningBudget, reasoningEffort, settings }),
	}
}
```

Pattern matches the existing precedent for OpenAI o1/o3-mini at line ~150 and
o1-pro at line ~165. The TODO comment in the file already anticipated this
change (`// TODO: Add a supportsTemperature field to the model info`); we are
completing the wiring that comment described.

Do NOT remove the existing TODO comments — they reference the OpenRouter
fetcher work which is still pending and out of scope for this sprint.

### 5. `src/api/providers/anthropic.ts`

Two locations need changes — `createMessage` and `completePrompt`. Both
involve the same pattern: when `info.supportsAdaptiveThinking` is true, add
`output_config` to the API request body, and use a conditional spread for
`temperature` so an undefined value is never serialized into the request.

The `info` object is destructured from `this.getModel()` at the top of each
method. Sprint 001 already destructures `id`, `betas`, `maxTokens`,
`temperature`, and `reasoning` — `info` needs to be added to the destructure
in `createMessage`. (It's already accessed via `this.getModel().info` later
in the cost-calculation block, so the property is already on the returned
object.)

#### 5a. `createMessage` — destructure additions

Current (line ~52):

```typescript
let {
	id: modelId,
	betas = ["fine-grained-tool-streaming-2025-05-14"],
	maxTokens,
	temperature,
	reasoning: thinking,
} = this.getModel()
```

New:

```typescript
let {
	id: modelId,
	info,
	betas = ["fine-grained-tool-streaming-2025-05-14"],
	maxTokens,
	temperature,
	reasoning: thinking,
} = this.getModel()
```

#### 5b. `createMessage` — request body for the cached-models switch case

Current (around line ~109, inside the `case "claude-opus-4-7":` arm of the
switch — i.e. all the cached models):

```typescript
stream = await this.client.messages.create(
	{
		model: modelId,
		max_tokens: maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
		temperature,
		thinking,
		// Setting cache breakpoint for system prompt so new tasks can reuse it.
		system: [{ text: systemPrompt, type: "text", cache_control: cacheControl }],
		messages: sanitizedMessages.map(/* ... */),
		stream: true,
		...nativeToolParams,
	},
	(() => {
		/* unchanged headers IIFE */
	})(),
)
```

New (only the body changes — the headers IIFE is untouched):

```typescript
stream = await this.client.messages.create(
	{
		model: modelId,
		max_tokens: maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
		// Conditionally include temperature: undefined values must not be
		// serialized for opus-4-7+ (rejected with 400). Existing models
		// continue to receive their temperature unchanged.
		...(temperature !== undefined && { temperature }),
		thinking,
		// Adaptive-thinking models accept output_config.effort as a soft
		// intelligence-vs-tokens guidance signal. Hardcoded to "high" for now;
		// future sprint can expose this via UI. SDK type lags the API.
		...(info.supportsAdaptiveThinking &&
			({
				output_config: { effort: "high" },
			} as Record<string, unknown>)),
		// Setting cache breakpoint for system prompt so new tasks can reuse it.
		system: [{ text: systemPrompt, type: "text", cache_control: cacheControl }],
		messages: sanitizedMessages.map(/* ... unchanged ... */),
		stream: true,
		...nativeToolParams,
	} as Parameters<typeof this.client.messages.create>[0],
	(() => {
		/* unchanged headers IIFE */
	})(),
)
```

The outer `as Parameters<...>[0]` cast is needed because the SDK type doesn't
include `output_config` yet. Place it on the body literal, not on individual
fields, to keep the cast surface area minimal.

#### 5c. `createMessage` — request body for the default switch case

The `default:` arm of the switch (around line ~178) handles models not in the
recognized list. Opus-4-7 is in the recognized list (per Sprint 001) so this
branch is not hit by opus-4-7 in practice. **Do not modify the default case.**
Leaving it unchanged guarantees no regression for any model that falls
through. Sprint 002 is opus-4-7-only.

#### 5d. `completePrompt`

Current (around line ~322):

```typescript
async completePrompt(prompt: string) {
    let { id: model, temperature } = this.getModel()

    let message
    try {
        message = await this.client.messages.create({
            model,
            max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
            thinking: undefined,
            temperature,
            messages: [{ role: "user", content: prompt }],
            stream: false,
        })
    } catch (error) { /* ... */ }
    /* ... */
}
```

New:

```typescript
async completePrompt(prompt: string) {
    let { id: model, info, temperature } = this.getModel()

    let message
    try {
        message = await this.client.messages.create({
            model,
            max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
            thinking: undefined,
            // Same temperature pattern as createMessage — strip when undefined
            // to avoid 400s on adaptive-thinking models.
            ...(temperature !== undefined && { temperature }),
            // completePrompt is used for one-shot completions. Effort defaults
            // to "high" via Anthropic's API default — no need to send output_config.
            messages: [{ role: "user", content: prompt }],
            stream: false,
        })
    } catch (error) { /* ... */ }
    /* ... */
}
```

`completePrompt` doesn't need `output_config` — Anthropic's default effort
level is `high` which is what we want anyway. Adding it would be additive
noise.

## What MUST NOT change

Roo: please verify these files/sections are still byte-identical to upstream
(or to the pre-sprint state) after your work.

- `packages/types/src/providers/anthropic.ts` — every model entry OTHER than
  `claude-opus-4-7`. No other model gets `supportsAdaptiveThinking` or
  `supportsTemperature: false` in this sprint.
- `packages/types/src/providers/vertex.ts` — Vertex provider is out of scope.
  Opus-4-7 via Vertex will continue to fail until a future sprint mirrors
  these changes there. Document this in the sprint completion notes.
- `src/api/providers/anthropic-vertex.ts` — out of scope, untouched.
- `src/api/providers/bedrock.ts` and any other provider — out of scope.
- The four switch statements / 1M context conditionals in
  `src/api/providers/anthropic.ts` — Sprint 001 already added opus-4-7 to all
  four. Do not modify those again.
- `getOpenRouterReasoning`, `getRooReasoning`, `getGeminiReasoning`,
  `getOpenAiReasoning` — Anthropic-specific changes only.
- The `default:` arm of the switch in `createMessage` — leave alone.
- All locale files, all translation files — no UI string changes.

## Build & test

```bash
cd ~/Projects/Roo-Code-MaxQ
nvm use
pnpm install:vsix
```

Quit and reopen VS Code.

### Smoke test 1 — opus-4-7 with thinking enabled

1. Open Roo settings → API Configuration → Anthropic → select `claude-opus-4-7`.
2. Ensure "Enable thinking budget" is toggled ON.
3. Send a message: "Explain why the sum of two even numbers is always even."
4. Expected: response streams normally. Reasoning text appears in the UI
   (this confirms `display: "summarized"` is working — without it the
   reasoning would be invisible).
5. No 400 errors in the dev console.

### Smoke test 2 — opus-4-7 with thinking disabled

1. Same model. Toggle "Enable thinking budget" OFF.
2. Send a message: "What is the capital of France?"
3. Expected: response streams normally, no reasoning block.
4. No 400 errors.

### Smoke test 3 — regression check on opus-4-6

1. Switch to `claude-opus-4-6` with thinking enabled.
2. Send a message.
3. Expected: behavior is identical to before this sprint. Thinking budget
   slider works, reasoning streams, no errors.
4. Repeat with thinking disabled.

### Smoke test 4 — regression check on sonnet-4-6

1. Switch to `claude-sonnet-4-6`.
2. Send a message with and without thinking enabled.
3. Expected: identical behavior to before this sprint.

### Smoke test 5 — 1M context still works on opus-4-7

1. Settings → enable "Anthropic 1M Context" beta toggle.
2. Send a message via opus-4-7.
3. Verify the request includes `context-1m-2025-08-07` beta header (dev
   console network tab).
4. Verify pricing reflects the 1M-context tier in the cost display
   (this confirms the four-site discipline from Sprint 001 still holds
   alongside the new changes).

## Done criteria

- [ ] `supportsAdaptiveThinking` field added to `modelInfoSchema` in
      `packages/types/src/model.ts`
- [ ] opus-4-7 entry has both `supportsAdaptiveThinking: true` AND
      `supportsTemperature: false` (with the comment explaining they travel
      together)
- [ ] `getAnthropicReasoning` branches on `supportsAdaptiveThinking`
- [ ] `model-params.ts` strips temperature in the anthropic branch when
      `supportsTemperature === false`
- [ ] `createMessage` includes `output_config` conditionally and uses
      conditional spread for `temperature`
- [ ] `completePrompt` uses conditional spread for `temperature`
- [ ] All five smoke tests pass
- [ ] Version bumped to `3.53.0-maxq.2` in `src/package.json`
- [ ] Entry added to `docs/maxq/CHANGELOG.md`
- [ ] Sprint 001 status updated to COMPLETED in
      `docs/maxq/sprints/SPRINT-001-opus-4-7-anthropic.md`
- [ ] Sprint 002 status updated to COMPLETED in this file
- [ ] Changes committed to `maxq` branch and pushed

## Risk

**Medium for silent failures, low for loud failures.**

The biggest silent-failure risk is the `display: "summarized"` opt-in. If it's
omitted, requests will still succeed — but Roo's UI will show a long pause
with no reasoning text during opus-4-7 thinking, then text will appear at the
end. Users will think Roo is hung. Smoke test 1 specifically verifies this.

The biggest loud-failure risk is forgetting to set `supportsTemperature: false`
alongside `supportsAdaptiveThinking: true`, or vice-versa. Either alone produces
400 errors. The model entry comment makes this explicit; smoke tests catch it.

The conditional-spread pattern for temperature is more defensive than
strictly necessary (the SDK likely strips undefined fields), but it's
explicit, unambiguous, and matches what we'd want regardless of SDK behavior.

## Out of scope (deferred to future sprints)

- **Effort level UI control.** Currently hardcoded to `"high"`. A future
  sprint could repurpose the existing thinking-budget slider as an effort
  selector (low/medium/high/xhigh/max), which would be the natural follow-up.
- **Vertex provider parity.** opus-4-7 via Vertex will continue to fail. The
  same pattern applies but lives in different files.
- **Task budgets beta.** Opus-4-7 introduces an optional advisory budget
  across an agentic loop (`task-budgets-2026-03-13` beta header). Could be
  valuable for Roo's agentic use case but not required for opus-4-7 to work.
- **Tokenizer accounting.** Opus-4-7 uses 1.0×–1.35× more tokens than opus-4-6
  for the same text. Cost-per-call is therefore higher even at identical
  per-token pricing. No code change needed — pricing data is correct — but
  worth knowing for benchmarking.
- **`thinking.display` user preference.** Currently hardcoded to
  `"summarized"`. A future setting could let users opt to `"omitted"` for
  faster time-to-first-token if they don't care about visible reasoning.

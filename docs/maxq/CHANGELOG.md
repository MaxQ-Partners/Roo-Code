# MaxQ Changelog

Changes specific to the MaxQ fork of Roo Code. Upstream changes are
tracked separately in the root `CHANGELOG.md` (which we don't modify).

## 3.53.0-maxq.4

### Added

- **`gemini-3.5-flash` model entry + `flash35` mode + `reasoningTokens` plumbing** (Sprint 004 / `c597a05e9`)

    - Added `gemini-3.5-flash` to `packages/types/src/providers/gemini.ts` (line 123):
      `supportsTemperature: false`, `supportsReasoningEffort: ["minimal","low","medium","high"]`,
      `reasoningEffort: "medium"`, `inputPrice: 0.5`, `outputPrice: 3.0`, `cacheReadsPrice: 0.05`.
    - Added `flash35` mode to `DEFAULT_MODES` in `packages/types/src/mode.ts` (line 215-216):
      `groups: ["read","edit","command","mcp"]`, with action-budget / observe-once /
      output-discipline / tool-selection / reasoning `customInstructions`.
    - Added `reasoningTokens` field to per-turn API metrics in `src/core/task/Task.ts`,
      enabling cost-curve diagnostics on thinking-model builds.
    - Measured win on synthetic designer task vs `gemini-flash-latest` + `code` + `medium`:
      −27% cost, −45% turns, −83% reasoning tokens, +1 quality point.

- **`GEMINI_MEDIA_RESOLUTION` env-flag for image cost lever** (Sprint MediaResolution / `19778e828`)
    - Added `MediaResolution` import from `@google/genai` to
      `src/api/providers/gemini.ts`.
    - `GEMINI_MEDIA_RESOLUTION=low|medium|high` maps to the SDK enum and injects
      `mediaResolution` into `GenerateContentConfig`. Unset = no field sent (default
      resolution unchanged). Per-image token cut at `low`: ~75% (~1,080 → ~270 tokens),
      measured on production screenshots in Stage 1.
    - No rebuild required to change resolution — flip the env var and restart.

## 3.53.0-maxq.3

### Added

- **`gemini-3.1-flash-lite` support in the native Gemini provider** (Sprint 003)
    - Added model definition to `packages/types/src/providers/gemini.ts` with
      a 1M context window, `supportsReasoningEffort: ["low", "medium", "high"]`
      (same effort-string API shape as `gemini-3.1-pro-preview`), and flat pricing:
      $0.25 / $1.50 / $0.025 per 1M tokens (input / output / cache-reads).
    - No provider-code changes required — `src/api/providers/gemini.ts` is
      fully table-driven via `geminiModels[id]` lookup; new models appear
      automatically once the type entry is added.

## 3.53.0-maxq.2

### Fixed

- **Adaptive thinking support for `claude-opus-4-7`** (Sprint 002)
    - Added `supportsAdaptiveThinking` capability flag to `ModelInfo` schema in
      `packages/types/src/model.ts`.
    - Set `supportsAdaptiveThinking: true` and `supportsTemperature: false` on the
      `claude-opus-4-7` model entry. These flags must travel together — opus-4-7
      rejects both `thinking.type: "enabled"` and any explicit `temperature` value.
    - Updated `getAnthropicReasoning` to branch on `supportsAdaptiveThinking`:
      emits `{ type: "adaptive", display: "summarized" }` instead of
      `{ type: "enabled", budget_tokens: N }` for adaptive models.
    - Updated `model-params.ts` anthropic branch to strip `temperature` when
      `model.supportsTemperature === false`, preventing 400 errors upstream.
    - Updated `createMessage` to use conditional spread for `temperature` and
      include `output_config: { effort: "high" }` for adaptive models.
    - Updated `completePrompt` to use conditional spread for `temperature`.
    - All existing models (opus-4-6, sonnet-4-6, etc.) are unchanged.

## 3.53.0-maxq.1

### Added

- **`claude-opus-4-7` support in the native Anthropic provider** (Sprint 001)
    - Added model definition to `packages/types/src/providers/anthropic.ts` with
      200K default context window, 1M-tier pricing, `supportsReasoningBudget: true`,
      and `maxTokens: 128_000` (overridden to 8k when reasoning is off).
    - Added to all four required sites in `src/api/providers/anthropic.ts`:
        1. `createMessage` 1M beta-header conditional (sends `context-1m-2025-08-07`)
        2. `createMessage` outer switch (routes to prompt-caching code path)
        3. `createMessage` inner switch (sends `prompt-caching-2024-07-31` header)
        4. `getModel()` 1M pricing conditional (updates `ModelInfo` to 1M-tier
           pricing and context window — required for correct cost accounting)

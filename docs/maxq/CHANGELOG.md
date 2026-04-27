# MaxQ Changelog

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

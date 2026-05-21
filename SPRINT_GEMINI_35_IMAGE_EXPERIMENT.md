# Sprint 1 (Fork): Gemini 3.5 Profile + Image-Consumption Experiment

> **Repo:** `Projects/Roo-Code-MaxQ` (the editable MaxQ Roo CLI fork — same
> tree GlowPitch vendors as `vendor/roo-cli`). ALL work here. Nothing in this
> sprint touches GlowPitch.

> **REVISION NOTE (post code-review):** An earlier draft of this doc reasoned
> from two fork files that turned out NOT to be on GlowPitch's execution path,
> and inverted one claim. Corrections, confirmed by two independent reads of
> the fork code:
>
> 1. `src/api/transform/caching/gemini.ts` is the OpenAI-COMPAT path. The
>    native `GeminiHandler` (`src/api/providers/gemini.ts`, `@google/genai`
>    SDK) NEVER calls `addCacheBreakpoints`. The "mark images cacheable in
>    that file" lever optimizes dead code for the native path. Confirm which
>    path GlowPitch uses (Step 0) — it decides whether any of that applies.
> 2. `src/api/transform/gemini-format.ts:131-135` emits tool_result images
>    as SIBLING parts AFTER the functionResponse (with a "(See next part for
>    image)" breadcrumb), NOT nested inside it. This is the exact anti-pattern
>    Google's article warns causes thought leakage + quality loss. The earlier
>    claim that the fork "already does this right" was WRONG. Fixing it is a
>    QUALITY lever (new Step 3c), and it must land before pruning/caching
>    measurements are trustworthy.
> 3. "Pin the model" is load-bearing, not nominal: `gemini-flash-latest`
>    carries `supportsReasoningBudget: true` so it sends the DEPRECATED
>    `thinkingBudget`. A `gemini-3.5-flash` entry shaped like
>    `gemini-3-flash-preview` (effort-array) is the single change that flips
>    onto the recommended `thinkingLevel` shape.

> **One sprint, one deliverable: a findings doc + measured token/quality data**
> so Sprint 2 (GlowPitch) is scoped from evidence, not inference.

---

## What's verified (from real data) vs. inferred

**Verified — do not relitigate:**

- 90.8% of conversation payload is `image` blocks; written HTML 0.4%. (From
  `glowpitch-new/scripts/diag-token-curve.js --anatomy` on a real build.)
- Builds show a ~47.7% cache-hit ratio (earlier per-turn data) — but per the
  code review this is Gemini IMPLICIT caching, not the `caching/gemini.ts`
  breakpoints (which the native path doesn't use).

**The article's mandatory/near-mandatory changes (apply + measure):**

- Pin model ID; remove `temperature`/`top_p`/`top_k`; use `thinking_level`
  enum not `thinking_budget`; default `medium`, `low` improved for agentic;
  add tool-call-budget system instruction; thought-preservation on by default
  may raise token usage; multimodal content belongs INSIDE functionResponse.

---

## Step 0: Confirm execution path + harness (do FIRST — it gates Step 3)

1. **Which Gemini path does GlowPitch exercise — native `@google/genai`
   (`GeminiHandler`) or OpenAI-compat?** This determines whether any
   cache-breakpoint work is even live code. Confirm by checking how the
   GlowPitch spawn config selects the provider (`--provider gemini` →
   native `GeminiHandler`; an OpenAI-compat base URL → the shim). Almost
   certainly native, given `--provider gemini`. **Write the answer at the top
   of the findings doc.** If native: the cache lever is implicit caching
   (prefix stability) or explicit `cachedContent` API, NOT `caching/gemini.ts`.

2. **Locate the Designer mode.** NOT in this repo's `.roomodes` (upstream dev
   modes: translate/issue-fixer/etc.) nor `.roo/` (upstream rules). It's a
   global/user-level custom mode. Find via `roo list modes` (note the source),
   or recreate a minimal representative Designer in this repo's `.roomodes`
   for the experiment (only needs: read images → observe → write index.html).

3. **Pin the SHA before baselining.** Build with
   `./apps/cli/scripts/build.sh --install`, confirm `roo --version` shows the
   local SHA. The baseline is "fork SHA `<X>` + `gemini-flash-latest`", not
   "whatever `roo` happened to be." Record SHA `<X>` in findings.

4. **Confirm task history path.** Diagnostic reads
   `~/.vscode-mock/global-storage/tasks/<taskId>/`. Confirm the local build
   writes there.

---

## Step 1: Controlled sample task with embedded images

A repeatable task so every config change is measured against identical input.

1. Scratch workspace (e.g. `~/tmp/roo-img-experiment/`) with 2-4 sample
   screenshots in `assets/thumbnails/` (real GlowPitch session screenshots or
   representative full-page captures, realistic dimensions), a `.roo/context.md`
   listing them with "read for analysis" notes mirroring GlowPitch's
   `writeContextMd`, and a trivial "redesign this homepage" brief.
2. Deterministic: same workspace/images/brief every run. Run each config 2-3x
   (token counts vary run-to-run).
3. **Baseline first** — current settings, `gemini-flash-latest`, pinned SHA.
   Capture per-turn table, totals, `--anatomy` image %, AND the new split of
   `reasoningTokens` vs `outputTokens` (see Step 4 measurement note).

---

## Step 2: Config-only changes (lowest risk, article-mandated — do these first)

### 2.1 Add a `gemini-3.5-flash` model entry (effort-shaped)

In `packages/types/src/providers/gemini.ts`, add `gemini-3.5-flash` mirroring
the `gemini-3-flash-preview` entry: `supportsReasoningEffort:
["minimal","low","medium","high"]`, `reasoningEffort: "medium"`,
`supportsTemperature: false`, 1M context, 65k max output (per the article).
This is the switch from deprecated `thinkingBudget` → recommended
`thinkingLevel` with zero changes to `reasoning.ts` (the effort branch exists).
Pin via `--model gemini-3.5-flash`. Verify the outgoing request shows
`thinkingLevel` and NO `temperature`.

### 2.2 Confirm sampling params are stripped

With `supportsTemperature: false` on the entry, confirm no `temperature`/
`top_p`/`top_k` reach the request. Strip any set elsewhere for this profile.

### 2.3 Designer `reasoningEffort: low` + tool-budget instruction

Set the Designer mode to `low` effort. Add the article's tool-budget system
instruction ("limited action budget of ~N tool calls; read each image once;
do not re-read files; work in larger steps"). Measure.

### 2.4 (NEW) Gate-hang re-test — may dissolve Sprint 2's hardest tension

GlowPitch forces `--reasoning-effort high` because low effort made an older
Flash ignore the `ask_followup_question` gate and hang. Two article facts
change this: `low` is "significantly improved" on 3.5 specifically, and a
tool-budget instruction is Google's recommended agentic-loop constraint.
**Run the gate-hang reproduction in isolation at `low` and `medium`, with and
without a strengthened gate instruction** (e.g. "before any other tool, ask
the gate question"). If it clears at `low` with strengthened prompting,
GlowPitch can run `low` everywhere and the Sprint 2 tension evaporates at the
source. Record the result — this is high-value and near-zero-cost to test.

### 2.5 (NEW) `media_resolution: low` test — may obsolete GlowPitch thumbnail work

Gemini image tokens scale with area (~258-token tiles at default resolution).
`media_resolution: "low"` is a per-request config — no GlowPitch code change.
Designer needs layout/color/hierarchy, not pixel detail. Test it on the sample
task, measure the per-image token delta. If it cuts image tokens materially
with acceptable quality, it may replace the GlowPitch-side thumbnail-shrink
entirely.

### 2.6 Re-measure profile delta (2-3x). Compare to baseline.

---

## Step 3: Structural code changes (fork — order matters)

### 3c FIRST (NEW): Nest images INSIDE functionResponse parts

`gemini-format.ts:131-135` currently returns
`[{ functionResponse }, ...imageParts]` — images as siblings after the
response. Per Google this causes thought leakage and lower quality. Restructure
to place image content inside the functionResponse `response` shape the
`@google/genai` SDK accepts for multimodal function responses (verify the
exact shape against the SDK's Multimodal Function Responses docs).

**This must come first** among structural changes: on a model preserving
thoughts by default, out-of-band images contaminate the reasoning channel, so
caching/pruning measurements aren't trustworthy until this is fixed. It may
also be partly what's _forcing_ `high` effort to look acceptable today —
fixing it could be what lets `low` work. Rebuild, re-measure (tokens AND
quality).

### 3b SECOND: Prune consumed image inlineData from history (the structural cure)

Once Designer has read an image and written a text observation, the raw
inlineData has no remaining value for later turns. Replace stale image blocks
(N turns after consumption) with a short text placeholder ("[homepage
screenshot — analyzed above]"), or hook the fork's context-condensing
mechanism to target stale image blocks.

**Scope as a per-MODE behavior, not fork-wide.** Designer mode is uniquely
safe: read-once → write-HTML, no debugging loop that revisits screenshots.
Annotate the findings that this is Designer-specific; a code-debugging mode
might legitimately need to re-examine an image. Rebuild, re-measure. **Highest
leverage on the 90.8% payload** — but measure how much 3c + Step 2 already
bought before assuming pruning must carry the full load.

### 3a CONDITIONAL: cache lever — depends on Step 0

- If GlowPitch uses **OpenAI-compat**: `caching/gemini.ts` IS live; extending
  cache_control to image-bearing messages is viable.
- If **native** (likely): that file is dead code for you. The equivalent is
  explicit `cachedContent` (named-cache API) for the static prefix — a larger,
  different change. Treat as a stretch / Sprint-3 candidate; don't sink time
  here if 3c + 3b + Step 2 already hit the target.

### Measure 3c, 3b (and 3a if applicable) separately AND cumulatively.

---

## Step 4: Findings doc (deliverable → Sprint 2)

Write to `progress.txt` or `docs/gemini-35-image-experiment.md`:

1. **Path answer:** native vs OpenAI-compat (decides 3a relevance).
2. **Measurement table — baseline vs each config. CRITICAL: split
   `reasoningTokens` from `outputTokens` as separate columns.** `calculateCost`
   (`gemini.ts:510`) bills `outputTokens + reasoningTokens` together; 3.5's
   default thought-preservation raises reasoning tokens. Without the split, a
   `low`-effort win hides inside `medium`'s reasoning growth, or a rise is
   misattributed. Columns: `fresh tokensIn | implicit cacheReads | outputTokens
| reasoningTokens | turns | image % | quality(1-5)`. Each config 2-3x;
   report spread.
3. **3.5 profile verdict** — token + quality delta; did `low` produce
   acceptable designs.
4. **Gate-hang verdict (2.4)** — does `low` + strengthened prompt clear the
   gate on 3.5? (Decides whether Sprint 2 can drop `--reasoning-effort high`.)
5. **`media_resolution: low` verdict (2.5)** — token delta + quality; does it
   obsolete GlowPitch thumbnail-shrink?
6. **Structural verdict** — 3c (quality), 3b pruning (cost), 3a (if live).
   Which moved numbers, by how much, at what risk.
7. **Sprint 2 inputs (explicit):**
    - New fork SHA to vendor (with the changes that proved out).
    - GlowPitch-side changes still needed vs. obsoleted (e.g. if `media_resolution
low` works, thumbnail-shrink may be unnecessary).
    - Recommended 3.5 profile env settings for `model-config.js`.
    - Whether `--reasoning-effort high` can be dropped (from 2.4).

---

## Go / No-Go (end of Sprint 1) — direction, not production rollout

- **GO to Sprint 2** if there's a measured win to port: the 3.5 profile is
  better-or-neutral-and-cheaper, AND/OR 3c+3b (and config levers) cut input
  tokens on the controlled task without wrecking quality.
- **NO-GO / re-instrument** if none of the levers move the numbers — meaning
  the cost source wasn't captured by this experiment.

---

## Re-prioritized lever table (high-leverage + low-risk first)

| #   | Change                                     | Token impact                     | Quality impact                         | Risk                       |
| --- | ------------------------------------------ | -------------------------------- | -------------------------------------- | -------------------------- |
| 1   | `gemini-3.5-flash` entry (effort-shape)    | Modest (stops deprecated params) | Stable→+                               | Trivial (data)             |
| 2   | `supportsTemperature: false`               | None direct                      | Removes flagged anti-pattern           | Trivial                    |
| 3   | Designer `low` effort + tool-budget prompt | Significant                      | TBD (gate-hang risk)                   | Trivial                    |
| 4   | `media_resolution: low`                    | Significant per-image            | TBD                                    | Trivial (config)           |
| 5   | Gate-hang re-test at `low`                 | Enables #3 everywhere            | —                                      | Trivial (test only)        |
| 6   | **3c**: images inside functionResponse     | Indirect                         | **Quality stabilizer**                 | Moderate (SDK shape)       |
| 7   | **3b**: prune consumed images              | **Massive** (90.8%)              | Risk: lost referent (low for Designer) | Larger (context transform) |
| 8   | 3a: cache_control images                   | Conditional (OpenAI-compat only) | None                                   | Small if applies           |
| 9   | `cachedContent` API (native)               | Large if static prefix real      | None                                   | Larger (new surface)       |

Do 1-6 first, re-measure, then decide whether 7 still needs to carry load.

---

## Explicitly OUT of scope for Sprint 1

- Any GlowPitch (`glowpitch-new/`) change — including the "obvious"
  thumbnail-shrink and screenshot-cap. Keep this sprint pure fork-side so
  variables don't confound. (And 2.5 may obsolete the thumbnail work anyway.)
- Re-vendoring / bumping `ROO_FORK_SHA` (first action of Sprint 2).
- Production deployment.

---

## Sprint 2 preview (GlowPitch — start only after findings exist)

1. Vendor the proven fork SHA; bump `ROO_FORK_SHA`; rebuild Docker image.
2. Apply only the GlowPitch-side reductions Sprint 1 proved still needed
   (screenshot-count cap; thumbnail-shrink ONLY if `media_resolution: low`
   didn't obsolete it).
3. Set the 3.5 profile via `model-config.js` env overrides.
4. Drop `--reasoning-effort high` IF Sprint 1's gate-hang re-test cleared it;
   otherwise strengthen the gate prompt as proven in 2.4.
5. Measure end-to-end on a real outbound build; production go/no-go (input-token
   cut target + quality holds on the visual scoring rubric).

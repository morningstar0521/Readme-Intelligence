# Phase 5 Tech Evidence Quality Implementation Plan

**Goal:** Improve README-only tech-stack precision and recall toward the PRD target without using repository manifests, network calls, or nondeterministic inference.

**Architecture:** Preserve the dictionary-driven extractor and its evidence records. Add deterministic context classification in `techstack.ts`: implementation evidence from imports and package-style install commands is strong, explicit stack/project-context prose is useful, and integration/support/example prose is excluded unless it is inside a dedicated stack section. Use unit tests for each new evidence boundary and the labeled evaluator as the aggregate gate.

**Tech Stack:** TypeScript, mdast, Vitest, existing `pnpm eval` benchmark.

---

### Task 1: Capture evidence-quality regressions

**Files:**
- Modify: `packages/core/tests/unit/techstack.test.ts`

- [x] Add failing tests for package-style install evidence, import evidence, and integration/support wording.
- [x] Run the focused tech-stack tests and confirm the new cases fail for the expected extraction reason.

### Task 2: Implement deterministic evidence scoring

**Files:**
- Modify: `packages/core/src/extract/techstack.ts`

- [x] Add explicit context classification for implementation, integration, support, and example prose.
- [x] Treat recognized imports and package-style install commands as strong evidence while preserving command extraction boundaries.
- [x] Suppress integration/support/example-only mentions outside dedicated stack sections.
- [x] Keep all evidence source references, deduplication, incidental-tool filtering, and README-only constraints unchanged.
- [x] Run focused tests and the full core test suite.

### Task 3: Evaluate and refine against fixtures

**Files:**
- Generated: `docs/RESULTS.md`

- [x] Run `pnpm eval` and inspect per-fixture tech false positives and false negatives.
- [x] Make only additional test-backed deterministic adjustments that improve aggregate quality without regressing other extractors.
- [x] Run lint, typecheck, core tests, and `pnpm eval` as the completion gate.

### Verification

- [x] `pnpm --filter @readme-intel/core test`
- [x] `pnpm --filter @readme-intel/core lint`
- [x] `pnpm --filter @readme-intel/core typecheck`
- [x] `pnpm eval`

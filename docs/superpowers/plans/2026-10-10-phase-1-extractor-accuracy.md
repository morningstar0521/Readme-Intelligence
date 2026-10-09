# Phase 1 Extractor Accuracy Implementation Plan

**Goal:** Raise command, environment-variable, and tech-stack extraction quality toward the PRD targets without adding an LLM or changing the local-first architecture.

**Architecture:** Keep extraction deterministic and AST-based. Improve command recognition with executable/context heuristics, broaden environment-variable evidence sources, and make tech-stack output depend on evidence strength and dedicated stack sections. Add focused unit tests and use the labeled fixture evaluator as the integration gate.

**Tech Stack:** TypeScript, mdast, unified, Vitest, pnpm evaluation fixtures.

### Task 1: Command extraction coverage

**Files:**
- Modify: `packages/core/src/extract/commands.ts`
- Test: `packages/core/tests/unit/commands.test.ts`

- [ ] Add failing tests for arbitrary CLI executables, assignment-prefixed commands, non-shell command code blocks, blockquote commands, and safe joining of multiline commands.
- [ ] Run the focused command tests and confirm the new cases fail.
- [ ] Add minimal executable/context heuristics without treating prose or function definitions as commands.
- [ ] Run command tests and the existing core unit suite.

### Task 2: Environment-variable evidence

**Files:**
- Modify: `packages/core/src/extract/env.ts`
- Test: `packages/core/tests/unit/env.test.ts`

- [ ] Add failing tests for variables named in prose, inline code, Markdown tables, shell assignments, and PowerShell assignments.
- [ ] Run the focused env tests and confirm failure.
- [ ] Implement deduplicated evidence collection across those sources while preserving masking and required-state behavior.
- [ ] Run env tests and the existing core unit suite.

### Task 3: Tech-stack evidence weighting

**Files:**
- Modify: `packages/core/src/extract/techstack.ts`
- Test: `packages/core/tests/unit/techstack.test.ts`

- [ ] Add failing tests showing weak prose mentions are excluded when a dedicated stack section exists, while explicit stack, badge, language, manifest-like, and command evidence remains.
- [ ] Run the focused tech-stack tests and confirm failure.
- [ ] Implement evidence-tier filtering and ambiguity gates without changing the public `TechItem` shape.
- [ ] Run tech-stack tests and the existing core unit suite.

### Task 4: Fixture evaluation and documentation

**Files:**
- Modify: `docs/RESULTS.md` through `pnpm eval`
- Test: `packages/core/tests/eval/eval.test.ts`

- [ ] Run `pnpm eval --verbose` and inspect command/env/tech misses.
- [ ] Correct only labels proven inconsistent with the README, never labels solely to match extractor output.
- [ ] Run `pnpm eval` and require commands/env regression floors to pass.
- [ ] Run focused eval tests and record the final metrics in generated `docs/RESULTS.md`.

### Verification

- [ ] Run `pnpm --filter @readme-intel/core exec vitest run tests/unit/commands.test.ts tests/unit/env.test.ts tests/unit/techstack.test.ts`.
- [ ] Run the complete core test suite.
- [ ] Run `pnpm eval` and confirm the generated report and exit status.
- [ ] Run typecheck and lint if the focused changes are green.

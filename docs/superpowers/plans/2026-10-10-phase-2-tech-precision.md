# Phase 2 Tech Precision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve tech-stack F1 by preventing incidental package-manager, CI, editor, and source-control mentions from being reported as the project stack.

**Architecture:** Keep the 246-entry dictionary and evidence collection unchanged. Add a small promotion policy at the final tech-stack boundary: incidental tooling is retained only when a dedicated tech-stack section explicitly names it; language tags, imports, headings, badges, and project-specific commands continue to provide evidence for normal technologies.

**Tech Stack:** TypeScript, Vitest, existing mdast extractor pipeline.

---

### Task 1: Add regression tests for incidental tooling

**Files:**
- Modify: `packages/core/tests/unit/techstack.test.ts`

- [x] Add a test proving generic command mentions such as `npm install`, `git clone`, `make`, and `GitHub Actions` do not become the stack.
- [x] Add a test proving an explicit Tech Stack section still returns those names.
- [x] Run the focused test and confirm the new behavior fails before implementation.

### Task 2: Implement the promotion policy

**Files:**
- Modify: `packages/core/src/extract/techstack.ts`

- [x] Add a documented set of incidental tooling names.
- [x] Filter only those names when no Tech Stack section exists and their evidence is limited to incidental text, badges, or command usage.
- [x] Preserve explicit Tech Stack section results and all non-incidental evidence.
- [x] Run focused and full core tests.

### Task 3: Measure and verify

**Files:**
- Modify: generated `docs/RESULTS.md` through `pnpm eval`

- [x] Run `pnpm eval`.
- [x] Run core lint and typecheck.
- [x] Compare tech-stack precision/recall and confirm commands/env vars did not regress.

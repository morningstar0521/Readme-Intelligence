# Phase 3 Environment Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Raise environment-variable extraction recall while preserving precision on the labeled README fixtures.

**Architecture:** Extend the existing deterministic environment extractor at its evidence boundaries: setup lists, inline assignments, shell assignments, Docker `--env` flags, and language-level environment access. Keep masking, deduplication, source references, and Zod validation unchanged.

**Tech Stack:** TypeScript, mdast, Vitest, existing extractor pipeline.

---

### Task 1: Add failing coverage for missing evidence forms

**Files:** `packages/core/tests/unit/env.test.ts`

- [x] Test setup lists, inline `export` assignments, lowercase shell variables, Python/JavaScript environment access, and Docker `--env` examples.
- [x] Confirm the new cases fail before implementation.

### Task 2: Implement safe evidence extraction

**Files:** `packages/core/src/extract/env.ts`, `packages/core/src/extract/section-classifier.ts`

- [x] Accept explicit setup lists under installation/prerequisite headings.
- [x] Parse inline assignments and multiple assignments in one code span.
- [x] Parse explicit lowercase shell variables without treating arbitrary lowercase package names as variables.
- [x] Parse `os.environ`, `os.getenv`, `process.env`, `getenv`, and Docker `--env` usage.
- [x] Recognize “Setting Up” headings as installation sections.
- [x] Require context for bare uppercase inline code and keep common words such as `PATH` out.

### Task 3: Verify and measure

**Files:** generated `docs/RESULTS.md`

- [x] Run focused and full core tests.
- [x] Run lint and strict typecheck.
- [x] Run `pnpm eval` and confirm env F1 improves without command or tech regressions.


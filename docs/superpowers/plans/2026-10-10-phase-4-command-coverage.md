# Phase 4 Command Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve command F1 by recognizing documented platform scripts, project CLIs, and unambiguous command wrappers without broad false-positive matching.

**Architecture:** Extend the existing command-prefix recognizer and normalize only semantic wrappers: `python -m pip` becomes `pip`, and `npx <tool>@latest` becomes `npx <tool>`. Existing source lines, categories, risk flags, and deduplication remain unchanged.

**Tech Stack:** TypeScript, mdast, Vitest, existing command extractor.

---

### Task 1: Add failing command coverage

**Files:** `packages/core/tests/unit/commands.test.ts`

- [x] Test platform scripts, `vc`, `openssl`, `snap`, `yay`, `bin/rails`, and PowerShell `$env:` commands.
- [x] Test wrapper normalization for `python -m pip` and `npx ...@latest`.
- [x] Run the focused command tests and confirm the new cases fail before implementation.

### Task 2: Implement conservative command support

**Files:** `packages/core/src/extract/commands.ts`

- [x] Add only the missing executable prefixes and script-file pattern.
- [x] Normalize the two unambiguous wrapper forms before deduplication and categorization.
- [x] Preserve commands that contain quoted arguments or shell pipelines.
- [x] Run focused and full core tests.

### Task 3: Measure and verify

**Files:** generated `docs/RESULTS.md`

- [x] Run `pnpm eval`.
- [x] Confirm command F1 improves and env/tech scores do not regress.
- [x] Run lint and strict typecheck.

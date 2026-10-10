# Public Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make README Intelligence more credible for public use without regressing its current benchmark scores.

**Architecture:** Keep benchmark scoring unchanged for the existing development set. Add a deterministic fixture split and separate holdout report metadata, update stale documentation, and add adoption documentation/examples without changing runtime behavior.

**Tech Stack:** TypeScript, Vitest, pnpm, Markdown, GitHub Actions.

---

### Task 1: Synchronize public compliance documentation

**Files:**
- Modify: `docs/PRD-COMPLIANCE.md`
- Test: `git diff --check`

- [ ] Update the test counts from the stale 537/8 values to the current verified 590/10 values.
- [ ] Replace old benchmark baseline numbers with the current development-set values from `docs/RESULTS.md`.
- [ ] Mark deployment and screenshot evidence as verified where the repository already contains the live URL and screenshot.
- [ ] Keep unverified coverage and accessibility claims explicitly marked as verification items.
- [ ] Run `git diff --check` and inspect the documentation diff.
- [ ] Commit with `docs: synchronize public compliance status`.

### Task 2: Add a deterministic benchmark holdout report

**Files:**
- Modify: `packages/core/tests/eval/evaluate.ts`
- Modify: `scripts/eval.ts`
- Modify: `docs/RESULTS.md`
- Modify: `docs/BENCHMARK.md`
- Test: `packages/core/tests/eval/eval.test.ts`

- [ ] Add a deterministic split based on fixture name hashing, reserving 20% of labeled fixtures for holdout evaluation.
- [ ] Add tests proving the same fixture always lands in the same partition and no fixture appears in both partitions.
- [ ] Evaluate the development and holdout partitions with the existing field normalizers and metrics.
- [ ] Report holdout counts and metrics separately without changing regression thresholds or the existing aggregate development score.
- [ ] Run the focused evaluation tests and `pnpm eval`.
- [ ] If any current development metric decreases, revert the experiment. Commit the holdout reporting only if the current metrics are preserved.

### Task 3: Add public adoption examples

**Files:**
- Create: `docs/ADOPTION.md`
- Create: `examples/readme-drift/basic.yml`
- Create: `examples/readme-drift/monorepo.yml`
- Create: `examples/readme-drift/report-only.yml`
- Modify: `README.md`
- Test: `git diff --check`

- [ ] Document the three supported adoption patterns with honest prerequisites and release-pinning guidance.
- [ ] Add minimal workflows for a standard repository, a separate base/head checkout, and a report-only workflow.
- [ ] Link the examples from the README without claiming external users or feedback.
- [ ] Run `git diff --check` and validate every YAML file with the repository's available YAML parser or a syntax check.
- [ ] Commit with `docs: add README drift adoption examples`.

### Task 4: Final verification

**Files:**
- No source changes expected.

- [ ] Run `pnpm check`.
- [ ] Run `pnpm eval` and confirm the current development metrics are not lower than the baseline.
- [ ] Run `git diff --check`.
- [ ] Review `git status` and the commit log before reporting results.

# Public Readiness Design

## Goal

Improve public credibility without changing the current README extraction scores: synchronize stale compliance documentation, report an explicit benchmark holdout, and add adoption examples while leaving external developer feedback empty until real users provide it.

## Scope

1. Update `docs/PRD-COMPLIANCE.md` to reflect the current verified test counts, benchmark state, and deployment evidence.
2. Add a deterministic holdout split to the benchmark harness. The existing 59-fixture development score remains the primary score; holdout metrics are reported separately and do not affect regression thresholds.
3. Add three copy-pasteable GitHub Action examples and a short adoption guide. Do not claim users, stars, feedback, or adoption.
4. Any extractor improvement is optional. It may be committed only when the complete benchmark shows no metric regression and at least one target metric improves.

## Non-goals

- No external outreach or fabricated user evidence.
- No new product surface or UI feature.
- No changes to the existing label set unless a label is demonstrably incorrect.
- No change to the current development-set score or regression floor semantics.

## Verification

- `pnpm eval` must preserve the current development metrics unless an extractor change improves them.
- A holdout test must prove the split is deterministic and has no overlap with the development set.
- `pnpm check` and `git diff --check` must pass before commits.

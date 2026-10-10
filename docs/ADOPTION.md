# Adopt README drift checks

README Intelligence can run as a static GitHub Action in repositories that want pull requests to expose stale README claims before merge.

The action checks repository text and metadata. It does not install or execute code from the pull request. The default policy fails only when the change introduces a new contradiction, so existing README problems do not block unrelated work.

## Choose a workflow

| Use case | Example |
|---|---|
| A normal pull request checkout | [`basic.yml`](../examples/readme-drift/basic.yml) |
| Compare explicit base and head checkouts, including monorepos | [`monorepo.yml`](../examples/readme-drift/monorepo.yml) |
| Generate a report without failing CI | [`report-only.yml`](../examples/readme-drift/report-only.yml) |

Copy one example into `.github/workflows/readme-drift.yml` and adjust `readme-path` when the README is not at the repository root.

## Pin the action

The examples use `@main` because the first public release has not been created yet. Before relying on the action for production checks, replace it with the full commit SHA of a reviewed release. Do not use a moving branch as a permanent supply-chain pin.

## Failure policy

- `new-contradiction`: recommended default; fails only on contradictions introduced by the change.
- `contradiction`: fails when any contradiction exists, including old ones.
- `none`: writes the report to the GitHub Actions job summary without failing for findings.

The action also exposes `report_path` and `exit_code` outputs for workflows that want to upload or post the generated Markdown report.

## Local dry run

Run the same logic before opening a pull request:

```bash
pnpm reality . --fail-on new-contradiction --format md
```

This repository does not yet have external user feedback or adoption measurements. Claims about usage should be added only after real repositories run the action.

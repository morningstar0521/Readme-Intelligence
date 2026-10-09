# Repository Reality Check and Setup Readiness

The README panel answers "what does the README say?". The Reality Check answers a different question:
**"is what the README says still true for this repository?"**. It compares README claims with the
repository files and shows every claim with evidence from both sides.

Available for GitHub sources only. It runs when the user clicks **Run reality check**; nothing runs
automatically and nothing is installed or executed.

## What is read

`GET /api/github/repo?owner=&repo=&ref=&path=` (`apps/web/app/api/github/repo/route.ts`) returns a
`RepoSnapshot`: the Git tree (one `git/trees?recursive=1` call) plus the content of up to 60 small
files fetched from `raw.githubusercontent.com` (`packages/core/src/repo/fetchRepo.ts`).

File selection (`repo/select.ts`), in priority order, README folder first and then repository root:

| Group | Files |
|---|---|
| Manifests | package.json, pyproject.toml, requirements.txt (+ dev variants), Pipfile, environment.yml, go.mod, Cargo.toml, Gemfile, composer.json |
| Runtime pins | .nvmrc, .node-version, .python-version, .tool-versions, runtime.txt, rust-toolchain(.toml) |
| Containers / build | Dockerfile, docker-compose.yml/.yaml, compose.yml/.yaml, Makefile |
| Env examples | up to 5: .env.example, .env.sample, .env.template, .env.dist, example.env... |
| CI | up to 8 files in .github/workflows |
| License | LICENSE / LICENCE / COPYING |
| Workspace manifests | up to 8 nested package.json files (apps/*, packages/*...), depth 1-3, excluding examples, tests, docs and node_modules. They add dependencies only: scripts, engines and packageManager always come from the README folder or the root |
| Source sample | top 30 source files by a path score (config / settings / env files, main / index / app / server entry points, src/ app/ lib/ api/), excluding node_modules, dist, build, vendor, docs, tests, fixtures, examples |

Limits: 60 files, 200 KB per file, 3 MB per snapshot, 6 parallel requests, 10 s timeout. Lockfiles are
detected from the tree only (never downloaded). Responses are cached 10 minutes (LRU, 30 entries).

## Facts extracted (`repo/parsers.ts`, `repo/facts.ts`)

Every fact keeps the file and line it came from, so the UI links to
`https://github.com/<owner>/<repo>/blob/<ref>/<path>#L<line>`.

- scripts (package.json), Make targets
- package managers (lockfiles, `packageManager` field, poetry / uv / pipenv config)
- dependencies (npm, PEP 621, Poetry, requirements, go.mod, Cargo)
- runtime requirements (`engines`, `requires-python`, `go` directive, `rust-version`, version files,
  Docker base images, CI setup actions and matrices)
- env vars in example files and in code (`process.env`, `import.meta.env`, `os.environ`, `os.getenv`,
  `os.Getenv`, `std::env::var`, `ENV[]`, `getenv`, `System.getenv`, `Environment.GetEnvironmentVariable`)
- Dockerfiles, Compose services and images, CI workflow commands, license name, CONTRIBUTING

## Claim statuses

| Status | Meaning |
|---|---|
| Verified | README claim confirmed by a repository file |
| Contradiction | README and repository disagree, and both sides are explicit |
| README only | README states it, the repository shows no evidence (possibly stale) |
| Undocumented | Repository has it, README never mentions it |
| Unverified | Not enough evidence either way |

## Checks (`repo/checks.ts`)

| Category | Contradiction when | Otherwise |
|---|---|---|
| command | `npm run x` / `pnpm x` / `make x` and the script or target does not exist | verified; pnpm / yarn / bun shorthand that matches a dependency binary is verified; workspace-scoped (`--filter`, `-w`) is unverified |
| package-manager | README install uses npm but the only lockfile is pnpm / yarn / bun (and the reverse); same for pip vs poetry / uv / pipenv | verified; global installs, `create`, `dlx`, `exec`, `npx` ignored |
| runtime | README minimum is below a requirement file (`engines`, `requires-python`, `go.mod`), or a pin file (.nvmrc...) is below the README minimum | verified; CI and Docker versions are evidence only, never a contradiction |
| env | never | README var used in code or example file = verified; README var nowhere = README only (only if an example file exists or 10+ source files were scanned); code / example var not in README = undocumented |
| tech | never | README tech found in dependencies / files = verified; not found = README only (only when the ecosystem is known and the tree is complete); notable dependency missing from README = undocumented |
| docker | README runs `docker compose` / `docker build` and no Compose file / Dockerfile exists | verified; Docker files the README never explains = undocumented |
| ci | never | README test command matches a CI step = verified; different commands = unverified; CI runs tests but README has no test command = undocumented |
| license | README license family differs from the LICENSE file | verified; LICENSE missing = README only; LICENSE not mentioned = undocumented; CONTRIBUTING not linked = undocumented |
| link / file | a relative link, image or file used in a command (`cp .env.example .env`, `python app.py`, `./run.sh`, `cd dir`) is not in the tree | verified; skipped entirely when GitHub truncated the tree; `cd <repo>` after `git clone` and files created by earlier commands are ignored |

**Precision rule.** A false contradiction destroys trust faster than a missed one, so:
contradictions need an explicit value on both sides; when evidence is partial (truncated tree, few
source files scanned, workspace scripts, unknown ecosystem) the claim becomes Unverified instead.
Each check runs in its own try/catch, so one bad file cannot break the report.

## Setup Readiness (`repo/readiness.ts`)

A separate score from documentation health: "could a developer realistically set this up?". It is a
static consistency check, labelled in the UI as: "Nothing was installed or run, so a high score means
consistent, not guaranteed to work".

| ID | Check | Weight |
|---|---|---|
| R01 | Package manager detected | 10 |
| R02 | Runtime version stated | 10 |
| R03 | Lockfile present (or Python deps pinned with ==) | 10 |
| R04 | Install command valid (no package-manager or missing-file contradiction) | 15 |
| R05 | Run / dev command exists and is not contradicted | 15 |
| R06 | Test command exists (real script, pytest, CI test step, Go / Rust built-in) | 10 |
| R07 | Every env var found in the repository is documented | 10 |
| R08 | .env.example lists every documented variable | 5 |
| R09 | Docker setup consistent | 5 |
| R10 | CI workflow exists and uses the README package manager | 10 |

Repositories without code manifests (docs, awesome lists) pass the code-specific checks as "not
applicable".

## UI

- **Setup readiness** card: score, failed checks ordered by weight with reason and suggestion, all checks on demand.
- **Repository reality check** card: counts per status (click to filter), "Needs attention" (default)
  and "Show all". Each claim expands into an evidence tree: README lines (click to jump in the rendered
  README) and repository files (open on GitHub at the exact line). Contradictions start expanded.
- Copy-as-JSON adds a `realityCheck` block (snapshot summary, counts, readiness, claims).

## Documentation drift (CLI and pull requests)

The same check runs on a local checkout without GitHub: `buildLocalSnapshot` (`repo/local.ts`) builds
the snapshot from `git ls-files` (or a directory walk) with the same file selection and limits, so local
and web results agree.

```bash
pnpm reality .                                   # report for this checkout
pnpm reality ../pr --base ../main --format md    # what changed between two checkouts
pnpm reality . --fail-on contradiction --min-readiness 70   # CI gate
```

`diffRealityReports(base, head)` (`repo/drift.ts`) matches claims by id and returns new, resolved and
still-open contradictions, newly undocumented env vars, the readiness delta and every status change.
`--fail-on new-contradiction` exits 1 only for contradictions the change introduces, so an old problem
on the main branch does not block unrelated pull requests.

`.github/workflows/readme-drift.yml` runs this on every pull request:

1. Checks out the base commit (the checker) and the PR head (files only, no credentials).
2. Runs `pnpm reality ../head --base .` from the base checkout, so the checker code is the base branch's, not the PR's. Nothing from the PR is installed or executed. (With the `pull_request` trigger the workflow file itself comes from the PR; that is safe because fork PRs get a read-only token and no secrets.)
3. Writes the report to the job summary and creates or updates one PR comment (found by a hidden marker).
4. Fails the job when the PR adds a contradiction. On forks the comment step may lack permission; the summary still has the report.

Typical catches: a script renamed in package.json while the README still says `npm run dev`; a linked
doc or image deleted; a new `process.env.X` with no README entry; `engines` raised above the README's
stated Node version.

## Evaluation

`pnpm fixtures:fetch --with-repo` saves a snapshot per fixture to
`packages/core/tests/fixtures/repos/<owner>__<repo>.json`. `pnpm eval --candidates` prints every
non-verified claim per fixture. Confirm the real ones by reading the repository and copy their ids into
the label's `reality` block (docs/LABELING.md). `pnpm eval` then reports contradiction and
undocumented-env precision / recall plus mean readiness in docs/RESULTS.md.

## Limits

- Static only: a script can exist and still fail. Readiness is not a build result.
- Source sample is 30 files, so env "README only" is conservative and may miss uses elsewhere.
- Monorepos: workspace package dependencies are read, but `--filter` / workspace-scoped scripts are reported as unverified, not checked.
- Tech mentioned in passing (for example in a limitations list) can still be read as a stack claim and show as README only.
- Public repositories only: file contents come from raw.githubusercontent.com without a token.
- Each run costs 1 GitHub API request (the tree); raw file reads do not count against the API limit.

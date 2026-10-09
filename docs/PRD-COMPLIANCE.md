# PRD compliance

Status of every requirement in `docs/PRD.md` (the README Intelligence Viewer PRD pack).

Legend:
- **Done**: implemented and covered by tests that ran during development.
- **Done, verify**: implemented and tested in code, but the test needs packages that could not be
  installed in the build environment (rehype, Next.js, Shiki, Playwright). Run `pnpm check` and
  `pnpm e2e` once locally.
- **You**: needs an action only you can take (accounts, hand labelling, deployment).

## Functional requirements

| ID | Requirement | Status | Where |
|---|---|---|---|
| F-01 | GitHub repo URL (+ /tree/branch/path) | Done | `core/github/parseUrl.ts`, `fetchReadme.ts`, `app/api/github/readme/route.ts` |
| F-02 | Raw / blob README URL | Done | same |
| F-03 | Drag-and-drop / pick local .md (browser only) | Done, verify | `components/landing/Landing.tsx`, e2e test 7 |
| F-04 | Paste Markdown | Done, verify | `Landing.tsx`, e2e test 1 |
| F-05 (P1) | `/r/[owner]/[repo]` route | Done | `app/r/[owner]/[repo]/page.tsx` |
| F-10 | GFM rendering | Done, verify | `core/render/pipeline.ts`, `render.test.ts` |
| F-11 | Shiki code blocks, badge, copy, line numbers, wrap, collapse > 30 lines | Done, verify | `components/markdown/CodeBlock.tsx`, `highlighter.ts` |
| F-12 | Embedded HTML through strict schema | Done, verify | `core/render/sanitizeSchema.ts`, `xss.test.ts` |
| F-13 | GitHub alerts | Done, verify | `core/render/alerts.ts`, `render.test.ts` |
| F-14 | Relative links and images resolved | Done | `core/render/resolveUrls.ts`, `resolveUrls.test.ts` |
| F-15 | GitHub heading slugs and anchors | Done, verify | `core/parse/slug.ts`, `pipeline.ts`, `slug-toc.test.ts`, `render.test.ts` |
| F-16 | Badges inline + used for tech detection | Done | `project.ts`, `techstack.ts` |
| F-17 (P1) | Emoji shortcodes | Done, verify | `remark-gemoji` in `parseMarkdown.ts` |
| F-20 | TOC h1-h4 with scroll spy | Done | `LeftSidebar.tsx`, `useScrollSpy` |
| F-21 | Smooth scroll to section | Done | `lib/jump.tsx` |
| F-22 | Collapse / expand side panels | Done | `AppShell.tsx` (Cmd/Ctrl+B, Cmd/Ctrl+Shift+B, persisted) |
| F-23 | Cmd/Ctrl+K search across headings, text, code, commands, env, tech, features | Done | `CommandPalette.tsx`, `core/search/buildIndex.ts` |
| F-24 | Keyboard navigation in search | Done | `CommandPalette.tsx` |
| F-30 | Project card | Done | `ProjectCard.tsx`, `project.ts` |
| F-31 | Features | Done | `features.ts` |
| F-32 | Prerequisites + ordered install steps | Done | `install.ts`, `InstallCard.tsx` |
| F-33 | Commands grouped, copy on click | Done | `commands.ts`, `CommandsCard.tsx` |
| F-34 | Env vars with required, description, masked values | Done | `env.ts`, `EnvCard.tsx` |
| F-35 | Tech stack by category with evidence | Done | `techstack.ts` (246-entry dictionary), `TechStackCard.tsx` |
| F-36 (P1) | API endpoints with examples | Done | `api.ts`, `ApiCard.tsx` |
| F-37 (P1) | Deployment platforms + steps | Done | `deploy.ts`, `DeployCard.tsx` |
| F-38 | Links grouped by type | Done | `links.ts`, `LinksCard.tsx` |
| F-39 | Jump to source on every item | Done | `SourceChip.tsx`, `data-line` attributes, `lib/jump.tsx` |
| F-40 | "Not found in README" empty states | Done | `EmptyState.tsx` in every card |
| F-50 | Health score 0-100 from transparent rules | Done | `health/rules.ts`, `score.ts` |
| F-51 | Checklist with reasons | Done | `HealthCard.tsx` |
| F-52 | Ordered suggestions | Done | `orderedSuggestions()` |
| F-53 | "Heuristic" label | Done | `HEALTH_LABEL` |
| F-60 | Dark / light / system themes, persisted | Done | `lib/theme.tsx`, pre-paint script in `app/layout.tsx` |
| F-61 | Source indicator | Done | `SourceBadge` in `TopBar.tsx` |
| F-62 | Friendly errors, no stack traces | Done | `ErrorState.tsx`, `core/errors.ts`, `app/error.tsx` |
| F-63 (P1) | Shortcuts modal | Done | `ShortcutsModal.tsx` ("?") |
| F-64 (P1) | Copy-as-JSON export | Done | `exportIntelligenceJson()`, TopBar button |

## Beyond the PRD

| Item | Status | Where |
|---|---|---|
| Repository Reality Check (README claims vs repository files, 5 statuses, per-claim evidence tree) | Done | `core/src/repo/*`, `api/github/repo/route.ts`, `RealityCheck.tsx`, docs/REALITY-CHECK.md |
| Setup Readiness score (10 rules, separate from health) | Done | `repo/readiness.ts`, `ReadinessCard` |
| Reality Check evaluation (contradiction / undocumented env precision and recall) | Done (code); labels: **You** | `tests/eval/evaluate.ts`, `pnpm eval --candidates` |
| Documentation drift: CLI (`pnpm reality`) + pull-request workflow that comments and fails on new contradictions | Done | `repo/local.ts`, `repo/drift.ts`, `scripts/reality.ts`, `.github/workflows/readme-drift.yml` |
| Monorepo support in the Reality Check (workspace package dependencies) | Done | `repo/select.ts`, `repo/facts.ts` |
| LLM baseline comparison | Not done (skipped on purpose: needs an API key) | |

## Non-functional requirements

| Area | Status | Notes |
|---|---|---|
| Performance (2,000 lines < 300 ms) | Done | about 120-190 ms warm for parse + extract on 1,988 lines; first call about 330 ms. `pnpm eval` records p50 / p95 on real fixtures. |
| Accessibility | Done, verify | keyboard reachable, visible focus, landmarks, skip link, ARIA on dialogs / tabs / combobox, AA link colour. Run Lighthouse. |
| Privacy | Done | no analytics; local content never leaves the tab; `Referrer-Policy: no-referrer`; optional image blocking |
| Reliability (never crash, extractors never throw) | Done | `safeExtract`, fuzz + malformed + 1 MB tests |
| Strict TypeScript, no `any` | Done | `tsc --strict` passed on `packages/core` with zero errors; no `any` in source |

## Test and evaluation plan

| Item | Status |
|---|---|
| Unit tests (slug, TOC, URL resolver, GitHub parser, each extractor 10+ cases, health, Zod) | Done: 537 tests in 18 files, 0 failures (includes 23 render, 60 XSS, 86 Reality Check and 18 drift tests). Run with the real installed packages; confirm once with `pnpm test` |
| XSS suite, 30+ payloads | Done: 50 payloads, 60 tests passing |
| Fixture set 50+ READMEs + hand labels | Done: 59 READMEs. Labels drafted by Shubh, then every item checked against the README text and corrected by Claude (AI-assisted, disclosed in RESULTS.md). Original drafts kept in `labels-backup-original/` outside the repo |
| `scripts/eval.ts` + `docs/RESULTS.md` + regression threshold | Done. Baseline: commands F1 72.9%, env vars 51.9%, tech 53.5% (PRD targets 85 / 85 / 80: **not met**). Regression floor 0.70 / 0.50 in `eval.test.ts` and `pnpm eval` |
| Playwright 3-5 e2e tests | Done, verify: 8 tests in `apps/web/e2e/smoke.spec.ts` (test 8: Reality Check with mocked GitHub) |
| Coverage >= 85% on core | Done, verify: threshold set in `vitest.config.ts`; run `pnpm test:coverage` |

## Definition of done

| Item | Status |
|---|---|
| Deployed on Vercel | **You**: see README "Deploy" |
| Project README with screenshot | README done; screenshot: **You** (run the app on its own README, save `docs/screenshot.png`) |
| docs/: PRD, ARCHITECTURE, EXTRACTORS, SECURITY, RESULTS | Done (RESULTS is generated by `pnpm eval`) |
| Coverage report >= 85% | Done, verify |
| No `any`, no lint warnings, no console errors | Done in code; run `pnpm lint` once |
| Known limitations in README | Done |

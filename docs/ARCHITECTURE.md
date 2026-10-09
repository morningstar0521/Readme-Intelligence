# Architecture

## Layout

```text
readme-intelligence/
  apps/web/                       Next.js 14 App Router UI (no parsing logic)
    app/
      page.tsx                    landing (URL input, drop zone, paste, example)
      view/page.tsx               viewer: ?url= (GitHub), ?src=local|paste|example
      r/[owner]/[repo]/page.tsx   shareable route
      api/github/readme/route.ts  GitHub proxy (allow-list, LRU cache, typed errors)
      api/github/repo/route.ts    repository snapshot for the Reality Check (tree + up to 60 files)
    components/
      layout/                     AppShell, TopBar, LeftSidebar, RightPanel, Drawer
      markdown/                   MarkdownView, CodeBlock (Shiki), SafeImage, highlighter
      intelligence/               Project, Health, Readiness + RealityCheck, Setup, Commands, Env, Tech, Features, API, Deploy, Links, SourceChip
      search/                     CommandPalette (Fuse.js)
      common/                     ThemeToggle, CopyButton, EmptyState, ErrorState, Modal, SettingsMenu, ShortcutsModal
      viewer/ViewerScreen.tsx     load -> analyze -> render, loading / error states
    lib/                          storage, theme, settings, hooks, jump-to-source, API client, sample README
    middleware.ts                 per-request CSP nonce
    e2e/                          Playwright smoke tests
  packages/core/                  pure TypeScript engine (no DOM, no React)
    src/
      parse/                      parseMarkdown (limits), slug (github-slugger), toc
      render/                     pipeline, sanitizeSchema, resolveUrls, alerts
      extract/                    context, section-classifier, project, features, install, commands,
                                  env, techstack + techDictionary (246 entries), api, deploy, links, meta
      health/                     rules (14 checks, weights = 100), score
      search/                     buildIndex
      github/                     parseUrl, rawBase, fetchReadme
      repo/                       Reality Check: select (which files), fetchRepo (snapshot), parsers,
                                  facts (with line evidence), checks (claims), readiness (10 rules),
                                  local (snapshot from a checkout), drift (base vs head diff + reports)
      analyze.ts                  one entry point: Markdown -> AnalysisResult
      schemas.ts                  Zod schemas mirroring types.ts
      errors.ts                   exact UI error copy
    tests/
      unit/  security/  eval/  fixtures/
  scripts/                        eval.ts, fetch-fixtures.ts, label-template.ts, fixture-repos.json,
                                  reality.ts (Reality Check / drift CLI)
  .github/workflows/              ci.yml (check, coverage, eval, e2e), readme-drift.yml (PR drift comment)
  docs/                           PRD, ARCHITECTURE, EXTRACTORS, SECURITY, RESULTS, LABELING, PRD-COMPLIANCE
```

## Data flow

```text
Input (GitHub URL | local file | pasted text)
  |  GitHub: browser -> /api/github/readme -> api.github.com / raw.githubusercontent.com
  |  Local / paste: FileReader -> sessionStorage (same tab) -> viewer. Never sent anywhere.
  v
analyzeReadme(markdown, source)                     packages/core/src/analyze.ts
  parseMarkdown         remark-parse + remark-gfm + remark-gemoji -> mdast (positions kept)
                        input capped at 1 MB, blockquote/indent and list nesting capped
  renderMdast           remark-rehype -> rehype-raw -> rehype-sanitize (strict schema)
                        -> post-process: URL resolution, external link rel/target,
                           task-list check, GitHub alerts, heading slugs, data-line attributes
  buildContext          one pass over the root: heading path, section type, anchor per block
  extractors            project, features, commands, prerequisites, install steps, env vars,
                        tech stack, API, deployment, links, license, flags
                        each wrapped in safeExtract(): try/catch + Zod validation -> never throws
  computeSignals        section types, images, env usage, "no env needed", API signals
  computeHealthReport   14 transparent rules
  buildSearchIndex      headings, text, code, commands, env vars, tech, features
  v
AnalysisResult { intelligence, health, toc, headings, sections, searchIndex, hast, warnings, stats }
  v
React: MarkdownView turns the sanitized hast into React elements (hast-util-to-jsx-runtime).
       No dangerouslySetInnerHTML for README content. Code blocks are highlighted by Shiki in the browser.
```

Reality Check (GitHub sources, on click):

```text
browser -> /api/github/repo -> api.github.com git/trees (1 call) + raw.githubusercontent.com (<= 60 files)
  v
RepoSnapshot { tree, truncated, files }            validated with Zod in the browser
  v
extractRepoFacts(snapshot)    scripts, package managers, lockfiles, deps, runtimes, env (example + code),
                              Docker, Compose, CI, Make targets, LICENSE  (each with path + line)
checkRepository({ intelligence, hast }, snapshot)
                              claims: verified | contradiction | readme-only | repo-only | unverified
computeReadiness              Setup Readiness, 10 weighted rules
  v
RealityReport { claims, counts, readiness, facts, snapshot summary }
```

The mdast is the single source of truth: extractors and the renderer both use it, so every
`SourceRef.line` matches a `data-line` attribute in the rendered page. "Jump to source" finds the
element with the largest `data-line` that is not after the target line and scrolls to it.

## Key decisions

| Decision | Why |
|---|---|
| Analysis runs in the browser | Local files and pasted text never leave the browser. Only GitHub fetches touch the server. |
| Sanitized hast -> React elements (no innerHTML) | Avoids an HTML re-parse in the browser (mXSS class of bugs) and lets us swap in components for `pre`, `img`, `a`. |
| Heading slugs assigned after sanitisation | User `id`s are prefixed `user-content-`; heading ids are generated by github-slugger in document order, matching GitHub. TOC and extractor anchors read the same ids. |
| GitHub JSON media type instead of raw | One request returns content plus README path and resolved ref, both needed to resolve relative links. Raw URL is the fallback. |
| Shiki with the JavaScript regex engine | No WebAssembly, so the CSP needs no `wasm-unsafe-eval`. Dual themes as CSS variables, so code follows the app theme without re-highlighting. |
| Whole-word, longest-first tech matching | "react" never matches "reactive"; "Tailwind CSS" is consumed before "CSS". Ambiguous words (Go, Express, Rust, Render...) only count in Tech stack / Prerequisites sections, headings, badges, commands or code. |
| `strength` on tech items | PRD rule: weak-only items are dropped when the README has a Tech stack section. The UI shows weak items with dashed chips. |
| Iterative tree walks for post-processing | Deeply nested hostile input cannot overflow the call stack. |
| Reality Check runs on click, in the browser | Costs one GitHub API call; the user decides. Comparison runs client-side on a validated snapshot, so the server only fetches. |
| Precision over recall for contradictions | A contradiction needs explicit values on both sides; partial evidence (truncated tree, small source sample, workspace scripts) gives Unverified instead. A wrong "contradiction" costs more trust than a missed one. |
| Setup Readiness separate from health | Health measures the README; readiness measures README vs repository. Mixing them would hide which one is weak. |

## Extensions to the PRD types

Marked `EXT` in `types.ts`: `CommandItem.risky`, `TechItem.strength`, `InstallStep.confidence`,
`SectionInfo`, `ReadmeSignals`, `SearchEntry`, `HeadingInfo`. All are additive.

## Keeping the example README in sync

`apps/web/lib/sampleReadme.ts` holds the same text as `packages/core/tests/fixtures/sample-readme.md`
(JSON-encoded string). If you edit the fixture, regenerate the TS file:

```bash
node -e "const fs=require('fs');const md=fs.readFileSync('packages/core/tests/fixtures/sample-readme.md','utf8');fs.writeFileSync('apps/web/lib/sampleReadme.ts','// Bundled example README for \"Try an example\". Same content as packages/core/tests/fixtures/sample-readme.md.\n// Keep the two in sync: the e2e tests and the core tests use the same document.\nexport const SAMPLE_README: string = '+JSON.stringify(md)+';\n')"
```

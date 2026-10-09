# README Intelligence Viewer: PRD Pack

This file contains everything a coding agent needs to build the project. Documents inside:

1. Master Prompt (give this to the agent first)
2. PRD (product requirements)
3. Technical Design (architecture, data models, pipeline)
4. Extractor Specifications (the core of the project)
5. Security Spec
6. Test and Evaluation Plan
7. UI Spec
8. Build Plan and Milestones
9. Acceptance Criteria and Definition of Done

---

# 1. MASTER PROMPT

Copy everything in this section into the coding agent as the first message. Attach the rest of this file as context.

```text
ROLE
You are a senior full-stack engineer. You are building a project called "README Intelligence Viewer" for one developer (me) as a personal tool and a portfolio project for SWE roles.

GOAL
A web app that takes a GitHub repository URL, a README.md file, or pasted Markdown, and shows:
(a) the README rendered as a clean documentation page, and
(b) a structured "intelligence" panel extracted deterministically from the README: project summary, commands, environment variables, install steps, tech stack, links, API endpoints, and a documentation health score.

A user must be able to understand an unfamiliar project in 30 to 60 seconds.

HARD RULES
1. No AI or LLM calls anywhere in v1. All extraction is deterministic (AST based parsing plus rules).
2. Never invent data. If something is not in the README, show "Not found in README". Every extracted item must keep a reference to its source (heading path and line number).
3. Treat README content as untrusted input. Sanitize all HTML. Never execute README code or commands.
4. Local-first. Local files and pasted Markdown never leave the browser. Only GitHub fetches use the network.
5. The parsing and extraction code lives in a pure TypeScript package with zero UI or DOM imports, so it is fully unit testable.
6. Write complete code. No placeholders, no "TODO", no "rest of code here".
7. Strict TypeScript. No `any` unless justified with a comment.
8. Build in the milestone order given in Document 8. After each milestone: run lint, type check and tests, then stop and give me a short summary (what was built, what is tested, what is next). Do not start the next milestone until I say "continue".

STACK (fixed, do not substitute)
- Next.js (App Router) + TypeScript (strict)
- Tailwind CSS
- unified, remark-parse, remark-gfm, remark-rehype, rehype-raw, rehype-sanitize, rehype-slug, rehype-stringify (or rehype-react)
- unist-util-visit, mdast-util-to-string
- Shiki for code highlighting
- Fuse.js for search
- Zod for validating all external data
- Vitest for unit tests, Playwright for 3 to 5 end-to-end smoke tests
- ESLint + Prettier
- Deploy target: Vercel

OUTPUT FORMAT FOR EVERY RESPONSE
1. What I am about to build (3 lines max)
2. The code (complete files, with paths)
3. How to run and test it
4. What is intentionally not done yet

If any requirement is unclear, make the simplest reasonable assumption, list it under "Assumptions" at the end, and continue. Do not ask me more than 3 questions at a time.

START
Read Documents 2 to 9 in this file fully. Then begin Milestone 0 (project setup). Do not write feature code before Milestone 0 is done.
```

---

# 2. PRD

## 2.1 Product summary

| Field | Value |
|---|---|
| Product name | README Intelligence Viewer |
| Type | Web app (Next.js), local-first |
| Owner and primary user | Shubh Ghiya (personal use + SWE portfolio) |
| Timeline | 2 weeks (14 days), hard time-box |
| Status | v1 scope locked |

## 2.2 Problem

When reviewing an unfamiliar GitHub project, you must read the whole README to find out what it does, how to run it, which env variables it needs, and what tech it uses. READMEs are inconsistent and long. GitHub's own view is only a renderer. It does not tell you what is missing.

## 2.3 Goals

1. Render any README accurately, matching GitHub behavior for common features.
2. Extract structured information deterministically and show where each item came from.
3. Score documentation quality with clear, explainable rules and give concrete suggestions.
4. Be fast, safe, and tested on real-world READMEs.
5. Be a strong portfolio project: clean architecture, tests, measured accuracy, live demo.

## 2.4 Non-goals (v1)

- No AI or LLM features.
- No desktop app, no Electron.
- No accounts, login, or database.
- No folder inspection or project file tree (planned for v2).
- No Mermaid, KaTeX, footnotes, media gallery, reading modes, accent color picker, recent projects, or outline view.
- No editing of READMEs.

## 2.5 Users and use cases

| Use case | Flow |
|---|---|
| Review a repo fast | Paste GitHub URL, read the summary, commands and env vars in under a minute |
| Check my own README | Paste my README, read the health score and fix the suggestions |
| Interview prep on a company's open source repo | Open the repo, understand stack and setup quickly |
| Read a local README | Drag and drop the file, nothing is uploaded |

## 2.6 Functional requirements

Priority: P0 = must ship, P1 = ship if time allows.

### Input

| ID | Requirement | Priority |
|---|---|---|
| F-01 | Paste GitHub repo URL (`https://github.com/owner/repo`, with optional `/tree/branch/path`) and fetch its README | P0 |
| F-02 | Paste a raw README URL (`raw.githubusercontent.com/...` or `github.com/.../blob/...`) | P0 |
| F-03 | Drag and drop or pick a local `.md` file (read in the browser only) | P0 |
| F-04 | Paste Markdown text into a textarea | P0 |
| F-05 | Shareable route `/r/[owner]/[repo]` that loads a GitHub README directly | P1 |

### Rendering

| ID | Requirement | Priority |
|---|---|---|
| F-10 | Render GFM: headings, paragraphs, emphasis, strikethrough, inline code, links, images, ordered/unordered/nested lists, task lists, blockquotes, horizontal rules, tables, autolinks | P0 |
| F-11 | Fenced code blocks with Shiki highlighting, language badge, copy button, line numbers, word wrap toggle | P0 |
| F-12 | Embedded HTML support through a strict sanitize schema: `details`, `summary`, `kbd`, `img`, `a`, `table` family, `p`, `br`, `div align`, `picture`, `source`, `sub`, `sup` | P0 |
| F-13 | GitHub alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) | P0 |
| F-14 | Resolve relative links and image paths against the source (GitHub raw base URL) | P0 |
| F-15 | Anchor links and heading slugs matching GitHub's slug algorithm | P0 |
| F-16 | Badge images (shields.io etc.) render inline and are also parsed for tech detection | P0 |
| F-17 | Emoji shortcodes (`:rocket:`) | P1 |

### Navigation

| ID | Requirement | Priority |
|---|---|---|
| F-20 | Auto table of contents from headings (h1 to h4) with scroll spy highlighting | P0 |
| F-21 | Smooth scroll to section on click | P0 |
| F-22 | Collapse and expand left sidebar and right panel | P0 |
| F-23 | Search with Cmd/Ctrl + K across headings, paragraphs, code, commands, env vars, tech stack, features | P0 |
| F-24 | Keyboard navigation in search (up, down, enter, escape) | P0 |

### Intelligence panel

| ID | Requirement | Priority |
|---|---|---|
| F-30 | Project card: name, one-line description, detected languages/frameworks, key links | P0 |
| F-31 | Features list extracted from a Features section | P0 |
| F-32 | Prerequisites and install steps extracted and ordered | P0 |
| F-33 | Commands grouped by purpose (setup, dev, build, test, lint, deploy, other) with copy on click | P0 |
| F-34 | Environment variables with name, required/optional (if stated), description (if stated), masked values | P0 |
| F-35 | Tech stack grouped by category with evidence for each item | P0 |
| F-36 | API endpoints (method, path, description, request/response examples if present) | P1 |
| F-37 | Deployment platforms detected and steps extracted | P1 |
| F-38 | Links grouped by type (repo, demo, docs, video, issues, chat, other) | P0 |
| F-39 | Every extracted item has a "source" jump link to the exact spot in the rendered README | P0 |
| F-40 | Empty states: if a category has no data show "Not found in README" | P0 |

### Documentation health

| ID | Requirement | Priority |
|---|---|---|
| F-50 | Health score 0 to 100 from a transparent rule list (see Document 4) | P0 |
| F-51 | Checklist of passed and failed checks with a reason for each | P0 |
| F-52 | Ordered improvement suggestions | P0 |
| F-53 | Score is labeled "heuristic, not a quality guarantee" in the UI | P0 |

### General

| ID | Requirement | Priority |
|---|---|---|
| F-60 | Dark, light, and system themes, persisted in localStorage | P0 |
| F-61 | Source indicator (Local, GitHub, Pasted) | P0 |
| F-62 | Friendly error states (no raw stack traces) | P0 |
| F-63 | Keyboard shortcuts modal | P1 |
| F-64 | Copy-as-JSON export of all extracted intelligence | P1 |

## 2.7 Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | A 2,000-line README parses and extracts in under 300 ms on a normal laptop. First render of the result under 1 second after data is available. |
| Accessibility | Keyboard reachable UI, visible focus states, semantic headings, contrast AA in both themes |
| Privacy | No analytics, no tracking, no upload of local content |
| Reliability | Any malformed Markdown must still render without a crash. Extractors must never throw. They return empty results on failure. |
| Browser support | Latest Chrome, Edge, Firefox, Safari |
| Code quality | TypeScript strict, ESLint clean, no console errors |

## 2.8 Success metrics (measured, not guessed)

| Metric | Target |
|---|---|
| Extractor accuracy on labeled fixture set | At least 85% field-level F1 for commands and env vars, at least 80% for tech stack |
| Fixture set size | At least 50 real public READMEs (target 100) |
| XSS payload suite | 100% blocked (at least 30 payloads) |
| Unit test coverage on `packages/core` | At least 85% lines |
| Parse time p95 on fixture set | Under 300 ms |
| Lighthouse (desktop) | Performance 90+, Accessibility 95+ |

These numbers are what you will later put on your resume. Record the real numbers in `docs/RESULTS.md`.

---

# 3. TECHNICAL DESIGN

## 3.1 Repository layout

```text
readme-intelligence/
  apps/
    web/                      Next.js app (UI only)
      app/
        page.tsx              landing + input
        view/page.tsx         viewer (client state)
        r/[owner]/[repo]/page.tsx
        api/github/readme/route.ts   GitHub fetch proxy with caching
      components/
        layout/               AppShell, TopBar, LeftSidebar, RightPanel
        markdown/             MarkdownView, CodeBlock, Alert, SafeImage
        intelligence/         ProjectCard, FeaturesCard, CommandsCard,
                              EnvCard, TechStackCard, ApiCard, LinksCard,
                              HealthCard, SourceChip
        search/               CommandPalette
        common/               ThemeToggle, CopyButton, EmptyState, ErrorState
      lib/                    client helpers (storage, hooks)
  packages/
    core/                     PURE TypeScript, no DOM, no React
      src/
        parse/                parseMarkdown.ts, toc.ts, slug.ts
        render/               pipeline.ts, sanitizeSchema.ts, resolveUrls.ts, alerts.ts
        extract/              project.ts, features.ts, install.ts, commands.ts,
                              env.ts, techstack.ts, api.ts, deploy.ts, links.ts
        health/               rules.ts, score.ts
        search/               buildIndex.ts
        github/                parseUrl.ts, rawBase.ts
        types.ts              shared types + Zod schemas
        index.ts
      tests/
        fixtures/readmes/     50-100 real READMEs (.md)
        fixtures/labels/      expected extraction JSON per README
        unit/
        security/xss.test.ts
        eval/eval.test.ts     computes accuracy and writes report
  docs/
    PRD.md  ARCHITECTURE.md  EXTRACTORS.md  SECURITY.md  RESULTS.md
  scripts/
    eval.ts                   runs evaluation, prints precision/recall/F1
```

Use pnpm workspaces. `apps/web` imports `packages/core`.

## 3.2 Data flow

```text
Input (URL | file | paste)
   |
   v
Source resolver  ->  { markdown: string, source: SourceInfo }
   |
   v
parseMarkdown (remark-parse + gfm)  ->  mdast (with positions)
   |
   +--> extractors (run on mdast, never on raw text only) -> Intelligence
   +--> toc builder -> TocItem[]
   +--> health scorer (uses Intelligence + mdast) -> HealthReport
   +--> search index builder -> SearchEntry[]
   |
   v
render pipeline: mdast -> hast -> rehype-raw -> sanitize -> slug -> highlight hooks -> React
```

The mdast is the single source of truth. Extractors and renderer both use it, so source line numbers stay consistent.

## 3.3 Core types (implement exactly, extend only if needed)

```ts
export type SourceInfo =
  | { kind: "github"; owner: string; repo: string; ref: string; path: string; rawBase: string; htmlUrl: string }
  | { kind: "local"; fileName: string }
  | { kind: "paste" };

export interface SourceRef {
  headingPath: string[];      // e.g. ["Installation", "Docker"]
  line: number;               // 1-based line in the README
  anchor?: string;            // slug of nearest heading
}

export interface Evidenced<T> {
  value: T;
  source: SourceRef;
  confidence: "explicit" | "inferred-rule";   // never "ai"
}

export interface TocItem { id: string; text: string; depth: 1 | 2 | 3 | 4; line: number; }

export interface ProjectInfo {
  name: Evidenced<string> | null;
  description: Evidenced<string> | null;
  badges: { alt: string; imageUrl: string; linkUrl?: string; line: number }[];
}

export interface CommandItem {
  command: string;
  category: "setup" | "dev" | "build" | "test" | "lint" | "deploy" | "docker" | "database" | "other";
  language: string | null;     // bash, sh, powershell, etc.
  source: SourceRef;
}

export interface EnvVarItem {
  name: string;
  required: boolean | null;    // null when README does not say
  description: string | null;
  exampleValue: string | null; // masked if looks like a secret
  masked: boolean;
  source: SourceRef;
}

export type TechCategory =
  | "language" | "frontend" | "backend" | "database" | "auth"
  | "ai-ml" | "cloud" | "devops" | "testing" | "tooling";

export interface TechItem {
  name: string;                // canonical name, e.g. "Next.js"
  category: TechCategory;
  evidence: { type: "badge" | "text" | "code" | "command" | "heading"; snippet: string; source: SourceRef }[];
}

export interface ApiEndpoint {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  path: string;
  description: string | null;
  requestExample: string | null;
  responseExample: string | null;
  authRequired: boolean | null;
  source: SourceRef;
}

export interface LinkItem {
  url: string;
  text: string;
  type: "repo" | "demo" | "docs" | "video" | "issues" | "chat" | "license" | "other";
  source: SourceRef;
}

export interface HealthCheck {
  id: string;
  label: string;
  passed: boolean;
  weight: number;
  reason: string;              // why it passed or failed
  suggestion: string | null;
}
export interface HealthReport { score: number; checks: HealthCheck[]; }

export interface Intelligence {
  project: ProjectInfo;
  features: Evidenced<string>[];
  prerequisites: Evidenced<string>[];
  installSteps: { order: number; title: string | null; commands: string[]; text: string; source: SourceRef }[];
  commands: CommandItem[];
  envVars: EnvVarItem[];
  techStack: TechItem[];
  api: ApiEndpoint[];
  deployment: { platforms: string[]; steps: Evidenced<string>[] };
  links: LinkItem[];
  license: Evidenced<string> | null;
  hasContributing: boolean;
  hasTestsSection: boolean;
}
```

All extractor outputs must be validated with Zod schemas that mirror these types.

## 3.4 GitHub fetching

- Route handler: `GET /api/github/readme?url=<encoded>`.
- Parse the URL into `owner`, `repo`, optional `ref` and `path`.
- Fetch README using the GitHub REST endpoint `GET /repos/{owner}/{repo}/readme` (with `ref` if given) with header `Accept: application/vnd.github.raw+json`. Fallback: try `raw.githubusercontent.com/{owner}/{repo}/{branch}/README.md`.
- Optional server-side env var `GITHUB_TOKEN` to raise the rate limit. It must never be sent to the client. The app must also work without it.
- Cache responses in memory (LRU, 50 entries, 10 minutes TTL) and send `Cache-Control` headers.
- Map errors to typed results: `NOT_FOUND`, `RATE_LIMITED` (include reset time if present), `PRIVATE_OR_FORBIDDEN`, `NETWORK`, `TOO_LARGE` (reject over 1 MB), `UNKNOWN`.
- Validate and allow-list: only `github.com` and `raw.githubusercontent.com` hosts. Reject everything else to prevent SSRF.
- Compute `rawBase` (e.g. `https://raw.githubusercontent.com/owner/repo/branch/dir/`) to resolve relative images and links.

## 3.5 Relative URL resolution rules

| Input | Output |
|---|---|
| `./img/a.png`, `img/a.png` | `{rawBase}img/a.png` for images |
| `/docs/a.png` | `https://raw.githubusercontent.com/owner/repo/branch/docs/a.png` |
| `docs/guide.md` (link) | `https://github.com/owner/repo/blob/branch/docs/guide.md` |
| `#section` | stays as in-page anchor |
| `https://...` | unchanged |
| `javascript:`, `data:` (except safe `data:image/png|jpeg|gif|webp`) | removed |

For local and pasted sources, relative images show a placeholder "Image unavailable" with the original path.

---

# 4. EXTRACTOR SPECIFICATIONS

General rules for all extractors:

- Work on the mdast and use node positions for line numbers.
- Section matching uses heading text with case-insensitive aliases (listed below). Matching a heading never depends on emoji or numbering. Strip them first.
- Never throw. Return `[]` or `null` on failure.
- Prefer explicit data over inferred. Mark `confidence` correctly.
- Deduplicate results.
- No network calls.

## 4.1 Section classifier

Map each top-level and second-level heading to a canonical section type using these aliases.

| Canonical | Aliases (case-insensitive, contains) |
|---|---|
| overview | overview, about, introduction, description, what is |
| features | features, highlights, key features, capabilities, what it does |
| techstack | tech stack, built with, technologies, stack, powered by |
| prerequisites | prerequisites, requirements, before you begin, system requirements |
| installation | installation, install, getting started, setup, quick start, quickstart |
| usage | usage, how to use, running, run, examples |
| configuration | configuration, config, environment, env, settings, .env |
| api | api, endpoints, routes, reference |
| testing | test, testing, tests |
| deployment | deployment, deploy, hosting, production |
| structure | project structure, folder structure, directory structure, architecture |
| contributing | contributing, contribution, how to contribute |
| license | license, licence |
| roadmap | roadmap, todo, future work |

Sections can be nested. A child inherits its parent's type if it has no match of its own.

## 4.2 Project info

- Name: first h1 text. If none, the repo name from the source. If none, `null`.
- Description: first non-badge, non-image paragraph after the h1 (or blockquote). Max 300 characters. If the first paragraph is only badges or images, skip it.
- Badges: images inside links or standalone at the top whose URL matches known badge hosts (`shields.io`, `badgen.net`, `img.shields.io`, `github.com/.../workflows/.../badge.svg`, `codecov.io`, `travis-ci`, `npmjs`, `vercel`).

## 4.3 Features

- Take list items under a `features` section (including nested lists, flatten one level).
- Also accept tables with a first column named Feature.
- Strip leading emoji and bold markers for the value, keep the original text in `source`.
- If there is no features section, return `[]`. Do not infer features from other text.

## 4.4 Commands

Sources: fenced code blocks and inline code that looks like a command.

Rules:

1. Code blocks with language `bash`, `sh`, `shell`, `zsh`, `console`, `powershell`, `cmd`, `terminal`, or no language where most lines look like commands.
2. Split by line. Join lines ending with `\` or `^`. Strip leading `$ ` or `> `. Skip comment-only lines. Skip lines that are clearly output (no known command prefix).
3. A line is a command if it starts with a known command prefix: `npm`, `npx`, `yarn`, `pnpm`, `bun`, `node`, `deno`, `pip`, `pip3`, `python`, `python3`, `poetry`, `uv`, `conda`, `cargo`, `rustup`, `go`, `mvn`, `gradle`, `./gradlew`, `dotnet`, `docker`, `docker-compose`, `make`, `cmake`, `git`, `cd`, `cp`, `mv`, `mkdir`, `source`, `export`, `chmod`, `curl`, `wget`, `brew`, `apt`, `apt-get`, `sudo`, `flutter`, `php`, `composer`, `bundle`, `rails`, `ruby`, `java`, `kubectl`, `terraform`, `prisma`, `npx prisma`, `alembic`, `pytest`, `jest`, `vitest`.
4. Categorize with rules (first match wins):
   - setup: `install`, `npm i`, `pip install`, `git clone`, `cp .env`, `poetry install`, `bundle install`, `composer install`, `cargo build` when under installation
   - dev: `run dev`, `start`, `serve`, `runserver`, `uvicorn`, `flask run`, `cargo run`
   - build: `build`, `compile`, `package`
   - test: `test`, `pytest`, `jest`, `vitest`, `cargo test`
   - lint: `lint`, `format`, `prettier`, `eslint`, `ruff`, `black`
   - docker: starts with `docker` or `docker-compose`
   - database: `migrate`, `prisma`, `seed`, `alembic`
   - deploy: `deploy`, `vercel`, `netlify`, `fly`, `kubectl apply`, `terraform apply`
   - other
5. Dedupe identical commands, keep the first source.
6. Never flag a command as safe or unsafe. Never run it. Show a small warning icon on commands containing `sudo`, `rm -rf`, `curl ... | sh`, or `chmod 777`.

## 4.5 Environment variables

Detection sources:

1. Code blocks labeled `env`, `dotenv`, `.env`, `ini`, `bash`, or any block where at least 50% of non-empty lines match `^[A-Z][A-Z0-9_]*=`.
2. Tables with a column named like `Variable`, `Name`, `Env`, `Key`.
3. Lists or inline code in a configuration section that match `^[A-Z][A-Z0-9_]{2,}$` and look like env names (contain `_`, or are all caps with length of 4 or more).
4. `export NAME=value` lines.

Rules:

- `required`: true if the text near it says required, mandatory, must; false if optional, default; otherwise `null`.
- `description`: text after `#` comment on the same or previous line, or table description column.
- Secret masking: mask the value if the name contains `KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE`, `CREDENTIAL`, `AUTH` or the value matches known secret patterns (`sk-...`, `ghp_...`, `AKIA...`, long base64/hex strings of 20 or more characters, `-----BEGIN`). Show `••••••••` and set `masked: true`.
- Keep placeholders such as `your_api_key_here`, `<token>`, `xxx` visible since they are not secrets, but still mark `masked: true` only if they look real.
- Dedupe by name. If the same name appears multiple times, merge: keep the first description and any `required` value that is not null.

## 4.6 Install steps and prerequisites

- Take the `installation` section (and `prerequisites`).
- Prerequisites: list items or lines matching `<tool> <version>` patterns (`Node.js 18+`, `Python >= 3.10`, `Docker`, `PostgreSQL 14`).
- Install steps: ordered list items, or h3/h4 headings with code blocks beneath. Attach the commands found under each step.
- If steps are only code blocks, create one step per block and number them.
- Fallback: if no installation section exists but setup-type commands exist elsewhere, create one "Inferred install steps" group with `confidence: "inferred-rule"`.

## 4.7 Tech stack

Use a built-in dictionary (`techDictionary.ts`) of at least 150 technologies. Each entry has: canonical name, category, aliases, optional badge keywords, optional file/command keywords.

Examples:

| Canonical | Category | Aliases and signals |
|---|---|---|
| Next.js | frontend | `next.js`, `nextjs`, `next dev`, `next build`, badge `nextdotjs` |
| React | frontend | `react`, `react.js`, badge `react` |
| Vue | frontend | `vue`, `vue.js`, `nuxt` |
| Tailwind CSS | frontend | `tailwind`, `tailwindcss` |
| Node.js | backend | `node.js`, `nodejs`, `node ` command |
| Express | backend | `express`, `expressjs` |
| FastAPI | backend | `fastapi`, `uvicorn` |
| Django | backend | `django`, `manage.py` |
| Flask | backend | `flask` |
| Spring Boot | backend | `spring boot`, `mvn spring-boot:run` |
| PostgreSQL | database | `postgres`, `postgresql`, `psql` |
| MongoDB | database | `mongodb`, `mongoose` |
| MySQL | database | `mysql` |
| Redis | database | `redis` |
| Prisma | database | `prisma`, `npx prisma` |
| NextAuth | auth | `next-auth`, `nextauth`, `auth.js` |
| OpenAI | ai-ml | `openai` |
| Gemini | ai-ml | `gemini`, `google generative` |
| TensorFlow / PyTorch | ai-ml | `tensorflow`, `pytorch`, `torch` |
| Docker | devops | `docker`, `Dockerfile`, `docker-compose` |
| Vercel / Netlify / Render / Railway / AWS / GCP / Azure | cloud | names and CLI commands |
| Jest / Vitest / Pytest / Playwright / Cypress | testing | names and commands |
| TypeScript / JavaScript / Python / Java / Go / Rust / C++ / C# / PHP / Ruby / Kotlin / Swift | language | names, code block languages, badges |

Rules:

- Match whole words only, case-insensitive, to avoid false hits (for example "react" inside "reactive").
- Evidence is required. A technology with no evidence is not returned.
- Weight evidence: badge or install command or tech stack section = strong. A single passing mention in prose = weak. Drop weak-only items if the README has a dedicated tech stack section that does not list them.
- Languages can also come from code block language tags.

## 4.8 API endpoints (P1)

- Only look in `api` sections and code blocks containing HTTP verbs.
- Pattern: `^(GET|POST|PUT|PATCH|DELETE)\s+(/[^\s]*)`, also in tables with Method/Endpoint columns, and `curl -X POST http://.../path`.
- Attach the nearest following JSON code blocks as request/response examples when the heading or label contains "request" or "response".
- `authRequired` is true only when the text near it says auth, token, bearer, API key.

## 4.9 Deployment (P1)

- Platforms from the tech dictionary (cloud and devops categories) found inside the `deployment` section or deploy-type commands.
- Steps: list items in the deployment section.

## 4.10 Links

- Collect all links. Classify by URL and text:
  - repo: `github.com/owner/repo`, `gitlab.com`
  - demo: text contains demo, live, try it, website, or host is `*.vercel.app`, `*.netlify.app`, `*.onrender.com`, `*.railway.app`, `*.herokuapp.com`
  - docs: text contains docs, documentation, wiki, or host contains `docs.`/`readthedocs`
  - video: youtube.com, youtu.be, vimeo.com, loom.com
  - issues: URL contains `/issues`
  - chat: discord.gg, discord.com, slack.com, t.me
  - license: text or URL contains license
  - other
- Exclude badge image links and in-page anchors. Dedupe by URL.

## 4.11 Health score rules

Total weight = 100. Score = sum of weights of passed checks.

| ID | Check | Weight | Pass condition |
|---|---|---|---|
| H01 | Project title | 5 | h1 or name found |
| H02 | Description | 10 | description of at least 40 characters |
| H03 | Features listed | 8 | at least 3 feature items |
| H04 | Tech stack stated | 8 | techstack section exists or at least 3 strong evidence items |
| H05 | Prerequisites | 7 | at least 1 prerequisite |
| H06 | Installation steps | 15 | at least 2 install steps or setup commands |
| H07 | Usage section | 10 | usage section exists or run/dev command exists |
| H08 | Environment variables documented | 8 | at least 1 env var, or the README states no env needed. If no env vars are used anywhere, this check passes automatically |
| H09 | Screenshot or demo | 6 | at least one non-badge image or a demo link |
| H10 | License | 6 | license section or LICENSE link |
| H11 | Contributing info | 4 | contributing section or link |
| H12 | Testing instructions | 5 | testing section or test command |
| H13 | Deployment info | 3 | deployment section or deploy platform |
| H14 | API docs when applicable | 5 | passes if API endpoints found, or if no API-like signals exist |

Each failed check returns a specific `suggestion`, for example "Add a Prerequisites section listing required tools and versions (for example Node.js 20+)."

UI label: **"Heuristic score. Based on the presence of common sections, not the quality of the content."**

---

# 5. SECURITY SPEC

| Threat | Mitigation |
|---|---|
| XSS through raw HTML in README | Parse with `rehype-raw`, then ALWAYS sanitize with `rehype-sanitize` using a custom strict schema (allow-list). Sanitize before any other HTML processing. |
| `javascript:` and `data:` URLs | Strip from `href` and `src`. Allow `http`, `https`, `mailto`, and `data:image/(png|jpeg|gif|webp)` only for images. |
| Event handler attributes (`onerror`, `onclick`) | Not in the allow-list, so removed |
| `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>` (except task-list checkbox), `<link>`, `<meta>`, `<base>` | Removed. No iframes in v1 (YouTube links are shown as links, not embeds). |
| CSS injection through `style` attribute | `style` is removed everywhere. Only `align` on `p`, `div`, `img`, `td`, `th` and `width`/`height` on `img` are allowed. |
| DOM clobbering via `id` and `name` | Prefix all user-supplied ids with `user-content-` (same as GitHub). Heading slugs get generated ids. |
| `target="_blank"` abuse | All external links get `rel="noopener noreferrer nofollow"` and `target="_blank"` |
| SSRF through the GitHub proxy | Host allow-list: `github.com`, `api.github.com`, `raw.githubusercontent.com` only. Reject IPs, localhost, and any other host. |
| Resource exhaustion | Max input 1 MB. Max nesting depth for lists (limit 20). Truncate and warn for larger inputs. |
| Secret exposure | Mask secret-looking env values in the UI and in JSON export. `GITHUB_TOKEN` stays server-side only. |
| Command execution | Never execute anything. Commands are copy-only. |
| Remote images tracking | Images load from their original host. Show a one-time notice in settings ("Images are loaded from their original URLs"). Optional toggle to block remote images (P1). |
| CSP | Add a Content-Security-Policy header: `default-src 'self'; img-src 'self' https: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'`. Adjust for Next.js requirements and document any relaxation. |

A written `docs/SECURITY.md` must list these threats, the mitigation for each, and the test that proves it.

---

# 6. TEST AND EVALUATION PLAN

## 6.1 Unit tests (Vitest, `packages/core`)

- Slug generation matches GitHub for: duplicates (`foo`, `foo-1`), punctuation, emoji, unicode, inline code in headings.
- TOC builder: nested, skipped levels (h1 to h3), empty headings.
- URL resolver: all rows of the table in 3.5.
- GitHub URL parser: repo URL, `/tree/branch/path`, `.git` suffix, trailing slash, `/blob/...`, raw URL, invalid hosts.
- Each extractor: at least 10 targeted cases covering normal, empty, malformed, and tricky input.
- Health scorer: weights sum to 100, each check toggles correctly.
- Zod validation rejects malformed extractor output.

## 6.2 Security tests

`tests/security/xss.test.ts` must contain at least 30 payloads, including:

```text
<script>alert(1)</script>
<img src=x onerror=alert(1)>
<a href="javascript:alert(1)">x</a>
<svg onload=alert(1)>
<iframe src="javascript:alert(1)"></iframe>
<details open ontoggle=alert(1)>
<math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>
[click](javascript:alert(1))
![x](javascript:alert(1))
<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>
<div style="background:url(javascript:alert(1))">x</div>
<input autofocus onfocus=alert(1)>
<base href="https://evil.com/">
<meta http-equiv="refresh" content="0;url=https://evil.com">
<object data="javascript:alert(1)">
<a href=" javascript:alert(1)">x</a>
<a href="jav&#x09;ascript:alert(1)">x</a>
<img src="x" id="__proto__">
<form action="https://evil.com"><button>go</button></form>
```

Each test renders to HTML and asserts: no `<script>`, no `on*` attributes, no `javascript:` URL, no `style` attribute, no `<iframe>`/`<form>`/`<object>`/`<base>`/`<meta>`.

## 6.3 Fixture set and evaluation

1. Collect **at least 50 public READMEs** (target 100) from varied projects: web apps, CLIs, libraries (JS, Python, Java, Go, Rust), ML projects, student projects, and a few poor-quality READMEs. Save under `tests/fixtures/readmes/` with the repo name and URL in a header comment file `fixtures/index.json`.
2. For each README, create a label file `tests/fixtures/labels/<name>.json` by hand (or by correcting extractor output manually) with the true values for: commands, envVars (names only), techStack (names only), installSteps count, hasLicense, apiEndpoints (if any).
3. `scripts/eval.ts` runs extractors on all fixtures and computes, per field: precision, recall, F1, with exact match on normalized strings.
4. Output a table and write it to `docs/RESULTS.md` along with parse time p50 and p95.
5. CI (or a local script) fails if F1 for commands or env vars drops below 0.80, so regressions are caught.

Important: labels must be created by hand, not generated from the extractor, otherwise the numbers are meaningless. Budget 3 to 4 hours for this. It is the most valuable part of the project.

## 6.4 End-to-end tests (Playwright)

1. Paste Markdown, see rendered output and intelligence cards.
2. Open a GitHub URL (mock the API route for the test) and see the README.
3. Cmd/Ctrl+K opens search, typing finds a heading, Enter scrolls to it.
4. Theme toggle persists after reload.
5. Invalid URL shows the friendly error state.

---

# 7. UI SPEC

## 7.1 Layout

Three panels:

```text
+--------------------------------------------------------------+
| Logo  Project name           [Search Cmd+K]   Theme   Source |
+--------------+---------------------------------+-------------+
| CONTENTS     |  README CONTENT                 | INTELLIGENCE|
| (TOC, scroll |  (rendered markdown)            | Project     |
|  spy)        |                                 | Health      |
|              |                                 | Commands    |
| Sections     |                                 | Env vars    |
| found        |                                 | Tech stack  |
|              |                                 | Features    |
|              |                                 | API         |
|              |                                 | Links       |
+--------------+---------------------------------+-------------+
```

- Left and right panels collapse (Cmd/Ctrl+B for left, Cmd/Ctrl+Shift+B for right). State persists in localStorage.
- Below 1024 px: panels become drawers. Below 640 px: single column with a tab switch (Readme / Intelligence).
- Content max width 760 px for readability.

## 7.2 Landing screen

- Title, one line explanation.
- One large input that accepts a GitHub URL or raw URL, with an "Open" button.
- A drop zone for `.md` files.
- A "Paste Markdown" toggle that opens a textarea.
- A "Try an example" link that loads a bundled sample README.

## 7.3 Design tokens

Dark first. Use CSS variables so themes switch with a class on `html`.

```css
:root[data-theme="dark"] {
  --bg: #0B0D10;
  --surface: #111418;
  --surface-elevated: #171A20;
  --border: #252A32;
  --text: #F5F7FA;
  --text-secondary: #9BA3AF;
  --text-muted: #6B7280;
  --accent: #7C3AED;
  --success: #22C55E;
  --warning: #F59E0B;
  --error: #EF4444;
  --info: #3B82F6;
}
:root[data-theme="light"] {
  --bg: #FFFFFF;
  --surface: #F8FAFC;
  --surface-elevated: #FFFFFF;
  --border: #E5E7EB;
  --text: #111827;
  --text-secondary: #4B5563;
  --text-muted: #6B7280;
  --accent: #6D28D9;
  --success: #16A34A;
  --warning: #D97706;
  --error: #DC2626;
  --info: #2563EB;
}
```

- Font: Inter (UI) and JetBrains Mono (code), loaded with `next/font`.
- Radius 8 px for cards, 6 px for buttons. Borders 1 px. No gradients. Transitions 150 ms only for hover and theme change.
- No emoji in the UI chrome. Use a single icon set (lucide-react).

## 7.4 Components (behavior)

| Component | Behavior |
|---|---|
| CodeBlock | Header with language badge and Copy. Line numbers toggle. Word wrap toggle. Collapse when over 30 lines with "Show more". Shiki themes follow the app theme. |
| CommandsCard | Grouped by category. Click row to copy, show "Copied" for 1.5 s. Warning icon for risky commands with tooltip. |
| EnvCard | Table: Name, Required, Description, Example. Masked values show dots. Copy name button. |
| TechStackCard | Category groups with chips. Hover on a chip shows the evidence snippet. |
| HealthCard | Big score, "heuristic" label, expandable checklist with pass/fail icons, suggestions list ordered by weight. |
| Every card | Empty state text "Not found in README". Each item has a small "jump to source" action that scrolls to the line in the rendered README and briefly highlights it. |
| CommandPalette | Opens on Cmd/Ctrl+K. Groups: Sections, Commands, Env vars, Tech, Features. Arrow keys move, Enter selects, Esc closes. |
| Alerts | NOTE, TIP, IMPORTANT, WARNING, CAUTION with left border color and icon. |
| SafeImage | Lazy load. On error show "Image unavailable" with the path. Click opens a zoom modal. |
| ErrorState | Title, one-sentence reason, list of possible causes, and buttons "Try again" and "Open another". |

## 7.5 Error messages (exact copy)

- Invalid URL: "That does not look like a GitHub repository or README link."
- Not found: "No README found for this repository."
- Private or forbidden: "This repository is private or access was denied."
- Rate limited: "GitHub rate limit reached. Try again at {time}."
- Too large: "This README is larger than 1 MB, so it was not loaded."
- Parse failure: "The file could not be read as Markdown."

---

# 8. BUILD PLAN AND MILESTONES

Time-box: 14 days. The agent builds one milestone at a time and stops for review.

| Milestone | Days | Scope | Exit criteria |
|---|---|---|---|
| M0 Setup | 0.5 | pnpm workspace, Next.js app, `packages/core`, Tailwind, ESLint, Prettier, Vitest, tsconfig strict, CI script (`pnpm check` = lint + typecheck + test) | `pnpm check` passes on an empty project |
| M1 Render pipeline | 2.5 | parseMarkdown, render pipeline, sanitize schema, slug, alerts, code blocks with Shiki, MarkdownView, paste input, XSS test suite | 30+ XSS tests pass, GFM sample renders correctly, sample README looks like GitHub |
| M2 GitHub + sources | 2 | URL parser, API route, caching, error mapping, relative URL resolver, local file drop, source chip, error states | All URL parser and resolver tests pass, 5 real repos load, errors show correct copy |
| M3 TOC + layout + search | 1.5 | AppShell, three panels, collapse, TOC with scroll spy, Cmd+K search, theme | Keyboard flow works, theme persists, layout responsive |
| M4 Extractors | 4 | section classifier, project, features, install, commands, env, tech stack, links, Evidenced source refs, Zod validation, unit tests, then api and deploy if time allows | Each extractor has 10+ tests, never throws on fuzz input |
| M5 Intelligence UI + health | 1.5 | all cards, jump-to-source, health rules and UI, JSON export | Cards render real data, empty states correct, health weights sum to 100 |
| M6 Evaluation | 1.5 | 50+ fixtures, hand labels, eval script, `docs/RESULTS.md`, regression threshold | Results table generated, F1 targets met or gaps documented |
| M7 Polish + deploy | 1 | Lighthouse and a11y fixes, CSP, Playwright tests, project README, deploy to Vercel | Live URL works, `pnpm check` and e2e pass |

Rules for the agent at each milestone:

1. List the files you will create or change before writing code.
2. Write the tests with or before the implementation.
3. Run `pnpm check` and show the result.
4. Report: built, tested, known gaps, next.
5. Stop and wait for "continue".

If a milestone runs over its time budget, cut P1 items first, never tests and never sanitization.

---

# 9. ACCEPTANCE CRITERIA AND DEFINITION OF DONE

## 9.1 Acceptance tests (must all pass)

1. Pasting a GitHub URL of a well-structured repo shows the rendered README, a populated intelligence panel, and a health score within 3 seconds on a normal connection.
2. Relative images and links in a GitHub README resolve correctly and display.
3. A README containing every payload in the XSS list renders with no script execution and no unsafe attributes.
4. Opening a local `.md` file makes zero network requests for the content (verify in the browser network tab).
5. A README with no env vars, no API, and no deployment info shows "Not found in README" for those cards and does not invent data.
6. A secret-looking value (`OPENAI_API_KEY=sk-abc123...`) is masked in the UI and in JSON export.
7. Every extracted item has a working "jump to source" action.
8. Cmd/Ctrl+K search finds a heading, a command, and an env var in the same README and navigates to each.
9. Dark, light, and system themes work and persist.
10. Malformed Markdown (unclosed code fence, broken table, 1 MB random text) does not crash the app.
11. `pnpm check` passes. Playwright tests pass. `docs/RESULTS.md` contains real measured numbers.

## 9.2 Definition of done

- Deployed on Vercel with a public URL.
- GitHub repo with a clear README for this project (run the app on its own README and put a screenshot in it).
- `docs/` contains PRD, ARCHITECTURE, EXTRACTORS, SECURITY, RESULTS.
- Test coverage report for `packages/core` at 85% or above.
- No `any` without a comment, no lint warnings, no console errors.
- Known limitations listed in the README (for example: heuristic extraction, English READMEs only, one README per repo).

## 9.3 v2 backlog (do NOT build in v1)

- Folder inspection with the File System Access API (project tree, `package.json` / `requirements.txt` / Dockerfile based tech detection)
- Mermaid and KaTeX
- Reading modes, accent color, recent projects, outline view
- Media gallery
- Optional AI explanation layer with a strict "README fact" vs "AI interpretation" split
- Browser extension that adds the intelligence panel on github.com

## 9.4 Resume bullets you can claim after v1 (fill with real numbers)

Do not use these until the numbers exist in `docs/RESULTS.md`.

```text
- Built README Intelligence Viewer (Next.js, TypeScript, unified/remark): a local-first tool that renders GitHub READMEs and extracts commands, env variables, tech stack and install steps with a deterministic AST-based parser.
- Evaluated extractors on <N> hand-labeled public READMEs, reaching <X>% F1 on commands and <Y>% on env variables; p95 parse time <Z> ms.
- Hardened rendering against XSS with an allow-list sanitizer and a <N>-payload test suite (100% blocked); added a host allow-list to the GitHub proxy to prevent SSRF.
```

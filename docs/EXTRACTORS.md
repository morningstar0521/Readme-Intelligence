# Extractors

All extractors live in `packages/core/src/extract/` and follow the same rules:

- Work on the mdast with positions. Every item keeps a `SourceRef` (heading path, 1-based line, anchor).
- Never throw. `analyze.ts` wraps each one in `safeExtract()` (try/catch + Zod validation). On failure the
  field is empty and a warning is recorded.
- Never invent data. No section, no result. The UI shows "Not found in README".
- No network calls.
- `confidence` is `explicit` or `inferred-rule`, never AI.

## Section classifier (`section-classifier.ts`, `context.ts`)

Heading text is normalised (emoji, numbering, punctuation removed, lowercase), then matched against
whole-word aliases. Rules are ordered from specific to generic, first match wins:

| Order | Type | Aliases |
|---|---|---|
| 1 | configuration | api key(s), environment variable(s), env vars, secrets |
| 2 | license | license, licence, licensing |
| 3 | contributing | contributing, contribution(s), how to contribute |
| 4 | testing | test, testing, tests, running tests |
| 5 | deployment | deployment, deploy, deploying, hosting, production |
| 6 | api | api, endpoint(s), routes, reference |
| 7 | techstack | tech stack, built with, technologies, stack, powered by, tech |
| 8 | prerequisites | prerequisites, requirements, before you begin, system requirements |
| 9 | features | features, highlights, key features, capabilities, what it does |
| 10 | installation | installation, install, getting started, setup, quick start |
| 11 | configuration | configuration, config, environment, env, .env, settings |
| 12 | usage | usage, how to use, running, run, examples |
| 13 | structure | project / folder / directory / file structure, architecture |
| 14 | roadmap | roadmap, todo, future work |
| 15 | overview | overview, about, introduction, description, what is |

Why the order differs from the PRD table: "Running tests" must be testing (not usage) and "API keys" must
be configuration (not api). The first `h1` before any other heading is the document title and is never
classified (otherwise "Awesome API Server" would turn the whole README into an API section). Children
inherit their parent's type unless they match on their own. Raw HTML headings (`<h2>...</h2>`) count.

## Project info (`project.ts`)

- Name: first h1 (Markdown or HTML), emoji removed. Else the repo name (`inferred-rule`). Else null.
- Description: first paragraph, blockquote or HTML `<p>` in the intro (before the first section heading,
  or inside an overview section) that is not only badges / images. Max 300 characters.
- Badges: images whose URL matches known badge hosts (shields.io, badgen, GitHub workflow badges,
  codecov, travis, circleci, coveralls, deploy buttons, ...), with the wrapping link when present.

## Features (`features.ts`)

List items under a Features section (nested lists flattened one level), tables whose first header is
"Feature(s)", and as a fallback sub-headings directly under Features. Leading emoji, `:shortcodes:`,
bullets and bold markers are stripped. Deduplicated. No Features section means `[]`.

## Commands (`commands.ts`)

1. Code blocks labelled bash, sh, shell, zsh, fish, console, terminal, powershell, cmd, bat; unlabelled or
   `text` blocks only when more than half of the lines are commands.
2. Continuations (`\`, `^`, `` ` ``) are joined. Prompts (`$ `, `> `, `PS> `, `C:\path> `) stripped. Comment
   lines skipped. Trailing ` # comment` removed when the line has no quotes.
3. A line is a command when its first token (after `sudo` and `VAR=value` prefixes) is a known prefix
   (npm, npx, yarn, pnpm, bun, node, pip, python, poetry, uv, cargo, go, mvn, gradle, dotnet, docker, make,
   git, cd, cp, curl, brew, apt, kubectl, terraform, prisma, pytest, ... about 110 prefixes).
4. Inline code counts when it has at least two tokens and a known prefix (`npm run dev`, not `npm`).
5. Categories, first match wins: setup, dev, build, test, lint, docker, database, deploy, other.
   `cargo build` is setup only under Installation.
6. Dedupe on normalised whitespace, keep the first source.
7. `risky` = sudo, `rm -rf`, `curl ... | sh`, `wget ... | sh`, `chmod 777`. Commands are never run.

## Environment variables (`env.ts`)

Sources: env-labelled blocks (env, dotenv, .env, ini, properties, bash, sh, ...), any block where at
least 50% of lines are strict `NAME=value`, `export NAME=value`, PowerShell `$env:NAME=`, tables with a
Variable / Name / Env / Key column, and list items or inline code inside configuration sections.

- `NAME=value cmd` in shell blocks is a one-off prefix, not a documented variable.
- Description: same-line `# comment`, the comment lines just above, or the table Description column.
- Required: "optional" -> false, "required / mandatory / must" -> true, "default" -> false, else null.
  Table Required columns accept yes/no/true/false/check marks.
- Masking: placeholders (`your_key_here`, `<token>`, `xxx`, `${VAR}`, `changeme`, ...) stay visible.
  Booleans and small numbers stay visible. Otherwise the value is masked when the name contains KEY,
  SECRET, TOKEN, PASSWORD, PRIVATE, CREDENTIAL, AUTH, or the value looks like a secret (`sk-`, `ghp_`,
  `AKIA`, `AIza`, `xox?-`, `-----BEGIN`, 20+ char random token). Masked values are replaced in core,
  so the original never reaches the UI or the JSON export.
- Merge by name: first source, first description, first non-null required.
- All-caps words like JSON, HTTP, API, README are ignored.

## Prerequisites and install steps (`install.ts`)

Prerequisites: list items in a Prerequisites section, `<tool> <version>` lines (Node.js 18+,
Python >= 3.10, PostgreSQL 14, Go 1.22, Docker), and short tool + version items or "make sure you have
..." sentences in Installation sections.

Install steps, inside Installation sections in document order:

- each ordered-list item is a step (commands from code or inline code inside it, or the next code block);
- a sub-heading starts a step and every command until the next heading belongs to it;
- a code block not attached to an open step becomes its own step, titled by the paragraph before it;
- a paragraph with an inline command is a step;
- fallback: no Installation section but setup commands elsewhere -> one "Inferred install steps"
  group with `confidence: "inferred-rule"`.

## Tech stack (`techstack.ts`, `techDictionary.ts`)

Dictionary of 246 technologies across 10 categories. Each entry has aliases, optional case-sensitive
`strict` forms, an `ambiguous` flag, badge keywords (simple-icons slugs), command patterns, code-block
language tags and import patterns.

Evidence types: badge, text, heading, code (language tag or import), command.
Strong evidence: badge, command, code, heading, or anything inside a Tech stack section.
Weak: a passing prose mention elsewhere. If a Tech stack section exists, weak-only items are dropped.
Matching is whole-word and longest-first with span masking, so "Tailwind CSS" does not also add CSS
and "React Native" does not also add React. Table cells are joined with " | " so cells never merge
into one word.

## API endpoints (`api.ts`)

`METHOD /path` lines in any code block, `curl -X METHOD url` in code blocks, and inside API sections:
headings, list items, paragraphs and tables with Method + Endpoint/Path/Route columns. The paragraph
after a heading endpoint is its description. JSON blocks that follow an endpoint are attached as
request / response examples when the label before them mentions request/body or response/returns.
`authRequired` is true only when nearby text mentions auth, token, bearer, API key or JWT.

## Deployment (`deploy.ts`)

Platforms: cloud / devops dictionary entries named in Deployment sections, deploy buttons anywhere
(Vercel, Netlify, Heroku, Railway, Render, Cloud Run, Cloudflare), and platforms implied by
deploy-category commands. Steps: list items in Deployment sections.

## Links (`links.ts`)

Markdown links, reference links and `<a href>` in HTML (including inline HTML split across nodes).
Anchors and badge-only links are excluded; relative links are resolved for GitHub sources and dropped
for local / pasted ones; unsafe schemes are dropped. Dedupe by URL. Classification order: video, chat,
issues, license, docs, demo, repo, other.

## License, flags, signals (`meta.ts`)

License from the License section (SPDX-style names such as MIT, Apache-2.0, GPL-3.0, BSD-3-Clause,
MPL-2.0, ISC), else the section's first paragraph, else a LICENSE link, else a license badge.
`hasContributing`: Contributing section, CONTRIBUTING link or mention. `hasTestsSection`: Testing section.
Signals for the health score: section types, non-badge image count, env usage mentioned, "no env
needed" statement, API signals.

## Health score (`health/rules.ts`)

| ID | Check | Weight | Pass condition |
|---|---|---|---|
| H01 | Project title | 5 | h1 or repo name |
| H02 | Description | 10 | description of 40+ characters |
| H03 | Features listed | 8 | 3+ features |
| H04 | Tech stack stated | 8 | Tech stack section or 3+ strong items |
| H05 | Prerequisites | 7 | 1+ prerequisite |
| H06 | Installation steps | 15 | 2+ explicit steps or 2+ setup commands |
| H07 | Usage section | 10 | Usage section or a dev/run command |
| H08 | Env vars documented | 8 | 1+ env var, or README says none needed, or no env usage at all |
| H09 | Screenshot or demo | 6 | non-badge image or demo / video link |
| H10 | License | 6 | License section, license link or badge |
| H11 | Contributing info | 4 | Contributing section or link |
| H12 | Testing instructions | 5 | Testing section or test command |
| H13 | Deployment info | 3 | Deployment section or deploy platform |
| H14 | API docs when applicable | 5 | endpoints found, or no API signals |

Each check returns a specific reason; failed checks carry a concrete suggestion. The UI orders
suggestions by weight and shows: "Heuristic score. Based on the presence of common sections, not the
quality of the content."

The Reality Check (comparing these README facts with repository files) is documented separately in
[REALITY-CHECK.md](REALITY-CHECK.md).

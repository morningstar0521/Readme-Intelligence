# Labelling guide

The accuracy numbers are only meaningful if the labels are written by a person reading the README,
not copied from the extractor. Budget 3 to 4 minutes per README.

## Workflow

1. `pnpm fixtures:fetch` (set `GITHUB_TOKEN` first if you hit the rate limit). Add your own repos and
   5 to 10 low-quality READMEs (classmates, old projects) to `scripts/fixture-repos.json` for variety.
2. `pnpm fixtures:labels` creates `packages/core/tests/fixtures/labels/<owner>__<repo>.json`.
3. Open the README in a plain text editor (not in the viewer) and fill in the label file.
4. Set `"labeled": true` and `"labeledBy": "<your name>"`.
5. `pnpm eval --verbose` lists false positives and misses per fixture. Fix labels only when the label
   was wrong; fix the extractor when the extractor was wrong.

Never edit a label to match the extractor output without re-reading the README.

## Reality Check labels (optional)

1. `pnpm fixtures:fetch --with-repo` saves `packages/core/tests/fixtures/repos/<owner>__<repo>.json`.
2. `pnpm eval --candidates` prints every non-verified claim per fixture with its id, e.g.
   `[contradiction] script:lint  README uses npm run lint ... <- README:42, package.json:5`.
3. For each candidate, open the repository on GitHub and decide: is it a real problem a new developer
   would hit? Also look for real contradictions the tool missed (check package.json scripts, lockfile,
   engines / .nvmrc, Dockerfile, LICENSE against the README).
4. Fill the `reality` block and set `"labeled": true` inside it. `pnpm eval` then reports precision
   and recall for contradictions and undocumented env vars.

```json
"reality": {
  "labeled": true,
  "contradictions": ["script:lint", "pm:node"],
  "undocumentedEnv": ["SENTRY_DSN"]
}
```

Rules: `contradictions` holds claim ids (as printed) of conflicts you confirmed; for a missed
contradiction, use the id format `<category>:<name>` you see on similar claims. `undocumentedEnv` holds
variable names the code really reads that a user must set and the README does not mention (exclude
`NODE_ENV`, CI-only and framework-internal variables). Snapshots are pinned to a ref, so labels stay
valid until you re-fetch with `--force`.

## Label format

```json
{
  "labeled": true,
  "labeledBy": "Shubh",
  "notes": "monorepo, install section uses tabs per OS",
  "commands": ["git clone https://github.com/acme/app.git", "npm install", "npm run dev"],
  "envVars": ["DATABASE_URL", "NEXTAUTH_SECRET"],
  "techStack": ["Next.js", "PostgreSQL", "Prisma"],
  "installSteps": 3,
  "hasLicense": true,
  "apiEndpoints": ["GET /api/users", "POST /api/users"]
}
```

## Rules per field

General: label only from the README text. Do not add what you know about the project, what its other
docs say (INSTALL.md, website) or GitHub's language stats. If it is not in the README, it is not in the label.

**commands**: every shell command the README tells the reader to run, exactly as written, without
the `$ ` prompt and without a trailing `# comment`. One entry per line (joined if continued with `\`,
`^` or a backtick). Include usage examples of the tool shown in shell blocks and every OS / package
manager variant shown. Include inline commands in prose
(`run \`npm test\``). Exclude command output, commands inside programming-language code (JS, Python),
and example commands for a different tool. Deduplicate.

**envVars**: names of environment variables the project reads, as documented in the README (env blocks,
tables, lists, `export` lines). Names only, uppercase as written. Exclude variables that only appear
as a one-off prefix in a command (`NODE_ENV=production npm start`) unless the README documents them.

**techStack**: technologies the project is built with or requires, using the canonical names from
`packages/core/src/extract/techDictionary.ts` (aliases like "postgres" are normalised automatically).
Include languages, frameworks, databases, auth, AI/ML libraries, cloud platforms, devops tools,
test frameworks and package managers the README uses. Exclude technologies only mentioned in passing
("unlike Django, this...") or in comparisons. If a technology is not in the dictionary, still label it:
it will count as a miss, which is the honest result. Also exclude: the project itself (Flask is not in
Flask's stack), OS package managers used only to obtain the tool (apt, brew, choco, winget), Git and
editors, sponsor or user logos, and lists of platforms / SDKs the product supports or integrates with.

**installSteps**: the number of distinct sequential steps a reader follows to install / set up the
project, from the Installation / Getting Started / Quick start / Setup section. Alternatives that do the
same job (per-OS installers, different package managers, Docker vs source) count as one step; when the
README offers alternative paths, count the steps of the first path only. Usage examples do not count.
0 if there is no installation section.

**hasLicense**: true if the README states or links the license.

**apiEndpoints**: `"METHOD /path"` for every HTTP endpoint the README documents. Empty for libraries
and CLIs.

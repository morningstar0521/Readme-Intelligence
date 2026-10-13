import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { analyzeReadme } from '../../src/analyze';
import { canonicalTechName } from '../../src/extract/techDictionary';
import { stripPrompt } from '../../src/extract/commands';
import type { SourceInfo } from '../../src/types';
import { checkRepository } from '../../src/repo/checks';
import { RepoSnapshotSchema } from '../../src/repo/fetchRepo';
import type { Claim, RepoSnapshot } from '../../src/repo/types';

/**
 * Evaluation harness (Test plan 6.3).
 * Runs the extractors on hand-labeled fixtures and computes precision, recall and F1
 * per field with exact match on field-specific canonical strings. Commands collapse
 * equivalent package-manager spelling and safe flags; other fields use canonical names.
 * Used by scripts/eval.ts (writes
 * docs/RESULTS.md) and tests/eval/eval.test.ts (regression threshold).
 */

export const LabelSchema = z.object({
  /** Must be set to true by a human after checking every field. Unlabeled fixtures are skipped. */
  labeled: z.boolean(),
  labeledBy: z.string().optional(),
  notes: z.string().optional(),
  commands: z.array(z.string()),
  envVars: z.array(z.string()),
  techStack: z.array(z.string()),
  installSteps: z.number().int().nonnegative(),
  hasLicense: z.boolean(),
  apiEndpoints: z.array(z.string()).default([]),
  /**
   * Optional Reality Check labels (needs a repo snapshot, see `pnpm fixtures:fetch --with-repo`).
   * contradictions: claim ids a human confirmed as real README vs repository conflicts.
   * undocumentedEnv: variable names the code reads that the README should mention.
   */
  reality: z
    .object({
      labeled: z.boolean(),
      contradictions: z.array(z.string()).default([]),
      undocumentedEnv: z.array(z.string()).default([]),
    })
    .optional(),
});
export type FixtureLabel = z.infer<typeof LabelSchema>;

/**
 * Regression floors (not targets). Set just below the baseline measured on 2026-10-08 with 59 labeled
 * fixtures (commands F1 72.9%, env vars F1 51.9%). Raise them whenever the extractor improves, so a
 * later change cannot silently undo the gain. PRD targets (85 / 85 / 80) are reported separately.
 */
export const REGRESSION_FLOOR = { commands: 0.7, envVars: 0.5 } as const;

export const FixtureIndexSchema = z.array(
  z.object({
    name: z.string(),
    repo: z.string(),
    url: z.string(),
    ref: z.string().optional(),
    path: z.string().optional(),
    category: z.string().optional(),
    fetchedAt: z.string().optional(),
  })
);
export type FixtureIndexEntry = z.infer<typeof FixtureIndexSchema>[number];

export interface Fixture {
  name: string;
  markdown: string;
  label: FixtureLabel;
  source: SourceInfo;
  /** Repository snapshot saved by `pnpm fixtures:fetch --with-repo`, when present. */
  snapshot?: RepoSnapshot;
}

export interface FieldMetrics {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export const FIELDS = ['commands', 'envVars', 'techStack', 'apiEndpoints'] as const;
export type Field = (typeof FIELDS)[number];

export interface EvalReport {
  fixtureCount: number;
  fields: Record<Field, FieldMetrics>;
  installSteps: { exact: number; meanAbsoluteError: number };
  license: { accuracy: number };
  timing: { p50: number; p95: number; max: number; totalP50: number; totalP95: number };
  perFixture: { name: string; f1: Record<Field, number | null>; ms: number; misses: Record<Field, { fp: string[]; fn: string[] }> }[];
}

export const HOLDOUT_BUCKET_COUNT = 5;
export const HOLDOUT_BUCKET = 0;

function fixtureBucket(name: string): number {
  let hash = 2166136261;
  for (const char of name) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % HOLDOUT_BUCKET_COUNT;
}

export function splitFixtures<T extends Pick<Fixture, 'name'>>(fixtures: T[]): { development: T[]; holdout: T[] } {
  return fixtures.reduce<{ development: T[]; holdout: T[] }>(
    (split, fixture) => {
      if (fixtureBucket(fixture.name) === HOLDOUT_BUCKET) split.holdout.push(fixture);
      else split.development.push(fixture);
      return split;
    },
    { development: [], holdout: [] },
  );
}

// ---------------------------------------------------------------- normalisation

export function normalizeCommandLabel(cmd: string): string {
  let normalized = stripPrompt(cmd.trim())
    .replace(/\s+/g, ' ')
    .replace(/\b(?!https?:\/\/)([^\s]+)@latest\b/gi, '$1')
    .replace(/;+$/, '')
    .trim();
  // Strip trailing comments ( # comment) but only if no unclosed quotes before the comment
  const idx = normalized.search(/\s+#/);
  if (idx !== -1) {
    const beforeComment = normalized.slice(0, idx);
    const singleQuotes = (beforeComment.match(/'/g) || []).length;
    const doubleQuotes = (beforeComment.match(/"/g) || []).length;
    const backticks = (beforeComment.match(/`/g) || []).length;
    if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0 && backticks % 2 === 0) {
      normalized = normalized.slice(0, idx).trimEnd();
    }
  }
  normalized = normalized.replace(/^(?:python3?|py)\s+-m\s+pip\b/i, 'pip');
  normalized = normalized.replace(/^(pip3?)\s+install\s+((?:-[A-Za-z][\w-]*(?:=\S+)?\s+)+)/i, '$1 install ');
  normalized = normalized.replace(/\b([@A-Za-z0-9_./-]+)\[[^\]]+\]/g, '$1');
  normalized = normalized.replace(/\s+--(?:save(?:-dev)?|upgrade|user|force-reinstall|no-deps|pre|editable|no-cache-dir)\b/gi, '');
  return normalized.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
}

export function normalizeTechLabel(name: string): string {
  return (canonicalTechName(name) ?? name.trim()).toLowerCase();
}

export function normalizeEndpointLabel(ep: string): string {
  const m = /^\s*([A-Za-z]+)\s+(\S+)/.exec(ep);
  if (!m) return ep.trim();
  const p = m[2]!.length > 1 ? m[2]!.replace(/\/+$/, '') : m[2]!;
  return `${m[1]!.toUpperCase()} ${p}`;
}

const NORMALIZERS: Record<Field, (s: string) => string> = {
  commands: normalizeCommandLabel,
  envVars: (s) => s.trim(),
  techStack: normalizeTechLabel,
  apiEndpoints: normalizeEndpointLabel,
};

// ---------------------------------------------------------------- metrics

export function setCounts(predicted: string[], expected: string[]): { tp: number; fp: number; fn: number; fpItems: string[]; fnItems: string[] } {
  const p = new Set(predicted);
  const e = new Set(expected);
  const fpItems = [...p].filter((x) => !e.has(x));
  const fnItems = [...e].filter((x) => !p.has(x));
  return { tp: [...p].filter((x) => e.has(x)).length, fp: fpItems.length, fn: fnItems.length, fpItems, fnItems };
}

export function metricsFrom(tp: number, fp: number, fn: number): FieldMetrics {
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  let f1: number | null = null;
  if (precision !== null && recall !== null) f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  else if (tp + fp + fn === 0) f1 = null;
  else f1 = 0;
  return { tp, fp, fn, precision, recall, f1 };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export function predictedFields(markdown: string, source: SourceInfo) {
  const result = analyzeReadme(markdown, source);
  const i = result.intelligence;
  return {
    result,
    fields: {
      commands: i.commands.map((c) => c.command),
      envVars: i.envVars.map((e) => e.name),
      techStack: i.techStack.map((t) => t.name),
      apiEndpoints: i.api.map((a) => `${a.method} ${a.path}`),
    } satisfies Record<Field, string[]>,
    installSteps: i.installSteps.filter((s) => s.confidence === 'explicit').length,
    hasLicense: i.license !== null,
  };
}

export function evaluate(fixtures: Fixture[]): EvalReport {
  const totals: Record<Field, { tp: number; fp: number; fn: number }> = {
    commands: { tp: 0, fp: 0, fn: 0 },
    envVars: { tp: 0, fp: 0, fn: 0 },
    techStack: { tp: 0, fp: 0, fn: 0 },
    apiEndpoints: { tp: 0, fp: 0, fn: 0 },
  };
  const parseTimes: number[] = [];
  const totalTimes: number[] = [];
  let stepsExact = 0;
  let stepsAbsError = 0;
  let licenseCorrect = 0;
  const perFixture: EvalReport['perFixture'] = [];

  // Warm-up so regex compilation and JIT do not count against the first fixture.
  if (fixtures[0]) analyzeReadme(fixtures[0].markdown, fixtures[0].source);

  for (const fx of fixtures) {
    const pred = predictedFields(fx.markdown, fx.source);
    parseTimes.push(pred.result.stats.parseMs + pred.result.stats.extractMs);
    totalTimes.push(pred.result.stats.totalMs);

    const f1: Record<Field, number | null> = { commands: null, envVars: null, techStack: null, apiEndpoints: null };
    const misses = {} as Record<Field, { fp: string[]; fn: string[] }>;
    for (const field of FIELDS) {
      const norm = NORMALIZERS[field];
      const c = setCounts(pred.fields[field].map(norm), fx.label[field].map(norm));
      totals[field].tp += c.tp;
      totals[field].fp += c.fp;
      totals[field].fn += c.fn;
      f1[field] = metricsFrom(c.tp, c.fp, c.fn).f1;
      misses[field] = { fp: c.fpItems, fn: c.fnItems };
    }

    if (pred.installSteps === fx.label.installSteps) stepsExact++;
    stepsAbsError += Math.abs(pred.installSteps - fx.label.installSteps);
    if (pred.hasLicense === fx.label.hasLicense) licenseCorrect++;
    perFixture.push({ name: fx.name, f1, ms: pred.result.stats.parseMs + pred.result.stats.extractMs, misses });
  }

  const n = fixtures.length || 1;
  return {
    fixtureCount: fixtures.length,
    fields: {
      commands: metricsFrom(totals.commands.tp, totals.commands.fp, totals.commands.fn),
      envVars: metricsFrom(totals.envVars.tp, totals.envVars.fp, totals.envVars.fn),
      techStack: metricsFrom(totals.techStack.tp, totals.techStack.fp, totals.techStack.fn),
      apiEndpoints: metricsFrom(totals.apiEndpoints.tp, totals.apiEndpoints.fp, totals.apiEndpoints.fn),
    },
    installSteps: { exact: stepsExact / n, meanAbsoluteError: stepsAbsError / n },
    license: { accuracy: licenseCorrect / n },
    timing: {
      p50: percentile(parseTimes, 50),
      p95: percentile(parseTimes, 95),
      max: Math.max(0, ...parseTimes),
      totalP50: percentile(totalTimes, 50),
      totalP95: percentile(totalTimes, 95),
    },
    perFixture,
  };
}

// ---------------------------------------------------------------- loading

export const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export function loadFixtures(dir = FIXTURE_DIR, { includeUnlabeled = false } = {}): { fixtures: Fixture[]; total: number; unlabeled: string[] } {
  const readmeDir = path.join(dir, 'readmes');
  const labelDir = path.join(dir, 'labels');
  const indexPath = path.join(dir, 'index.json');
  const index = existsSync(indexPath) ? FixtureIndexSchema.parse(JSON.parse(readFileSync(indexPath, 'utf8'))) : [];
  const byName = new Map(index.map((e) => [e.name, e]));
  const files = existsSync(readmeDir) ? readdirSync(readmeDir).filter((f) => f.endsWith('.md')) : [];

  const fixtures: Fixture[] = [];
  const unlabeled: string[] = [];
  for (const file of files.sort()) {
    const name = file.replace(/\.md$/, '');
    const labelPath = path.join(labelDir, `${name}.json`);
    if (!existsSync(labelPath)) {
      unlabeled.push(name);
      continue;
    }
    const label = LabelSchema.parse(JSON.parse(readFileSync(labelPath, 'utf8')));
    if (!label.labeled && !includeUnlabeled) {
      unlabeled.push(name);
      continue;
    }
    const entry = byName.get(name);
    const [owner, repo] = (entry?.repo ?? name.replace('__', '/')).split('/');
    const source: SourceInfo =
      owner && repo
        ? {
            kind: 'github',
            owner,
            repo,
            ref: entry?.ref ?? 'HEAD',
            path: entry?.path ?? 'README.md',
            rawBase: `https://raw.githubusercontent.com/${owner}/${repo}/${entry?.ref ?? 'HEAD'}/`,
            htmlUrl: `https://github.com/${owner}/${repo}`,
          }
        : { kind: 'local', fileName: file };
    const snapshot = loadSnapshot(path.join(dir, 'repos', `${name}.json`));
    fixtures.push({ name, markdown: readFileSync(path.join(readmeDir, file), 'utf8'), label, source, ...(snapshot ? { snapshot } : {}) });
  }
  return { fixtures, total: files.length, unlabeled };
}

/** Read a saved repository snapshot; invalid or missing files are ignored (the fixture still runs the README eval). */
export function loadSnapshot(file: string): RepoSnapshot | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const parsed = RepoSnapshotSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- reality check

export interface RealityEval {
  /** Fixtures that have a snapshot (Reality Check ran). */
  withSnapshot: number;
  /** Fixtures with a snapshot AND reality.labeled = true (precision / recall computed on these). */
  labeled: number;
  contradictions: FieldMetrics;
  undocumentedEnv: FieldMetrics;
  meanReadiness: number | null;
  statusTotals: Record<Claim['status'], number>;
  perFixture: { name: string; readiness: number; counts: Record<Claim['status'], number>; labeled: boolean; misses: { contradictions: { fp: string[]; fn: string[] }; undocumentedEnv: { fp: string[]; fn: string[] } } }[];
}

/** Run the Reality Check on one fixture. Rendering is kept on so image links are checked too. */
export function runReality(fx: Fixture) {
  if (!fx.snapshot) return null;
  const result = analyzeReadme(fx.markdown, fx.source);
  return checkRepository({ intelligence: result.intelligence, hast: result.hast }, fx.snapshot);
}

/**
 * Reality Check evaluation. Predicted contradictions = claim ids with status "contradiction";
 * predicted undocumented env = names of env claims with status "repo-only". Compared with the
 * hand labels by exact id / name. Fixtures without labels still add to the readiness mean and
 * status totals, but not to precision / recall.
 */
export function evaluateReality(fixtures: Fixture[]): RealityEval {
  const c = { tp: 0, fp: 0, fn: 0 };
  const e = { tp: 0, fp: 0, fn: 0 };
  const statusTotals: RealityEval['statusTotals'] = { contradiction: 0, 'readme-only': 0, 'repo-only': 0, unverified: 0, verified: 0 };
  const perFixture: RealityEval['perFixture'] = [];
  const readiness: number[] = [];
  let labeled = 0;

  for (const fx of fixtures) {
    const report = runReality(fx);
    if (!report) continue;
    readiness.push(report.readiness.score);
    for (const s of Object.keys(statusTotals) as Claim['status'][]) statusTotals[s] += report.counts[s];

    const isLabeled = fx.label.reality?.labeled === true;
    const misses = { contradictions: { fp: [] as string[], fn: [] as string[] }, undocumentedEnv: { fp: [] as string[], fn: [] as string[] } };
    if (isLabeled && fx.label.reality) {
      labeled++;
      const predC = report.claims.filter((x) => x.status === 'contradiction').map((x) => x.id);
      const predE = report.claims.filter((x) => x.category === 'env' && x.status === 'repo-only').map((x) => x.id.replace(/^env:/, ''));
      const cc = setCounts(predC, fx.label.reality.contradictions);
      const ec = setCounts(predE, fx.label.reality.undocumentedEnv.map((s) => s.trim()));
      c.tp += cc.tp;
      c.fp += cc.fp;
      c.fn += cc.fn;
      e.tp += ec.tp;
      e.fp += ec.fp;
      e.fn += ec.fn;
      misses.contradictions = { fp: cc.fpItems, fn: cc.fnItems };
      misses.undocumentedEnv = { fp: ec.fpItems, fn: ec.fnItems };
    }
    perFixture.push({ name: fx.name, readiness: report.readiness.score, counts: report.counts, labeled: isLabeled, misses });
  }

  return {
    withSnapshot: perFixture.length,
    labeled,
    contradictions: metricsFrom(c.tp, c.fp, c.fn),
    undocumentedEnv: metricsFrom(e.tp, e.fp, e.fn),
    meanReadiness: readiness.length ? readiness.reduce((a, b) => a + b, 0) / readiness.length : null,
    statusTotals,
    perFixture,
  };
}

// ---------------------------------------------------------------- report

const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);

export function renderRealityEvalMarkdown(r: RealityEval): string[] {
  if (r.withSnapshot === 0) {
    return ['## Repository Reality Check', '', 'No repository snapshots yet. Run `pnpm fixtures:fetch --with-repo`, then add a `reality` block to each label (docs/LABELING.md).', ''];
  }
  const row = (name: string, m: FieldMetrics) => `| ${name} | ${m.tp} | ${m.fp} | ${m.fn} | ${pct(m.precision)} | ${pct(m.recall)} | **${pct(m.f1)}** |`;
  return [
    '## Repository Reality Check',
    '',
    `- Fixtures with a repository snapshot: **${r.withSnapshot}**, with hand-labeled reality claims: **${r.labeled}**`,
    `- Mean Setup Readiness: ${r.meanReadiness === null ? 'n/a' : r.meanReadiness.toFixed(1)} / 100`,
    `- Claims by status (all snapshots): ${r.statusTotals.contradiction} contradiction, ${r.statusTotals['readme-only']} README only, ${r.statusTotals['repo-only']} undocumented, ${r.statusTotals.unverified} unverified, ${r.statusTotals.verified} verified`,
    '- Matching: exact claim id for contradictions, exact variable name for undocumented env vars. Precision is the number that matters: a false contradiction costs user trust.',
    '',
    ...(r.labeled > 0
      ? ['| Claim type | TP | FP | FN | Precision | Recall | F1 |', '|---|---|---|---|---|---|---|', row('Contradictions', r.contradictions), row('Undocumented env vars', r.undocumentedEnv), '']
      : ['Precision and recall are not reported yet: no fixture has `reality.labeled: true`.', '']),
  ];
}

export function renderResultsMarkdown(
  report: EvalReport,
  meta: { date: string; totalFixtures: number; unlabeled: number; nodeVersion: string; labelers?: Record<string, number> },
  reality?: RealityEval,
  holdout?: EvalReport,
): string {
  const rows = FIELDS.map((f) => {
    const m = report.fields[f];
    return `| ${f} | ${m.tp} | ${m.fp} | ${m.fn} | ${pct(m.precision)} | ${pct(m.recall)} | **${pct(m.f1)}** |`;
  });
  const worst = [...report.perFixture]
    .map((p) => ({ name: p.name, score: (p.f1.commands ?? 1) + (p.f1.envVars ?? 1) + (p.f1.techStack ?? 1) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);

  return [
    '# Results',
    '',
    `Generated by \`pnpm eval\` on ${meta.date} (Node ${meta.nodeVersion}). Do not edit by hand: re-run the script.`,
    '',
    `- Labeled fixtures evaluated: **${report.fixtureCount}** (of ${meta.totalFixtures} fixture READMEs, ${meta.unlabeled} not yet labeled)`,
    ...(meta.labelers && Object.keys(meta.labelers).length > 0
      ? [`- Labels by: ${Object.entries(meta.labelers).map(([who, n]) => `${who} (${n})`).join(', ')}. Labels follow docs/LABELING.md and were written from the README text, never from extractor output.`]
      : []),
    '- Matching: exact match after field-specific canonicalisation (commands: prompt, whitespace, package-manager spelling, safe install flags and package extras; tech: canonical names; endpoints: "METHOD /path").',
    `- Validation status: development benchmark plus deterministic holdout; the primary score uses all ${report.fixtureCount} labeled fixtures and holdout metrics are reported separately.`,
    '- Averaging: micro-average (true/false positives summed over all fixtures).',
    '',
    '## Extraction accuracy',
    '',
    '| Field | TP | FP | FN | Precision | Recall | F1 |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `| Install steps (exact count match) | ${pct(report.installSteps.exact)} | mean absolute error ${report.installSteps.meanAbsoluteError.toFixed(2)} |`,
    '|---|---|---|',
    `| License detected correctly | ${pct(report.license.accuracy)} | |`,
    '',
    '## Performance',
    '',
    '| Metric | Value |',
    '|---|---|',
    `| Parse + extract p50 | ${report.timing.p50.toFixed(1)} ms |`,
    `| Parse + extract p95 | ${report.timing.p95.toFixed(1)} ms |`,
    `| Parse + extract max | ${report.timing.max.toFixed(1)} ms |`,
    `| Full pipeline incl. rendering p50 / p95 | ${report.timing.totalP50.toFixed(1)} / ${report.timing.totalP95.toFixed(1)} ms |`,
    '',
    '## Targets (PRD 2.8)',
    '',
    `- Commands F1 >= 85%: ${pct(report.fields.commands.f1)} ${report.fields.commands.f1 !== null && report.fields.commands.f1 >= 0.85 ? 'met' : 'NOT met'}`,
    `- Env vars F1 >= 85%: ${pct(report.fields.envVars.f1)} ${report.fields.envVars.f1 !== null && report.fields.envVars.f1 >= 0.85 ? 'met' : 'NOT met'}`,
    `- Tech stack F1 >= 80%: ${pct(report.fields.techStack.f1)} ${report.fields.techStack.f1 !== null && report.fields.techStack.f1 >= 0.8 ? 'met' : 'NOT met'}`,
    `- Parse p95 < 300 ms: ${report.timing.p95.toFixed(1)} ms ${report.timing.p95 < 300 ? 'met' : 'NOT met'}`,
    `- Fixture set >= 50: ${report.fixtureCount} ${report.fixtureCount >= 50 ? 'met' : 'NOT met'}`,
    '',
    '## Lowest scoring fixtures',
    '',
    '| Fixture | Commands F1 | Env F1 | Tech F1 |',
    '|---|---|---|---|',
    ...worst.map((w) => {
      const p = report.perFixture.find((x) => x.name === w.name)!;
      return `| ${w.name} | ${pct(p.f1.commands)} | ${pct(p.f1.envVars)} | ${pct(p.f1.techStack)} |`;
    }),
    '',
    ...(holdout
      ? [
          '## Holdout accuracy',
          '',
          `The deterministic holdout contains **${holdout.fixtureCount}** fixtures reserved from extractor tuning. These metrics are descriptive and do not replace the primary development-set score or regression floor.`,
          '',
          '| Field | Precision | Recall | F1 |',
          '|---|---:|---:|---:|',
          ...FIELDS.map((field) => {
            const m = holdout.fields[field];
            return `| ${field} | ${pct(m.precision)} | ${pct(m.recall)} | **${pct(m.f1)}** |`;
          }),
          '',
        ]
      : []),
    ...(reality ? renderRealityEvalMarkdown(reality) : []),
  ].join('\n');
}

/** Compact benchmark dashboard with aggregate metrics and actionable failure examples. */
export function renderBenchmarkDashboard(report: EvalReport, meta: { date: string; nodeVersion: string }, holdout?: EvalReport): string {
  const rows = FIELDS.map((field) => {
    const m = report.fields[field];
    return `| ${field} | ${pct(m.precision)} | ${pct(m.recall)} | **${pct(m.f1)}** | ${m.tp} | ${m.fp} | ${m.fn} |`;
  });
  const failures = report.perFixture
    .flatMap((fixture) =>
      FIELDS.map((field) => {
        const miss = fixture.misses[field];
        return { fixture: fixture.name, field, fp: miss.fp, fn: miss.fn, total: miss.fp.length + miss.fn.length };
      })
    )
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total || a.fixture.localeCompare(b.fixture))
    .slice(0, 20);

  return [
    '# README Intelligence Benchmark Dashboard',
    '',
    `Generated by \`pnpm eval\` on ${meta.date} (Node ${meta.nodeVersion}). Do not edit by hand.`,
    '',
    `Evaluated **${report.fixtureCount}** labeled README fixtures using deterministic, README-only extraction.`,
    '',
    '## Aggregate metrics',
    '',
    '| Field | Precision | Recall | F1 | TP | FP | FN |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...rows,
    '',
    '## Performance and target status',
    '',
    '| Metric | Value | Status |',
    '|---|---:|---|',
    `| Parse + extract p95 | ${report.timing.p95.toFixed(1)} ms | ${report.timing.p95 < 300 ? 'met' : 'not met'} |`,
    `| Commands F1 target | ${pct(report.fields.commands.f1)} | ${report.fields.commands.f1 !== null && report.fields.commands.f1 >= 0.85 ? 'met' : 'not met'} |`,
    `| Environment variables F1 target | ${pct(report.fields.envVars.f1)} | ${report.fields.envVars.f1 !== null && report.fields.envVars.f1 >= 0.85 ? 'met' : 'not met'} |`,
    `| Tech stack F1 target | ${pct(report.fields.techStack.f1)} | ${report.fields.techStack.f1 !== null && report.fields.techStack.f1 >= 0.8 ? 'met' : 'not met'} |`,
    '',
    '## Highest-impact failure examples',
    '',
    '| Fixture | Field | False positives | Missed labels |',
    '|---|---|---|---|',
    ...failures.map((item) => `| ${item.fixture} | ${item.field} | ${item.fp.join(', ') || '-'} | ${item.fn.join(', ') || '-'} |`),
    '',
    'False positives reduce precision. Missed labels reduce recall. These examples are the starting point for the next extractor change, not evidence that the labels should be changed.',
    '',
    ...(holdout
      ? [
          '## Holdout accuracy',
          '',
          `Reserved fixtures: **${holdout.fixtureCount}**. Holdout metrics are reported separately and do not replace the primary development-set score.`,
          '',
          '| Field | Precision | Recall | F1 |',
          '|---|---:|---:|---:|',
          ...FIELDS.map((field) => {
            const m = holdout.fields[field];
            return `| ${field} | ${pct(m.precision)} | ${pct(m.recall)} | **${pct(m.f1)}** |`;
          }),
          '',
        ]
      : []),
  ].join('\n');
}

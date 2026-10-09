/**
 * pnpm eval
 * Runs the extractors on every hand-labeled fixture, prints precision / recall / F1
 * per field and writes docs/RESULTS.md. Exits with code 1 when commands or env vars F1
 * drops below REGRESSION_FLOOR in tests/eval/evaluate.ts (just under the measured baseline).
 *
 * Fixtures with a saved repository snapshot (pnpm fixtures:fetch --with-repo) also run the
 * Reality Check. Flags:
 *   --verbose     print every extraction miss
 *   --candidates  print every non-verified Reality Check claim per fixture (labeled or not),
 *                 so you can judge each one and copy the real ones into the label's "reality" block
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, evaluateReality, loadFixtures, renderBenchmarkDashboard, renderResultsMarkdown, runReality, FIELDS, REGRESSION_FLOOR } from '../packages/core/tests/eval/evaluate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv.includes('--candidates')) {
  const all = loadFixtures(undefined, { includeUnlabeled: true }).fixtures.filter((f) => f.snapshot);
  if (all.length === 0) console.log('No repository snapshots. Run "pnpm fixtures:fetch --with-repo" first.');
  for (const fx of all) {
    const report = runReality(fx)!;
    const open = report.claims.filter((c) => c.status !== 'verified');
    console.log(`\n## ${fx.name}  readiness ${report.readiness.score}/100  (${open.length} non-verified claims)`);
    for (const c of open) {
      const where = [...c.readme.map((r) => `README:${r.line}`), ...c.repo.map((e) => `${e.path}${e.line ? `:${e.line}` : ''}`)].join(', ');
      console.log(`  [${c.status}] ${c.id}  ${c.title}${where ? `  <- ${where}` : ''}`);
    }
  }
  process.exit(0);
}

const { fixtures, total, unlabeled } = loadFixtures();

if (fixtures.length === 0) {
  console.log(`No labeled fixtures found (${total} README files, ${unlabeled.length} unlabeled).`);
  console.log('Run "pnpm fixtures:fetch", then "pnpm fixtures:labels", label the JSON files by hand and set "labeled": true.');
  console.log('See docs/LABELING.md.');
  process.exit(0);
}

const report = evaluate(fixtures);
const pct = (v: number | null) => (v === null ? '  n/a ' : `${(v * 100).toFixed(1).padStart(5)}%`);

console.log(`\nEvaluated ${report.fixtureCount} labeled fixtures (${unlabeled.length} unlabeled skipped)\n`);
console.log('field          precision  recall     F1');
for (const f of FIELDS) {
  const m = report.fields[f];
  console.log(`${f.padEnd(14)} ${pct(m.precision)}   ${pct(m.recall)}  ${pct(m.f1)}   (tp ${m.tp}, fp ${m.fp}, fn ${m.fn})`);
}
console.log(`installSteps   exact ${pct(report.installSteps.exact)}  MAE ${report.installSteps.meanAbsoluteError.toFixed(2)}`);
console.log(`license        accuracy ${pct(report.license.accuracy)}`);
console.log(`timing         parse+extract p50 ${report.timing.p50.toFixed(1)} ms, p95 ${report.timing.p95.toFixed(1)} ms\n`);

if (process.argv.includes('--verbose')) {
  for (const fx of report.perFixture) {
    for (const f of FIELDS) {
      const miss = fx.misses[f];
      if (miss.fp.length || miss.fn.length) {
        console.log(`${fx.name} ${f}: false positives ${JSON.stringify(miss.fp)} | missed ${JSON.stringify(miss.fn)}`);
      }
    }
  }
}

const reality = evaluateReality(fixtures);
if (reality.withSnapshot > 0) {
  console.log(`reality check  ${reality.withSnapshot} snapshots, ${reality.labeled} labeled, mean readiness ${reality.meanReadiness?.toFixed(1) ?? 'n/a'}`);
  if (reality.labeled > 0) {
    console.log(`  contradictions   precision ${pct(reality.contradictions.precision)}  recall ${pct(reality.contradictions.recall)}`);
    console.log(`  undocumented env precision ${pct(reality.undocumentedEnv.precision)}  recall ${pct(reality.undocumentedEnv.recall)}`);
  }
  if (process.argv.includes('--verbose')) {
    for (const fx of reality.perFixture.filter((p) => p.labeled)) {
      const m = fx.misses;
      if (m.contradictions.fp.length || m.contradictions.fn.length) console.log(`${fx.name} contradictions: false ${JSON.stringify(m.contradictions.fp)} | missed ${JSON.stringify(m.contradictions.fn)}`);
      if (m.undocumentedEnv.fp.length || m.undocumentedEnv.fn.length) console.log(`${fx.name} undocumented env: false ${JSON.stringify(m.undocumentedEnv.fp)} | missed ${JSON.stringify(m.undocumentedEnv.fn)}`);
    }
  }
  console.log('');
}

const out = renderResultsMarkdown(report, {
  date: new Date().toISOString().slice(0, 10),
  totalFixtures: total,
  unlabeled: unlabeled.length,
  nodeVersion: process.versions.node,
  labelers: fixtures.reduce<Record<string, number>>((acc, f) => {
    const who = f.label.labeledBy || 'unknown';
    acc[who] = (acc[who] ?? 0) + 1;
    return acc;
  }, {}),
}, reality);
writeFileSync(path.join(root, 'docs', 'RESULTS.md'), out);
writeFileSync(path.join(root, 'docs', 'BENCHMARK.md'), renderBenchmarkDashboard(report, { date: new Date().toISOString().slice(0, 10), nodeVersion: process.versions.node }));
console.log('Wrote docs/RESULTS.md');
console.log('Wrote docs/BENCHMARK.md');

const failing = (['commands', 'envVars'] as const).filter((f) => (report.fields[f].f1 ?? 0) < REGRESSION_FLOOR[f]);
if (failing.length > 0) {
  console.error(`F1 below the regression floor for: ${failing.map((f) => `${f} (floor ${REGRESSION_FLOOR[f]})`).join(', ')}`);
  process.exit(1);
}

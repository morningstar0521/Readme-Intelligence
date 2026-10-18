import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtures, runReality } from '../packages/core/tests/eval/evaluate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'docs', 'reality-labels');
const outputPath = path.join(outputDir, 'contradictions.json');

const { fixtures } = loadFixtures();
const rows = fixtures.flatMap((fixture) => {
  const report = runReality(fixture);
  const snapshot = fixture.snapshot;
  if (!report || !snapshot) return [];

  return report.claims
    .filter((claim) => claim.status === 'contradiction')
    .map((claim) => ({
      fixture: fixture.name,
      repo: `${snapshot.owner}/${snapshot.repo}`,
      repo_ref: snapshot.ref,
      snapshot_ref: snapshot.ref,
      sha_available: false,
      claim_id: claim.id,
      field: claim.category,
      readme_line: claim.readme[0]?.line ?? null,
      readme_value: claim.title,
      repo_evidence: claim.repo.map((evidence) => evidence.kind === 'content' ? `${evidence.path}:${evidence.line} ${evidence.snippet}` : `${evidence.path}:tree-absence`),
    }));
});

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`Wrote ${path.relative(root, outputPath)} (${rows.length} contradictions)`);

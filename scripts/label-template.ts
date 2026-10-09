/**
 * pnpm fixtures:labels
 * Creates an EMPTY label file for every fixture README that does not have one yet.
 * Labels are intentionally NOT pre-filled from extractor output: the PRD requires hand
 * labels, otherwise the accuracy numbers measure the extractor against itself.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'packages/core/tests/fixtures');
const readmeDir = path.join(fixtureDir, 'readmes');
const labelDir = path.join(fixtureDir, 'labels');
mkdirSync(labelDir, { recursive: true });

const template = {
  labeled: false,
  labeledBy: '',
  notes: '',
  commands: [] as string[],
  envVars: [] as string[],
  techStack: [] as string[],
  installSteps: 0,
  hasLicense: false,
  apiEndpoints: [] as string[],
  reality: {
    labeled: false,
    contradictions: [] as string[],
    undocumentedEnv: [] as string[],
  },
};

let created = 0;
const files = existsSync(readmeDir) ? readdirSync(readmeDir).filter((f) => f.endsWith('.md')) : [];
for (const file of files) {
  const labelPath = path.join(labelDir, file.replace(/\.md$/, '.json'));
  if (existsSync(labelPath)) continue;
  writeFileSync(labelPath, JSON.stringify(template, null, 2) + '\n');
  created++;
}
console.log(`Created ${created} empty label files in ${path.relative(root, labelDir)} (${files.length} READMEs total).`);
console.log('Fill each one by reading the README, then set "labeled": true. Rules: docs/LABELING.md');

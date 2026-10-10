import { describe, it, expect } from 'vitest';
import { extractLicense, detectContributing, detectTestsSection, computeSignals } from '../../src/extract/meta';
import { extractLinks } from '../../src/extract/links';
import { extractProjectInfo } from '../../src/extract/project';
import { computeHealthReport, orderedSuggestions, HEALTH_LABEL } from '../../src/health/score';
import { HEALTH_RULES, TOTAL_WEIGHT, type HealthRule } from '../../src/health/rules';
import { emptyIntelligence } from '../../src/analyze';
import type { Intelligence, ReadmeSignals, SourceRef } from '../../src/types';
import { ctxFor, md, PASTE } from '../helpers';

const license = (markdown: string) => {
  const ctx = ctxFor(markdown);
  return extractLicense(ctx, extractLinks(ctx, PASTE), extractProjectInfo(ctx, PASTE).badges);
};

describe('extractLicense', () => {
  it('names the license from the License section', () => {
    expect(license(md('## License', 'This project is licensed under the MIT License.'))?.value).toBe('MIT');
    expect(license(md('## Licence', 'Apache License 2.0'))?.value).toBe('Apache License 2.0');
    expect(license(md('## License', 'GPL-3.0-or-later'))?.value).toBe('GPL-3.0-or-later');
  });

  it('falls back to the first paragraph of the License section', () => {
    expect(license(md('## License', 'All rights reserved by Acme.'))?.value).toBe('All rights reserved by Acme.');
  });

  it('uses a LICENSE link when there is no section', () => {
    expect(license('Released under the [MIT license](https://github.com/a/b/blob/main/LICENSE).')?.value).toBe('MIT');
  });

  it('reads explicit licensing prose outside a License section', () => {
    expect(license('This project is dual-licensed under MIT or the Unlicense.')?.value).toBe('MIT');
  });

  it('uses a license badge as a last resort', () => {
    expect(license('![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD_3--Clause-blue.svg)')?.value).toMatch(/BSD/);
  });

  it('null when there is no license info', () => {
    expect(license(md('# App', 'Hello'))).toBeNull();
  });
});

describe('contributing / testing flags', () => {
  it('detects a Contributing section, link or file mention', () => {
    expect(detectContributing(ctxFor(md('## Contributing', 'PRs welcome')), [])).toBe(true);
    const ctx = ctxFor('[How to contribute](https://github.com/a/b/blob/main/CONTRIBUTING.md)');
    expect(detectContributing(ctx, extractLinks(ctx, PASTE))).toBe(true);
    expect(detectContributing(ctxFor('Read CONTRIBUTING.md first.'), [])).toBe(true);
    expect(detectContributing(ctxFor('# App'), [])).toBe(false);
  });

  it('detects a Testing section', () => {
    expect(detectTestsSection(ctxFor(md('## Running tests', 'x')))).toBe(true);
    expect(detectTestsSection(ctxFor('# App'))).toBe(false);
  });
});

describe('computeSignals', () => {
  it('env usage and "no env needed"', () => {
    expect(computeSignals(ctxFor('Copy `.env.example` to `.env`.')).envUsageMentioned).toBe(true);
    expect(computeSignals(ctxFor('No environment variables are required.')).statesNoEnvNeeded).toBe(true);
    expect(computeSignals(ctxFor('A pure library.')).envUsageMentioned).toBe(false);
  });

  it('section types, images and API signals', () => {
    const s = computeSignals(ctxFor(md('## Usage', '![shot](a.png)', '## API', 'x')));
    expect(s.sectionTypes).toEqual(['usage', 'api']);
    expect(s.nonBadgeImageCount).toBe(1);
    expect(s.apiSignals).toBe(true);
  });
});

const ref: SourceRef = { headingPath: [], line: 1 };
const ev = (value: string) => ({ value, source: ref, confidence: 'explicit' as const });
const noSignals: ReadmeSignals = { sectionTypes: [], nonBadgeImageCount: 0, envUsageMentioned: false, statesNoEnvNeeded: false, apiSignals: false };

function fullIntel(): Intelligence {
  const i = emptyIntelligence();
  i.project.name = ev('App');
  i.project.description = ev('A description that is definitely longer than forty characters.');
  i.features = [ev('a'), ev('b'), ev('c')];
  i.prerequisites = [ev('Node 20')];
  i.installSteps = [1, 2].map((order) => ({ order, title: null, commands: ['npm i'], text: '', source: ref, confidence: 'explicit' as const }));
  i.commands = [
    { command: 'npm run dev', category: 'dev', language: 'bash', source: ref, risky: false },
    { command: 'npm test', category: 'test', language: 'bash', source: ref, risky: false },
  ];
  i.envVars = [{ name: 'PORT', required: null, description: null, exampleValue: '3000', masked: false, source: ref }];
  i.techStack = ['A', 'B', 'C'].map((name) => ({ name, category: 'tooling' as const, evidence: [{ type: 'badge' as const, snippet: name, source: ref }], strength: 'strong' as const }));
  i.api = [{ method: 'GET', path: '/x', description: null, requestExample: null, responseExample: null, authRequired: null, source: ref }];
  i.deployment = { platforms: ['Vercel'], steps: [] };
  i.links = [{ url: 'https://x.vercel.app', text: 'demo', type: 'demo', source: ref }];
  i.license = ev('MIT');
  i.hasContributing = true;
  i.hasTestsSection = true;
  return i;
}

describe('health score', () => {
  it('weights sum to 100 and ids are unique', () => {
    expect(TOTAL_WEIGHT).toBe(100);
    expect(new Set(HEALTH_RULES.map((r) => r.id)).size).toBe(14);
  });

  it('a complete README scores 100', () => {
    const r = computeHealthReport(fullIntel(), noSignals);
    expect(r.score).toBe(100);
    expect(r.checks.every((c) => c.passed && c.suggestion === null)).toBe(true);
  });

  it('an empty README fails everything except the "not applicable" checks', () => {
    const r = computeHealthReport(emptyIntelligence(), noSignals);
    const passed = r.checks.filter((c) => c.passed).map((c) => c.id);
    expect(passed).toEqual(['H08', 'H14']);
    expect(r.score).toBe(13);
  });

  it.each([
    ['H01', (i: Intelligence) => void (i.project.name = null)],
    ['H02', (i: Intelligence) => void (i.project.description = ev('Too short'))],
    ['H03', (i: Intelligence) => void (i.features = [ev('a')])],
    ['H04', (i: Intelligence) => void (i.techStack = i.techStack.map((t) => ({ ...t, strength: 'weak' as const })))],
    ['H05', (i: Intelligence) => void (i.prerequisites = [])],
    ['H06', (i: Intelligence) => void ((i.installSteps = []), (i.commands = i.commands.filter((c) => c.category !== 'setup')))],
    ['H07', (i: Intelligence) => void (i.commands = i.commands.filter((c) => c.category !== 'dev'))],
    ['H09', (i: Intelligence) => void (i.links = [])],
    ['H10', (i: Intelligence) => void (i.license = null)],
    ['H11', (i: Intelligence) => void (i.hasContributing = false)],
    ['H12', (i: Intelligence) => void ((i.hasTestsSection = false), (i.commands = i.commands.filter((c) => c.category !== 'test')))],
    ['H13', (i: Intelligence) => void (i.deployment = { platforms: [], steps: [] })],
  ])('%s fails when its data is removed', (id, mutate) => {
    const intel = fullIntel();
    mutate(intel);
    const r = computeHealthReport(intel, noSignals);
    const check = r.checks.find((c) => c.id === id)!;
    expect(check.passed).toBe(false);
    expect(check.suggestion).toBeTruthy();
    expect(r.score).toBe(100 - check.weight);
  });

  it('H08: fails only when env usage is mentioned but nothing is documented', () => {
    const intel = fullIntel();
    intel.envVars = [];
    expect(computeHealthReport(intel, noSignals).checks.find((c) => c.id === 'H08')!.passed).toBe(true);
    expect(computeHealthReport(intel, { ...noSignals, envUsageMentioned: true }).checks.find((c) => c.id === 'H08')!.passed).toBe(false);
    expect(computeHealthReport(intel, { ...noSignals, envUsageMentioned: true, statesNoEnvNeeded: true }).checks.find((c) => c.id === 'H08')!.passed).toBe(true);
  });

  it('H14: fails only when API signals exist but no endpoints', () => {
    const intel = fullIntel();
    intel.api = [];
    expect(computeHealthReport(intel, noSignals).checks.find((c) => c.id === 'H14')!.passed).toBe(true);
    expect(computeHealthReport(intel, { ...noSignals, apiSignals: true }).checks.find((c) => c.id === 'H14')!.passed).toBe(false);
  });

  it('section signals can satisfy H04, H07, H10 and H13', () => {
    const intel = emptyIntelligence();
    const r = computeHealthReport(intel, { ...noSignals, sectionTypes: ['techstack', 'usage', 'license', 'deployment'] });
    expect(r.checks.filter((c) => c.passed).map((c) => c.id)).toEqual(['H04', 'H07', 'H08', 'H10', 'H13', 'H14']);
  });

  it('orders suggestions by weight', () => {
    const r = computeHealthReport(emptyIntelligence(), noSignals);
    const weights = orderedSuggestions(r).map((c) => c.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    expect(orderedSuggestions(r)[0]!.id).toBe('H06');
  });

  it('a throwing rule is reported as failed instead of crashing', () => {
    const bad: HealthRule = { id: 'X', label: 'x', weight: 100, suggestion: 's', evaluate: () => { throw new Error('boom'); } };
    const r = computeHealthReport(emptyIntelligence(), noSignals, [bad]);
    expect(r).toEqual({ score: 0, checks: [{ id: 'X', label: 'x', passed: false, weight: 100, reason: 'Check could not be evaluated.', suggestion: 's' }] });
  });

  it('exports the heuristic label', () => {
    expect(HEALTH_LABEL).toBe('Heuristic score. Based on the presence of common sections, not the quality of the content.');
  });
});

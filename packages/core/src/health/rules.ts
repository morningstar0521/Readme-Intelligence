import type { Intelligence, ReadmeSignals } from '../types';

/**
 * Health score rules (Extractor spec 4.11). Weights sum to 100.
 * Score = sum of the weights of passed checks.
 * Each rule returns a specific reason, and failed rules carry a concrete suggestion.
 */

export interface HealthInput {
  intelligence: Intelligence;
  signals: ReadmeSignals;
}

export interface HealthRule {
  id: string;
  label: string;
  weight: number;
  suggestion: string;
  evaluate(input: HealthInput): { passed: boolean; reason: string };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const HEALTH_RULES: HealthRule[] = [
  {
    id: 'H01',
    label: 'Project title',
    weight: 5,
    suggestion: 'Add a top-level heading with the project name, for example "# My Project".',
    evaluate: ({ intelligence }) => {
      const name = intelligence.project.name;
      if (name && name.confidence === 'explicit') return { passed: true, reason: `Title found: "${name.value}".` };
      if (name) return { passed: true, reason: `No h1 found, using the repository name "${name.value}".` };
      return { passed: false, reason: 'No h1 heading or repository name found.' };
    },
  },
  {
    id: 'H02',
    label: 'Description',
    weight: 10,
    suggestion: 'Add a one or two sentence description under the title that says what the project does and who it is for (40+ characters).',
    evaluate: ({ intelligence }) => {
      const d = intelligence.project.description;
      if (!d) return { passed: false, reason: 'No description paragraph found under the title.' };
      if (d.value.length < 40) return { passed: false, reason: `Description is only ${d.value.length} characters (needs 40).` };
      return { passed: true, reason: `Description found (${d.value.length} characters).` };
    },
  },
  {
    id: 'H03',
    label: 'Features listed',
    weight: 8,
    suggestion: 'Add a "Features" section with at least 3 bullet points describing what the project can do.',
    evaluate: ({ intelligence }) => {
      const n = intelligence.features.length;
      return n >= 3
        ? { passed: true, reason: `${plural(n, 'feature')} listed.` }
        : { passed: false, reason: n === 0 ? 'No Features section with list items found.' : `Only ${plural(n, 'feature')} listed (needs 3).` };
    },
  },
  {
    id: 'H04',
    label: 'Tech stack stated',
    weight: 8,
    suggestion: 'Add a "Tech Stack" section that lists the main languages, frameworks and databases.',
    evaluate: ({ intelligence, signals }) => {
      if (signals.sectionTypes.includes('techstack')) return { passed: true, reason: 'Tech stack section found.' };
      const strong = intelligence.techStack.filter((t) => t.strength === 'strong').length;
      return strong >= 3
        ? { passed: true, reason: `${plural(strong, 'technology')} backed by strong evidence (badges, commands, code).` }
        : { passed: false, reason: `No Tech stack section and only ${plural(strong, 'technology')} with strong evidence (needs 3).` };
    },
  },
  {
    id: 'H05',
    label: 'Prerequisites',
    weight: 7,
    suggestion: 'Add a "Prerequisites" section listing required tools and versions (for example Node.js 20+).',
    evaluate: ({ intelligence }) => {
      const n = intelligence.prerequisites.length;
      return n >= 1
        ? { passed: true, reason: `${plural(n, 'prerequisite')} listed.` }
        : { passed: false, reason: 'No prerequisites or required tool versions found.' };
    },
  },
  {
    id: 'H06',
    label: 'Installation steps',
    weight: 15,
    suggestion: 'Add an "Installation" section with numbered steps and the exact commands (clone, install dependencies, configure).',
    evaluate: ({ intelligence }) => {
      const steps = intelligence.installSteps.filter((s) => s.confidence === 'explicit').length;
      const setup = intelligence.commands.filter((c) => c.category === 'setup').length;
      if (steps >= 2) return { passed: true, reason: `${plural(steps, 'install step')} found.` };
      if (setup >= 2) return { passed: true, reason: `${plural(setup, 'setup command')} found.` };
      return { passed: false, reason: `Only ${plural(steps, 'install step')} and ${plural(setup, 'setup command')} found (needs 2).` };
    },
  },
  {
    id: 'H07',
    label: 'Usage section',
    weight: 10,
    suggestion: 'Add a "Usage" section that shows how to run the project (for example "npm run dev") with an example.',
    evaluate: ({ intelligence, signals }) => {
      if (signals.sectionTypes.includes('usage')) return { passed: true, reason: 'Usage section found.' };
      const dev = intelligence.commands.find((c) => c.category === 'dev');
      return dev
        ? { passed: true, reason: `Run command found: "${dev.command}".` }
        : { passed: false, reason: 'No Usage section and no run/dev command found.' };
    },
  },
  {
    id: 'H08',
    label: 'Environment variables documented',
    weight: 8,
    suggestion: 'Document every environment variable with its purpose and whether it is required (a table or a .env.example block).',
    evaluate: ({ intelligence, signals }) => {
      const n = intelligence.envVars.length;
      if (n >= 1) return { passed: true, reason: `${plural(n, 'environment variable')} documented.` };
      if (signals.statesNoEnvNeeded) return { passed: true, reason: 'README states that no environment variables are needed.' };
      if (!signals.envUsageMentioned) return { passed: true, reason: 'No environment variables are used, so nothing to document.' };
      return { passed: false, reason: 'The README mentions environment configuration but documents no variables.' };
    },
  },
  {
    id: 'H09',
    label: 'Screenshot or demo',
    weight: 6,
    suggestion: 'Add a screenshot, GIF or a link to a live demo so readers can see the project before installing it.',
    evaluate: ({ intelligence, signals }) => {
      if (signals.nonBadgeImageCount > 0) return { passed: true, reason: `${plural(signals.nonBadgeImageCount, 'image')} (not badges) found.` };
      const demo = intelligence.links.find((l) => l.type === 'demo' || l.type === 'video');
      return demo
        ? { passed: true, reason: `Demo link found: ${demo.url}` }
        : { passed: false, reason: 'No screenshot, GIF or demo link found.' };
    },
  },
  {
    id: 'H10',
    label: 'License',
    weight: 6,
    suggestion: 'Add a "License" section naming the license (for example MIT) and link to the LICENSE file.',
    evaluate: ({ intelligence, signals }) => {
      if (signals.sectionTypes.includes('license')) {
        return { passed: true, reason: intelligence.license ? `License section found (${intelligence.license.value}).` : 'License section found.' };
      }
      if (intelligence.license || intelligence.links.some((l) => l.type === 'license')) {
        return { passed: true, reason: `License reference found${intelligence.license ? ` (${intelligence.license.value})` : ''}.` };
      }
      return { passed: false, reason: 'No license section, LICENSE link or license badge found.' };
    },
  },
  {
    id: 'H11',
    label: 'Contributing info',
    weight: 4,
    suggestion: 'Add a "Contributing" section or link to CONTRIBUTING.md explaining how to propose changes.',
    evaluate: ({ intelligence }) =>
      intelligence.hasContributing
        ? { passed: true, reason: 'Contributing section or link found.' }
        : { passed: false, reason: 'No contributing section or CONTRIBUTING link found.' },
  },
  {
    id: 'H12',
    label: 'Testing instructions',
    weight: 5,
    suggestion: 'Add a "Testing" section with the command to run the tests (for example "npm test").',
    evaluate: ({ intelligence }) => {
      if (intelligence.hasTestsSection) return { passed: true, reason: 'Testing section found.' };
      const test = intelligence.commands.find((c) => c.category === 'test');
      return test
        ? { passed: true, reason: `Test command found: "${test.command}".` }
        : { passed: false, reason: 'No testing section or test command found.' };
    },
  },
  {
    id: 'H13',
    label: 'Deployment info',
    weight: 3,
    suggestion: 'Add a "Deployment" section that explains where and how the project is deployed (for example Vercel or Docker).',
    evaluate: ({ intelligence, signals }) => {
      if (signals.sectionTypes.includes('deployment')) return { passed: true, reason: 'Deployment section found.' };
      if (intelligence.deployment.platforms.length > 0) {
        return { passed: true, reason: `Deploy platform found: ${intelligence.deployment.platforms.join(', ')}.` };
      }
      return { passed: false, reason: 'No deployment section or deploy platform found.' };
    },
  },
  {
    id: 'H14',
    label: 'API docs when applicable',
    weight: 5,
    suggestion: 'The README mentions an API. List the endpoints with method, path, a short description and an example request.',
    evaluate: ({ intelligence, signals }) => {
      const n = intelligence.api.length;
      if (n > 0) return { passed: true, reason: `${plural(n, 'API endpoint')} documented.` };
      if (!signals.apiSignals) return { passed: true, reason: 'No API signals found, so API docs are not needed.' };
      return { passed: false, reason: 'The README mentions an API but documents no endpoints.' };
    },
  },
];

export const TOTAL_WEIGHT = HEALTH_RULES.reduce((sum, r) => sum + r.weight, 0);

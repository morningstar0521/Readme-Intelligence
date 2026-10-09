import { describe, it, expect } from 'vitest';
import { extractTechStack } from '../../src/extract/techstack';
import { extractCommands } from '../../src/extract/commands';
import { TECH_DICTIONARY, canonicalTechName } from '../../src/extract/techDictionary';
import { ctxFor, md } from '../helpers';

const fence = (lang: string, ...lines: string[]) => md('```' + lang, ...lines, '```');
const tech = (markdown: string) => {
  const ctx = ctxFor(markdown);
  return extractTechStack(ctx, extractCommands(ctx));
};
const techNames = (markdown: string) => tech(markdown).map((t) => t.name);

describe('tech dictionary', () => {
  it('has at least 150 technologies', () => {
    expect(TECH_DICTIONARY.length).toBeGreaterThanOrEqual(150);
  });

  it('has unique canonical names', () => {
    const names = TECH_DICTIONARY.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('canonicalTechName maps aliases', () => {
    expect(canonicalTechName('postgres')).toBe('PostgreSQL');
    expect(canonicalTechName('nextjs')).toBe('Next.js');
    expect(canonicalTechName('Nope')).toBeNull();
  });
});

describe('extractTechStack', () => {
  it('reads a Tech Stack list', () => {
    expect(techNames(md('## Tech Stack', '- Next.js', '- PostgreSQL', '- Tailwind CSS'))).toEqual(['Next.js', 'Tailwind CSS', 'PostgreSQL']);
  });

  it('reads Tech Stack tables without gluing cells', () => {
    expect(techNames(md('## Built With', '', '| Layer | Tech |', '|---|---|', '| Database | PostgreSQL |', '| Backend | Node.js |'))).toEqual(['Node.js', 'PostgreSQL']);
  });

  it('matches whole words only', () => {
    expect(techNames('This is a reactive, expressive system built on gopher tunnels.')).toEqual([]);
  });

  it('does not double count overlapping names', () => {
    expect(techNames(md('## Tech Stack', '- Tailwind CSS', '- React Native'))).toEqual(['Tailwind CSS', 'React Native']);
  });

  it('detects technologies from badges', () => {
    const t = tech('![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript) ![x](https://img.shields.io/badge/-black?logo=nextdotjs)');
    expect(t.map((x) => x.name)).toEqual(['TypeScript', 'Next.js']);
    expect(t[0]!.evidence[0]!.type).toBe('badge');
  });

  it('detects languages from code block tags', () => {
    expect(techNames(md(fence('python', 'print(1)'), fence('rust', 'fn main() {}')))).toEqual(['Python', 'Rust']);
  });

  it('detects frameworks from imports in code', () => {
    expect(techNames(fence('', 'from fastapi import FastAPI'))).toContain('FastAPI');
  });

  it('detects technologies from commands', () => {
    const names = techNames(fence('bash', 'docker compose up', 'npx prisma migrate dev', 'uvicorn main:app'));
    expect(names).toEqual(expect.arrayContaining(['Docker', 'Docker Compose', 'Prisma', 'FastAPI']));
  });

  it('ambiguous words need a tech stack section or a strong signal', () => {
    expect(techNames('Go to the settings page and express your rust-free thoughts.')).toEqual([]);
    expect(techNames(md('## Tech Stack', '- Go', '- Express'))).toEqual(['Go', 'Express']);
  });

  it('drops weak-only items when a Tech Stack section exists', () => {
    const names = techNames(md('## Tech Stack', '- Django', '', '## Notes', '', 'We once tried Laravel.'));
    expect(names).toEqual(['Django']);
  });

  it('does not promote generic package and hosting mentions without strong evidence', () => {
    const names = techNames('Install with npm and deploy to Vercel. GitHub Actions runs the checks.');
    expect(names).not.toEqual(expect.arrayContaining(['npm', 'Vercel', 'GitHub Actions']));
  });

  it('does not treat workflow tooling in commands as the project stack', () => {
    const names = techNames(fence('bash', 'npm install', 'git clone https://example.com/app.git', 'make build', 'pnpm test'));
    for (const name of ['npm', 'Git', 'Make', 'pnpm']) expect(names).not.toContain(name);
  });

  it('keeps explicitly declared workflow tooling in a Tech Stack section', () => {
    const names = techNames(md('## Tech Stack', '- npm', '- GitHub Actions', '- GNU Make'));
    expect(names).toEqual(expect.arrayContaining(['npm', 'GitHub Actions', 'Make']));
  });

  it('keeps technologies named in explicit project-context prose', () => {
    expect(techNames('This project is written in Rust and uses PostgreSQL.')).toEqual(['Rust', 'PostgreSQL']);
  });

	it('recognizes named tools in project-context prose', () => {
		expect(techNames('The app uses React Router and the AI SDK.')).toEqual(['React Router', 'AI SDK']);
	});

	it('detects technologies from package-style install commands', () => {
		expect(techNames(fence('bash', 'pip install llama-index fastapi', 'npm install @supabase/supabase-js'))).toEqual(
			expect.arrayContaining(['LlamaIndex', 'FastAPI', 'Supabase'])
		);
	});

	it('detects technologies from package imports', () => {
		expect(techNames(fence('typescript', "import { createClient } from '@supabase/supabase-js';"))).toContain('Supabase');
	});

	it('detects technologies from bare Python and Go imports', () => {
		const names = techNames(fence('python', 'import torch', 'from openai import OpenAI') + '\n' + fence('go', 'import "github.com/spf13/cobra"'));
		expect(names).toEqual(expect.arrayContaining(['PyTorch', 'OpenAI', 'Cobra']));
	});

	it('detects technologies from versioned Go package installs', () => {
		expect(techNames(fence('bash', 'go get -u github.com/spf13/cobra@latest', 'go install github.com/gohugoio/hugo@latest'))).toEqual(
			expect.arrayContaining(['Cobra', 'Hugo'])
		);
	});

	it('does not treat integrations and supported platforms as implementation stack', () => {
		const names = techNames('This project uses React and integrates with Sentry. It supports Vercel deployments and exports to AWS.');
		expect(names).toContain('React');
		expect(names).not.toEqual(expect.arrayContaining(['Sentry', 'Vercel', 'AWS']));
	});

	it('does not treat SDK and quick-start catalogs as implementation stack', () => {
		const names = techNames('- Quick start for Node.js\n- Python SDK\n- Kotlin client\n- Supported platforms: AWS and Azure');
		expect(names).toEqual([]);
	});

	it('filters noun-form integration and community mentions', () => {
		const names = techNames('The project has integrations for OpenAI and Ollama, plus community-maintained React packages.');
		expect(names).toEqual([]);
	});

	it('recognizes explicit built-for implementation statements', () => {
		expect(techNames('This editor is built for React applications.')).toContain('React');
	});

	it('requires stronger evidence for HTML and CSS prose mentions', () => {
		expect(techNames('The documentation renders HTML and CSS examples.')).toEqual([]);
	});

  it('keeps weak prose mentions when there is no Tech Stack section', () => {
    const t = tech('This app uses Django and Redis.');
    expect(t.map((x) => [x.name, x.strength])).toEqual([
      ['Django', 'weak'],
      ['Redis', 'weak'],
    ]);
  });

  it('every item has evidence with a source line', () => {
    const t = tech(md('# A', '', '## Tech Stack', '', '- Vue'));
    expect(t[0]!.evidence[0]).toMatchObject({ type: 'text', source: { line: 5 } });
    expect(t[0]!.strength).toBe('strong');
  });

  it('headings count as strong evidence', () => {
    expect(tech(md('## Running with Docker', 'text'))[0]).toMatchObject({ name: 'Docker', strength: 'strong' });
  });

  it('returns [] for empty input', () => {
    expect(tech('')).toEqual([]);
  });
});

#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeReadme, type AnalysisResult, type Intelligence } from '@readme-intel/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

type Format = 'text' | 'md' | 'json';

interface Args {
  file: string;
  format: Format;
}

function usage(message?: string): never {
  if (message) console.error(`readme-intel: ${message}\n`);
  console.error('Usage: readme-intel <README.md> [--format text|md|json]');
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  let file = 'README.md';
  let format: Format = 'text';
  let positional = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: readme-intel <README.md> [--format text|md|json]');
      process.exit(0);
    }
    if (arg === '--version' || arg === '-v') {
      console.log(pkg.version);
      process.exit(0);
    }
    if (arg === '--format') {
      const value = argv[++i];
      if (value !== 'text' && value !== 'md' && value !== 'json') usage(`unknown format "${value ?? ''}"`);
      format = value;
      continue;
    }
    if (arg.startsWith('--')) usage(`unknown option ${arg}`);
    if (positional) usage('only one README path is supported');
    file = arg;
    positional = true;
  }
  return { file, format };
}

function readmePath(file: string): string {
  const resolved = resolve(process.cwd(), file);
  try {
    return readFileSync(resolved, 'utf8');
  } catch {
    usage(`cannot read ${file}`);
  }
}

function sourceFor(file: string) {
  return { kind: 'local' as const, fileName: basename(file) };
}

function jsonReport(result: AnalysisResult, file: string): string {
  return JSON.stringify({ file, intelligence: result.intelligence, health: result.health, warnings: result.warnings }, null, 2);
}

function sourceLine(line: number): string {
  return line > 0 ? ` (README:${line})` : '';
}

function markdownReport(intelligence: Intelligence, health: AnalysisResult['health']): string {
  const lines = ['# README Intelligence', '', `Documentation health: **${health.score}/100**`, ''];
  const section = (title: string, items: string[]) => {
    lines.push(`## ${title}`, '', ...(items.length ? items.map((item) => `- ${item}`) : ['Not found in README']), '');
  };
  section('Commands', intelligence.commands.map((item) => `\`${item.command}\` - ${item.category}${sourceLine(item.source.line)}`));
  section('Environment variables', intelligence.envVars.map((item) => `\`${item.name}\`${item.required === true ? ' (required)' : ''}${sourceLine(item.source.line)}`));
  section('Tech stack', intelligence.techStack.map((item) => `${item.name} - ${item.category}${sourceLine(item.evidence[0]?.source.line ?? 0)}`));
  section('API endpoints', intelligence.api.map((item) => `\`${item.method} ${item.path}\`${sourceLine(item.source.line)}`));
  return lines.join('\n');
}

function textReport(result: AnalysisResult): string {
  const i = result.intelligence;
  const lines = [
    `README Intelligence: ${i.project.name?.value ?? 'Unnamed project'}`,
    `Health: ${result.health.score}/100`,
    `Commands: ${i.commands.length}`,
    `Environment variables: ${i.envVars.length}`,
    `Tech stack evidence: ${i.techStack.length}`,
    `API endpoints: ${i.api.length}`,
  ];
  if (i.commands.length) lines.push('', 'Commands:', ...i.commands.map((item) => `  ${item.command}${sourceLine(item.source.line)}`));
  if (result.warnings.length) lines.push('', `Warnings: ${result.warnings.length}`);
  return lines.join('\n');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const markdown = readmePath(args.file);
  const result = analyzeReadme(markdown, sourceFor(args.file));
  if (args.format === 'json') console.log(jsonReport(result, args.file));
  else if (args.format === 'md') console.log(markdownReport(result.intelligence, result.health));
  else console.log(textReport(result));
}

main();

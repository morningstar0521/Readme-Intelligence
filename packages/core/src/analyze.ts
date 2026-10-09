import type { Root as HastRoot } from 'hast';
import type { ZodType } from 'zod';
import type {
  HeadingInfo,
  HealthReport,
  Intelligence,
  ReadmeSignals,
  SearchEntry,
  SectionInfo,
  SourceInfo,
  TocItem,
} from './types';
import { parseMarkdown } from './parse/parseMarkdown';
import { buildToc } from './parse/toc';
import { renderMdast } from './render/pipeline';
import { buildContext } from './extract/context';
import { extractProjectInfo } from './extract/project';
import { extractFeatures } from './extract/features';
import { extractCommands } from './extract/commands';
import { extractEnvVars } from './extract/env';
import { extractTechStack } from './extract/techstack';
import { extractApiEndpoints } from './extract/api';
import { extractDeployment } from './extract/deploy';
import { extractLinks } from './extract/links';
import { extractInstallSteps, extractPrerequisites } from './extract/install';
import { computeSignals, detectContributing, detectTestsSection, extractLicense } from './extract/meta';
import { computeHealthReport } from './health/score';
import { buildSearchIndex } from './search/buildIndex';
import {
  ApiEndpointSchema,
  CommandItemSchema,
  DeploymentInfoSchema,
  EnvVarItemSchema,
  EvidencedStringSchema,
  HealthReportSchema,
  InstallStepSchema,
  IntelligenceSchema,
  LinkItemSchema,
  ProjectInfoSchema,
  TechItemSchema,
} from './schemas';
import { z } from 'zod';

/**
 * One call that turns Markdown into everything the UI needs.
 * Sync, pure, no network. Every extractor is wrapped so that a bug or malformed input
 * yields an empty result and a warning instead of an exception.
 */

export interface AnalysisResult {
  source: SourceInfo;
  intelligence: Intelligence;
  health: HealthReport;
  signals: ReadmeSignals;
  toc: TocItem[];
  headings: HeadingInfo[];
  sections: SectionInfo[];
  searchIndex: SearchEntry[];
  hast: HastRoot;
  warnings: string[];
  stats: {
    lines: number;
    bytes: number;
    parseMs: number;
    renderMs: number;
    extractMs: number;
    totalMs: number;
  };
}

export interface AnalyzeOptions {
  /** Skip building the hast (used by the evaluator, which only needs extraction). */
  skipRender?: boolean;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Run an extractor, validate with Zod, fall back on error. Never throws. */
export function safeExtract<T>(name: string, fn: () => T, schema: ZodType<T>, fallback: T, warnings: string[]): T {
  try {
    const value = fn();
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    warnings.push(`Extractor "${name}" produced invalid output and was skipped.`);
    return fallback;
  } catch {
    warnings.push(`Extractor "${name}" failed and was skipped.`);
    return fallback;
  }
}

export function emptyIntelligence(): Intelligence {
  return {
    project: { name: null, description: null, badges: [] },
    features: [],
    prerequisites: [],
    installSteps: [],
    commands: [],
    envVars: [],
    techStack: [],
    api: [],
    deployment: { platforms: [], steps: [] },
    links: [],
    license: null,
    hasContributing: false,
    hasTestsSection: false,
  };
}

export function analyzeReadme(markdown: string, source: SourceInfo, options: AnalyzeOptions = {}): AnalysisResult {
  const t0 = now();
  const parsed = parseMarkdown(markdown);
  const warnings = [...parsed.warnings];
  const t1 = now();

  const rendered = options.skipRender
    ? { hast: { type: 'root', children: [] } as HastRoot, headings: [] as HeadingInfo[] }
    : renderMdast(parsed.mdast, source);
  const t2 = now();

  const ctx = buildContext(parsed.mdast, rendered.headings);

  const project = safeExtract('project', () => extractProjectInfo(ctx, source), ProjectInfoSchema, emptyIntelligence().project, warnings);
  const features = safeExtract('features', () => extractFeatures(ctx), z.array(EvidencedStringSchema), [], warnings);
  const commands = safeExtract('commands', () => extractCommands(ctx), z.array(CommandItemSchema), [], warnings);
  const prerequisites = safeExtract('prerequisites', () => extractPrerequisites(ctx), z.array(EvidencedStringSchema), [], warnings);
  const installSteps = safeExtract('installSteps', () => extractInstallSteps(ctx, commands), z.array(InstallStepSchema), [], warnings);
  const envVars = safeExtract('envVars', () => extractEnvVars(ctx), z.array(EnvVarItemSchema), [], warnings);
  const techStack = safeExtract('techStack', () => extractTechStack(ctx, commands), z.array(TechItemSchema), [], warnings);
  const api = safeExtract('api', () => extractApiEndpoints(ctx), z.array(ApiEndpointSchema), [], warnings);
  const deployment = safeExtract('deployment', () => extractDeployment(ctx, commands), DeploymentInfoSchema, { platforms: [], steps: [] }, warnings);
  const links = safeExtract('links', () => extractLinks(ctx, source), z.array(LinkItemSchema), [], warnings);
  const license = safeExtract('license', () => extractLicense(ctx, links, project.badges), EvidencedStringSchema.nullable(), null, warnings);
  const hasContributing = safeExtract('contributing', () => detectContributing(ctx, links), z.boolean(), false, warnings);
  const hasTestsSection = safeExtract('testing', () => detectTestsSection(ctx), z.boolean(), false, warnings);

  const intelligence = safeExtract(
    'intelligence',
    (): Intelligence => ({
      project,
      features,
      prerequisites,
      installSteps,
      commands,
      envVars,
      techStack,
      api,
      deployment,
      links,
      license,
      hasContributing,
      hasTestsSection,
    }),
    IntelligenceSchema,
    emptyIntelligence(),
    warnings
  );

  let signals: ReadmeSignals;
  try {
    signals = computeSignals(ctx);
  } catch {
    signals = { sectionTypes: [], nonBadgeImageCount: 0, envUsageMentioned: false, statesNoEnvNeeded: false, apiSignals: false };
  }

  const health = safeExtract('health', () => computeHealthReport(intelligence, signals), HealthReportSchema, { score: 0, checks: [] }, warnings);

  let searchIndex: SearchEntry[] = [];
  try {
    searchIndex = buildSearchIndex(ctx, rendered.headings, intelligence);
  } catch {
    warnings.push('Search index could not be built.');
  }

  const t3 = now();
  return {
    source,
    intelligence,
    health,
    signals,
    toc: buildToc(rendered.headings),
    headings: rendered.headings,
    sections: ctx.sections,
    searchIndex,
    hast: rendered.hast,
    warnings,
    stats: {
      lines: parsed.markdown === '' ? 0 : parsed.markdown.split('\n').length,
      bytes: new TextEncoder().encode(parsed.markdown).length,
      parseMs: t1 - t0,
      renderMs: t2 - t1,
      extractMs: t3 - t2,
      totalMs: t3 - t0,
    },
  };
}

/** JSON export of all extracted intelligence (env values are already masked). */
export function exportIntelligenceJson(result: Pick<AnalysisResult, 'source' | 'intelligence' | 'health'>): string {
  return JSON.stringify(
    {
      generatedBy: 'README Intelligence Viewer',
      source: result.source,
      intelligence: result.intelligence,
      health: result.health,
    },
    null,
    2
  );
}

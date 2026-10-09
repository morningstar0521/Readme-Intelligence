/**
 * Shared types for the README Intelligence engine.
 * These mirror Document 3.3 of the PRD. Extensions are marked with "EXT".
 */

export type SourceInfo =
  | {
      kind: 'github';
      owner: string;
      repo: string;
      ref: string;
      path: string;
      rawBase: string;
      htmlUrl: string;
    }
  | { kind: 'local'; fileName: string }
  | { kind: 'paste' };

export interface SourceRef {
  /** e.g. ["Installation", "Docker"] */
  headingPath: string[];
  /** 1-based line in the README */
  line: number;
  /** slug of nearest heading */
  anchor?: string;
}

export type Confidence = 'explicit' | 'inferred-rule';

export interface Evidenced<T> {
  value: T;
  source: SourceRef;
  confidence: Confidence;
}

export interface TocItem {
  id: string;
  text: string;
  depth: 1 | 2 | 3 | 4;
  line: number;
}

export interface Badge {
  alt: string;
  imageUrl: string;
  linkUrl?: string;
  line: number;
}

export interface ProjectInfo {
  name: Evidenced<string> | null;
  description: Evidenced<string> | null;
  badges: Badge[];
}

export type CommandCategory =
  | 'setup'
  | 'dev'
  | 'build'
  | 'test'
  | 'lint'
  | 'deploy'
  | 'docker'
  | 'database'
  | 'other';

export interface CommandItem {
  command: string;
  category: CommandCategory;
  /** bash, sh, powershell, etc. null for inline code or unlabeled blocks */
  language: string | null;
  source: SourceRef;
  /** EXT: true when the command contains sudo, rm -rf, curl | sh or chmod 777 */
  risky: boolean;
}

export interface EnvVarItem {
  name: string;
  /** null when README does not say */
  required: boolean | null;
  description: string | null;
  /** masked ("••••••••") if it looks like a secret */
  exampleValue: string | null;
  masked: boolean;
  source: SourceRef;
}

export type TechCategory =
  | 'language'
  | 'frontend'
  | 'backend'
  | 'database'
  | 'auth'
  | 'ai-ml'
  | 'cloud'
  | 'devops'
  | 'testing'
  | 'tooling';

export type TechEvidenceType = 'badge' | 'text' | 'code' | 'command' | 'heading';

export interface TechEvidence {
  type: TechEvidenceType;
  snippet: string;
  source: SourceRef;
}

export interface TechItem {
  /** canonical name, e.g. "Next.js" */
  name: string;
  category: TechCategory;
  evidence: TechEvidence[];
  /** EXT: strong = badge, command, code, heading or tech stack section. weak = passing prose mention */
  strength: 'strong' | 'weak';
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface ApiEndpoint {
  method: HttpMethod;
  path: string;
  description: string | null;
  requestExample: string | null;
  responseExample: string | null;
  authRequired: boolean | null;
  source: SourceRef;
}

export type LinkType = 'repo' | 'demo' | 'docs' | 'video' | 'issues' | 'chat' | 'license' | 'other';

export interface LinkItem {
  url: string;
  text: string;
  type: LinkType;
  source: SourceRef;
}

export interface HealthCheck {
  id: string;
  label: string;
  passed: boolean;
  weight: number;
  /** why it passed or failed */
  reason: string;
  suggestion: string | null;
}

export interface HealthReport {
  score: number;
  checks: HealthCheck[];
}

export interface InstallStep {
  order: number;
  title: string | null;
  commands: string[];
  text: string;
  source: SourceRef;
  /** EXT: "inferred-rule" for the fallback group built from setup commands outside an install section */
  confidence: Confidence;
}

export interface DeploymentInfo {
  platforms: string[];
  steps: Evidenced<string>[];
}

export interface Intelligence {
  project: ProjectInfo;
  features: Evidenced<string>[];
  prerequisites: Evidenced<string>[];
  installSteps: InstallStep[];
  commands: CommandItem[];
  envVars: EnvVarItem[];
  techStack: TechItem[];
  api: ApiEndpoint[];
  deployment: DeploymentInfo;
  links: LinkItem[];
  license: Evidenced<string> | null;
  hasContributing: boolean;
  hasTestsSection: boolean;
}

export type SectionType =
  | 'overview'
  | 'features'
  | 'techstack'
  | 'prerequisites'
  | 'installation'
  | 'usage'
  | 'configuration'
  | 'api'
  | 'testing'
  | 'deployment'
  | 'structure'
  | 'contributing'
  | 'license'
  | 'roadmap';

/** EXT: one detected section, used by the "Sections found" list and the health scorer. */
export interface SectionInfo {
  text: string;
  depth: number;
  line: number;
  anchor?: string;
  /** type matched by this heading's own text */
  ownType: SectionType | null;
  /** own type, or inherited from the parent heading */
  type: SectionType | null;
}

/** EXT: document-level signals the health scorer needs that are not part of Intelligence. */
export interface ReadmeSignals {
  sectionTypes: SectionType[];
  nonBadgeImageCount: number;
  /** README talks about env vars / .env / process.env anywhere */
  envUsageMentioned: boolean;
  /** README explicitly says no environment variables are needed */
  statesNoEnvNeeded: boolean;
  /** API section, HTTP verb + path patterns or "REST API" style phrases */
  apiSignals: boolean;
}

export type SearchEntryKind =
  | 'section'
  | 'paragraph'
  | 'code'
  | 'command'
  | 'env'
  | 'tech'
  | 'feature';

export interface SearchEntry {
  id: string;
  kind: SearchEntryKind;
  title: string;
  text: string;
  line: number;
  anchor?: string;
}

export interface HeadingInfo {
  id: string;
  text: string;
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  line: number;
}

export type GitHubErrorCode =
  | 'INVALID_URL'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'PRIVATE_OR_FORBIDDEN'
  | 'NETWORK'
  | 'TOO_LARGE'
  | 'UNKNOWN';

export type AppErrorCode = GitHubErrorCode | 'PARSE_FAILURE';

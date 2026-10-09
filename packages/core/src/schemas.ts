import { z } from 'zod';

/**
 * Zod schemas that mirror types.ts. Every extractor output is validated against these
 * before it reaches the UI, and the GitHub API response is validated on the client.
 */

export const SourceRefSchema = z.object({
  headingPath: z.array(z.string()),
  line: z.number().int().nonnegative(),
  anchor: z.string().optional(),
});

export const ConfidenceSchema = z.enum(['explicit', 'inferred-rule']);

export const evidenced = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value, source: SourceRefSchema, confidence: ConfidenceSchema });

export const EvidencedStringSchema = evidenced(z.string().min(1));

export const SourceInfoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('github'),
    owner: z.string().min(1),
    repo: z.string().min(1),
    ref: z.string().min(1),
    path: z.string(),
    rawBase: z.string().url(),
    htmlUrl: z.string().url(),
  }),
  z.object({ kind: z.literal('local'), fileName: z.string() }),
  z.object({ kind: z.literal('paste') }),
]);

export const BadgeSchema = z.object({
  alt: z.string(),
  imageUrl: z.string().min(1),
  linkUrl: z.string().optional(),
  line: z.number().int().nonnegative(),
});

export const ProjectInfoSchema = z.object({
  name: EvidencedStringSchema.nullable(),
  description: EvidencedStringSchema.nullable(),
  badges: z.array(BadgeSchema),
});

export const CommandCategorySchema = z.enum([
  'setup',
  'dev',
  'build',
  'test',
  'lint',
  'deploy',
  'docker',
  'database',
  'other',
]);

export const CommandItemSchema = z.object({
  command: z.string().min(1),
  category: CommandCategorySchema,
  language: z.string().nullable(),
  source: SourceRefSchema,
  risky: z.boolean(),
});

export const EnvVarItemSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  required: z.boolean().nullable(),
  description: z.string().nullable(),
  exampleValue: z.string().nullable(),
  masked: z.boolean(),
  source: SourceRefSchema,
});

export const TechCategorySchema = z.enum([
  'language',
  'frontend',
  'backend',
  'database',
  'auth',
  'ai-ml',
  'cloud',
  'devops',
  'testing',
  'tooling',
]);

export const TechItemSchema = z.object({
  name: z.string().min(1),
  category: TechCategorySchema,
  evidence: z
    .array(
      z.object({
        type: z.enum(['badge', 'text', 'code', 'command', 'heading']),
        snippet: z.string(),
        source: SourceRefSchema,
      })
    )
    .min(1, 'A technology with no evidence must not be returned'),
  strength: z.enum(['strong', 'weak']),
});

export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

export const ApiEndpointSchema = z.object({
  method: HttpMethodSchema,
  path: z.string().min(1),
  description: z.string().nullable(),
  requestExample: z.string().nullable(),
  responseExample: z.string().nullable(),
  authRequired: z.boolean().nullable(),
  source: SourceRefSchema,
});

export const LinkItemSchema = z.object({
  url: z.string().min(1),
  text: z.string(),
  type: z.enum(['repo', 'demo', 'docs', 'video', 'issues', 'chat', 'license', 'other']),
  source: SourceRefSchema,
});

export const InstallStepSchema = z.object({
  order: z.number().int().positive(),
  title: z.string().nullable(),
  commands: z.array(z.string()),
  text: z.string(),
  source: SourceRefSchema,
  confidence: ConfidenceSchema,
});

export const DeploymentInfoSchema = z.object({
  platforms: z.array(z.string()),
  steps: z.array(EvidencedStringSchema),
});

export const IntelligenceSchema = z.object({
  project: ProjectInfoSchema,
  features: z.array(EvidencedStringSchema),
  prerequisites: z.array(EvidencedStringSchema),
  installSteps: z.array(InstallStepSchema),
  commands: z.array(CommandItemSchema),
  envVars: z.array(EnvVarItemSchema),
  techStack: z.array(TechItemSchema),
  api: z.array(ApiEndpointSchema),
  deployment: DeploymentInfoSchema,
  links: z.array(LinkItemSchema),
  license: EvidencedStringSchema.nullable(),
  hasContributing: z.boolean(),
  hasTestsSection: z.boolean(),
});

export const HealthCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  passed: z.boolean(),
  weight: z.number().int().nonnegative(),
  reason: z.string(),
  suggestion: z.string().nullable(),
});

export const HealthReportSchema = z.object({
  score: z.number().int().min(0).max(100),
  checks: z.array(HealthCheckSchema),
});

export const GitHubErrorCodeSchema = z.enum([
  'INVALID_URL',
  'NOT_FOUND',
  'RATE_LIMITED',
  'PRIVATE_OR_FORBIDDEN',
  'NETWORK',
  'TOO_LARGE',
  'UNKNOWN',
]);

/** Shape returned by GET /api/github/readme. */
export const GitHubReadmeResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    markdown: z.string(),
    source: SourceInfoSchema,
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: GitHubErrorCodeSchema,
      message: z.string(),
      resetAt: z.string().nullable().optional(),
    }),
  }),
]);

export type GitHubReadmeResponse = z.infer<typeof GitHubReadmeResponseSchema>;

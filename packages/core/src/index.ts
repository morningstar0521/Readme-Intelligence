// Public API of @readme-intel/core. Pure TypeScript: no DOM, no React.

export * from './types';
export * from './schemas';

export { analyzeReadme, exportIntelligenceJson, emptyIntelligence, safeExtract } from './analyze';
export type { AnalysisResult, AnalyzeOptions } from './analyze';

export { parseMarkdown, preprocessMarkdown, MAX_INPUT_BYTES, MAX_LIST_DEPTH } from './parse/parseMarkdown';
export { createSlugger, slugify } from './parse/slug';
export { buildToc } from './parse/toc';

export { renderMdast, renderToHtml, hastToHtml } from './render/pipeline';
export { resolveUrl, resolveSrcSet, getScheme, isSafeDataImage } from './render/resolveUrls';
export { sanitizeSchema } from './render/sanitizeSchema';
export { ALERT_TYPES } from './render/alerts';
export type { AlertType } from './render/alerts';

export { classifySection, normalizeHeadingText } from './extract/section-classifier';
export { buildContext } from './extract/context';
export { extractProjectInfo, isBadgeUrl } from './extract/project';
export { extractFeatures } from './extract/features';
export { extractCommands, categorizeCommand, isRiskyCommand, parseCommandLines, isCommandLine } from './extract/commands';
export { extractEnvVars, maskValue, MASK, isPlaceholderValue, looksLikeSecretValue } from './extract/env';
export { extractTechStack } from './extract/techstack';
export { TECH_DICTIONARY, canonicalTechName } from './extract/techDictionary';
export { extractApiEndpoints } from './extract/api';
export { extractDeployment } from './extract/deploy';
export { extractLinks, classifyLink } from './extract/links';
export { extractInstallSteps, extractPrerequisites } from './extract/install';
export { extractLicense, computeSignals } from './extract/meta';

export { computeHealthReport, orderedSuggestions, HEALTH_LABEL } from './health/score';
export { HEALTH_RULES, TOTAL_WEIGHT } from './health/rules';

export { buildSearchIndex } from './search/buildIndex';

export { parseGitHubInput, parseGitHubUrl, INVALID_URL_MESSAGE, ALLOWED_FETCH_HOSTS } from './github/parseUrl';
export type { GitHubTarget, ParseGitHubResult } from './github/parseUrl';
export { computeRawBase, buildGitHubSource } from './github/rawBase';
export { fetchGitHubReadme, cacheKeyFor, decodeBase64Utf8 } from './github/fetchReadme';
export type { FetchReadmeResult, FetchReadmeOptions } from './github/fetchReadme';

export { errorMessage, errorCopy, formatResetTime } from './errors';
export { LruCache } from './util/lru';

// Repository Reality Check
export * from './repo/types';
export { selectRepoFiles, MAX_FILES, LOCKFILES } from './repo/select';
export { extractRepoFacts, blobUrl } from './repo/facts';
export { checkRepository, scriptReference, referencedPaths, licenseFamily, TECH_SIGNALS } from './repo/checks';
export type { RealityInput } from './repo/checks';
export { computeReadiness, READINESS_RULES, READINESS_TOTAL_WEIGHT, READINESS_LABEL } from './repo/readiness';
export { fetchRepoSnapshot, validRepoTarget, RepoSnapshotSchema, RepoSnapshotResponseSchema } from './repo/fetchRepo';
export type { FetchRepoResult, FetchRepoOptions } from './repo/fetchRepo';
export { minVersion } from './repo/parsers';
export { buildLocalSnapshot } from './repo/local';
export type { LocalSnapshotInput } from './repo/local';
export { diffRealityReports, shouldFail, renderRealityMarkdown, renderRealityText, DRIFT_COMMENT_MARKER } from './repo/drift';
export type { RealityDiff, StatusChange, FailOn, RenderOptions } from './repo/drift';

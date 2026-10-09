import type { AppErrorCode } from './types';

/**
 * User-facing error copy (UI spec 7.5). Exact strings from the PRD where given.
 * No stack traces are ever shown.
 */

export interface ErrorCopy {
  title: string;
  message: string;
  causes: string[];
}

/** Format an ISO timestamp as a short local time, e.g. "14:05". */
export function formatResetTime(iso: string | null | undefined, locale?: string): string {
  if (!iso) return 'a few minutes';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'a few minutes';
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export function errorMessage(code: AppErrorCode, resetAt?: string | null): string {
  switch (code) {
    case 'INVALID_URL':
      return 'That does not look like a GitHub repository or README link.';
    case 'NOT_FOUND':
      return 'No README found for this repository.';
    case 'PRIVATE_OR_FORBIDDEN':
      return 'This repository is private or access was denied.';
    case 'RATE_LIMITED':
      return `GitHub rate limit reached. Try again at ${formatResetTime(resetAt)}.`;
    case 'TOO_LARGE':
      return 'This README is larger than 1 MB, so it was not loaded.';
    case 'PARSE_FAILURE':
      return 'The file could not be read as Markdown.';
    case 'NETWORK':
      return 'Could not reach GitHub. Check your connection and try again.';
    case 'UNKNOWN':
    default:
      return 'Something went wrong while loading this README.';
  }
}

export function errorCopy(code: AppErrorCode, resetAt?: string | null): ErrorCopy {
  const message = errorMessage(code, resetAt);
  switch (code) {
    case 'INVALID_URL':
      return {
        title: 'Invalid link',
        message,
        causes: [
          'The link is not on github.com or raw.githubusercontent.com.',
          'The link points to a user or organisation page, not a repository.',
          'There is a typo in the owner or repository name.',
        ],
      };
    case 'NOT_FOUND':
      return {
        title: 'README not found',
        message,
        causes: [
          'The repository does not exist or was renamed.',
          'The repository has no README file in this folder or branch.',
          'The repository is private (GitHub reports private repositories as not found).',
        ],
      };
    case 'PRIVATE_OR_FORBIDDEN':
      return {
        title: 'Access denied',
        message,
        causes: ['The repository is private.', 'GitHub blocked the request for this repository.'],
      };
    case 'RATE_LIMITED':
      return {
        title: 'Rate limit reached',
        message,
        causes: [
          'Too many requests were sent to GitHub from this server.',
          'Set GITHUB_TOKEN on the server to raise the limit.',
        ],
      };
    case 'TOO_LARGE':
      return {
        title: 'README too large',
        message,
        causes: ['The file is over the 1 MB safety limit.'],
      };
    case 'PARSE_FAILURE':
      return {
        title: 'Could not read file',
        message,
        causes: ['The file is not UTF-8 text.', 'The file is not Markdown.'],
      };
    case 'NETWORK':
      return {
        title: 'Network error',
        message,
        causes: ['You are offline.', 'GitHub is unreachable or timed out.'],
      };
    case 'UNKNOWN':
    default:
      return {
        title: 'Something went wrong',
        message,
        causes: ['GitHub returned an unexpected response.', 'Try again in a moment.'],
      };
  }
}

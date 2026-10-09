import GithubSlugger from 'github-slugger';

/**
 * GitHub-compatible heading slugs. Uses github-slugger, which reproduces
 * GitHub's algorithm: lowercase, drop punctuation and emoji, spaces to "-",
 * and "-1", "-2" suffixes for duplicates.
 */
export interface Slugger {
  slug(text: string): string;
  reset(): void;
}

export function createSlugger(): Slugger {
  const inner = new GithubSlugger();
  return {
    slug: (text: string) => inner.slug(text),
    reset: () => inner.reset(),
  };
}

/** Stateless slug of one heading (no duplicate tracking). */
export function slugify(text: string): string {
  return new GithubSlugger().slug(text);
}

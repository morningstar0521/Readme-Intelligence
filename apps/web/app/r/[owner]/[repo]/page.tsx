import type { Metadata } from 'next';
import { ViewerScreen } from '@/components/viewer/ViewerScreen';
import { ErrorState } from '@/components/common/ErrorState';

interface RepoPageProps {
  params: { owner: string; repo: string };
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

export function generateMetadata({ params }: RepoPageProps): Metadata {
  return { title: `${params.owner}/${params.repo} · README Intelligence` };
}

/** Shareable route (F-05): /r/owner/repo loads that repository's README directly. */
export default function RepoPage({ params }: RepoPageProps) {
  const owner = decodeURIComponent(params.owner);
  const repo = decodeURIComponent(params.repo);
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) return <ErrorState code="INVALID_URL" />;
  return <ViewerScreen githubInput={`https://github.com/${owner}/${repo}`} mode="github" />;
}

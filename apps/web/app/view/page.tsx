import { ViewerScreen } from '@/components/viewer/ViewerScreen';

interface ViewPageProps {
  searchParams: { url?: string | string[]; src?: string | string[] };
}

/**
 * /view?url=<github url>   fetch a GitHub README through /api/github/readme
 * /view?src=local|paste    show a document stored in this tab (never uploaded)
 * /view?src=example        show the bundled example README
 */
export default function ViewPage({ searchParams }: ViewPageProps) {
  const url = Array.isArray(searchParams.url) ? searchParams.url[0] : searchParams.url;
  const src = Array.isArray(searchParams.src) ? searchParams.src[0] : searchParams.src;
  if (url) return <ViewerScreen githubInput={url} mode="github" />;
  if (src === 'example') return <ViewerScreen mode="example" />;
  return <ViewerScreen mode="stored" />;
}

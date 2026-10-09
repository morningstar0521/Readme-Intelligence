import { describe, it, expect } from 'vitest';
import { resolveUrl, resolveSrcSet, getScheme, isSafeDataImage, readmeDir } from '../../src/render/resolveUrls';
import { GITHUB, GITHUB_SUBDIR, PASTE } from '../helpers';
import type { SourceInfo } from '../../src/types';

const LOCAL: SourceInfo = { kind: 'local', fileName: 'README.md' };

describe('resolveUrl (Technical design 3.5)', () => {
  it('./img/a.png and img/a.png resolve against the raw base for images', () => {
    expect(resolveUrl('./img/a.png', 'image', GITHUB)).toBe('https://raw.githubusercontent.com/acme/taskflow/main/img/a.png');
    expect(resolveUrl('img/a.png', 'image', GITHUB)).toBe('https://raw.githubusercontent.com/acme/taskflow/main/img/a.png');
  });

  it('/docs/a.png resolves against the repo root', () => {
    expect(resolveUrl('/docs/a.png', 'image', GITHUB_SUBDIR)).toBe('https://raw.githubusercontent.com/acme/taskflow/dev/docs/a.png');
  });

  it('relative links go to github.com/blob', () => {
    expect(resolveUrl('docs/guide.md', 'link', GITHUB)).toBe('https://github.com/acme/taskflow/blob/main/docs/guide.md');
  });

  it('relative paths resolve from the README directory', () => {
    expect(resolveUrl('./shot.png', 'image', GITHUB_SUBDIR)).toBe('https://raw.githubusercontent.com/acme/taskflow/dev/packages/web/shot.png');
    expect(resolveUrl('../../LICENSE', 'link', GITHUB_SUBDIR)).toBe('https://github.com/acme/taskflow/blob/dev/LICENSE');
  });

  it('keeps query and hash on relative links', () => {
    expect(resolveUrl('docs/a.md#setup', 'link', GITHUB)).toBe('https://github.com/acme/taskflow/blob/main/docs/a.md#setup');
  });

  it('#section stays an in-page anchor', () => {
    expect(resolveUrl('#installation', 'link', GITHUB)).toBe('#installation');
  });

  it('absolute https URLs are unchanged', () => {
    expect(resolveUrl('https://example.com/x', 'link', GITHUB)).toBe('https://example.com/x');
    expect(resolveUrl('http://example.com/a.png', 'image', PASTE)).toBe('http://example.com/a.png');
  });

  it('mailto is allowed for links only', () => {
    expect(resolveUrl('mailto:a@b.c', 'link', PASTE)).toBe('mailto:a@b.c');
    expect(resolveUrl('mailto:a@b.c', 'image', PASTE)).toBeNull();
  });

  it('javascript: is removed, including obfuscated variants', () => {
    for (const url of ['javascript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'jav\tascript:alert(1)', 'java\nscript:alert(1)', '\u0001javascript:x']) {
      expect(resolveUrl(url, 'link', GITHUB)).toBeNull();
      expect(resolveUrl(url, 'image', GITHUB)).toBeNull();
    }
  });

  it('vbscript: and file: are removed', () => {
    expect(resolveUrl('vbscript:msgbox(1)', 'link', GITHUB)).toBeNull();
    expect(resolveUrl('file:///etc/passwd', 'link', GITHUB)).toBeNull();
  });

  it('data: is removed except safe data:image types for images', () => {
    expect(resolveUrl('data:text/html;base64,PHNjcmlwdD4=', 'link', PASTE)).toBeNull();
    expect(resolveUrl('data:text/html;base64,PHNjcmlwdD4=', 'image', PASTE)).toBeNull();
    expect(resolveUrl('data:image/svg+xml;base64,PHN2Zz4=', 'image', PASTE)).toBeNull();
    expect(resolveUrl('data:image/png;base64,iVBORw0KGgo=', 'image', PASTE)).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(resolveUrl('data:image/png;base64,iVBORw0KGgo=', 'link', PASTE)).toBeNull();
  });

  it('local and pasted sources cannot load relative images', () => {
    expect(resolveUrl('img/a.png', 'image', LOCAL)).toBeNull();
    expect(resolveUrl('img/a.png', 'image', PASTE)).toBeNull();
    expect(resolveUrl('docs/a.md', 'link', LOCAL)).toBeNull();
  });

  it('protocol-relative URLs become https', () => {
    expect(resolveUrl('//cdn.example.com/a.png', 'image', PASTE)).toBe('https://cdn.example.com/a.png');
  });

  it('github.com blob image URLs become raw URLs', () => {
    expect(resolveUrl('https://github.com/a/b/blob/main/x.png?raw=true', 'image', PASTE)).toBe('https://raw.githubusercontent.com/a/b/main/x.png');
  });

  it('empty and non-string input returns null', () => {
    expect(resolveUrl('', 'link', GITHUB)).toBeNull();
    expect(resolveUrl('   ', 'link', GITHUB)).toBeNull();
    expect(resolveUrl(undefined as unknown as string, 'link', GITHUB)).toBeNull();
  });

  it('a hash-only image src is not loadable', () => {
    expect(resolveUrl('#x', 'image', GITHUB)).toBeNull();
  });
});

describe('helpers', () => {
  it('getScheme', () => {
    expect(getScheme('https://x')).toBe('https');
    expect(getScheme('a/b:c')).toBeNull();
    expect(getScheme('./x')).toBeNull();
    expect(getScheme(' JavaScript:x')).toBe('javascript');
  });

  it('isSafeDataImage', () => {
    expect(isSafeDataImage('data:image/webp;base64,AAAA')).toBe(true);
    expect(isSafeDataImage('data:image/gif;base64,AAAA')).toBe(true);
    expect(isSafeDataImage('data:image/svg+xml;base64,AAAA')).toBe(false);
  });

  it('readmeDir', () => {
    expect(readmeDir('README.md')).toBe('');
    expect(readmeDir('/docs/README.md')).toBe('docs');
    expect(readmeDir('a/b/README.md')).toBe('a/b');
  });

  it('resolveSrcSet resolves every candidate and rejects unsafe ones', () => {
    expect(resolveSrcSet('img/a.png 1x, img/b.png 2x', GITHUB)).toBe(
      'https://raw.githubusercontent.com/acme/taskflow/main/img/a.png 1x, https://raw.githubusercontent.com/acme/taskflow/main/img/b.png 2x'
    );
    expect(resolveSrcSet('ok.png 1x, javascript:alert(1) 2x', GITHUB)).toBeNull();
    expect(resolveSrcSet('', GITHUB)).toBeNull();
  });
});

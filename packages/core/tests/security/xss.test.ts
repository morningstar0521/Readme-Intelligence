import { describe, it, expect } from 'vitest';
import { renderToHtml } from '../../src/render/pipeline';
import { analyzeReadme } from '../../src/analyze';
import { GITHUB, PASTE } from '../helpers';

/**
 * XSS payload suite (Security spec 6.2). Every payload is rendered to HTML through the
 * full pipeline and must produce:
 * - no <script>, no on* attributes, no javascript:/vbscript: URLs, no style attributes,
 * - no <iframe>, <form>, <object>, <embed>, <base>, <meta>, <link>, <svg>, <math>, <style>.
 */
export const XSS_PAYLOADS: string[] = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '<svg onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<details open ontoggle=alert(1)>',
  '<math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
  '[click](javascript:alert(1))',
  '![x](javascript:alert(1))',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<input autofocus onfocus=alert(1)>',
  '<base href="https://evil.com/">',
  '<meta http-equiv="refresh" content="0;url=https://evil.com">',
  '<object data="javascript:alert(1)">',
  '<a href=" javascript:alert(1)">x</a>',
  '<a href="jav&#x09;ascript:alert(1)">x</a>',
  '<img src="x" id="__proto__">',
  '<form action="https://evil.com"><button>go</button></form>',
  '<body onload=alert(1)>',
  '<embed src="javascript:alert(1)">',
  '<link rel="stylesheet" href="https://evil.com/x.css">',
  '<style>body{background:url(javascript:alert(1))}</style>',
  '<a href="JaVaScRiPt:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<img src="javascript:alert(1)">',
  '<video><source onerror=alert(1)></video>',
  '<audio src=x onerror=alert(1)>',
  '<marquee onstart=alert(1)>x</marquee>',
  '<table background="javascript:alert(1)"><tr><td>x</td></tr></table>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '[x](data:text/html,<script>alert(1)</script>)',
  '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
  '<p onmouseover=alert(1)>hover</p>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  '<textarea><script>alert(1)</script></textarea>',
  '<template><script>alert(1)</script></template>',
  '<img srcset="javascript:alert(1) 1x" src="ok.png">',
  '<picture><source srcset="javascript:alert(1)"><img src="ok.png"></picture>',
  '<div><iframe srcdoc="<script>alert(1)</script>"></iframe></div>',
  '<h1 onclick=alert(1)>t</h1>',
  '<kbd style="color:red">k</kbd>',
  '<a href="https://ok.com" target="_self" onclick="steal()">ok</a>',
  '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">',
  '<details><summary onclick=alert(1)>s</summary>body</details>',
  '<a href="javascript&colon;alert(1)">x</a>',
  '[x]( javascript:alert(1) )',
  '<scr<script>ipt>alert(1)</script>',
  '<IMG SRC=JaVaScRiPt:alert(1)>',
  '<a href="\u0001javascript:alert(1)">x</a>',
];

function tagsOf(html: string): string[] {
  return html.match(/<[a-zA-Z][^>]*>/g) ?? [];
}

function assertSafe(html: string, payload: string): void {
  const ctx = `payload: ${payload}\nhtml: ${html}`;
  expect(html, ctx).not.toMatch(/<script\b/i);
  for (const tag of tagsOf(html)) {
    expect(tag, ctx).not.toMatch(/\son[a-z]+\s*=/i);
    expect(tag, ctx).not.toMatch(/\sstyle\s*=/i);
    expect(tag, ctx).not.toMatch(/(javascript|vbscript|livescript)\s*:/i);
    expect(tag, ctx).not.toMatch(/data:text\/html/i);
    expect(tag, ctx).not.toMatch(/data:image\/svg/i);
    expect(tag, ctx).not.toMatch(/\s(srcdoc|formaction|action|background|xlink:href)\s*=/i);
  }
  expect(html, ctx).not.toMatch(/<(iframe|form|object|embed|base|meta|link|svg|math|style|textarea|template|noscript|frame|frameset|applet|button|video|audio|marquee|body)\b/i);
  expect(html, ctx).not.toMatch(/<input\b/i);
}

describe('XSS payload suite', () => {
  it('has at least 30 payloads', () => {
    expect(XSS_PAYLOADS.length).toBeGreaterThanOrEqual(30);
  });

  it.each(XSS_PAYLOADS.map((p) => [p]))('blocks %s', (payload) => {
    assertSafe(renderToHtml(payload, PASTE), payload);
    assertSafe(renderToHtml(payload, GITHUB), payload);
  });

  it('blocks every payload when they are all in one README', () => {
    const all = XSS_PAYLOADS.join('\n\n');
    assertSafe(renderToHtml(all, GITHUB), 'all payloads');
  });

  it('blocks payloads nested inside Markdown structures', () => {
    for (const payload of XSS_PAYLOADS.slice(0, 15)) {
      const doc = `# Title\n\n- item ${payload}\n\n> quote ${payload}\n\n| a |\n|---|\n| ${payload.replace(/\|/g, '')} |\n`;
      assertSafe(renderToHtml(doc, GITHUB), payload);
    }
  });

  it('never executes or links code inside fenced blocks', () => {
    const html = renderToHtml('```html\n<script>alert(1)</script>\n```');
    expect(html).toContain('&#x3C;script>');
    expect(html).not.toMatch(/<script\b/i);
  });
});

describe('DOM clobbering and links', () => {
  it('prefixes user-supplied ids and names with user-content-', () => {
    const html = renderToHtml('<a id="getElementById" name="cookie" href="#x">x</a>');
    expect(html).toContain('id="user-content-getElementById"');
    expect(html).toContain('name="user-content-cookie"');
  });

  it('adds rel="noopener noreferrer nofollow" and target="_blank" to external links', () => {
    const html = renderToHtml('[site](https://example.com) <a href="https://ok.com" target="_self">ok</a>');
    for (const tag of tagsOf(html).filter((t) => t.startsWith('<a '))) {
      expect(tag).toContain('rel="noopener noreferrer nofollow"');
      expect(tag).toContain('target="_blank"');
      expect(tag).not.toContain('_self');
    }
  });

  it('keeps in-page anchors without target', () => {
    const html = renderToHtml('[jump](#install)');
    expect(html).toContain('href="#install"');
    expect(html).not.toContain('target=');
  });
});

describe('safe HTML that must survive', () => {
  it('keeps the allowed GitHub README HTML', () => {
    const html = renderToHtml(
      [
        '<div align="center"><img src="https://example.com/logo.png" width="120" alt="logo"></div>',
        '',
        '<details><summary>More</summary>Hidden text</details>',
        '',
        '<p align="center">Press <kbd>Ctrl</kbd> + <kbd>K</kbd>. H<sub>2</sub>O and x<sup>2</sup>.</p>',
        '',
        '<picture><source media="(prefers-color-scheme: dark)" srcset="https://example.com/dark.png"><img src="https://example.com/light.png" alt="x"></picture>',
      ].join('\n'),
      PASTE
    );
    expect(html).toContain('<div align="center"');
    expect(html).toMatch(/<img [^>]*src="https:\/\/example\.com\/logo\.png"/);
    expect(html).toMatch(/<img [^>]*width="120"/);
    expect(html).toContain('<details');
    expect(html).toContain('<summary>More</summary>');
    expect(html).toContain('<kbd>Ctrl</kbd>');
    expect(html).toContain('<sub>2</sub>');
    expect(html).toContain('<sup>2</sup>');
    expect(html).toMatch(/<source [^>]*srcset="https:\/\/example\.com\/dark\.png"/);
  });

  it('allows safe data:image URLs only', () => {
    const html = renderToHtml('<img src="data:image/png;base64,iVBORw0KGgo=">');
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });

  it('secrets are masked in extraction output for the UI and export', () => {
    const r = analyzeReadme('```env\nOPENAI_API_KEY=sk-abc123def456ghi789\n```', PASTE);
    expect(JSON.stringify(r.intelligence)).not.toContain('sk-abc123');
  });
});

import { NextResponse, type NextRequest } from 'next/server';

/**
 * Content-Security-Policy (Security spec, Document 5).
 *
 * Base policy from the PRD:
 *   default-src 'self'; img-src 'self' https: data:; script-src 'self'; style-src 'self' 'unsafe-inline';
 *   connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'
 *
 * Relaxations required by Next.js (documented in docs/SECURITY.md):
 * - script-src uses a per-request nonce + 'strict-dynamic' instead of plain 'self', because the
 *   App Router injects inline bootstrap scripts. Next reads the nonce from this header and adds it
 *   to its own scripts automatically. No 'unsafe-inline' for scripts.
 * - In development only: 'unsafe-eval' (React Refresh) and ws: for hot reload.
 * Additions: font-src 'self' (next/font self-hosts fonts), form-action 'self', frame-ancestors 'none'.
 */
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV !== 'production';

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' https: data:`,
    `font-src 'self'`,
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};

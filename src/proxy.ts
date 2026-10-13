import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

/** Only the configured storefront may be framed (Studio website preview); everything else stays blocked. */
function framePolicy(): string {
  const origins = new Set<string>();
  for (const value of [process.env.DASHBOARD_STOREFRONT_ORIGIN, process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:5174', process.env.NODE_ENV === 'production' ? undefined : 'http://127.0.0.1:5174']) {
    if (!value) continue;
    try {
      const url = new URL(value);
      const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) origins.add(url.origin);
    } catch { /* ignore a malformed origin; framing stays blocked */ }
  }
  return origins.size ? [...origins].join(' ') : "'none'";
}

function contentSecurityPolicy(nonce: string): string {
  const development = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    `frame-src ${framePolicy()}`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development}`,
    `style-src 'self' 'nonce-${nonce}'`,
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const nonce = randomBytes(18).toString('base64');
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  if (request.nextUrl.protocol === 'https:') response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};

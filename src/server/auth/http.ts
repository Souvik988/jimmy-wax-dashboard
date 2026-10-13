import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { ApiError } from './backend';
import { createCsrfToken, CSRF_COOKIE, csrfTokensMatch, decryptSession, encryptSession, SESSION_COOKIE, type OperatorSession } from './session';

// Local HTTP testing must opt out explicitly; deployed environments remain Secure by default.
const secure = process.env.DASHBOARD_COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && process.env.DASHBOARD_COOKIE_SECURE !== 'false');

export function writeSession(response: NextResponse, session: OperatorSession): void {
  response.cookies.set(SESSION_COOKIE, encryptSession(session), { httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: 60 * 60 * 8 });
  response.cookies.set(CSRF_COOKIE, session.csrfToken, { httpOnly: false, sameSite: 'strict', secure, path: '/', maxAge: 60 * 60 * 8 });
}
export function clearSession(response: NextResponse): void { response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: 0 }); response.cookies.set(CSRF_COOKIE, '', { httpOnly: false, sameSite: 'strict', secure, path: '/', maxAge: 0 }); }
export function sessionFromRequest(request: NextRequest): OperatorSession | null { const raw = request.cookies.get(SESSION_COOKIE)?.value; return raw ? decryptSession(raw) : null; }
export function nextSession(partial: Omit<OperatorSession, 'csrfToken'>, prior?: OperatorSession): OperatorSession { return { ...partial, csrfToken: prior?.csrfToken ?? createCsrfToken() }; }

/**
 * The origin browsers see for this dashboard. `next start` only knows its internal listener (e.g. http://localhost:3200), so behind a
 * reverse proxy / port mapping the request URL's origin never matches the browser's Origin header. Set DASHBOARD_PUBLIC_ORIGIN
 * (e.g. https://ops.example.com) in deployments; otherwise the Host header with the request protocol is used (correct for direct access).
 */
export function expectedOrigin(request: NextRequest): string | null {
  const configured = process.env.DASHBOARD_PUBLIC_ORIGIN;
  if (configured) { try { return new URL(configured).origin; } catch { return null; } }
  const host = request.headers.get('host');
  return host ? `${request.nextUrl.protocol}//${host}` : null;
}

export function assertSameOriginCsrf(request: NextRequest, requireToken = true): void {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  try {
    const source = origin ?? (referer ? new URL(referer).origin : null);
    const expected = expectedOrigin(request);
    if (!source || !expected || new URL(source).origin !== expected) throw new Error('different or missing origin');
  } catch { throw new ApiError(403, 'CSRF_REJECTED', 'This request was rejected for security reasons.'); }
  if (requireToken && !csrfTokensMatch(request.cookies.get(CSRF_COOKIE)?.value, request.headers.get('x-csrf-token'))) throw new ApiError(403, 'CSRF_REJECTED', 'This request was rejected for security reasons.');
}

export function errorResponse(error: unknown): { status: number; body: { error: { code: string; message: string; requestId?: string; retryable: boolean; fields?: Record<string, string>; retryAfter?: number } } } {
  if (error instanceof z.ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) { const key = issue.path[0]; if (typeof key === 'string' && !fields[key]) fields[key] = 'Check this field and try again.'; }
    return { status: 400, body: { error: { code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', retryable: false, ...(Object.keys(fields).length ? { fields } : {}) } } };
  }
  if (error instanceof SyntaxError) return { status: 400, body: { error: { code: 'VALIDATION_FAILED', message: 'The request body must be valid JSON.', retryable: false } } };
  if (error instanceof ApiError) return { status: error.status, body: { error: { code: error.code, message: error.code === 'UNAUTHENTICATED' ? 'Your session has ended. Please sign in again.' : error.message, retryable: error.status >= 500 || error.code === 'UNAVAILABLE', ...(error.requestId ? { requestId: error.requestId } : {}), ...(error.fields ? { fields: error.fields } : {}), ...(error.retryAfter !== undefined ? { retryAfter: error.retryAfter } : {}) } } };
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.', retryable: true } } };
}

export function authErrorResponse(error: unknown, clear = false): NextResponse {
  const mapped = errorResponse(error);
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (mapped.body.error.retryAfter !== undefined) headers.set('Retry-After', String(mapped.body.error.retryAfter));
  const response = NextResponse.json(mapped.body, { status: mapped.status, headers });
  if (clear) clearSession(response);
  return response;
}

import { NextRequest, NextResponse } from 'next/server';

import { authorizedBackendFetch, SessionExpiredError } from '@/server/auth/coordinator';
import { authErrorResponse, clearSession, sessionFromRequest, writeSession } from '@/server/auth/http';

const mediaFiles: Readonly<Record<string, string>> = {
  'orig.webp': 'image/webp',
  'video.mp4': 'video/mp4',
  'video.webm': 'video/webm',
  'font.woff2': 'font/woff2',
  'font.ttf': 'font/ttf',
  'font.otf': 'font/otf',
};

export const dynamic = 'force-dynamic';

function expectedMediaType(file: string): string | null {
  if (/^w\d{3,4}\.webp$/u.test(file)) return 'image/webp';
  return mediaFiles[file] ?? null;
}

const baseHeaders = { 'X-Content-Type-Options': 'nosniff' } as const;

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { ...baseHeaders, 'Cache-Control': 'no-store' } });
}

/**
 * Operator-only preview of ANY library asset (approved or not). The public `/v1/media` URL serves approved media only (DASH-BR-042), so previews
 * go through the session-authenticated `/v1/admin/media-files` route and are never cached by shared caches.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ sha: string; file: string }> }): Promise<Response> {
  const { sha, file } = await context.params;
  const mediaType = /^[0-9a-f]{64}$/u.test(sha) ? expectedMediaType(file) : null;
  if (!mediaType) return jsonError(404, 'NOT_FOUND', 'Media not found.');

  const session = sessionFromRequest(request);
  if (!session) return jsonError(401, 'UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
  if (!session.loginMfaComplete) return jsonError(403, 'MFA_REQUIRED', 'Complete your sign-in verification before continuing.');
  if (!session.permissions.includes('media:read')) return jsonError(403, 'FORBIDDEN', 'Your role cannot preview media.');

  const headers = new Headers();
  const range = request.headers.get('range');
  if (range && /^bytes=\d*-\d*$/u.test(range)) headers.set('range', range);
  let result: Awaited<ReturnType<typeof authorizedBackendFetch>>;
  try {
    result = await authorizedBackendFetch(session, `/v1/admin/media-files/${sha}/${file}`, { method: 'GET', headers, cache: 'no-store', signal: AbortSignal.timeout(file.startsWith('video.') ? 120_000 : 20_000) });
  } catch (error) {
    if (error instanceof SessionExpiredError) return authErrorResponse(error, true);
    return jsonError(503, 'UNAVAILABLE', 'Media preview is unavailable.');
  }

  const upstream = result.response;
  const responseHeaders = new Headers({ ...baseHeaders, 'Cross-Origin-Resource-Policy': 'same-origin' });
  if (upstream.status === 200 || upstream.status === 206) {
    responseHeaders.set('Content-Type', mediaType);
    // Bytes are content-addressed and immutable, but visibility depends on the operator's session, so only this browser may keep them.
    responseHeaders.set('Cache-Control', 'private, max-age=300');
    responseHeaders.set('Accept-Ranges', 'bytes');
    for (const name of ['content-length', 'content-range']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
  } else {
    responseHeaders.set('Cache-Control', 'no-store');
    if (upstream.status === 416) {
      responseHeaders.set('Accept-Ranges', 'bytes');
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) responseHeaders.set('content-range', contentRange);
    }
    const contentType = upstream.headers.get('content-type');
    if (contentType?.toLowerCase().includes('application/json')) responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
    const requestId = upstream.headers.get('x-request-id');
    if (requestId) responseHeaders.set('x-request-id', requestId);
  }
  const response = new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
  if (upstream.status === 401) clearSession(response);
  else if (result.refreshed) writeSession(response, result.session);
  return response;
}

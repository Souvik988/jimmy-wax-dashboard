import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import { ApiError } from './backend';
import { authorizedBackendFetch, SessionExpiredError } from './coordinator';
import { assertSameOriginCsrf, authErrorResponse, clearSession, sessionFromRequest, writeSession } from './http';
import { dashboardMediaMaxUploadBytes, mediaContentLengthError } from '@/lib/api/resources/media-validation';

const invoiceIssuePath = /^\/v1\/admin\/orders\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/invoice$/iu;

/** Only issuing (POST) is restricted here; the backend itself serves the read-only GET and blanks the buyer address for roles without fulfilment. */
export function invoiceGuardApplies(method: string, path: string): boolean { return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) && invoiceIssuePath.test(path); }

export function invoiceAccessError(permissions: readonly string[], aal: string): 'FORBIDDEN' | 'MFA_REQUIRED' | null {
  if (!permissions.includes('orders:fulfil')) return 'FORBIDDEN';
  if (aal !== 'aal2') return 'MFA_REQUIRED';
  return null;
}

export function safeResponseHeaders(source: Headers): Headers {
  const target = new Headers({ 'Cache-Control': 'no-store, max-age=0' });
  for (const key of ['content-type', 'etag', 'x-request-id', 'retry-after', 'ratelimit-limit', 'ratelimit-remaining']) { const value = source.get(key); if (value) target.set(key, value); }
  const disposition = source.get('content-disposition');
  const filename = disposition?.match(/^attachment\s*;\s*filename\s*=\s*"?([A-Za-z0-9._-]{1,120})"?$/iu)?.[1];
  if (filename) target.set('Content-Disposition', `attachment; filename="${filename}"`);
  return target;
}

export async function proxyAdminRequest(request: NextRequest, path: string): Promise<NextResponse> {
  const method = request.method.toUpperCase(); const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  try {
    if (mutating) assertSameOriginCsrf(request);
    const mediaUpload = method === 'POST' && path === '/v1/admin/media';
    if (mediaUpload) {
      const lengthError = mediaContentLengthError(request.headers.get('content-length'));
      if (lengthError === 'missing-or-invalid') return authErrorResponse(new ApiError(400, 'VALIDATION_FAILED', 'The upload size could not be verified. Choose the file again and retry.'));
      if (lengthError === 'too-large') return authErrorResponse(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Uploads through the dashboard are limited to 15 MiB per file.'));
    }
    const session = sessionFromRequest(request);
    if (!session) return authErrorResponse(new ApiError(401, 'UNAUTHENTICATED', 'Your session has ended. Please sign in again.'));
    if (!session.loginMfaComplete) return authErrorResponse(new ApiError(403, 'MFA_REQUIRED', 'Complete your sign-in verification before continuing.'));
    if (invoiceGuardApplies(method, path)) {
      const invoiceError = invoiceAccessError(session.permissions, session.aal);
      if (invoiceError === 'FORBIDDEN') return authErrorResponse(new ApiError(403, 'FORBIDDEN', 'Only fulfillment operators can issue order invoices.'));
      if (invoiceError === 'MFA_REQUIRED') return authErrorResponse(new ApiError(403, 'MFA_REQUIRED', 'Verify your identity before issuing an order invoice.'));
    }
    const body = mutating ? await request.arrayBuffer() : undefined;
    if (mediaUpload && body && body.byteLength > dashboardMediaMaxUploadBytes) return authErrorResponse(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Uploads through the dashboard are limited to 15 MiB per file.'));
    const headers = new Headers();
    for (const key of ['content-type', 'if-match', 'idempotency-key']) { const value = request.headers.get(key); if (value) headers.set(key, value); }
    if (mediaUpload) {
      const meta = request.headers.get('x-jw-upload-meta');
      if (meta !== null) {
        if (meta.length > 8192 || !/^[A-Za-z0-9_-]+$/u.test(meta)) return authErrorResponse(new ApiError(400, 'VALIDATION_FAILED', 'The upload details were not in the expected format. Reload the page and try again.'));
        headers.set('x-jw-upload-meta', meta);
      }
    }
    const search = request.nextUrl.search;
    const result = await authorizedBackendFetch(session, `${path}${search}`, { method, ...(body ? { body } : {}), ...(mediaUpload ? { signal: AbortSignal.timeout(120_000) } : {}), headers }, { retryUnauthorized: !mutating || Boolean(request.headers.get('idempotency-key')) });
    const response = new NextResponse(result.response.body, { status: result.response.status, headers: safeResponseHeaders(result.response.headers) });
    if (result.response.status === 401) clearSession(response);
    else if (result.refreshed) writeSession(response, result.session);
    return response;
  } catch (error) { return authErrorResponse(error, error instanceof SessionExpiredError); }
}

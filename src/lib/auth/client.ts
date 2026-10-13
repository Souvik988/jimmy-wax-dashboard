'use client';

export type ClientAuthError = { code: string; message: string; retryable: boolean; requestId?: string; retryAfter?: number; fields?: Record<string, string> };

export function csrfToken(): string | null { const entry = document.cookie.split('; ').find((item) => item.startsWith('jw_csrf=')); return entry ? decodeURIComponent(entry.split('=').slice(1).join('=')) : null; }

function replayableBody(body: BodyInit | null | undefined): boolean {
  return body == null || typeof body === 'string' || body instanceof URLSearchParams || body instanceof Blob || body instanceof FormData || body instanceof ArrayBuffer || ArrayBuffer.isView(body);
}

function waitForStepUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (verified: boolean) => {
      window.removeEventListener('jw:mfa-verified', onVerified);
      window.removeEventListener('jw:mfa-cancelled', onCancelled);
      resolve(verified);
    };
    const onVerified = () => finish(true);
    const onCancelled = () => finish(false);
    window.addEventListener('jw:mfa-verified', onVerified);
    window.addEventListener('jw:mfa-cancelled', onCancelled);
    window.dispatchEvent(new Event('jw:mfa-required'));
  });
}

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase(); const headers = new Headers(init.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) { const token = csrfToken(); if (token) headers.set('x-csrf-token', token); }
  const request = { ...init, headers, credentials: 'same-origin' as const, cache: 'no-store' as const };
  let response = await fetch(path, request);
  if (response.status === 403 && replayableBody(init.body)) {
    try {
      const payload = await response.clone().json() as { error?: { code?: string } };
      if (payload.error?.code === 'MFA_REQUIRED' && await waitForStepUp()) response = await fetch(path, request);
    } catch { /* a malformed refusal remains visible to the form; never retry without verified MFA */ }
  } else if (response.status === 403) {
    try {
      const payload = await response.clone().json() as { error?: { code?: string } };
      if (payload.error?.code === 'MFA_REQUIRED') window.dispatchEvent(new Event('jw:mfa-required'));
    } catch { /* a malformed refusal remains visible to the form */ }
  }
  const sessionBoundRoute = path.startsWith('/api/backend/') || path === '/api/auth/sessions' || path.startsWith('/api/auth/sessions/') || path === '/api/auth/mfa/enroll' || path === '/api/auth/mfa/recovery-codes';
  if (response.status === 401 && sessionBoundRoute) {
    try {
      const payload = await response.clone().json() as { error?: { code?: string } };
      if (payload.error?.code === 'UNAUTHENTICATED') window.dispatchEvent(new Event('jw:session-ended'));
    } catch { /* non-JSON errors are handled by the caller */ }
  }
  return response;
}
export async function readError(response: Response): Promise<ClientAuthError> { try { const payload = await response.json() as { error?: ClientAuthError }; if (payload.error) return payload.error; } catch { /* use safe fallback */ } return { code: 'INTERNAL', message: 'Something went wrong. Please try again.', retryable: response.status >= 500 }; }

import 'server-only';

import { ApiError, backendFetch, refresh, type BackendTokens } from './backend';
import { sessionLockKey, type OperatorSession } from './session';
import { authErrorResponse, writeSession } from './http';

export class SessionExpiredError extends ApiError {
  constructor() { super(401, 'UNAUTHENTICATED', 'Your session has ended. Please sign in again.'); }
}

export class AuthorizedApiError extends ApiError {
  constructor(status: number, code: string, message: string, requestId: string | undefined, retryAfter: number | undefined, fields: Record<string, string> | undefined, readonly session: OperatorSession, readonly refreshed: boolean) {
    super(status, code, message, requestId, retryAfter, fields);
  }
}

const refreshFlights = new Map<string, Promise<OperatorSession>>();

async function refreshSession(session: OperatorSession): Promise<OperatorSession> {
  const key = sessionLockKey(session); const flight = refreshFlights.get(key);
  if (flight) return flight;
  const pending = (async () => {
    try {
      const tokens: BackendTokens = await refresh(session.refreshToken);
      return { ...session, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, aal: tokens.aal, accessExpiresAt: Date.now() + tokens.expiresIn * 1000 };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw new SessionExpiredError();
      throw error;
    }
  })();
  refreshFlights.set(key, pending);
  try { return await pending; } finally { if (refreshFlights.get(key) === pending) refreshFlights.delete(key); }
}

export async function refreshIfNeeded(session: OperatorSession, force = false): Promise<OperatorSession> {
  return !force && session.accessExpiresAt > Date.now() + 45_000 ? session : refreshSession(session);
}

export async function authorizedBackendFetch(session: OperatorSession, path: string, init: RequestInit = {}, options: { retryUnauthorized?: boolean } = {}): Promise<{ response: Response; session: OperatorSession; refreshed: boolean }> {
  let current = await refreshIfNeeded(session); let refreshed = current !== session;
  const send = () => { const headers = new Headers(init.headers); headers.set('authorization', `Bearer ${current.accessToken}`); return backendFetch(path, { ...init, headers }); };
  let response = await send();
  if (response.status === 401 && options.retryUnauthorized !== false) { current = await refreshIfNeeded(current, true); refreshed = true; response = await send(); }
  return { response, session: current, refreshed };
}

export async function authorizedBackendJson(session: OperatorSession, path: string, init: RequestInit = {}, options: { retryUnauthorized?: boolean } = {}): Promise<{ body: unknown; session: OperatorSession; refreshed: boolean }> {
  const result = await authorizedBackendFetch(session, path, init, options); const text = await result.response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) as unknown : null; } catch { body = text; }
  if (!result.response.ok) {
    const payload = typeof body === 'object' && body !== null && 'error' in body ? (body as { error: { code?: string; message?: string; requestId?: string; fields?: Record<string, string> } }).error : undefined;
    const retryHeader = result.response.headers.get('retry-after'); const retryValue = retryHeader === null ? Number.NaN : Number(retryHeader);
    throw new AuthorizedApiError(result.response.status, payload?.code ?? 'INTERNAL', payload?.message ?? 'The request could not be completed.', payload?.requestId, Number.isFinite(retryValue) ? retryValue : undefined, payload?.fields, result.session, result.refreshed);
  }
  return { body, session: result.session, refreshed: result.refreshed };
}

export function coordinatorErrorResponse(error: unknown): ReturnType<typeof authErrorResponse> {
  const response = authErrorResponse(error, error instanceof SessionExpiredError);
  if (error instanceof AuthorizedApiError && error.refreshed) writeSession(response, error.session);
  return response;
}

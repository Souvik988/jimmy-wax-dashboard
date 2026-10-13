import 'server-only';

import { z } from 'zod';

import { isPermission, isRole, permissions, rolePermissions, type Permission, type SafeOperator } from '@/lib/auth/permissions';

const origin = process.env.BACKEND_ORIGIN ?? 'http://localhost:8080';
const timeoutMs = 8_000;

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional(), retryable: z.boolean().optional(), fields: z.record(z.string(), z.string()).optional() }) });
const tokensSchema = z.object({ accessToken: z.string(), refreshToken: z.string(), expiresIn: z.number().int().positive(), tokenType: z.string(), aal: z.enum(['aal1', 'aal2']) });
const loginSchema = tokensSchema.extend({ user: z.object({ id: z.string(), email: z.string().nullable().optional() }).passthrough(), mfa: z.object({ required: z.boolean(), enrolled: z.boolean() }) });
const mfaVerifySchema = z.object({ accessToken: z.string(), expiresIn: z.number().int().positive(), tokenType: z.string(), aal: z.literal('aal2') });
const meSchema = z.object({ userId: z.string(), role: z.string(), permissions: z.array(z.string()), mfa: z.boolean() });

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly requestId?: string | undefined, readonly retryAfter?: number | undefined, readonly fields?: Record<string, string> | undefined) { super(message); }
}
export type BackendLogin = z.infer<typeof loginSchema>;
export type BackendTokens = z.infer<typeof tokensSchema>;

export function parseSafeOperator(value: unknown, aal: 'aal1' | 'aal2'): SafeOperator {
  const raw = meSchema.parse(value);
  if (!isRole(raw.role)) throw new ApiError(502, 'CONTRACT_DRIFT', 'The backend returned an unsupported operator role.');
  if (raw.permissions.some((permission) => !isPermission(permission))) throw new ApiError(502, 'CONTRACT_DRIFT', 'The backend returned an unsupported operator permission set.');
  const allowedForRole = rolePermissions[raw.role];
  const expected: readonly Permission[] = allowedForRole === 'all' ? permissions : allowedForRole;
  const actualSet = new Set(raw.permissions);
  if (actualSet.size !== expected.length || expected.some((permission) => !actualSet.has(permission))) throw new ApiError(502, 'CONTRACT_DRIFT', 'The backend operator permissions do not match the approved role matrix.');
  return { userId: raw.userId, role: raw.role, permissions: raw.permissions as Permission[], mfa: raw.mfa, aal };
}

function apiUrl(path: string): URL { return new URL(path, origin); }

async function parseResponse(response: Response): Promise<unknown> { const text = await response.text(); if (!text) return null; try { return JSON.parse(text) as unknown; } catch { return text; } }
function retryAfter(response: Response): number | undefined { const raw = response.headers.get('retry-after'); const value = raw ? Number(raw) : Number.NaN; return Number.isFinite(value) && value >= 0 ? value : undefined; }

export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    const headers = new Headers(init.headers);
    if (!headers.has('accept')) headers.set('accept', 'application/json');
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    return await fetch(apiUrl(path), { ...init, cache: 'no-store', signal: init.signal ?? AbortSignal.timeout(timeoutMs), headers });
  }
  catch { throw new ApiError(503, 'UNAVAILABLE', 'The backend could not be reached. Please try again.'); }
}

export async function backendRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await backendFetch(path, init);
  const body = await parseResponse(response);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(body); const error = parsed.success ? parsed.data.error : undefined;
    throw new ApiError(response.status, error?.code ?? 'INTERNAL', error?.message ?? 'The request could not be completed.', error?.requestId, retryAfter(response), error?.fields);
  }
  return body;
}

function bearer(accessToken: string): HeadersInit { return { authorization: `Bearer ${accessToken}` }; }

export async function login(email: string, password: string): Promise<BackendLogin> { return loginSchema.parse(await backendRequest('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password, client: 'admin' }) })); }
export async function refresh(refreshToken: string): Promise<BackendTokens> { return tokensSchema.parse(await backendRequest('/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) })); }
export async function logout(refreshToken: string): Promise<void> { await backendRequest('/v1/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }); }
export async function getMe(accessToken: string, aal: 'aal1' | 'aal2' = 'aal1'): Promise<SafeOperator> {
  return parseSafeOperator(await backendRequest('/v1/admin/me', { headers: bearer(accessToken) }), aal);
}
export async function enrollMfa(accessToken: string): Promise<{ secret: string; otpauthUri: string }> { return z.object({ secret: z.string(), otpauthUri: z.string() }).parse(await backendRequest('/v1/auth/mfa/enroll', { method: 'POST', headers: bearer(accessToken) })); }
export async function verifyMfa(accessToken: string, input: { code: string } | { recoveryCode: string }): Promise<z.infer<typeof mfaVerifySchema>> { return mfaVerifySchema.parse(await backendRequest('/v1/auth/mfa/verify', { method: 'POST', headers: bearer(accessToken), body: JSON.stringify(input) })); }
export async function rotateRecoveryCodes(accessToken: string): Promise<string[]> { return z.object({ codes: z.array(z.string()) }).parse(await backendRequest('/v1/auth/mfa/recovery-codes', { method: 'POST', headers: bearer(accessToken) })).codes; }
export async function listSessions(accessToken: string): Promise<Array<{ id: string; client: string; aal: string; current: boolean; startedAt: string; lastSeenAt: string }>> { return z.object({ items: z.array(z.object({ id: z.string(), client: z.string(), aal: z.string(), current: z.boolean(), startedAt: z.string(), lastSeenAt: z.string() })) }).parse(await backendRequest('/v1/admin/sessions', { headers: bearer(accessToken) })).items; }
export async function revokeSession(accessToken: string, id: string): Promise<void> { await backendRequest(`/v1/admin/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', headers: bearer(accessToken) }); }

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { permissions, rolePermissions, roles, type Role, type SafeOperator } from '@/lib/auth/permissions';
import { isSafeNextPath } from '@/lib/auth/navigation';
import { parseSafeOperator, ApiError } from '@/server/auth/backend';
import { assertSameOriginCsrf } from '@/server/auth/http';
import { csrfTokensMatch, decryptSession, encryptSession, type OperatorSession } from '@/server/auth/session';

const supportOperator: SafeOperator = { userId: 'operator-test-id', role: 'support', permissions: ['orders:read', 'customers:read', 'customers:write', 'reviews:moderate', 'media:read', 'shipping:read'], mfa: false, aal: 'aal1' };
const session: OperatorSession = { ...supportOperator, accessToken: 'access-secret-example', refreshToken: 'refresh-secret-example', accessExpiresAt: 1_800_000_000_000, csrfToken: 'csrf-value-example', loginMfaComplete: true };

beforeEach(() => { vi.stubEnv('DASHBOARD_SESSION_SECRET', Buffer.alloc(32, 7).toString('base64')); });

describe('encrypted operator session boundary', () => {
  it('encrypts both bearer credentials into an authenticated opaque envelope', () => {
    const encrypted = encryptSession(session);
    expect(encrypted).not.toContain(session.accessToken);
    expect(encrypted).not.toContain(session.refreshToken);
    expect(decryptSession(encrypted)).toEqual(session);
  });

  it('rejects tampered envelopes and sessions missing the MFA completion gate', () => {
    const bytes = Buffer.from(encryptSession(session), 'base64url'); bytes[10] = (bytes[10] ?? 0) ^ 0xff;
    expect(decryptSession(bytes.toString('base64url'))).toBeNull();
    expect(decryptSession(encryptSession({ ...session, loginMfaComplete: undefined } as unknown as OperatorSession))).toBeNull();
  });

  it('matches the double-submit CSRF token in constant-time-safe form', () => {
    expect(csrfTokensMatch('same-token', 'same-token')).toBe(true);
    expect(csrfTokensMatch('same-token', 'other-token')).toBe(false);
    expect(csrfTokensMatch(undefined, 'same-token')).toBe(false);
    expect(csrfTokensMatch('same-token', null)).toBe(false);
  });

  it('rejects cross-origin mutations before backend dispatch', () => {
    const request = new NextRequest('http://localhost:3200/api/auth/logout', { method: 'POST', headers: { host: 'localhost:3200', origin: 'https://attacker.example', cookie: 'jw_csrf=csrf-value-example', 'x-csrf-token': 'csrf-value-example' } });
    let error: unknown;
    try { assertSameOriginCsrf(request); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: 'CSRF_REJECTED' });
  });

  it('accepts a same-origin mutation only with both CSRF proofs', () => {
    const request = new NextRequest('http://localhost:3200/api/auth/logout', { method: 'POST', headers: { host: 'localhost:3200', origin: 'http://localhost:3200', cookie: 'jw_csrf=csrf-value-example', 'x-csrf-token': 'csrf-value-example' } });
    expect(() => assertSameOriginCsrf(request)).not.toThrow();
  });
});

describe('CSRF origin behind a proxy or port mapping', () => {
  const post = (url: string, headers: Record<string, string>) => new NextRequest(url, { method: 'POST', headers: { cookie: 'jw_csrf=csrf-value-example', 'x-csrf-token': 'csrf-value-example', ...headers } });
  it('accepts the browser origin when the public port differs from the internal listener', () => {
    expect(() => assertSameOriginCsrf(post('http://localhost:3200/api/auth/logout', { host: 'localhost:3299', origin: 'http://localhost:3299' }))).not.toThrow();
  });
  it('honours DASHBOARD_PUBLIC_ORIGIN for TLS-terminating proxies and still rejects other origins', () => {
    process.env.DASHBOARD_PUBLIC_ORIGIN = 'https://ops.example.com';
    try {
      expect(() => assertSameOriginCsrf(post('http://localhost:3200/api/x', { host: 'localhost:3200', origin: 'https://ops.example.com' }))).not.toThrow();
      expect(() => assertSameOriginCsrf(post('http://localhost:3200/api/x', { host: 'localhost:3200', origin: 'https://attacker.example' }))).toThrow();
      expect(() => assertSameOriginCsrf(post('http://localhost:3200/api/x', { host: 'localhost:3200' }))).toThrow();
    } finally { delete process.env.DASHBOARD_PUBLIC_ORIGIN; }
  });
});

describe('role and redirect guards', () => {
  it('mirrors the approved permissions for every operator role', () => {
    const expected: Record<Role, readonly string[]> = {
      admin: permissions,
      support: ['orders:read', 'customers:read', 'customers:write', 'reviews:moderate', 'media:read', 'shipping:read'],
      catalog: ['catalog:read', 'catalog:write', 'inventory:read', 'media:read', 'media:write', 'experience:read'],
      fulfillment: ['orders:read', 'orders:fulfil', 'orders:cancel', 'inventory:read', 'inventory:write', 'customers:read', 'shipping:read', 'shipping:write', 'analytics:read'],
      finance: ['orders:read', 'payments:read', 'refunds:write', 'audit:read', 'coupons:read', 'analytics:read', 'shipping:read'],
      designer: ['catalog:read', 'media:read', 'media:write', 'experience:read', 'experience:write'],
    };
    expect(roles).toHaveLength(6);
    for (const role of roles) {
      const roleSet = rolePermissions[role] === 'all' ? permissions : rolePermissions[role];
      expect(new Set(roleSet)).toEqual(new Set(expected[role]));
    }
  });

  it('accepts backend permissions only when they exactly match the role matrix', () => {
    expect(parseSafeOperator({ userId: 'support-1', role: 'support', permissions: [...rolePermissions.support], mfa: false }, 'aal1').role).toBe('support');
    expect(() => parseSafeOperator({ userId: 'support-1', role: 'support', permissions: ['refunds:write'], mfa: false }, 'aal1')).toThrowError(ApiError);
  });

  it('permits only safe same-site application destinations', () => {
    expect(isSafeNextPath('/orders/123')).toBe(true);
    expect(isSafeNextPath('/account/security?tab=sessions')).toBe(true);
    for (const value of ['//attacker.example', 'https://attacker.example', '/api/auth/session', '/login/mfa', '/invite?token=x', '/dev/components']) expect(isSafeNextPath(value)).toBe(false);
  });
});

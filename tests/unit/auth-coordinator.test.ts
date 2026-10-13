import { beforeEach, describe, expect, it, vi } from 'vitest';

const { refreshMock, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
  }
  return { refreshMock: vi.fn(), MockApiError };
});

vi.mock('@/server/auth/backend', () => ({ ApiError: MockApiError, backendFetch: vi.fn(), refresh: refreshMock }));

import type { OperatorSession } from '@/server/auth/session';

const session: OperatorSession = { userId: 'operator-1', role: 'support', permissions: ['orders:read'], mfa: false, aal: 'aal1', accessToken: 'old-access', refreshToken: 'single-refresh-token', accessExpiresAt: 0, csrfToken: 'csrf', loginMfaComplete: true };

beforeEach(() => { refreshMock.mockReset(); });

describe('single-flight refresh coordinator', () => {
  it('shares one rotating refresh token request between concurrent callers', async () => {
    refreshMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh', expiresIn: 900, tokenType: 'Bearer', aal: 'aal1' }), 10)));
    const { refreshIfNeeded } = await import('@/server/auth/coordinator');
    const results = await Promise.all([refreshIfNeeded(session, true), refreshIfNeeded(session, true), refreshIfNeeded(session, true)]);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.refreshToken)).toEqual(['fresh-refresh', 'fresh-refresh', 'fresh-refresh']);
  });

  it('treats only a definitive refresh 401 as session expiry', async () => {
    const { refreshIfNeeded, SessionExpiredError } = await import('@/server/auth/coordinator');
    refreshMock.mockRejectedValueOnce(new MockApiError(401, 'UNAUTHENTICATED', 'expired'));
    await expect(refreshIfNeeded(session, true)).rejects.toBeInstanceOf(SessionExpiredError);
    const unavailable = new MockApiError(503, 'UNAVAILABLE', 'offline');
    refreshMock.mockRejectedValueOnce(unavailable);
    await expect(refreshIfNeeded(session, true)).rejects.toBe(unavailable);
  });
});

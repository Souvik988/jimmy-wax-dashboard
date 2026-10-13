/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authFetch } from '@/lib/auth/client';

afterEach(() => vi.unstubAllGlobals());

describe('authFetch MFA boundary', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    document.cookie = 'jw_csrf=csrf-for-test; path=/';
    fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { code: 'MFA_REQUIRED', message: 'Verify this action', retryable: false } },
        { status: 403 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  it('returns the original refusal when the operator cancels step-up without replaying the mutation', async () => {
    const onMfaRequired = vi.fn();
    const cancel = () => window.dispatchEvent(new Event('jw:mfa-cancelled'));
    window.addEventListener('jw:mfa-required', onMfaRequired);
    window.addEventListener('jw:mfa-required', cancel);

    const response = await authFetch('/api/backend/admin/app-versions/not-a-platform', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(403);
    expect(onMfaRequired).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    window.removeEventListener('jw:mfa-required', onMfaRequired);
    window.removeEventListener('jw:mfa-required', cancel);
  });

  it('retries a refused mutation exactly once after verified step-up', async () => {
    fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { code: 'MFA_REQUIRED', message: 'Verify' } }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const verify = () => window.dispatchEvent(new Event('jw:mfa-verified'));
    window.addEventListener('jw:mfa-required', verify);

    const response = await authFetch('/api/backend/admin/app-versions/ios', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: '1.0' }),
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    window.removeEventListener('jw:mfa-required', verify);
  });
});

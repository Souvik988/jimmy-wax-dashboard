import { afterEach, describe, expect, it, vi } from 'vitest';

import { backendFetch } from '@/server/auth/backend';

afterEach(() => vi.unstubAllGlobals());

describe('backendFetch', () => {
  it('preserves headers supplied as a Headers instance', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await backendFetch('/v1/admin/me', {
      headers: new Headers({ authorization: 'Bearer local-test-token', 'x-request-id': 'trace-1' }),
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer local-test-token');
    expect(headers.get('x-request-id')).toBe('trace-1');
    expect(headers.get('accept')).toBe('application/json');
  });

  it('adds JSON content type without replacing caller headers', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await backendFetch('/v1/admin/example', {
      method: 'POST', body: '{}', headers: new Headers({ authorization: 'Bearer local-test-token' }),
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer local-test-token');
    expect(headers.get('content-type')).toBe('application/json');
  });
});

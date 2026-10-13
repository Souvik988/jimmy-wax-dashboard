import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/media/[sha]/[file]/route';

const mocks = vi.hoisted(() => ({
  sessionFromRequest: vi.fn(),
  authorizedBackendFetch: vi.fn(),
}));

vi.mock('@/server/auth/http', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/server/auth/http')>()), sessionFromRequest: mocks.sessionFromRequest }));
vi.mock('@/server/auth/coordinator', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/server/auth/coordinator')>()), authorizedBackendFetch: mocks.authorizedBackendFetch }));

const session = { permissions: ['media:read'], loginMfaComplete: true, accessToken: 't', aal: 'aal1' };
const sha = 'c'.repeat(64);
const call = (file: string, init?: { headers?: Record<string, string> }, params?: { sha: string; file: string }) =>
  GET(new NextRequest(`http://localhost:3200/api/media/${params?.sha ?? sha}/${file}`, init), { params: Promise.resolve(params ?? { sha, file }) });

beforeEach(() => { mocks.sessionFromRequest.mockReturnValue(session); });
afterEach(() => { vi.clearAllMocks(); });

describe('operator media preview route (authenticated, not the public media URL)', () => {
  it('rejects path traversal and unknown file names without calling the backend', async () => {
    const response = await call('orig.webp', undefined, { sha: '../admin', file: 'orig.webp' });
    expect(response.status).toBe(404);
    expect(mocks.authorizedBackendFetch).not.toHaveBeenCalled();
  });

  it('refuses requests without an operator session, so unapproved media is never reachable anonymously', async () => {
    mocks.sessionFromRequest.mockReturnValue(null);
    const response = await call('orig.webp');
    expect(response.status).toBe(401);
    expect(mocks.authorizedBackendFetch).not.toHaveBeenCalled();
  });

  it('refuses roles without media:read and unfinished MFA sign-ins', async () => {
    mocks.sessionFromRequest.mockReturnValue({ ...session, permissions: ['orders:read'] });
    expect((await call('orig.webp')).status).toBe(403);
    mocks.sessionFromRequest.mockReturnValue({ ...session, loginMfaComplete: false });
    expect((await call('orig.webp')).status).toBe(403);
    expect(mocks.authorizedBackendFetch).not.toHaveBeenCalled();
  });

  it('fetches the AUTHENTICATED admin route, forwards Range, and keeps the bytes private', async () => {
    mocks.authorizedBackendFetch.mockResolvedValue({ response: new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'content-type': 'video/mp4', 'content-length': '3', 'content-range': 'bytes 0-2/10' } }), session, refreshed: false });
    const response = await call('video.mp4', { headers: { range: 'bytes=0-2' } });
    expect(mocks.authorizedBackendFetch).toHaveBeenCalledWith(session, `/v1/admin/media-files/${sha}/video.mp4`, expect.objectContaining({ method: 'GET' }));
    const forwarded = mocks.authorizedBackendFetch.mock.calls[0]?.[2]?.headers as Headers;
    expect(forwarded.get('range')).toBe('bytes=0-2');
    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-range')).toBe('bytes 0-2/10');
    expect(response.headers.get('cache-control')).toBe('private, max-age=300');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('preserves the backend unsatisfied-range size without caching an error response', async () => {
    mocks.authorizedBackendFetch.mockResolvedValue({ response: new Response(null, { status: 416, headers: { 'content-range': 'bytes */10' } }), session, refreshed: false });
    const response = await call('video.mp4', { headers: { range: 'bytes=20-30' } });
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */10');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

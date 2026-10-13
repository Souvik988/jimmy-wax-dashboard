// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiDownload, apiGet, apiPost, apiPostTextResult, createIdempotentPost, type ApiPath } from '@/lib/api/client';

afterEach(() => vi.unstubAllGlobals());

describe('typed BFF client', () => {
  it('builds a same-origin URL with bounded query parameters and uses no backend token', async () => {
    const mockedFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', mockedFetch);
    await apiGet<{ items: unknown[] }>('admin/orders', { params: { limit: 20, status: 'placed', q: 'JW-17', cursor: null } });
    expect(mockedFetch.mock.calls[0]?.[0]).toBe('/api/backend/admin/orders?limit=20&status=placed&q=JW-17');
    expect(mockedFetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
    expect(JSON.stringify(mockedFetch.mock.calls[0])).not.toMatch(/accessToken|refreshToken|Bearer/i);
  });

  it('rejects path traversal before a request can leave the browser', async () => {
    const mockedFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'));
    vi.stubGlobal('fetch', mockedFetch);
    await expect(apiGet('admin/../auth' as ApiPath)).rejects.toMatchObject({ code: 'INVALID_API_PATH' });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('allows Studio custom page keys (scope:slug) but nothing else with a colon, and nothing that escapes the admin path', async () => {
    const mockedFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', mockedFetch);
    await apiGet('admin/experience/web/docs/page/custom:our-story' as ApiPath);
    expect(mockedFetch.mock.calls[0]?.[0]).toBe('/api/backend/admin/experience/web/docs/page/custom:our-story');
    await apiPost('admin/experience/web/docs/page/custom:our-story/discard-draft' as ApiPath, { reason: 'Start over' }, { ifMatch: '"3"' });
    expect(new Headers((mockedFetch.mock.calls[1]?.[1] as RequestInit).headers).get('if-match')).toBe('"3"');
    for (const bad of ['admin/a:b:c', 'admin/http://evil.example', 'admin/x/:y', 'admin/x:', 'admin/..:/y']) {
      await expect(apiGet(bad as ApiPath), bad).rejects.toMatchObject({ code: 'INVALID_API_PATH' });
    }
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('pins an idempotency key to the exact create request', async () => {
    const mockedFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', mockedFetch);
    const create = createIdempotentPost('admin/experience/releases', { channel: 'web' });
    await create.run();
    const request = mockedFetch.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get('idempotency-key')).toBe(create.key);
    expect(create.key).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('sanitizes server-provided CSV filenames and validates the response media type', async () => {
    const mockedFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('order_number,total_paise\n', { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="orders_2026-01.csv"' } }));
    vi.stubGlobal('fetch', mockedFetch);
    const file = await apiDownload('admin/exports/orders.csv', { params: { from: '2026-01-01', to: '2026-01-02' } });
    expect(file.filename).toBe('orders_2026-01.csv');
    expect(file.blob.size).toBeGreaterThan(0);
  });

  it('sends CSV as raw text through the same-origin BFF and accepts the source-backed 422 report', async () => {
    const report = { dryRun: true, rows: 1, products: { create: 0, update: 1 }, variants: { create: 0, update: 1 }, errors: [{ row: 2, field: 'price_paise', message: 'invalid' }], applied: false };
    const mockedFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(report), { status: 422, headers: { 'content-type': 'application/json', 'x-request-id': 'catalog-csv-31' } }));
    vi.stubGlobal('fetch', mockedFetch);
    const csv = 'product_id,name\ncleaner,Leather Cleaner\n';

    await expect(apiPostTextResult('admin/catalog/import', csv, [422], { params: { dryRun: true } })).resolves.toEqual({ data: report, status: 422, requestId: 'catalog-csv-31' });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch.mock.calls[0]?.[0]).toBe('/api/backend/admin/catalog/import?dryRun=true');
    expect(mockedFetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: csv, credentials: 'same-origin', cache: 'no-store' });
    expect(new Headers(mockedFetch.mock.calls[0]?.[1]?.headers).get('content-type')).toBe('text/csv; charset=utf-8');
    expect(new Headers(mockedFetch.mock.calls[0]?.[1]?.headers).get('x-csrf-token')).toBeNull();
  });

  it('keeps ordinary backend errors on the shared sanitized error path for raw text requests', async () => {
    const mockedFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not permitted', requestId: 'csv-forbidden-4' } }), { status: 403, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', mockedFetch);
    await expect(apiPostTextResult('admin/catalog/import', 'csv', [422])).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', requestId: 'csv-forbidden-4' });
  });
});

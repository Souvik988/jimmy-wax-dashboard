// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiError } from '@/lib/api/errors';
import { uploadFile } from '@/lib/api/upload';

type ProgressHandler = ((event: ProgressEvent) => void) | null;
type LoadHandler = ((event: ProgressEvent) => void) | null;

class FakeXhr {
  static instances: FakeXhr[] = [];
  upload: { onprogress: ProgressHandler } = { onprogress: null };
  onerror: LoadHandler = null;
  onabort: LoadHandler = null;
  ontimeout: LoadHandler = null;
  onload: LoadHandler = null;
  onloadend: LoadHandler = null;
  timeout = 0;
  status = 201;
  responseText = '{"mediaId":"media-1"}';
  method = '';
  url = '';
  body: Document | XMLHttpRequestBodyInit | null = null;
  aborted = false;
  readonly headers = new Map<string, string>();

  constructor() { FakeXhr.instances.push(this); }
  open(method: string, url: string): void { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string): void { this.headers.set(name.toLowerCase(), value); }
  getResponseHeader(name: string): string | null { return name.toLowerCase() === 'content-type' ? 'application/json' : name.toLowerCase() === 'x-request-id' ? 'req-upload-1' : null; }
  send(body: Document | XMLHttpRequestBodyInit | null): void {
    this.body = body;
    queueMicrotask(() => {
      if (this.aborted) return;
      this.upload.onprogress?.({ lengthComputable: true, loaded: 40, total: 100 } as ProgressEvent);
      this.onload?.({} as ProgressEvent);
      this.onloadend?.({} as ProgressEvent);
    });
  }
  abort(): void { this.aborted = true; this.onabort?.({} as ProgressEvent); this.onloadend?.({} as ProgressEvent); }
}

afterEach(() => {
  FakeXhr.instances = [];
  vi.unstubAllGlobals();
  document.cookie = 'jw_csrf=; Max-Age=0; path=/';
});

describe('same-origin multipart upload transport', () => {
  it('posts a multipart form with CSRF, reports progress, and validates response JSON', async () => {
    document.cookie = 'jw_csrf=local-proof; path=/';
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const progress: number[] = [];
    const file = new File(['asset bytes'], 'care-guide.jpg', { type: 'image/jpeg' });
    const result = await uploadFile('admin/media', file, z.object({ mediaId: z.string() }), { fields: { purpose: 'catalogue' }, onProgress: (event) => progress.push(event.percent) });

    const xhr = FakeXhr.instances[0];
    expect(result).toEqual({ mediaId: 'media-1' });
    expect(xhr?.method).toBe('POST');
    expect(xhr?.url).toBe('/api/backend/admin/media');
    expect(xhr?.headers.get('x-csrf-token')).toBe('local-proof');
    expect(xhr?.timeout).toBe(120_000);
    expect(xhr?.body).toBeInstanceOf(FormData);
    expect(progress).toEqual([40]);
  });

  it('cancels only when explicitly requested and gives the operator a reusable error', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const controller = new AbortController();
    const pending = uploadFile('admin/media', new File(['asset'], 'asset.jpg'), z.object({ mediaId: z.string() }), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    expect(FakeXhr.instances[0]?.aborted).toBe(true);
  });

  it('times out instead of spinning forever and marks the upload as safe to retry explicitly', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const pending = uploadFile('admin/media', new File(['asset'], 'asset.jpg'), z.object({ mediaId: z.string() }), { timeoutMs: 500 });
    FakeXhr.instances[0]?.ontimeout?.({} as ProgressEvent);
    await expect(pending).rejects.toBeInstanceOf(ApiError);
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
  });
});

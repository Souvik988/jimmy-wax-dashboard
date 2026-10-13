// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadMediaFile } from '@/lib/api/resources/media';

type Handler = ((event: ProgressEvent) => void) | null;

class MediaXhr {
  static instances: MediaXhr[] = [];
  upload: { onprogress: Handler } = { onprogress: null };
  onerror: Handler = null;
  onabort: Handler = null;
  ontimeout: Handler = null;
  onload: Handler = null;
  onloadend: Handler = null;
  timeout = 0;
  status = 201;
  responseText = '';
  method = '';
  url = '';
  body: Document | XMLHttpRequestBodyInit | null = null;
  readonly headers = new Map<string, string>();

  constructor() { MediaXhr.instances.push(this); }
  open(method: string, url: string): void { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string): void { this.headers.set(name.toLowerCase(), value); }
  getResponseHeader(name: string): string | null { return name.toLowerCase() === 'content-type' ? 'application/json' : name.toLowerCase() === 'x-request-id' ? 'media-req-8' : null; }
  send(body: Document | XMLHttpRequestBodyInit | null): void { this.body = body; }
  abort(): void { this.onabort?.({} as ProgressEvent); this.onloadend?.({} as ProgressEvent); }
}

afterEach(() => { MediaXhr.instances = []; vi.unstubAllGlobals(); document.cookie = 'jw_csrf=; Max-Age=0; path=/'; });

describe('raw media upload transport', () => {
  it('sends raw file bytes and only supported metadata, with CSRF and progress; it does not use multipart or an automatic retry key', async () => {
    document.cookie = 'jw_csrf=csrf-proof; path=/';
    vi.stubGlobal('XMLHttpRequest', MediaXhr);
    const file = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], 'care image.png', { type: 'image/png' });
    const media = {
      id: '11111111-1111-4111-8111-111111111111', kind: 'image', sha256: 'a'.repeat(64), mime: 'image/webp', bytes: 12,
      width: 40, height: 30, durationMs: null, filename: 'care image.png', status: 'ready', provenance: 'original_photo', approval: 'draft', approvalNote: null,
      packagingAttested: false, alt: 'Leather care', decorative: false, focal: null, tags: [], folder: 'catalogue', role: null,
      license: 'Rights holder: JIMMY & WAX | Evidence: Owner permission dated 2026-10-07', rightsHolder: 'JIMMY & WAX', provenanceNote: 'Owner permission dated 2026-10-07', consentReference: null,
      posterMediaId: null, bundledKey: null, archived: false, updatedAt: '2026-10-07T10:00:00.000Z',
      urls: { original: `/v1/media/${'a'.repeat(64)}/orig.webp`, variants: [] }, createdAt: '2026-10-07T10:00:00.000Z', duplicate: false,
    };
    MediaXhr.prototype.status = 201;
    const progress: number[] = [];
    const promise = uploadMediaFile(file, {
      alt: 'Leather care', provenance: 'original_photo', folder: 'catalogue',
      license: 'Rights holder: JIMMY & WAX | Evidence: Owner permission dated 2026-10-07',
      rightsHolder: 'JIMMY & WAX', provenanceNote: 'Owner permission dated 2026-10-07',
    }, { onProgress: (value) => progress.push(value.percent) });
    for (let attempt = 0; attempt < 20 && MediaXhr.instances.length === 0; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    }
    const xhr = MediaXhr.instances[0];
    expect(xhr).toBeDefined();
    if (!xhr) throw new Error('Expected media XHR transport');
    xhr.responseText = JSON.stringify(media);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 9, total: 12 } as ProgressEvent);
    xhr.onload?.({} as ProgressEvent);
    xhr.onloadend?.({} as ProgressEvent);
    await expect(promise).resolves.toMatchObject({ duplicate: false, approval: 'draft' });
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toContain('/api/backend/admin/media?');
    expect(xhr.url).toContain('filename=care+image.png');
    // Rights details never travel in the URL: they go in the X-JW-Upload-Meta header.
    expect(xhr.url).not.toContain('license=');
    expect(xhr.url).not.toContain('Rights');
    const meta = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob((xhr.headers.get('x-jw-upload-meta') ?? '').replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0)))) as Record<string, string>;
    expect(meta).toMatchObject({ alt: 'Leather care', provenance: 'original_photo', folder: 'catalogue', rightsHolder: 'JIMMY & WAX', provenanceNote: 'Owner permission dated 2026-10-07' });
    expect(meta.license).toContain('Rights holder: JIMMY & WAX');
    expect(xhr.headers.get('content-type')).toBe('application/octet-stream');
    expect(xhr.headers.get('x-csrf-token')).toBe('csrf-proof');
    expect(xhr.headers.has('idempotency-key')).toBe(false);
    expect(xhr.body).toBe(file);
    expect(progress).toEqual([75]);
  });

  it('rejects a disguised SVG before opening a network request', async () => {
    vi.stubGlobal('XMLHttpRequest', MediaXhr);
    const file = new File(['<svg><script>alert(1)</script></svg>'], 'badge.svg', { type: 'image/svg+xml' });
    await expect(uploadMediaFile(file, { alt: 'Badge', provenance: 'illustration', folder: 'brand', license: 'Rights holder: JWX | Evidence: Approved artwork' })).rejects.toThrow('Unsupported file signature');
    expect(MediaXhr.instances).toHaveLength(0);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ apiGet: vi.fn(), apiPatch: vi.fn(), apiPost: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiGet: client.apiGet, apiPatch: client.apiPatch, apiPost: client.apiPost };
});

import { archiveMedia, encodeUploadMeta, getMediaPage, getMediaUsage, mediaSchema, restoreMedia, updateMedia } from '@/lib/api/resources/media';

afterEach(() => vi.resetAllMocks());

const media = {
  id: '11111111-1111-4111-8111-111111111111', kind: 'image', sha256: 'a'.repeat(64), mime: 'image/webp', bytes: 120,
  width: 400, height: 300, durationMs: null, filename: 'leather-care.jpg', status: 'ready', provenance: 'original_photo',
  approval: 'draft', approvalNote: null, packagingAttested: false, alt: 'Leather care kit', decorative: false,
  focal: { x: 0.5, y: 0.5 }, tags: ['product'], folder: 'catalogue', role: 'product_packshot', license: 'Rights holder: Jimmy & Wax | Evidence: owner record',
  rightsHolder: 'Jimmy & Wax', provenanceNote: 'Shot in-house', consentReference: null,
  posterMediaId: null, bundledKey: null, archived: false, updatedAt: '2026-10-07T10:05:00.000Z',
  urls: { original: `/v1/media/${'a'.repeat(64)}/orig.webp`, variants: [{ url: `/v1/media/${'a'.repeat(64)}/w320.webp`, width: 320 }] },
  createdAt: '2026-10-07T10:00:00.000Z',
};

describe('media library resources', () => {
  it('strictly parses the backend media DTO and rejects undocumented fields', () => {
    expect(mediaSchema.parse(media).approval).toBe('draft');
    expect(mediaSchema.safeParse({ ...media, invented: 'DTO field' }).success).toBe(false);
    expect(mediaSchema.safeParse({ ...media, updatedAt: undefined }).success).toBe(false);
    expect(mediaSchema.safeParse({ ...media, sha256: 'not-a-hash' }).success).toBe(false);
  });

  it('uses only documented server filters and opaque cursors, never client-side in-use filtering', async () => {
    const page = { items: [media], nextCursor: 'backend-opaque-cursor' };
    const signal = new AbortController().signal;
    client.apiGet.mockResolvedValue(page);
    await expect(getMediaPage({ q: ' leather ', kind: 'image', approval: 'draft', archived: false, limit: 50 }, 'opaque', signal)).resolves.toEqual(page);
    expect(client.apiGet).toHaveBeenCalledWith('admin/media', {
      params: { q: 'leather', kind: 'image', approval: 'draft', archived: false, limit: 50, cursor: 'opaque' }, signal,
    });
    await getMediaPage({ inUse: false });
    expect(client.apiGet).toHaveBeenLastCalledWith('admin/media', { params: { inUse: false, limit: 30, cursor: undefined } });
    await expect(getMediaPage({ unknownFilter: true } as never)).rejects.toThrow();
    expect(client.apiGet).toHaveBeenCalledTimes(2);
  });

  it('loads usage from the documented endpoint and accurately parses the limited returned references', async () => {
    const usage = { items: [{ type: 'product', id: 'leather-cleaner', label: 'Leather Cleaner' }] };
    client.apiGet.mockResolvedValue(usage);
    await expect(getMediaUsage(media.id)).resolves.toEqual(usage);
    expect(client.apiGet).toHaveBeenCalledWith(`admin/media/${media.id}/usage`, {});
  });

  it('patches only source-supported metadata and parses the authoritative response', async () => {
    client.apiPatch.mockResolvedValue({ ...media, alt: 'Leather cleaning kit' });
    await expect(updateMedia(media.id, { alt: 'Leather cleaning kit', tags: ['product', 'care'] })).resolves.toMatchObject({ alt: 'Leather cleaning kit' });
    expect(client.apiPatch).toHaveBeenCalledWith(`admin/media/${media.id}`, { alt: 'Leather cleaning kit', tags: ['product', 'care'] });
    await expect(updateMedia(media.id, { bundledKey: 'assets/runtime/file.png' } as never)).rejects.toThrow();
    expect(client.apiPatch).toHaveBeenCalledTimes(1);
  });

  it('patches the structured rights fields', async () => {
    client.apiPatch.mockResolvedValue({ ...media, rightsHolder: 'Studio X' });
    await updateMedia(media.id, { rightsHolder: 'Studio X', provenanceNote: null });
    expect(client.apiPatch).toHaveBeenCalledWith(`admin/media/${media.id}`, { rightsHolder: 'Studio X', provenanceNote: null });
  });

  it('archives and restores only with the loaded version stamp and a reason', async () => {
    client.apiPost.mockResolvedValue({});
    await archiveMedia(media.id, { expectedUpdatedAt: media.updatedAt, reason: 'Superseded by new packshot' });
    expect(client.apiPost).toHaveBeenLastCalledWith(`admin/media/${media.id}/archive`, { expectedUpdatedAt: media.updatedAt, reason: 'Superseded by new packshot' });
    await restoreMedia(media.id, { expectedUpdatedAt: media.updatedAt, reason: 'Needed again for autumn campaign' });
    expect(client.apiPost).toHaveBeenLastCalledWith(`admin/media/${media.id}/restore`, { expectedUpdatedAt: media.updatedAt, reason: 'Needed again for autumn campaign' });
    await expect(archiveMedia(media.id, { expectedUpdatedAt: media.updatedAt, reason: 'x' })).rejects.toThrow();
    await expect(archiveMedia(media.id, { expectedUpdatedAt: 'yesterday', reason: 'Valid reason' })).rejects.toThrow();
    expect(client.apiPost).toHaveBeenCalledTimes(2);
  });

  it('encodes upload details as base64url JSON without padding and drops empty values', () => {
    const encoded = encodeUploadMeta({ rightsHolder: 'Jimmy & Wax \u2013 \u20b9', alt: undefined, folder: '' });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
    const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0)))) as Record<string, string>;
    expect(decoded).toEqual({ rightsHolder: 'Jimmy & Wax \u2013 \u20b9' });
  });
});

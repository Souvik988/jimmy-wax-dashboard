import { z } from 'zod';

import { csrfToken } from '@/lib/auth/client';
import { ApiError, apiErrorFromResponse } from '@/lib/api/errors';
import { apiEndpoint, apiGet, apiPatch, apiPost } from '@/lib/api/client';

import { mediaFileError, readMediaPrefix, sniffMediaKind } from './media-validation';

const count = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const timestamp = z.string().datetime({ offset: true });
const provenance = z.enum(['original_photo', 'edited_photo', 'generated', 'illustration']);
const mediaRole = z.enum(['product_packshot', 'campaign', 'brand', 'mascot', 'state_art', 'avatar', 'poster', 'font']);
const safeMediaId = z.string().uuid();

export const mediaSchema = z.object({
  id: safeMediaId,
  kind: z.enum(['image', 'video', 'font']),
  sha256: hash,
  mime: z.string().min(1).max(100),
  bytes: count,
  width: count.nullable(),
  height: count.nullable(),
  durationMs: count.nullable(),
  filename: z.string().min(1).max(200),
  status: z.string().min(1).max(40),
  provenance,
  approval: z.enum(['draft', 'approved', 'rejected']),
  approvalNote: z.string().nullable(),
  packagingAttested: z.boolean(),
  alt: z.string().max(200),
  decorative: z.boolean(),
  focal: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict().nullable(),
  tags: z.array(z.string().min(1).max(40)).max(20),
  folder: z.string().max(80),
  role: mediaRole.nullable(),
  license: z.string().max(300).nullable(),
  rightsHolder: z.string().max(200).nullable(),
  provenanceNote: z.string().max(500).nullable(),
  consentReference: z.string().max(200).nullable(),
  posterMediaId: safeMediaId.nullable(),
  /** Path of the same picture shipped inside the app binary. Set by administrators with step-up only; shown read-only here. */
  bundledKey: z.string().nullable(),
  archived: z.boolean(),
  /** Version stamp: echoed back as `expectedUpdatedAt` when archiving or restoring. */
  updatedAt: timestamp,
  urls: z.object({
    original: z.string().min(1),
    variants: z.array(z.object({ url: z.string().min(1), width: count.nullable() }).strict()),
  }).strict(),
  createdAt: timestamp,
}).strict();

export const mediaPageSchema = z.object({ items: z.array(mediaSchema), nextCursor: z.string().nullable() }).strict();
export const mediaUsageSchema = z.object({
  items: z.array(z.object({ type: z.string(), id: z.string(), label: z.string() }).strict()),
}).strict();
export const mediaFiltersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  kind: z.enum(['image', 'video', 'font']).optional(),
  tag: z.string().max(40).optional(),
  folder: z.string().max(80).optional(),
  approval: z.enum(['draft', 'approved', 'rejected']).optional(),
  provenance: provenance.optional(),
  archived: z.boolean().optional(),
  /** Backed by COMPLETE usage (catalogue, library, Studio drafts, live releases, campaigns), so "unused" is reliable. */
  inUse: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).default(30),
}).strict();
export const mediaPatchSchema = z.object({
  alt: z.string().trim().max(200).optional(),
  decorative: z.boolean().optional(),
  focalX: z.number().min(0).max(1).nullable().optional(),
  focalY: z.number().min(0).max(1).nullable().optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).optional(),
  folder: z.string().trim().max(80).optional(),
  role: mediaRole.nullable().optional(),
  provenance: provenance.optional(),
  license: z.string().trim().max(300).nullable().optional(),
  rightsHolder: z.string().trim().max(200).nullable().optional(),
  provenanceNote: z.string().trim().max(500).nullable().optional(),
  consentReference: z.string().trim().max(200).nullable().optional(),
  posterMediaId: safeMediaId.nullable().optional(),
}).strict().refine((input) => Object.keys(input).length > 0, 'At least one supported media field must change.');

export type Media = z.infer<typeof mediaSchema>;
export type MediaPage = z.infer<typeof mediaPageSchema>;
export type MediaFilters = z.input<typeof mediaFiltersSchema>;
export type MediaPatch = z.input<typeof mediaPatchSchema>;
export type MediaUsage = z.infer<typeof mediaUsageSchema>;

export const mediaUploadMetadataSchema = z.object({
  alt: z.string().trim().max(200).optional(),
  decorative: z.boolean().optional(),
  provenance,
  folder: z.string().trim().max(80).optional(),
  // `license` stays the human-readable summary the backend shows everywhere; the structured fields below are what audits and reviews rely on.
  license: z.string().trim().min(8).max(300),
  rightsHolder: z.string().trim().min(2).max(200).optional(),
  provenanceNote: z.string().trim().min(3).max(500).optional(),
  consentReference: z.string().trim().max(200).optional(),
}).strict();
export type MediaUploadMetadata = z.input<typeof mediaUploadMetadataSchema>;

const mediaUploadResultSchema = mediaSchema.extend({ duplicate: z.boolean() }).strict();
export type MediaUploadResult = z.infer<typeof mediaUploadResultSchema>;

export async function getMediaPage(filters: MediaFilters = {}, cursor: string | null = null, signal?: AbortSignal): Promise<MediaPage> {
  const query = mediaFiltersSchema.parse(filters);
  const response = await apiGet<unknown>('admin/media', { params: { ...query, cursor: cursor ?? undefined }, ...(signal ? { signal } : {}) });
  return mediaPageSchema.parse(response);
}

export async function getMedia(id: string, signal?: AbortSignal): Promise<Media> {
  const mediaId = safeMediaId.parse(id);
  const response = await apiGet<unknown>(`admin/media/${mediaId}`, signal ? { signal } : {});
  return mediaSchema.parse(response);
}

export async function getMediaUsage(id: string, signal?: AbortSignal): Promise<MediaUsage> {
  const mediaId = safeMediaId.parse(id);
  return mediaUsageSchema.parse(await apiGet<unknown>(`admin/media/${mediaId}/usage`, signal ? { signal } : {}));
}

export async function updateMedia(id: string, input: MediaPatch): Promise<Media> {
  const mediaId = safeMediaId.parse(id);
  const body = mediaPatchSchema.parse(input);
  return mediaSchema.parse(await apiPatch<unknown>(`admin/media/${mediaId}`, body));
}

export async function approveMedia(id: string, input: { note?: string; packagingAttested?: boolean } = {}): Promise<Media> {
  const mediaId = safeMediaId.parse(id);
  const body = z.object({ note: z.string().trim().max(300).optional(), packagingAttested: z.boolean().optional() }).strict().parse(input);
  return mediaSchema.parse(await apiPost<unknown>(`admin/media/${mediaId}/approve`, body));
}

export async function rejectMedia(id: string, note: string): Promise<Media> {
  const mediaId = safeMediaId.parse(id);
  const body = z.object({ note: z.string().trim().min(3).max(300) }).strict().parse({ note });
  return mediaSchema.parse(await apiPost<unknown>(`admin/media/${mediaId}/reject`, body));
}

/** base64url(JSON) of the defined metadata keys, as the backend's X-JW-Upload-Meta header expects. Undefined and empty values are left out. */
export function encodeUploadMeta(meta: Record<string, string | undefined>): string {
  const clean = Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined && value !== ''));
  const bytes = new TextEncoder().encode(JSON.stringify(clean));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

const mediaGuardSchema = z.object({ expectedUpdatedAt: timestamp, reason: z.string().trim().min(3).max(300) }).strict();
const mediaGuardResultSchema = z.object({}).passthrough();

/**
 * Archiving is refused (409 ILLEGAL_STATE, `error.lines` = usage rows) while ANY durable reference exists, and with 409 CART_VERSION_CONFLICT when
 * `expectedUpdatedAt` is stale. The body of a success is not relied on: callers refetch the asset.
 */
export async function archiveMedia(id: string, guard: { expectedUpdatedAt: string; reason: string }): Promise<void> {
  const mediaId = safeMediaId.parse(id);
  mediaGuardResultSchema.parse(await apiPost<unknown>(`admin/media/${mediaId}/archive`, mediaGuardSchema.parse(guard)));
}

export async function restoreMedia(id: string, guard: { expectedUpdatedAt: string; reason: string }): Promise<void> {
  const mediaId = safeMediaId.parse(id);
  mediaGuardResultSchema.parse(await apiPost<unknown>(`admin/media/${mediaId}/restore`, mediaGuardSchema.parse(guard)));
}

export async function uploadMediaFile(
  file: File,
  metadata: MediaUploadMetadata,
  options: { signal?: AbortSignal; onProgress?: (progress: { loaded: number; total: number; percent: number }) => void; timeoutMs?: number } = {},
): Promise<MediaUploadResult> {
  if (file.name.trim().length < 1 || file.name.length > 200) throw new ApiError(400, 'VALIDATION_FAILED', 'File name must be 1–200 characters.');
  const details = mediaUploadMetadataSchema.parse(metadata);
  const signature = await readMediaPrefix(file);
  const kind = sniffMediaKind(signature);
  const fileError = mediaFileError(kind, file.size);
  if (fileError) throw new ApiError(400, 'VALIDATION_FAILED', fileError);
  if (kind === 'image' && !details.alt && !details.decorative) throw new ApiError(400, 'VALIDATION_FAILED', 'Add meaningful alternative text or mark this image explicitly decorative.');

  // Only the file name travels in the URL. Rights details go in the X-JW-Upload-Meta header so they stay out of access logs and browser history.
  const params = { filename: file.name };
  const metaHeader = encodeUploadMeta({
    alt: details.alt, provenance: details.provenance, folder: details.folder, license: details.license,
    rightsHolder: details.rightsHolder, provenanceNote: details.provenanceNote, consentReference: details.consentReference,
  });
  return new Promise<MediaUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    if (options.signal?.aborted) { reject(new ApiError(0, 'REQUEST_CANCELLED', 'The upload was cancelled.')); return; }
    options.signal?.addEventListener('abort', abort, { once: true });
    xhr.timeout = options.timeoutMs ?? 90_000;
    xhr.open('POST', apiEndpoint('admin/media', params));
    xhr.withCredentials = true;
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('x-jw-upload-meta', metaHeader);
    const csrf = csrfToken();
    if (csrf) xhr.setRequestHeader('x-csrf-token', csrf);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.({ loaded: event.loaded, total: event.total, percent: Math.round((event.loaded / event.total) * 100) });
    };
    xhr.onerror = () => reject(new ApiError(0, 'UNAVAILABLE', 'The upload connection failed. Its final status is unknown; do not retry until the library has been refreshed.', undefined, true));
    xhr.onabort = () => reject(new ApiError(0, 'REQUEST_CANCELLED', 'The upload was cancelled. If it had already reached the server, refresh the library before trying again.'));
    xhr.ontimeout = () => reject(new ApiError(0, 'TIMEOUT', 'The upload timed out. Its final status is unknown; refresh the library before trying again.', undefined, true));
    xhr.onload = () => {
      const headers = new Headers();
      const contentType = xhr.getResponseHeader('content-type');
      const requestId = xhr.getResponseHeader('x-request-id');
      if (contentType) headers.set('content-type', contentType);
      if (requestId) headers.set('x-request-id', requestId);
      const response = new Response(xhr.responseText, { status: xhr.status, headers });
      if (xhr.status !== 200 && xhr.status !== 201) { void apiErrorFromResponse(response).then(reject); return; }
      try {
        const parsed = mediaUploadResultSchema.safeParse(JSON.parse(xhr.responseText) as unknown);
        if (!parsed.success) { reject(new ApiError(502, 'CONTRACT_DRIFT', 'The media upload response did not match the documented resource shape.', requestId ?? undefined)); return; }
        if (details.decorative && !parsed.data.duplicate) {
          void updateMedia(parsed.data.id, { decorative: true }).then((updated) => resolve({ ...updated, duplicate: false })).catch((error: unknown) => {
            reject(error instanceof ApiError ? error : new ApiError(502, 'MEDIA_METADATA_UNCERTAIN', 'The file uploaded, but its decorative setting did not save. Refresh the library before retrying.', requestId ?? undefined));
          });
          return;
        }
        resolve(parsed.data);
      } catch { reject(new ApiError(502, 'CONTRACT_DRIFT', 'The media upload response was not valid JSON.', requestId ?? undefined)); }
    };
    xhr.onloadend = () => options.signal?.removeEventListener('abort', abort);
    xhr.send(file);
  });
}

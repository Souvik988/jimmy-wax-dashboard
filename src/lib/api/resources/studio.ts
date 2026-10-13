import { z } from 'zod';

import { apiDelete, apiGet, apiPatch, apiPost, apiPut, type ApiPath } from '@/lib/api/client';

/** Experience Studio resource. Shapes verified against the running backend (adminB9Routes.ts) on 2026-10-08. */

export const channels = ['app', 'web'] as const;
export type Channel = (typeof channels)[number];
export const docKinds = ['tokens', 'navigation', 'chrome', 'page'] as const;
export type DocKind = (typeof docKinds)[number];

export const appPageKeys = ['home', 'category', 'product', 'cart'] as const;
export const webPageKeys = ['home', 'shop', 'product', 'ritual', 'story'] as const;
export function pageKeysFor(channel: Channel): readonly string[] { return channel === 'app' ? appPageKeys : webPageKeys; }

const releaseSummary = z.object({ id: z.string(), number: z.number(), label: z.string(), publishedAt: z.string().nullable().optional() }).passthrough();

export const channelStateSchema = z.object({
  channel: z.enum(channels),
  enabled: z.boolean(),
  killReason: z.string().nullable(),
  killedAt: z.string().nullable(),
  live: releaseSummary.nullable(),
}).passthrough();
export type ChannelState = z.infer<typeof channelStateSchema>;

export const docSummarySchema = z.object({
  channel: z.string(),
  kind: z.enum(docKinds),
  key: z.string(),
  rev: z.number(),
  etag: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string().nullable(),
  dirtyVsLive: z.boolean(),
}).passthrough();
export type DocSummary = z.infer<typeof docSummarySchema>;

export const docSchema = z.object({
  channel: z.string(),
  kind: z.enum(docKinds),
  key: z.string(),
  rev: z.number(),
  etag: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string().nullable(),
  body: z.record(z.string(), z.unknown()),
}).passthrough();
export type StudioDoc = z.infer<typeof docSchema>;

export const revisionSchema = z.object({
  rev: z.number(),
  updatedBy: z.string().nullable(),
  createdAt: z.string(),
  body: z.record(z.string(), z.unknown()),
}).passthrough();
export type Revision = z.infer<typeof revisionSchema>;

const issueSchema = z.object({
  level: z.string(),
  code: z.string(),
  docKey: z.string().optional(),
  message: z.string(),
  blockId: z.string().optional(),
  path: z.string().optional(),
}).passthrough();
export const validationReportSchema = z.object({
  errors: z.array(issueSchema),
  warnings: z.array(issueSchema),
  infos: z.array(issueSchema),
  canPublish: z.boolean(),
  checkedAt: z.string(),
}).passthrough();
export type ValidationReport = z.infer<typeof validationReportSchema>;
export type ValidationIssue = z.infer<typeof issueSchema>;

export const diffSchema = z.object({
  against: z.string(),
  docs: z.array(z.object({ doc: z.string(), status: z.string(), summary: z.array(z.string()) }).passthrough()),
}).passthrough();
export type ChannelDiff = z.infer<typeof diffSchema>;

export const variableSchema = z.object({ name: z.string(), token: z.string(), value: z.string().nullable() });
export type StudioVariable = z.infer<typeof variableSchema>;

export const releaseSchema = z.object({
  id: z.string(),
  channel: z.enum(channels),
  number: z.number(),
  status: z.string(),
  label: z.string(),
  note: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  activatedAt: z.string().nullable(),
  rollbackOf: z.string().nullable(),
  createdAt: z.string(),
  checksum: z.string().optional(),
}).passthrough();
export type Release = z.infer<typeof releaseSchema>;

export const campaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.string(),
  app: z.record(z.string(), z.unknown()).nullable().optional(),
  web: z.record(z.string(), z.unknown()).nullable().optional(),
  rev: z.number().optional(),
}).passthrough();
export type Campaign = z.infer<typeof campaignSchema>;
export type CampaignInput = { name: string; startsAt: string; endsAt: string; app?: Record<string, unknown> | null; web?: Record<string, unknown> | null; status?: 'draft' | 'active' | 'archived' };

export const presenceSchema = z.object({ items: z.array(z.object({ pageKey: z.string(), userId: z.string(), label: z.string(), seenAt: z.string() })) });
export type PresenceItem = z.infer<typeof presenceSchema>['items'][number];

export const libraryEntities = ['care-guides', 'stories', 'journal', 'testimonials', 'faq-groups', 'announcements'] as const;
export type LibraryEntity = (typeof libraryEntities)[number];
export const libraryItemSchema = z.object({ id: z.string() }).passthrough();
export type LibraryItem = z.infer<typeof libraryItemSchema>;

function docPath(channel: string, kind: string, key: string): ApiPath {
  return `admin/experience/${channel}/docs/${kind}/${key}` as ApiPath;
}

export async function getExperienceState(signal?: AbortSignal): Promise<ChannelState[]> {
  const payload = await apiGet<unknown>('admin/experience/state', signal ? { signal } : {});
  return z.object({ channels: z.array(channelStateSchema) }).parse(payload).channels;
}
export async function getVariables(signal?: AbortSignal): Promise<StudioVariable[]> {
  return z.object({ items: z.array(variableSchema) }).parse(await apiGet<unknown>('admin/experience/variables', signal ? { signal } : {})).items;
}
export async function listDocs(channel: string, signal?: AbortSignal): Promise<DocSummary[]> {
  return z.object({ items: z.array(docSummarySchema) }).parse(await apiGet<unknown>(`admin/experience/${channel}/docs` as ApiPath, signal ? { signal } : {})).items;
}
export async function getDoc(channel: string, kind: string, key: string, signal?: AbortSignal): Promise<StudioDoc> {
  return docSchema.parse(await apiGet<unknown>(docPath(channel, kind, key), signal ? { signal } : {}));
}
/** Body is the document itself (not wrapped). `etag` is the quoted revision the editor loaded; "0" creates. */
export async function putDoc(channel: string, kind: string, key: string, body: Record<string, unknown>, etag: string): Promise<StudioDoc> {
  return docSchema.parse(await apiPut<unknown>(docPath(channel, kind, key), body, { ifMatch: etag }));
}
export async function deleteDoc(channel: string, kind: string, key: string): Promise<void> {
  await apiDelete<unknown>(docPath(channel, kind, key));
}
/** Returns a draft to the live (last published) version as a NEW revision; needs the loaded etag and a reason. Standard pages cannot be deleted, so this is how a draft is abandoned. */
export async function discardDraft(channel: string, kind: string, key: string, etag: string, reason: string): Promise<StudioDoc> {
  const body = z.object({ reason: z.string().trim().min(3).max(300) }).strict().parse({ reason });
  return docSchema.parse(await apiPost<unknown>(`${docPath(channel, kind, key)}/discard-draft` as ApiPath, body, { ifMatch: etag }));
}
export async function listRevisions(channel: string, kind: string, key: string, signal?: AbortSignal): Promise<Revision[]> {
  return z.object({ items: z.array(revisionSchema) }).parse(await apiGet<unknown>(`${docPath(channel, kind, key)}/revisions` as ApiPath, signal ? { signal } : {})).items;
}
export async function validateChannel(channel: Channel): Promise<ValidationReport> {
  return validationReportSchema.parse(await apiPost<unknown>(`admin/experience/${channel}/validate` as ApiPath, {}));
}
export async function getDiff(channel: Channel, signal?: AbortSignal): Promise<ChannelDiff> {
  return diffSchema.parse(await apiGet<unknown>(`admin/experience/${channel}/diff` as ApiPath, signal ? { signal } : {}));
}
export async function heartbeat(channel: Channel, pageKey: string): Promise<void> {
  await apiPut<unknown>(`admin/experience/${channel}/presence` as ApiPath, { pageKey });
}
export async function getPresence(channel: Channel, signal?: AbortSignal): Promise<PresenceItem[]> {
  return presenceSchema.parse(await apiGet<unknown>(`admin/experience/${channel}/presence` as ApiPath, signal ? { signal } : {})).items;
}

export async function listReleases(filters: { channel?: Channel; status?: string } = {}, signal?: AbortSignal): Promise<Release[]> {
  return z.object({ items: z.array(releaseSchema) }).parse(await apiGet<unknown>('admin/experience/releases', { params: { ...filters, limit: 50 }, ...(signal ? { signal } : {}) })).items;
}
export async function createRelease(input: { channels: Channel[]; label: string; note?: string; scheduledAt?: string; confirmReplaceScheduled?: boolean }, idempotencyKey: string): Promise<unknown> {
  return apiPost<unknown>('admin/experience/releases', input, { idempotencyKey });
}
export async function rollbackRelease(id: string, reason: string, confirmReplaceScheduled?: boolean): Promise<unknown> {
  return apiPost<unknown>(`admin/experience/releases/${id}/rollback` as ApiPath, { reason, ...(confirmReplaceScheduled ? { confirmReplaceScheduled } : {}) });
}
export async function cancelRelease(id: string): Promise<unknown> {
  return apiPost<unknown>(`admin/experience/releases/${id}/cancel` as ApiPath, {});
}
export async function setKillSwitch(channel: Channel, enabled: boolean, reason: string): Promise<unknown> {
  return apiPost<unknown>(`admin/experience/${channel}/kill` as ApiPath, { enabled, reason });
}
export async function createPreviewToken(channel: Channel, ttlMinutes: number): Promise<{ id?: string | undefined; token: string; expiresAt: string; path: string }> {
  return z.object({ id: z.string().optional(), token: z.string(), expiresAt: z.string(), path: z.string() }).passthrough().parse(await apiPost<unknown>(`admin/experience/${channel}/preview-tokens` as ApiPath, { ttlMinutes }));
}
export async function revokePreviewToken(id: string): Promise<void> {
  await apiDelete<unknown>(`admin/experience/preview-tokens/${id}` as ApiPath);
}

export async function listCampaigns(signal?: AbortSignal): Promise<Campaign[]> {
  return z.object({ items: z.array(campaignSchema) }).parse(await apiGet<unknown>('admin/experience/campaigns', signal ? { signal } : {})).items;
}
export async function createCampaign(input: CampaignInput): Promise<Campaign> {
  return campaignSchema.parse(await apiPost<unknown>('admin/experience/campaigns', input));
}
export async function updateCampaign(id: string, input: CampaignInput, rev: number): Promise<Campaign> {
  return campaignSchema.parse(await apiPut<unknown>(`admin/experience/campaigns/${id}` as ApiPath, input, { ifMatch: `"${rev}"` }));
}

export async function listLibrary(entity: LibraryEntity, status?: string, signal?: AbortSignal): Promise<LibraryItem[]> {
  return z.object({ items: z.array(libraryItemSchema) }).parse(await apiGet<unknown>(`admin/content-library/${entity}` as ApiPath, { ...(status ? { params: { status } } : {}), ...(signal ? { signal } : {}) })).items;
}
export async function createLibraryItem(entity: LibraryEntity, body: Record<string, unknown>): Promise<LibraryItem> {
  return libraryItemSchema.parse(await apiPost<unknown>(`admin/content-library/${entity}` as ApiPath, body));
}
export async function updateLibraryItem(entity: LibraryEntity, id: string, body: Record<string, unknown>, rev: number): Promise<LibraryItem> {
  return libraryItemSchema.parse(await apiPatch<unknown>(`admin/content-library/${entity}/${id}` as ApiPath, body, { ifMatch: `"${rev}"` }));
}
export async function deleteLibraryItem(entity: LibraryEntity, id: string): Promise<void> {
  await apiDelete<unknown>(`admin/content-library/${entity}/${id}` as ApiPath);
}

// ----------------------------------------------- catalogue lookups for the Action picker
const lookupProduct = z.object({ id: z.string(), name: z.string(), active: z.boolean(), archived: z.boolean(), variants: z.array(z.object({ active: z.boolean().optional(), onHand: z.number().optional(), reserved: z.number().optional() }).passthrough()).optional() }).passthrough();
export type LookupProduct = z.infer<typeof lookupProduct>;
export async function searchProducts(q: string, signal?: AbortSignal): Promise<LookupProduct[]> {
  return z.object({ items: z.array(lookupProduct) }).passthrough().parse(await apiGet<unknown>('admin/products', { params: { limit: 15, ...(q ? { q } : {}) }, ...(signal ? { signal } : {}) })).items;
}
const lookupNamed = z.object({ id: z.string(), name: z.string(), active: z.boolean().optional() }).passthrough();
export type LookupNamed = z.infer<typeof lookupNamed>;
export async function listCategoryLookups(signal?: AbortSignal): Promise<LookupNamed[]> {
  return z.object({ items: z.array(lookupNamed) }).passthrough().parse(await apiGet<unknown>('admin/categories', signal ? { signal } : {})).items;
}
export async function listCollectionLookups(signal?: AbortSignal): Promise<LookupNamed[]> {
  return z.object({ items: z.array(lookupNamed) }).passthrough().parse(await apiGet<unknown>('admin/collections', signal ? { signal } : {})).items;
}

/** Exact lookup used by the Action picker to warn about a target's state; resolves null for an unknown id. */
export async function getProductLookup(id: string, signal?: AbortSignal): Promise<LookupProduct | null> {
  try {
    return lookupProduct.parse(await apiGet<unknown>(`admin/products/${id}` as ApiPath, signal ? { signal } : {}));
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'status' in error && (error as { status: number }).status === 404) return null;
    throw error;
  }
}

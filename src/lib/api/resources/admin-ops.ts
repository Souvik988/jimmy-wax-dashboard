/* eslint-disable @typescript-eslint/no-explicit-any -- passthrough backend payloads are intentionally loosely typed */
import { z } from 'zod';

import { apiDelete, apiDownload, apiGet, apiPatch, apiPost, apiPut, type ApiPath } from '@/lib/api/client';

/** Customers, reviews, coupons, templates, analytics, audit, ops, settings, team, flags, versions, integrations.
 *  Shapes verified against the running backend 2026-10-08 (adminRoutes.ts, adminB8/B11/B12Routes.ts). Loose (passthrough) where the backend adds fields. */

const opt = (signal?: AbortSignal) => (signal ? { signal } : {});
const items = <T extends z.ZodTypeAny>(schema: T) => z.object({ items: z.array(schema) }).passthrough();

// ---------------------------------------------------------------- customers
export const customerSchema = z.object({
  id: z.string(), name: z.string(), email: z.string().nullable(), phone: z.string().nullable(), status: z.string(), blocked: z.boolean(),
  tags: z.array(z.string()), orders: z.number(), lifetimeSpendPaise: z.number(), lastOrderAt: z.string().nullable(), joinedAt: z.string(),
}).passthrough();
export type Customer = z.infer<typeof customerSchema>;
export const customerDetailSchema = customerSchema.extend({
  notes: z.string(), blockedReason: z.string().nullable(), addressCount: z.number(),
  recentOrders: z.array(z.object({ id: z.string(), orderNumber: z.string(), status: z.string(), paymentMethod: z.string(), totalPaise: z.number(), createdAt: z.string() })),
}).passthrough();
export type CustomerDetail = z.infer<typeof customerDetailSchema>;
export const revealSchema = z.object({
  name: z.string(), email: z.string().nullable(), phone: z.string().nullable(),
  addresses: z.array(z.object({ name: z.string().nullable(), phone: z.string().nullable(), line1: z.string(), landmark: z.string().nullable(), city: z.string(), state: z.string(), pin: z.string() }).passthrough()),
}).passthrough();
export type Reveal = z.infer<typeof revealSchema>;

export async function listCustomers(f: { q?: string | undefined; tag?: string | undefined; blocked?: boolean | undefined }, cursor: string | null, signal: AbortSignal) {
  const params: Record<string, string | number | boolean | undefined> = { limit: 25, ...(cursor ? { cursor } : {}), ...(f.q ? { q: f.q } : {}), ...(f.tag ? { tag: f.tag } : {}), ...(f.blocked !== undefined ? { blocked: f.blocked } : {}) };
  return z.object({ items: z.array(customerSchema), nextCursor: z.string().nullable() }).passthrough().parse(await apiGet<unknown>('admin/customers', { params, signal }));
}
export async function getCustomer(id: string, signal?: AbortSignal): Promise<CustomerDetail> {
  return customerDetailSchema.parse(await apiGet<unknown>(`admin/customers/${id}` as ApiPath, opt(signal)));
}
export async function revealCustomer(id: string, reason: string): Promise<Reveal> {
  return revealSchema.parse(await apiPost<unknown>(`admin/customers/${id}/reveal` as ApiPath, { reason }));
}
export async function updateCustomerNotes(id: string, patch: { notes?: string; tags?: string[] }): Promise<CustomerDetail> {
  return customerDetailSchema.parse(await apiPatch<unknown>(`admin/customers/${id}` as ApiPath, patch));
}
export async function blockCustomer(id: string, blocked: boolean, reason: string): Promise<unknown> {
  return apiPost<unknown>(`admin/customers/${id}/block` as ApiPath, { blocked, reason });
}

// ------------------------------------------------------------------ reviews
export const reviewSchema = z.object({
  id: z.string(), productId: z.string(), rating: z.number(), title: z.string().nullable(), body: z.string().nullable(), status: z.string(), verifiedPurchase: z.boolean(), createdAt: z.string(),
  photos: z.array(z.object({ id: z.string(), status: z.string(), width: z.number().nullable(), height: z.number().nullable() }).passthrough()),
}).passthrough();
export type Review = z.infer<typeof reviewSchema>;
export async function listReviews(status: 'pending' | 'approved' | 'rejected', signal?: AbortSignal): Promise<Review[]> {
  return items(reviewSchema).parse(await apiGet<unknown>('admin/reviews', { params: { status }, ...opt(signal) })).items as Review[];
}
export async function moderateReview(id: string, approve: boolean, note: string): Promise<void> {
  await apiPost<unknown>(`admin/reviews/${id}/moderate` as ApiPath, { approve, note });
}
export async function moderateReviewPhoto(id: string, approve: boolean): Promise<void> {
  await apiPost<unknown>(`admin/review-media/${id}/moderate` as ApiPath, { approve });
}

// ------------------------------------------------------------------ coupons
export const couponSchema = z.object({ id: z.string(), code: z.string() }).passthrough();
export type Coupon = z.infer<typeof couponSchema> & Record<string, unknown>;
export type CouponInput = {
  code: string; description?: string; kind: 'percentage' | 'flat' | 'free_shipping'; valueBps?: number | null; valuePaise?: number | null; minOrderPaise?: number;
  maxDiscountPaise?: number | null; startsAt?: string | null; endsAt?: string | null; usageLimitTotal?: number | null; usageLimitPerCustomer?: number; firstOrderOnly?: boolean; scopeProductIds?: string[]; active?: boolean;
};
export async function listCoupons(status: string | undefined, cursor: string | null, signal: AbortSignal) {
  const page = z.object({ items: z.array(couponSchema), nextCursor: z.string().nullable().optional() }).passthrough().parse(await apiGet<unknown>('admin/coupons', { params: { limit: 25, ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) }, signal }));
  return { items: page.items as Coupon[], nextCursor: page.nextCursor ?? null };
}
export const couponAnalyticsSchema = z.object({ redemptions: z.number(), discountGivenPaise: z.number(), orderRevenuePaise: z.number(), top: z.array(z.object({}).passthrough()) }).passthrough();
export async function getCouponAnalytics(signal?: AbortSignal) { return couponAnalyticsSchema.parse(await apiGet<unknown>('admin/coupons/analytics', opt(signal))); }
export async function createCoupon(input: CouponInput): Promise<Coupon> { return couponSchema.parse(await apiPost<unknown>('admin/coupons', input)) as Coupon; }
export async function updateCoupon(id: string, patch: Partial<Omit<CouponInput, 'code'>>): Promise<Coupon> { return couponSchema.parse(await apiPatch<unknown>(`admin/coupons/${id}` as ApiPath, patch)) as Coupon; }
export async function deactivateCoupon(id: string): Promise<Coupon> { return couponSchema.parse(await apiPost<unknown>(`admin/coupons/${id}/deactivate` as ApiPath, {})) as Coupon; }

// --------------------------------------------------------- message templates
export const templateSchema = z.object({
  key: z.string(), variables: z.array(z.string()), default: z.object({ subject: z.string(), body: z.string() }),
  override: z.object({ subject: z.string(), body: z.string(), enabled: z.boolean(), updatedAt: z.string() }).nullable(),
});
export type MessageTemplate = z.infer<typeof templateSchema>;
export async function listTemplates(signal?: AbortSignal) { return items(templateSchema).parse(await apiGet<unknown>('admin/message-templates', opt(signal))).items as MessageTemplate[]; }
export async function saveTemplate(key: string, input: { subject: string; body: string; enabled: boolean }) { return templateSchema.parse(await apiPut<unknown>(`admin/message-templates/${key}` as ApiPath, input)); }
export async function resetTemplate(key: string) { await apiDelete<unknown>(`admin/message-templates/${key}` as ApiPath); }
export async function testTemplate(key: string, input: { subject?: string; body?: string; send: boolean }) {
  return z.object({ subject: z.string(), body: z.string(), sent: z.boolean(), sender: z.string() }).parse(await apiPost<unknown>(`admin/message-templates/${key}/test` as ApiPath, input));
}
export async function listEmailOutbox(signal?: AbortSignal) { return items(z.object({ id: z.number(), template: z.string(), status: z.string(), createdAt: z.string() }).passthrough()).parse(await apiGet<unknown>('admin/outbox/emails', opt(signal))).items; }

// ---------------------------------------------------------------- analytics
export const analyticsNames = ['sales', 'products', 'customers', 'shipping', 'returns', 'geo', 'gst'] as const;
export type AnalyticsName = (typeof analyticsNames)[number];
export async function getAnalytics(name: AnalyticsName, range: { from?: string; to?: string }, signal?: AbortSignal): Promise<Record<string, any>> {
  return z.record(z.string(), z.any()).parse(await apiGet<unknown>(`admin/analytics/${name}` as ApiPath, { params: { ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) }, ...opt(signal) }));
}

// ------------------------------------------------------------------ GSTR-1 working paper
const gstAmount = z.number().int().safe();
export const gstr1Schema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
  merchantStateCode: z.string().nullable(),
  orders: z.number().int().nonnegative(),
  b2cs: z.array(z.object({ placeOfSupply: z.string(), rateBps: z.number().int(), taxablePaise: gstAmount, igstPaise: gstAmount, cgstPaise: gstAmount, sgstPaise: gstAmount, orders: z.number().int() })),
  hsn: z.array(z.object({ hsn: z.string(), description: z.string(), uqc: z.string(), quantity: z.number().int(), totalValuePaise: gstAmount, taxablePaise: gstAmount, igstPaise: gstAmount, cgstPaise: gstAmount, sgstPaise: gstAmount, rateBps: z.number().int() })),
  totals: z.object({ taxablePaise: gstAmount, igstPaise: gstAmount, cgstPaise: gstAmount, sgstPaise: gstAmount }),
  warnings: z.array(z.string()),
});
export type Gstr1Report = z.infer<typeof gstr1Schema>;
export const gstr1MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u, 'Choose a month.');
export async function getGstr1(month: string, signal?: AbortSignal): Promise<Gstr1Report> {
  return gstr1Schema.parse(await apiGet<unknown>('admin/analytics/gstr1', { params: { month: gstr1MonthSchema.parse(month) }, ...opt(signal) }));
}
export async function downloadGstr1Csv(month: string, table: 'b2cs' | 'hsn') {
  return apiDownload('admin/analytics/gstr1', { params: { month: gstr1MonthSchema.parse(month), format: 'csv', table } });
}

// -------------------------------------------------------------------- audit
export const auditSchema = z.object({
  id: z.number(), actorId: z.string().nullable(), actorRole: z.string().nullable(), action: z.string(), resourceType: z.string().nullable(), resourceId: z.string().nullable(),
  reason: z.string().nullable(), before: z.unknown(), after: z.unknown(), requestId: z.string().nullable(), createdAt: z.string(),
});
export type AuditEntry = z.infer<typeof auditSchema>;
export async function listAudit(resourceType: string | undefined, signal?: AbortSignal): Promise<AuditEntry[]> {
  return items(auditSchema).parse(await apiGet<unknown>('admin/audit', { ...(resourceType ? { params: { resourceType } } : {}), ...opt(signal) })).items as AuditEntry[];
}

// ---------------------------------------------------------------------- ops
export const healthSchema = z.object({ outbox: z.object({ dead: z.number(), pending: z.number() }), alerts: z.array(z.string()) }).passthrough();
export async function getOpsHealth(signal?: AbortSignal) { return healthSchema.parse(await apiGet<unknown>('admin/health', opt(signal))); }
export const outboxSchema = z.object({ id: z.number(), eventType: z.string(), aggregateId: z.string().nullable(), attempts: z.number(), lastError: z.string().nullable(), createdAt: z.string(), dead: z.boolean() });
export type OutboxEvent = z.infer<typeof outboxSchema>;
export async function listOutbox(state: 'dead' | 'pending', signal?: AbortSignal) { return items(outboxSchema).parse(await apiGet<unknown>('admin/ops/outbox', { params: { state }, ...opt(signal) })).items as OutboxEvent[]; }
export async function replayOutbox(id: number, reason: string) { await apiPost<unknown>(`admin/ops/outbox/${id}/replay` as ApiPath, { reason }); }

// ----------------------------------------------------------------- settings
export const settingsSchema = z.object({
  settings: z.object({
    shippingFeePaise: z.number(), freeShippingThresholdPaise: z.number().nullable(), codEnabled: z.boolean(), codMaxOrderPaise: z.number().nullable(),
    onlinePaymentsEnabled: z.boolean(), paymentWindowMinutes: z.number().nullable(), checkoutEnabled: z.boolean(), checkoutPolicyConfirmed: z.boolean(),
    codFeePaise: z.number(), gstRateBps: z.number(), taxInclusive: z.boolean(), returnWindowDays: z.number().nullable(), merchantLegalName: z.string().nullable(),
    merchantGstin: z.string().nullable(), merchantState: z.string().nullable(), merchantAddress: z.string().nullable(), brandName: z.string(),
    supportEmail: z.string().nullable(), supportPhone: z.string().nullable(), ordersPaused: z.boolean(), pauseMessage: z.string(), version: z.number(),
  }).passthrough(),
  readiness: z.object({ allOk: z.boolean(), checks: z.array(z.object({ id: z.string(), ok: z.boolean(), detail: z.string() }).passthrough()) }).passthrough(),
}).passthrough();
export type SettingsView = z.infer<typeof settingsSchema>;
export type SettingsPatch = { expectedVersion: number; reason: string } & Partial<Record<string, string | number | boolean | null>>;
export async function getSettings(signal?: AbortSignal) { return settingsSchema.parse(await apiGet<unknown>('admin/settings', opt(signal))); }
export async function patchSettings(patch: SettingsPatch): Promise<void> { await apiPatch<unknown>('admin/settings', patch); }

// --------------------------------------------------------- team, flags, etc.
export const teamSchema = z.object({
  members: z.array(z.object({ userId: z.string(), email: z.string(), role: z.string(), disabled: z.boolean(), mfaEnrolled: z.boolean().optional(), lastLogin: z.string().nullable().optional(), createdAt: z.string().optional() }).passthrough()),
  invites: z.array(z.object({ id: z.string(), email: z.string(), role: z.string(), expiresAt: z.string().optional() }).passthrough()).default([]),
}).passthrough();
export type Team = z.infer<typeof teamSchema>;
export async function getTeam(signal?: AbortSignal) { return teamSchema.parse(await apiGet<unknown>('admin/team', opt(signal))); }
export async function inviteMember(input: { email: string; role: string }) { return apiPost<unknown>('admin/team/invite', input); }
export async function revokeInvite(id: string) { await apiDelete<unknown>(`admin/team/invites/${id}` as ApiPath); }
export async function updateMember(id: string, patch: { role?: string; disabled?: boolean }) { return apiPatch<unknown>(`admin/team/${id}` as ApiPath, patch); }
export async function resetMemberMfa(id: string) { await apiPost<unknown>(`admin/team/${id}/reset-mfa` as ApiPath, {}); }

export const flagSchema = z.object({ key: z.string(), description: z.string(), enabled: z.boolean(), rolloutPercent: z.number(), updatedAt: z.string() });
export type Flag = z.infer<typeof flagSchema>;
export async function listFlags(signal?: AbortSignal) { return items(flagSchema).parse(await apiGet<unknown>('admin/flags', opt(signal))).items as Flag[]; }
export async function saveFlag(flag: { key: string; description: string; enabled: boolean; rolloutPercent: number }) { const { key, ...rest } = flag; return apiPut<unknown>(`admin/flags/${key}` as ApiPath, rest); }
export async function deleteFlag(key: string) { await apiDelete<unknown>(`admin/flags/${key}` as ApiPath); }

export const appVersionSchema = z.object({ platform: z.enum(['android', 'ios']), latestVersion: z.string(), minSupportedVersion: z.string(), storeUrl: z.string(), message: z.string(), updatedAt: z.string() }).passthrough();
export type AppVersion = z.infer<typeof appVersionSchema>;
export async function listAppVersions(signal?: AbortSignal) { return items(appVersionSchema).parse(await apiGet<unknown>('admin/app-versions', opt(signal))).items as AppVersion[]; }
export async function saveAppVersion(platform: 'android' | 'ios', input: { latestVersion: string; minSupportedVersion: string; storeUrl: string; message: string }) { return apiPut<unknown>(`admin/app-versions/${platform}` as ApiPath, input); }

export const integrationSchema = z.object({ name: z.string(), configured: z.boolean(), facts: z.record(z.string(), z.unknown()), lastCheck: z.unknown() }).passthrough();
export type Integration = z.infer<typeof integrationSchema>;
export async function listIntegrations(signal?: AbortSignal) { return items(integrationSchema).parse(await apiGet<unknown>('admin/integrations', opt(signal))).items as Integration[]; }
export async function testIntegration(name: string) { return apiPost<unknown>(`admin/integrations/${name}/test` as ApiPath, {}); }

// ------------------------------------------------------- policy / content pages
export const contentKinds = ['policy', 'care_guide', 'page'] as const;
export const contentSummarySchema = z.object({ slug: z.string(), kind: z.string(), title: z.string(), version: z.number(), status: z.string(), updatedAt: z.string() }).passthrough();
export type ContentSummary = z.infer<typeof contentSummarySchema>;
export const contentPageSchema = z.object({ slug: z.string(), kind: z.string(), title: z.string(), bodyMd: z.string(), version: z.number(), status: z.string() }).passthrough();
export type ContentPage = z.infer<typeof contentPageSchema>;
export async function listContent(signal?: AbortSignal): Promise<ContentSummary[]> { return items(contentSummarySchema).parse(await apiGet<unknown>('admin/content', opt(signal))).items as ContentSummary[]; }
export async function getContent(slug: string, signal?: AbortSignal): Promise<ContentPage> { return contentPageSchema.parse(await apiGet<unknown>(`admin/content/${slug}` as ApiPath, opt(signal))); }
export async function saveContent(slug: string, input: { kind: string; title: string; bodyMd: string; expectedVersion?: number }): Promise<unknown> { return apiPut<unknown>(`admin/content/${slug}` as ApiPath, input); }
export async function publishContent(slug: string): Promise<void> { await apiPost<unknown>(`admin/content/${slug}/publish` as ApiPath, {}); }

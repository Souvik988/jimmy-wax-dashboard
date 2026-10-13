import { z } from 'zod';

import { apiGet, apiPost, apiPut } from '../client';

const paise = z.number().int().safe();
const count = z.number().int().nonnegative();

export const dashboardSchema = z.object({
  definitions: z.object({ window: z.string(), currency: z.string(), ordersByStatus: z.string() }),
  ordersByStatus: z.array(z.object({ status: z.string(), count, totalPaise: paise })),
  lowStockVariants: count,
  paymentExceptions: count,
  refundsOpen: count,
  outbox: z.object({ pending: count, deadLetters: count, oldestPendingSeconds: count }),
});

export const healthSchema = z.object({
  outbox: z.object({ dead: count, pending: count }),
  email: z.object({ failed: count, pending: count }),
  shippingEvents: z.object({ unprocessed: count }),
  bulkJobs: z.object({ active: count }),
  stuckShipmentRequests: count,
  lowStockVariants: count,
  provider: z.string(),
  paymentProvider: z.string(),
  alerts: z.array(z.string()),
});

export const storeStatusSchema = z.object({
  ordersPaused: z.boolean(),
  pauseMessage: z.string(),
  checkoutOpen: z.boolean(),
  codEnabled: z.boolean(),
  onlinePaymentsEnabled: z.boolean(),
});

export const settingsSchema = z.object({
  settings: z.object({
    shippingFeePaise: paise,
    freeShippingThresholdPaise: paise.nullable(),
    codEnabled: z.boolean(),
    codMaxOrderPaise: paise.nullable(),
    onlinePaymentsEnabled: z.boolean(),
    paymentWindowMinutes: count.nullable(),
    checkoutEnabled: z.boolean(),
    checkoutPolicyConfirmed: z.boolean(),
    checkoutAuthority: z.string().nullable(),
    codFeePaise: paise,
    gstRateBps: count,
    taxInclusive: z.boolean(),
    returnWindowDays: count.nullable(),
    merchantLegalName: z.string().nullable(),
    merchantGstin: z.string().nullable(),
    merchantState: z.string().nullable(),
    merchantAddress: z.string().nullable(),
    brandName: z.string(),
    supportEmail: z.string().nullable(),
    supportPhone: z.string().nullable(),
    ordersPaused: z.boolean(),
    pauseMessage: z.string(),
    version: count,
  }),
  readiness: z.object({
    allOk: z.boolean(),
    checks: z.array(z.object({ id: z.string(), ok: z.boolean(), detail: z.string() })),
  }),
});

const integrationFactSchema = z.union([z.string(), z.boolean(), z.number(), z.null()]);
export const integrationsSchema = z.object({
  items: z.array(z.object({
    name: z.string(),
    configured: z.boolean(),
    facts: z.record(z.string(), integrationFactSchema),
    lastCheck: z.object({ ok: z.boolean(), detail: z.string(), at: z.string().datetime() }).nullable(),
  })),
});

export const auditSchema = z.object({
  items: z.array(z.object({
    id: count,
    actorId: z.string(),
    actorRole: z.string(),
    action: z.string(),
    resourceType: z.string(),
    resourceId: z.string(),
    reason: z.string().nullable(),
    before: z.unknown(),
    after: z.unknown(),
    requestId: z.string().nullable(),
    createdAt: z.string().datetime(),
  })),
});

export const salesSchema = z.object({
  range: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
  definitions: z.object({ sales: z.string(), aov: z.string() }),
  totals: z.object({ orders: count, revenuePaise: paise, aovPaise: paise, discountPaise: paise }),
  series: z.array(z.object({
    bucket: z.string().date(), orders: count, subtotalPaise: paise, discountPaise: paise,
    shippingPaise: paise, taxPaise: paise, revenuePaise: paise, aovPaise: paise,
  })),
  byPaymentMethod: z.array(z.object({ method: z.string(), orders: count, revenuePaise: paise })),
});

export type DashboardSnapshot = z.infer<typeof dashboardSchema>;
export type HealthSnapshot = z.infer<typeof healthSchema>;
export type StoreStatus = z.infer<typeof storeStatusSchema>;
export type SettingsSnapshot = z.infer<typeof settingsSchema>;
export type IntegrationsSnapshot = z.infer<typeof integrationsSchema>;
export type AuditSnapshot = z.infer<typeof auditSchema>;
export type SalesSnapshot = z.infer<typeof salesSchema>;

async function parse<T>(request: Promise<unknown>, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await request);
}

export function getDashboard(): Promise<DashboardSnapshot> { return parse(apiGet('admin/dashboard'), dashboardSchema); }
export function getHealth(): Promise<HealthSnapshot> { return parse(apiGet('admin/health'), healthSchema); }
export function getStoreStatus(): Promise<StoreStatus> { return parse(apiGet('admin/store-status'), storeStatusSchema); }
export function getSettings(): Promise<SettingsSnapshot> { return parse(apiGet('admin/settings'), settingsSchema); }
export function getIntegrations(): Promise<IntegrationsSnapshot> { return parse(apiGet('admin/integrations'), integrationsSchema); }
export function getAudit(): Promise<AuditSnapshot> { return parse(apiGet('admin/audit'), auditSchema); }
export function getSales(): Promise<SalesSnapshot> { return parse(apiGet('admin/analytics/sales'), salesSchema); }

export function setStoreStatus(input: Pick<StoreStatus, 'ordersPaused' | 'pauseMessage'>): Promise<StoreStatus> {
  return parse(apiPut('admin/store-status', input), storeStatusSchema);
}

export function activateCheckout(input: { reason: string; expectedVersion: number }): Promise<void> {
  return apiPost<void>('admin/checkout/activate', { confirm: true, ...input });
}

export function disableCheckout(reason: string): Promise<void> {
  return apiPost<void>('admin/checkout/disable', { reason });
}

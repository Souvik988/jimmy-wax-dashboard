import { describe, expect, it } from 'vitest';

import { dashboardSchema, healthSchema, integrationsSchema, salesSchema, settingsSchema, storeStatusSchema } from '@/lib/api/resources/overview';

describe('overview runtime contracts', () => {
  it('parses the real dashboard shape and refuses non-integer paise', () => {
    const valid = { definitions: { window: 'last 30 calendar days, Asia/Kolkata', currency: 'INR (paise)', ordersByStatus: 'derived' }, ordersByStatus: [{ status: 'placed', count: 2, totalPaise: 259800 }], lowStockVariants: 0, paymentExceptions: 0, refundsOpen: 0, outbox: { pending: 0, deadLetters: 0, oldestPendingSeconds: 0 } };
    expect(dashboardSchema.parse(valid).ordersByStatus[0]?.totalPaise).toBe(259800);
    expect(dashboardSchema.safeParse({ ...valid, ordersByStatus: [{ ...valid.ordersByStatus[0], totalPaise: 2.5 }] }).success).toBe(false);
  });

  it('parses health and store status without inventing a provider state', () => {
    expect(healthSchema.parse({ outbox: { dead: 0, pending: 1 }, email: { failed: 0, pending: 0 }, shippingEvents: { unprocessed: 0 }, bulkJobs: { active: 0 }, stuckShipmentRequests: 0, lowStockVariants: 0, provider: 'manual', paymentProvider: 'none', alerts: [] }).provider).toBe('manual');
    expect(storeStatusSchema.parse({ ordersPaused: false, pauseMessage: '', checkoutOpen: false, codEnabled: true, onlinePaymentsEnabled: false }).checkoutOpen).toBe(false);
  });

  it('requires the version and concrete readiness check fields before checkout controls can render', () => {
    const response = { settings: { shippingFeePaise: 4000, freeShippingThresholdPaise: null, codEnabled: true, codMaxOrderPaise: null, onlinePaymentsEnabled: false, paymentWindowMinutes: null, checkoutEnabled: false, checkoutPolicyConfirmed: false, checkoutAuthority: 'operator', codFeePaise: 2500, gstRateBps: 1800, taxInclusive: true, returnWindowDays: null, merchantLegalName: null, merchantGstin: null, merchantState: null, merchantAddress: null, brandName: 'JIMMY WAX', supportEmail: null, supportPhone: null, ordersPaused: false, pauseMessage: '', version: 1 }, readiness: { allOk: false, checks: [{ id: 'stock', ok: false, detail: 'Stock is unavailable' }] } };
    expect(settingsSchema.parse(response).settings.version).toBe(1);
    expect(settingsSchema.safeParse({ ...response, settings: { ...response.settings, version: 1.5 } }).success).toBe(false);
  });

  it('renders sales only from a half-open returned range and parses integration proof separately from configuration', () => {
    const sales = { range: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' }, definitions: { sales: 'server definition', aov: 'server definition' }, totals: { orders: 1, revenuePaise: 12500, aovPaise: 12500, discountPaise: 0 }, series: [{ bucket: '2026-10-01', orders: 1, subtotalPaise: 10000, discountPaise: 0, shippingPaise: 4000, taxPaise: 2100, revenuePaise: 12500, aovPaise: 12500 }], byPaymentMethod: [{ method: 'cod', orders: 1, revenuePaise: 12500 }] };
    expect(salesSchema.parse(sales).range.to).toContain('2026-10-02');
    const integrations = integrationsSchema.parse({ items: [{ name: 'razorpay', configured: false, facts: { mode: 'none' }, lastCheck: null }] });
    expect(integrations.items[0]?.lastCheck).toBeNull();
  });
});

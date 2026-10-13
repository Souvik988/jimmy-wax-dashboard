import { describe, expect, it } from 'vitest';

import { asContractStorePolicy, storePolicySchema } from '@/lib/api/public';

const validPolicy = {
  shippingFeePaise: 4000,
  freeShippingThresholdPaise: 200000,
  codEnabled: true,
  codMaxOrderPaise: 500000,
  codFeePaise: 2500,
  gstRateBps: 1800,
  taxInclusive: true,
  checkoutOpen: false,
  ordersPaused: false,
  pauseMessage: '',
  brandName: 'JIMMY WAX',
  supportEmail: null,
  supportPhone: null,
  deliveryEstimate: '3–5 business days',
  currency: 'INR',
};

describe('storePolicySchema', () => {
  it('accepts the documented public store settings response', () => {
    const parsed = storePolicySchema.parse(validPolicy);
    expect(asContractStorePolicy(parsed).gstRateBps).toBe(1800);
  });

  it('rejects an invalid currency instead of silently rendering it', () => {
    expect(storePolicySchema.safeParse({ ...validPolicy, currency: 'USD' }).success).toBe(false);
  });
});

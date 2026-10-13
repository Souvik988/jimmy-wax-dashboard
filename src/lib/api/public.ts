import { z } from 'zod';

import type { components } from '@/lib/api/generated/schema';

export type ContractStorePolicy = components['schemas']['StoreSettingsPublic'];

export const storePolicySchema = z.object({
  shippingFeePaise: z.number().int().nonnegative(),
  freeShippingThresholdPaise: z.number().int().nonnegative(),
  codEnabled: z.boolean(),
  codMaxOrderPaise: z.number().int().nonnegative(),
  codFeePaise: z.number().int().nonnegative(),
  gstRateBps: z.number().int().nonnegative(),
  taxInclusive: z.boolean(),
  checkoutOpen: z.boolean(),
  ordersPaused: z.boolean(),
  pauseMessage: z.string(),
  brandName: z.string(),
  supportEmail: z.string().nullable(),
  supportPhone: z.string().nullable(),
  deliveryEstimate: z.string(),
  currency: z.literal('INR'),
});

export type StorePolicy = z.infer<typeof storePolicySchema>;

export function parseStorePolicy(payload: unknown): StorePolicy {
  return storePolicySchema.parse(payload);
}

export function asContractStorePolicy(policy: StorePolicy): ContractStorePolicy {
  return policy;
}

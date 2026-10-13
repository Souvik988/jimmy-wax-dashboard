import { z } from 'zod';

import { apiGet, apiPost, apiPut } from '@/lib/api/client';

const count = z.number().int().nonnegative().safe();
const paise = count;

export const shippingSettingsSchema = z.object({
  pickupLocation: z.string().nullable(),
  pickupPin: z.string().nullable(),
  defaultWeightGrams: z.number().int().positive().safe(),
  defaultLengthMm: z.number().int().positive().safe(),
  defaultWidthMm: z.number().int().positive().safe(),
  defaultHeightMm: z.number().int().positive().safe(),
  courierRule: z.enum(['cheapest', 'fastest', 'balanced', 'preferred']),
  preferredCouriers: z.array(z.string()),
  autoShip: z.boolean(),
  bulkConfirmThreshold: z.number().int().positive().safe(),
  requireProviderCheck: z.boolean(),
  stuckAfterHours: z.number().int().positive().safe(),
  /** Version stamp a write must echo as `expectedUpdatedAt`. */
  updatedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const shippingOverviewSchema = z.object({
  activeShipments: count,
  exceptions: count,
  stuck: count,
  webhook: z.object({
    pendingEvents: count,
    eventsWithErrors: count,
    lastReceivedAt: z.string().datetime({ offset: true }).nullable(),
  }),
  stalledRequests: count,
});

export const shippingProviderSchema = z.object({
  provider: z.string(),
  configured: z.boolean(),
  reachable: z.boolean().nullable(),
  walletBalancePaise: paise.nullable(),
  pickupLocations: z.array(z.string()),
  settings: shippingSettingsSchema,
  overview: shippingOverviewSchema,
});

export const pinPrefixListSchema = z.object({
  items: z.array(z.object({ prefix: z.string().regex(/^[0-9]{3,6}$/u), note: z.string().nullable() })),
  /** Fingerprint of the list; a write must echo it as `expectedEtag`. */
  etag: z.string().length(64).optional(),
});

export const pickupLocationsSchema = z.object({ items: z.array(z.string()) });

export const serviceabilityInputSchema = z.object({
  pin: z.string().regex(/^[0-9]{6}$/u),
  weightGrams: z.number().int().min(1).max(50_000).safe(),
  cod: z.boolean(),
  declaredValuePaise: paise,
}).strict();

const serviceabilityProviderSchema = z.object({
  serviceable: z.boolean(),
  couriers: z.array(z.object({
    courierId: z.string(),
    name: z.string(),
    freightPaise: paise,
    codChargesPaise: paise,
    etdDays: count.nullable(),
    etd: z.string().nullable(),
    rating: z.number().nullable(),
  })),
});

export const serviceabilityResultSchema = z.object({
  pin: z.string().regex(/^[0-9]{6}$/u),
  allowListed: z.boolean(),
  allowListConfigured: z.boolean(),
  provider: serviceabilityProviderSchema.nullable(),
  note: z.string().optional(),
});

const packageSchema = z.object({
  weightGrams: z.number().int().positive().safe(),
  lengthMm: z.number().int().positive().safe(),
  widthMm: z.number().int().positive().safe(),
  heightMm: z.number().int().positive().safe(),
});

export const shippingReadyItemSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  customerName: z.string(),
  city: z.string(),
  pincode: z.string().regex(/^[0-9]{6}$/u),
  lines: z.number().int().positive().safe(),
  paymentMethod: z.string(),
  codAmountPaise: paise,
  totalPaise: paise,
  package: packageSchema,
  volumetricGrams: count,
  serviceable: z.boolean().nullable(),
  ageHours: count,
  warnings: z.array(z.string()),
});

export const shippingReadyPageSchema = z.object({
  items: z.array(shippingReadyItemSchema),
  nextCursor: z.string().nullable(),
});

function isSafeTrackingUrl(value: string | undefined): boolean {
  if (value === undefined) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const manualShipmentInputSchema = z.object({
  courier: z.string().trim().min(2).max(80),
  trackingNumber: z.string().trim().min(3).max(80),
  trackingUrl: z.string().trim().max(2048).transform((value) => value || undefined).optional()
    .refine(isSafeTrackingUrl, 'Enter a valid HTTPS tracking link without embedded credentials.'),
});

export const orderShipmentEventSchema = z.object({
  status: z.string(),
  description: z.string(),
  occurredAt: z.string().datetime({ offset: true }),
});

export const orderShipmentSchema = z.object({
  id: z.string().uuid(),
  courier: z.string(),
  trackingNumber: z.string(),
  trackingUrl: z.string().nullable(),
  status: z.string(),
  events: z.array(orderShipmentEventSchema),
});

export const orderShipmentsSchema = z.object({ items: z.array(orderShipmentSchema) });

const shipmentRecordSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  orderNumber: z.string().optional(),
  provider: z.string(),
  courier: z.string(),
  awb: z.string(),
  trackingUrl: z.string().nullable(),
  status: z.string(),
  rawStatus: z.string().nullable(),
  codAmountPaise: paise,
  chargesPaise: paise.nullable(),
  weightGrams: count.nullable(),
  etd: z.string().datetime({ offset: true }).nullable(),
  pickupScheduledAt: z.string().datetime({ offset: true }).nullable(),
  lastEventAt: z.string().datetime({ offset: true }).nullable(),
  ndrCount: count,
  rtoState: z.string().nullable(),
  hasLabel: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
});

export const shipmentPageSchema = z.object({ items: z.array(shipmentRecordSchema), nextCursor: z.string().nullable() });
export const shipmentDetailSchema = shipmentRecordSchema.extend({
  events: z.array(z.object({
    status: z.string(),
    description: z.string(),
    occurredAt: z.string().datetime({ offset: true }),
    source: z.string(),
  })),
});

export const manualShipmentEventStatuses = ['label_created', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned_to_origin'] as const;
export const shipmentEventInputSchema = z.object({
  status: z.enum(manualShipmentEventStatuses),
  description: z.string().trim().max(300).optional(),
}).strict();

export const manualShipmentCreatedSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  status: z.literal('label_created'),
});

const returnStatusSchema = z.enum(['requested', 'approved', 'rejected', 'received', 'closed']);
const returnRowSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  orderNumber: z.string(),
  status: returnStatusSchema,
  reason: z.string(),
  items: z.array(z.object({ sku: z.string(), name: z.string(), quantity: z.number().int().positive().safe() })),
  createdAt: z.string().datetime({ offset: true }),
});
export const returnPageSchema = z.object({ items: z.array(returnRowSchema) });

const refundPaise = z.union([
  z.number().int(),
  z.string().regex(/^\d+$/u).transform(Number),
]).refine((value) => Number.isSafeInteger(value) && value >= 0, 'Refund amount must be non-negative integer paise.');
/** Why a refund cannot be sent to the payment gateway right now. */
export const refundBlockedReasonSchema = z.enum(['already_processed', 'no_gateway', 'no_online_payment']);
const refundRowSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  amountPaise: refundPaise,
  status: z.string(),
  reason: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  /** True when processing can succeed right now (gateway configured, captured online payment, not yet processed). Absent on older backends. */
  processable: z.boolean().optional(),
  blockedReason: refundBlockedReasonSchema.nullable().optional(),
});
/** Display-safe: whether a payment gateway is connected. Never contains keys. */
export const paymentCapabilitySchema = z.object({
  configured: z.boolean(),
  provider: z.string().nullable(),
  mode: z.enum(['test', 'live']).nullable(),
});
export const refundPageSchema = z.object({
  items: z.array(refundRowSchema),
  nextCursor: z.string().nullable().optional(),
  paymentCapability: paymentCapabilitySchema.optional(),
});
export const refundProcessResultSchema = z.object({ id: z.string().uuid(), status: z.enum(['processed', 'pending', 'failed']) });

export const returnDecisionInputSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().min(3).max(300),
});
const returnIdSchema = z.string().uuid();

const reasonSchema = z.string().trim().min(3).max(300);
export const shippingSettingsWriteSchema = z.object({
  pickupLocation: z.string().trim().min(2).max(120).nullable(),
  pickupPin: z.string().regex(/^[0-9]{6}$/u).nullable(),
  defaultWeightGrams: z.number().int().min(1).max(50_000),
  defaultLengthMm: z.number().int().min(1).max(2000),
  defaultWidthMm: z.number().int().min(1).max(2000),
  defaultHeightMm: z.number().int().min(1).max(2000),
  courierRule: z.enum(['cheapest', 'fastest', 'balanced', 'preferred']),
  preferredCouriers: z.array(z.string().trim().min(2).max(60)).max(10),
  autoShip: z.boolean(),
  bulkConfirmThreshold: z.number().int().min(1).max(200),
  requireProviderCheck: z.boolean(),
  stuckAfterHours: z.number().int().min(6).max(720),
}).partial().strict();
export const shippingPinWriteSchema = z.object({
  add: z.array(z.string().regex(/^[0-9]{3,6}$/u)).max(2000),
  remove: z.array(z.string().regex(/^[0-9]{3,6}$/u)).max(2000),
  note: z.string().max(100).optional(),
  expectedEtag: z.string().length(64),
  reason: reasonSchema,
}).strict();

const courierOptionSchema = z.object({
  courierId: z.string(),
  name: z.string(),
  freightPaise: paise,
  codChargesPaise: paise,
  etdDays: count.nullable(),
  etd: z.string().nullable(),
  rating: z.number().nullable(),
});
/** What the backend would do for an order through the connected provider; planning books nothing. */
export const shipmentPlanSchema = z.object({
  order: z.object({ id: z.string().uuid(), orderNumber: z.string(), paymentMethod: z.string(), totalPaise: paise, codAmountPaise: paise, pincode: z.string() }).passthrough(),
  package: packageSchema,
  volumetricGrams: count,
  serviceable: z.boolean(),
  options: z.array(courierOptionSchema),
  recommended: z.string().nullable(),
  rule: z.enum(['cheapest', 'fastest', 'balanced', 'preferred']),
  walletBalancePaise: paise.nullable(),
  warnings: z.array(z.string()),
});
export const providerShipInputSchema = z.object({
  courierId: z.string().max(40).optional(),
  package: z.object({ weightGrams: z.number().int().min(1).max(50_000), lengthMm: z.number().int().min(1).max(2000), widthMm: z.number().int().min(1).max(2000), heightMm: z.number().int().min(1).max(2000) }).optional(),
  overrideReason: z.string().trim().min(3).max(200).optional(),
}).strict().refine((value) => !value.package || Boolean(value.overrideReason), { message: 'Say why the package differs from the catalogue.', path: ['overrideReason'] });
export const bulkShipInputSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(100),
  strategy: z.enum(['cheapest', 'fastest', 'balanced', 'preferred', 'courier']),
  courierId: z.string().max(40).optional(),
}).strict().refine((value) => value.strategy !== 'courier' || Boolean(value.courierId), { message: 'Choose a courier.', path: ['courierId'] });
export const bulkJobSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  strategy: z.string().optional(),
  total: count,
  completed: count.optional(),
  succeeded: count.optional(),
  failed: count.optional(),
  results: z.array(z.object({ orderId: z.string(), ok: z.boolean() }).passthrough()).optional(),
}).passthrough();

export type ShipmentPlan = z.infer<typeof shipmentPlanSchema>;
export type ProviderShipInput = z.input<typeof providerShipInputSchema>;
export type BulkShipInput = z.input<typeof bulkShipInputSchema>;
export type BulkJob = z.infer<typeof bulkJobSchema>;
export type ShippingProvider = z.infer<typeof shippingProviderSchema>;
export type ShippingSettings = z.infer<typeof shippingSettingsSchema>;
export type ShippingPinList = z.infer<typeof pinPrefixListSchema>;
export type ShippingSettingsPatchInput = z.input<typeof shippingSettingsWriteSchema>;
export type ServiceabilityInput = z.infer<typeof serviceabilityInputSchema>;
export type ServiceabilityResult = z.infer<typeof serviceabilityResultSchema>;
export type ShippingReadyItem = z.infer<typeof shippingReadyItemSchema>;
export type ShippingReadyPage = z.infer<typeof shippingReadyPageSchema>;
export type ManualShipmentInput = z.infer<typeof manualShipmentInputSchema>;
export type OrderShipment = z.infer<typeof orderShipmentSchema>;
export type ShippingShipment = z.infer<typeof shipmentRecordSchema>;
export type ShipmentDetail = z.infer<typeof shipmentDetailSchema>;
export type ShipmentEventInput = z.infer<typeof shipmentEventInputSchema>;
export type ShipmentFilters = { status?: string | undefined; courier?: string | undefined; q?: string | undefined; exception?: boolean | undefined; stuck?: boolean | undefined };
export type ReturnStatus = z.infer<typeof returnStatusSchema>;
export type AdminReturn = z.infer<typeof returnRowSchema>;
export type ReturnPage = z.infer<typeof returnPageSchema>;
export type RefundRecord = z.infer<typeof refundRowSchema>;
export type RefundPage = z.infer<typeof refundPageSchema>;
export type PaymentCapability = z.infer<typeof paymentCapabilitySchema>;
export type RefundBlockedReason = z.infer<typeof refundBlockedReasonSchema>;
export type RefundProcessResult = z.infer<typeof refundProcessResultSchema>;
export type ReturnDecisionInput = z.infer<typeof returnDecisionInputSchema>;

export async function getShippingProvider(signal?: AbortSignal): Promise<ShippingProvider> {
  const response = await apiGet<unknown>('admin/shipping/provider', signal ? { signal } : {});
  return shippingProviderSchema.parse(response);
}

export async function getShippingSettings(signal?: AbortSignal): Promise<ShippingSettings> {
  const response = await apiGet<unknown>('admin/shipping/settings', signal ? { signal } : {});
  return shippingSettingsSchema.parse(response);
}

/** Guarded write: needs the `updatedAt` you loaded and an audit reason; a stale stamp is a 409 and nothing is applied. */
export async function updateShippingSettings(patch: z.input<typeof shippingSettingsWriteSchema>, guard: { expectedUpdatedAt: string; reason: string }): Promise<ShippingSettings> {
  const body = {
    ...shippingSettingsWriteSchema.parse(patch),
    expectedUpdatedAt: z.string().datetime({ offset: true }).parse(guard.expectedUpdatedAt),
    reason: reasonSchema.parse(guard.reason),
  };
  const response = await apiPut<unknown>('admin/shipping/settings', body);
  return shippingSettingsSchema.parse(response);
}

/** Guarded write: needs the list `etag` you loaded and an audit reason; a stale etag is a 409 and nothing is applied. */
export async function updateShippingPins(input: z.input<typeof shippingPinWriteSchema>): Promise<void> {
  await apiPut<null>('admin/shipping/pins', shippingPinWriteSchema.parse(input));
}

export async function getShippingPins(signal?: AbortSignal): Promise<ShippingPinList> {
  const response = await apiGet<unknown>('admin/shipping/pins', signal ? { signal } : {});
  return pinPrefixListSchema.parse(response);
}

export async function getShippingPickupLocations(signal?: AbortSignal): Promise<z.infer<typeof pickupLocationsSchema>> {
  const response = await apiGet<unknown>('admin/shipping/pickup-locations', signal ? { signal } : {});
  return pickupLocationsSchema.parse(response);
}

export async function checkShippingServiceability(input: ServiceabilityInput): Promise<ServiceabilityResult> {
  const body = serviceabilityInputSchema.parse(input);
  const response = await apiPost<unknown>('admin/shipping/serviceability/check', body);
  return serviceabilityResultSchema.parse(response);
}

export async function getReadyToShip(cursor: string | null, signal?: AbortSignal, limit = 20): Promise<ShippingReadyPage> {
  const response = await apiGet<unknown>('admin/shipping/ready', {
    params: { limit, cursor: cursor ?? undefined },
    ...(signal ? { signal } : {}),
  });
  return shippingReadyPageSchema.parse(response);
}

export async function getReturns(status?: ReturnStatus, signal?: AbortSignal): Promise<ReturnPage> {
  const response = await apiGet<unknown>('admin/returns', {
    params: { status },
    ...(signal ? { signal } : {}),
  });
  return returnPageSchema.parse(response);
}

export async function decideReturn(returnId: string, input: ReturnDecisionInput): Promise<void> {
  const id = returnIdSchema.parse(returnId);
  await apiPost<null>(`admin/returns/${id}/decide`, returnDecisionInputSchema.parse(input));
}

/**
 * Sends a refund to the payment gateway. Needs `refunds:write` and a verified (MFA) session; safe to retry because the gateway call uses the
 * refund's own idempotency key, an already-processed refund answers `processed`, and a gateway failure leaves it `failed` so it can be retried.
 */
export async function processRefund(id: string): Promise<RefundProcessResult> {
  const refundId = z.string().uuid().parse(id);
  return refundProcessResultSchema.parse(await apiPost<unknown>(`admin/refunds/${refundId}/process`, {}));
}

export async function getRefunds(signal?: AbortSignal): Promise<RefundPage> {
  const response = await apiGet<unknown>('admin/refunds', signal ? { signal } : {});
  return refundPageSchema.parse(response);
}

export async function createManualShipment(orderId: string, input: ManualShipmentInput): Promise<z.infer<typeof manualShipmentCreatedSchema>> {
  const body = manualShipmentInputSchema.parse(input);
  const response = await apiPost<unknown>(`admin/orders/${orderId}/shipments`, body);
  return manualShipmentCreatedSchema.parse(response);
}

export async function getOrderShipments(orderId: string, signal?: AbortSignal): Promise<z.infer<typeof orderShipmentsSchema>> {
  const response = await apiGet<unknown>(`admin/orders/${orderId}/shipments`, signal ? { signal } : {});
  return orderShipmentsSchema.parse(response);
}

export async function getShipments(cursor: string | null, signal?: AbortSignal, filters: ShipmentFilters = {}, limit = 20): Promise<z.infer<typeof shipmentPageSchema>> {
  const response = await apiGet<unknown>('admin/shipments', {
    params: { ...filters, limit, cursor: cursor ?? undefined },
    ...(signal ? { signal } : {}),
  });
  return shipmentPageSchema.parse(response);
}

export async function getShipment(shipmentId: string, signal?: AbortSignal): Promise<ShipmentDetail> {
  const response = await apiGet<unknown>(`admin/shipments/${shipmentId}`, signal ? { signal } : {});
  return shipmentDetailSchema.parse(response);
}

export async function addManualShipmentEvent(shipmentId: string, input: ShipmentEventInput): Promise<void> {
  await apiPost<null>(`admin/shipments/${shipmentId}/events`, shipmentEventInputSchema.parse(input));
}

/** Statuses the backend lets an operator cancel (not yet picked up). Manual shipments can be cancelled without a provider. */
export const cancellableShipmentStatuses = ['label_created', 'awb_assigned', 'pickup_scheduled', 'pending_provider'] as const;

export async function cancelShipment(shipmentId: string, reason: string): Promise<ShipmentDetail> {
  const body = z.object({ reason: z.string().trim().min(3).max(200) }).strict().parse({ reason });
  return shipmentDetailSchema.parse(await apiPost<unknown>(`admin/shipments/${shipmentId}/cancel`, body));
}

/** Provider path. Only callable when the backend reports a configured provider; otherwise the backend answers POLICY_NOT_CONFIGURED. */
export async function planProviderShipment(orderId: string): Promise<ShipmentPlan> {
  const id = z.string().uuid().parse(orderId);
  return shipmentPlanSchema.parse(await apiPost<unknown>(`admin/orders/${id}/shipments/plan`, {}));
}

/** Idempotent on the backend (one open request per order); safe to repeat the same call after an ambiguous failure. */
export async function shipViaProvider(orderId: string, input: ProviderShipInput = {}): Promise<ShipmentDetail> {
  const id = z.string().uuid().parse(orderId);
  return shipmentDetailSchema.parse(await apiPost<unknown>(`admin/orders/${id}/ship`, providerShipInputSchema.parse(input)));
}

export async function createBulkShipments(input: BulkShipInput): Promise<BulkJob> {
  return bulkJobSchema.parse(await apiPost<unknown>('admin/shipments/bulk', bulkShipInputSchema.parse(input)));
}

export async function getBulkShipmentJob(jobId: string, signal?: AbortSignal): Promise<BulkJob> {
  const id = z.string().uuid().parse(jobId);
  return bulkJobSchema.parse(await apiGet<unknown>(`admin/shipments/bulk/${id}`, signal ? { signal } : {}));
}

/** Same-origin URL for the provider label PDF (opened in a new tab; the BFF adds the session). */
export const shipmentLabelPath = (shipmentId: string): string => `/api/backend/admin/shipments/${z.string().uuid().parse(shipmentId)}/label`;

import { z } from 'zod';

import { apiGet, apiPost, apiDownload, type ApiOptions, type ApiDownload } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';

const paise = z.union([z.number().int(), z.string().regex(/^-?\d+$/u).transform(Number)]).refine(Number.isSafeInteger);

export const adminOrderSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  status: z.string(),
  paymentStatus: z.string(),
  paymentMethod: z.string(),
  totalPaise: paise,
  createdAt: z.string().datetime({ offset: true }),
  version: z.number().int(),
  demo: z.boolean(),
});

export const orderListSchema = z.object({ items: z.array(adminOrderSchema), nextCursor: z.string().nullable() });
export type AdminOrder = z.infer<typeof adminOrderSchema>;
export type OrderListPage = z.infer<typeof orderListSchema>;
export type OrderListFilters = { status?: string; paymentStatus?: string; q?: string; limit?: number };

const orderAddressSchema = z.object({
  name: z.string(),
  city: z.string(),
  state: z.string(),
  pin: z.string(),
}).passthrough();

export const adminOrderDetailSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  status: z.string(),
  paymentStatus: z.string(),
  paymentMethod: z.string(),
  version: z.number().int(),
  subtotalPaise: paise,
  discountPaise: paise,
  taxPaise: paise,
  shippingPaise: paise,
  codFeePaise: paise,
  taxInclusive: z.boolean(),
  totalPaise: paise,
  currency: z.literal('INR'),
  address: orderAddressSchema,
  createdAt: z.string().datetime({ offset: true }),
  lines: z.array(z.object({ sku: z.string(), productName: z.string(), variantTitle: z.string(), unitPricePaise: paise, quantity: z.number().int().positive(), lineTotalPaise: paise })),
  paymentAttempts: z.array(z.object({ id: z.string().uuid(), status: z.string(), amountPaise: paise, provider: z.string(), createdAt: z.string().datetime({ offset: true }) })),
  refunds: z.array(z.object({ id: z.string().uuid(), status: z.string(), amountPaise: paise, reason: z.string() })),
  /** Added with contract 1.4.0. Optional so an older backend still renders the order. */
  couponCode: z.string().nullable().optional(),
  /** Oldest first, recorded by the database on every status change. Orders that predate it show their current status only. */
  statusHistory: z.array(z.object({ from: z.string().nullable(), to: z.string(), at: z.string().datetime({ offset: true }) })).optional(),
  shipments: z.array(z.object({
    id: z.string().uuid(), courier: z.string(), trackingNumber: z.string(), trackingUrl: z.string().nullable().optional(), status: z.string(),
    events: z.array(z.object({ status: z.string(), description: z.string(), occurredAt: z.string().datetime({ offset: true }) }).passthrough()).optional(),
  }).passthrough()).optional(),
  returns: z.array(z.object({ id: z.string().uuid(), status: z.string(), reason: z.string(), createdAt: z.string().datetime({ offset: true }) })).optional(),
  /** Transactional email delivery state for this order. */
  messages: z.array(z.object({ template: z.string(), status: z.enum(['pending', 'sent', 'failed', 'suppressed']), createdAt: z.string().datetime({ offset: true }) })).optional(),
});

export const orderNotesSchema = z.object({ items: z.array(z.object({ id: z.number().int(), body: z.string(), authorId: z.string(), authorRole: z.string(), createdAt: z.string().datetime({ offset: true }) })) });
export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;
export type OrderNotes = z.infer<typeof orderNotesSchema>;

const invoiceChargeSchema = z.object({ taxablePaise: paise, gstPaise: paise, totalPaise: paise });
export const invoiceSnapshotSchema = z.object({
  invoiceNumber: z.string(),
  issuedAt: z.string().datetime({ offset: true }),
  orderNumber: z.string(),
  seller: z.object({ legalName: z.string(), gstin: z.string(), state: z.string(), address: z.string() }),
  buyer: z.object({ name: z.string(), address: z.string(), state: z.string(), pin: z.string() }),
  placeOfSupply: z.string(),
  supply: z.enum(['intra_state', 'inter_state']),
  gstRatePercent: z.number().positive(),
  priceBasis: z.enum(['inclusive', 'exclusive']),
  lines: z.array(z.object({ description: z.string(), sku: z.string(), hsn: z.string().nullable().optional(), quantity: z.number().int().positive(), unitPricePaise: paise, taxablePaise: paise, gstPaise: paise, totalPaise: paise })),
  shipping: invoiceChargeSchema,
  codFee: invoiceChargeSchema,
  totals: z.object({ taxablePaise: paise, cgstPaise: paise, sgstPaise: paise, igstPaise: paise, gstPaise: paise, grandTotalPaise: paise }),
  currency: z.literal('INR'),
  hsnIncluded: z.boolean(),
});
export type InvoiceSnapshot = z.infer<typeof invoiceSnapshotSchema>;

export async function listOrders(filters: OrderListFilters, cursor: string | null, signal?: AbortSignal): Promise<OrderListPage> {
  const options: ApiOptions = {
    params: { limit: filters.limit ?? 20, status: filters.status, paymentStatus: filters.paymentStatus, q: filters.q, cursor: cursor ?? undefined },
    ...(signal ? { signal } : {}),
  };
  const raw = await apiGet<unknown>('admin/orders', options);
  return orderListSchema.parse(raw);
}

export async function getOrder(id: string, signal?: AbortSignal): Promise<AdminOrderDetail> {
  return adminOrderDetailSchema.parse(await apiGet<unknown>(`admin/orders/${id}`, signal ? { signal } : {}));
}

/** Read-only: returns the already-issued invoice, or null when none has been issued (the backend answers 404 and never issues on GET). */
export async function getOrderInvoice(id: string, signal?: AbortSignal): Promise<InvoiceSnapshot | null> {
  try {
    return invoiceSnapshotSchema.parse(await apiGet<unknown>(`admin/orders/${id}/invoice`, signal ? { signal } : {}));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** Issues the immutable GST invoice exactly once (201), or returns the original when already issued (200). Needs orders:fulfil, MFA and a reason. */
export async function issueOrderInvoice(id: string, reason: string): Promise<InvoiceSnapshot> {
  return invoiceSnapshotSchema.parse(await apiPost<unknown>(`admin/orders/${id}/invoice`, { reason }));
}

export async function getOrderNotes(id: string, signal?: AbortSignal): Promise<OrderNotes> {
  return orderNotesSchema.parse(await apiGet<unknown>(`admin/orders/${id}/notes`, signal ? { signal } : {}));
}

export async function addOrderNote(id: string, body: string): Promise<OrderNotes> {
  return orderNotesSchema.parse(await apiPost<unknown>(`admin/orders/${id}/notes`, { body }));
}

const transitionSchema = z.object({ id: z.string().uuid(), status: z.string(), version: z.number().int() });
export async function transitionOrder(id: string, input: { to: 'confirmed' | 'processing'; expectedVersion: number }): Promise<z.infer<typeof transitionSchema>> {
  return transitionSchema.parse(await apiPost<unknown>(`admin/orders/${id}/status`, input));
}

export async function cancelOrder(id: string, input: { reason: string; expectedVersion: number }): Promise<{ id: string; status: string; refundQueued: boolean }> {
  return z.object({ id: z.string().uuid(), status: z.string(), refundQueued: z.boolean() }).parse(await apiPost<unknown>(`admin/orders/${id}/cancel`, input));
}

const packingSlipSchema = z.object({
  orderNumber: z.string(), placedAt: z.string().datetime({ offset: true }), paymentMethod: z.string(), collectOnDeliveryPaise: paise,
  shipTo: z.object({ name: z.string(), phone: z.string(), address: z.string(), landmark: z.string().nullable().optional(), city: z.string(), state: z.string(), pin: z.string() }),
  items: z.array(z.object({ sku: z.string(), name: z.string(), quantity: z.number().int().positive() })),
  from: z.object({ brand: z.string(), phone: z.string().nullable(), email: z.string().nullable() }),
});
export type PackingSlip = z.infer<typeof packingSlipSchema>;
export async function getPackingSlip(id: string): Promise<PackingSlip> { return packingSlipSchema.parse(await apiGet<unknown>(`admin/orders/${id}/packing-slip`)); }
export async function resendOrderConfirmation(id: string): Promise<{ queued: true }> { return z.object({ queued: z.literal(true) }).parse(await apiPost<unknown>(`admin/orders/${id}/resend-confirmation`)); }

export async function exportOrders(range: { from: string; to: string }, signal?: AbortSignal): Promise<ApiDownload> {
  return apiDownload('admin/exports/orders.csv', { params: range, ...(signal ? { signal } : {}) });
}

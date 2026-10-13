import type { ReturnStatus } from './resources/shipping';

export type OrderFilters = { status?: string; paymentStatus?: string; q?: string };

export const queryKeys = {
  orders: {
    all: ['orders'] as const,
    list: (filters: OrderFilters) => ['orders', 'list', canonicalFilters(filters)] as const,
    detail: (id: string) => ['orders', 'detail', id] as const,
    notes: (id: string) => ['orders', 'notes', id] as const,
  },
  customers: {
    all: ['customers'] as const,
    list: (filters: Record<string, string | boolean | undefined>) => ['customers', 'list', canonicalFilters(filters)] as const,
    detail: (id: string) => ['customers', 'detail', id] as const,
  },
  settings: ['settings'] as const,
  storeStatus: ['store-status'] as const,
  overview: ['overview'] as const,
  dashboard: ['dashboard'] as const,
  health: ['health'] as const,
  integrations: ['integrations'] as const,
  audit: ['audit'] as const,
  sales: ['analytics', 'sales'] as const,
  shipping: {
    all: ['shipping'] as const,
    provider: ['shipping', 'provider'] as const,
    ready: ['shipping', 'ready'] as const,
    shipments: ['shipping', 'shipments'] as const,
    shipment: (id: string) => ['shipping', 'shipment', id] as const,
    returns: (status?: ReturnStatus) => ['shipping', 'returns', status] as const,
    refunds: ['shipping', 'refunds'] as const,
    settings: ['shipping', 'settings'] as const,
    pins: ['shipping', 'pins'] as const,
    pickupLocations: ['shipping', 'pickup-locations'] as const,
  },
  catalog: {
    all: ['catalog'] as const,
    products: ['catalog', 'products'] as const,
    product: (id: string) => ['catalog', 'product', id] as const,
    variants: ['catalog', 'variants'] as const,
    categories: ['catalog', 'categories'] as const,
    collections: ['catalog', 'collections'] as const,
  },
  media: {
    all: ['media'] as const,
    list: (filters: Record<string, string | boolean | number | undefined>, cursor: string | null) => ['media', 'list', canonicalFilters({ ...filters, cursor: cursor ?? undefined })] as const,
    detail: (id: string) => ['media', 'detail', id] as const,
    usage: (id: string) => ['media', 'usage', id] as const,
  },
  inventory: {
    all: ['inventory'] as const,
    list: ['inventory', 'list'] as const,
    movements: (variantId: string) => ['inventory', 'movements', variantId] as const,
  },
  publicHealth: ['public-health'] as const,
  experience: {
    document: (channel: string, kind: string, key: string) => ['experience', 'document', channel, kind, key] as const,
    revisions: (channel: string, kind: string, key: string) => ['experience', 'revisions', channel, kind, key] as const,
    diff: (channel: string) => ['experience', 'diff', channel] as const,
  },
};

function canonicalFilters<T extends Record<string, unknown>>(filters: T): ReadonlyArray<readonly [string, unknown]> {
  return Object.entries(filters)
    .filter(([, value]) => value !== undefined && value !== '')
    .sort(([left], [right]) => left.localeCompare(right));
}

export const resourceInvalidation = {
  orders: [queryKeys.orders.all],
  orderNotes: (orderId: string) => [queryKeys.orders.notes(orderId), queryKeys.orders.detail(orderId)],
  customers: [queryKeys.customers.all],
  customer: (customerId: string) => [queryKeys.customers.all, queryKeys.customers.detail(customerId)],
  settings: [queryKeys.settings, queryKeys.storeStatus, queryKeys.overview, queryKeys.publicHealth],
  returns: [['shipping', 'returns']],
  refunds: [queryKeys.shipping.refunds],
  catalog: [queryKeys.catalog.all],
  inventory: [queryKeys.inventory.all],
  media: [queryKeys.media.all],
  storeStatus: [queryKeys.storeStatus, queryKeys.overview, queryKeys.publicHealth],
  experienceDocument: (channel: string, kind: string, key: string) => [
    queryKeys.experience.document(channel, kind, key),
    queryKeys.experience.revisions(channel, kind, key),
    queryKeys.experience.diff(channel),
  ],
} as const;

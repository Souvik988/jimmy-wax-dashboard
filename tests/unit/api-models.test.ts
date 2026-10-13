import { describe, expect, it } from 'vitest';

import { conflictActions, shouldAutoRetryConflict } from '@/lib/api/conflicts';
import { mergeCursorPages } from '@/lib/api/cursor';
import { ApiError } from '@/lib/api/errors';
import { applyServerFieldErrors } from '@/lib/api/form-errors';
import { queryKeys, resourceInvalidation } from '@/lib/api/query-keys';
import { parseSavedView, readSavedView, savedViewKey, writeSavedView } from '@/lib/api/saved-views';
import { readDraft, saveDraft } from '@/lib/api/drafts';
import { adminOrderSchema, orderListSchema } from '@/lib/api/resources/orders';

describe('resource data contracts and reusable models', () => {
  it('normalizes a live Postgres bigint money string to safe integer paise', () => {
    const row = adminOrderSchema.parse({ id: 'f8103f7d-1d69-4629-83bd-51ef9a04908d', orderNumber: 'JW-1', status: 'placed', paymentStatus: 'pending', paymentMethod: 'cod', totalPaise: '129900', createdAt: '2026-10-07T10:30:00.000Z', version: 1, demo: false });
    expect(row.totalPaise).toBe(129900);
    expect(Number.isSafeInteger(row.totalPaise)).toBe(true);
  });

  it('rejects unrecognized order shapes and validates opaque cursor pages', () => {
    expect(orderListSchema.safeParse({ items: [], nextCursor: 42 }).success).toBe(false);
    expect(orderListSchema.safeParse({ items: [{ status: 'placed' }], nextCursor: null }).success).toBe(false);
  });

  it('deduplicates stable IDs across cursor pages without decoding the cursor', () => {
    expect(mergeCursorPages([
      { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'opaque' },
      { items: [{ id: 'b' }, { id: 'c' }], nextCursor: null },
    ])).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });

  it('canonicalizes query keys and declares resource-scoped invalidation', () => {
    expect(queryKeys.orders.list({ q: 'JW-1', status: 'placed' })).toEqual(queryKeys.orders.list({ status: 'placed', q: 'JW-1' }));
    expect(queryKeys.shipping.returns()).toEqual(['shipping', 'returns', undefined]);
    expect(queryKeys.shipping.returns('requested')).not.toEqual(queryKeys.shipping.returns('approved'));
    expect(queryKeys.shipping.refunds).toEqual(['shipping', 'refunds']);
    expect(queryKeys.shipping.settings).toEqual(['shipping', 'settings']);
    expect(queryKeys.shipping.pins).toEqual(['shipping', 'pins']);
    expect(queryKeys.shipping.pickupLocations).toEqual(['shipping', 'pickup-locations']);
    expect(resourceInvalidation.settings).toContain(queryKeys.storeStatus);
    expect(resourceInvalidation.orderNotes('o-1')).toEqual([queryKeys.orders.notes('o-1'), queryKeys.orders.detail('o-1')]);
  });

  it('allows no automatic conflict retries and distinguishes versioned choices', () => {
    expect(conflictActions('if-match')).toEqual(['reload', 'merge']);
    expect(conflictActions('expected-version')).toEqual(['reload', 'merge']);
    expect(conflictActions('none')).toEqual(['reload']);
    expect(shouldAutoRetryConflict('expected-version')).toBe(false);
  });

  it('maps only known server form fields and returns the first field to focus', () => {
    const apiError = new ApiError(400, 'VALIDATION_FAILED', 'Invalid', undefined, false, { email: 'Invalid email', secretToken: 'Do not expose' });
    const applied: Array<[string, string]> = [];
    const first = applyServerFieldErrors(apiError, ['email', 'password'] as const, (field, issue) => applied.push([field, issue.message]));
    expect(first).toBe('email');
    expect(applied).toEqual([['email', 'Invalid email']]);
  });

  it('version-scopes saved views and drops unsupported or PII-like filters', () => {
    const raw = JSON.stringify({ version: 1, columns: ['order', 'status'], density: 'regular', filters: { status: 'placed', q: 'customer@example.test', email: 'customer@example.test' } });
    expect(parseSavedView(raw, 'orders')?.filters).toEqual({ status: 'placed' });
    expect(savedViewKey('orders', 'operator-1')).toBe('jw:data-table:v1:orders:operator-1');
    expect(parseSavedView('{bad json', 'orders')).toBeNull();
  });

  it('reads and writes saved views defensively and scopes them by operator', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const view = { version: 1 as const, columns: ['order'], density: 'compact' as const, filters: { status: 'placed', q: 'JW-5' } };
    expect(writeSavedView(storage, 'orders', 'support-a', view)).toBe(true);
    expect(readSavedView(storage, 'orders', 'support-a')?.filters).toEqual({ status: 'placed' });
    expect(readSavedView(storage, 'orders', 'support-b')).toBeNull();
  });

  it('version-scopes safe drafts and refuses drafts marked sensitive', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(saveDraft(storage, 'long-form', 'operator-1', { text: 'draft' }, { safeToPersist: true })).toBe(true);
    expect(readDraft<{ text: string }>(storage, 'long-form', 'operator-1')).toEqual({ text: 'draft' });
    expect(saveDraft(storage, 'implicit-sensitive', 'operator-1', { text: 'draft' })).toBe(false);
    expect(saveDraft(storage, 'legal-settings', 'operator-1', { gstin: 'sensitive' }, { safeToPersist: false })).toBe(false);
  });
});

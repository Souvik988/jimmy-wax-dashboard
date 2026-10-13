import { describe, expect, it } from 'vitest';

import { buildVariantDetailsPatch, variantDetailsDraftFrom } from '@/features/catalog/variant-details-model';
import type { ProductVariant } from '@/lib/api/resources/catalog';

const variant: ProductVariant = {
  id: 'cleaner-250', sku: 'JWX-CLN-250', title: '250 ml', pricePaise: 49900, compareAtPricePaise: null, active: true,
  weightGrams: 300, lengthMm: 60, widthMm: 60, heightMm: 120, hsnCode: '3405', barcode: null, onHand: 4, reserved: 0, lowStockThreshold: 5, costPricePaise: 20000,
};

describe('variant details patch', () => {
  const draft = () => ({ ...variantDetailsDraftFrom(variant), reason: 'Package re-measured' });
  it('sends only what changed and describes each change', () => {
    const result = buildVariantDetailsPatch(variant, { ...draft(), weightGrams: '320', barcode: '8901234567890', lowStockThreshold: '8' }, false);
    expect(result.ok && result.patch).toEqual({ weightGrams: 320, barcode: '8901234567890', lowStockThreshold: 8 });
    expect(result.ok && result.changes.map((c) => c.label)).toEqual(['Weight', 'Barcode', 'Low-stock alert']);
  });
  it('never sends cost for non-admins and requires a reason', () => {
    const noCost = buildVariantDetailsPatch(variant, { ...draft(), costPrice: '' , title: '250 ml bottle' }, false);
    expect(noCost.ok && 'costPricePaise' in noCost.patch).toBe(false);
    const admin = buildVariantDetailsPatch(variant, { ...draft(), costPrice: '210' }, true);
    expect(admin.ok && admin.patch.costPricePaise).toBe(21000);
    const noReason = buildVariantDetailsPatch(variant, { ...draft(), title: 'x y', reason: '' }, false);
    expect(!noReason.ok && noReason.errors['reason']).toBeTruthy();
  });
  it('validates HSN, sizes and refuses empty edits and cleared thresholds', () => {
    const bad = buildVariantDetailsPatch(variant, { ...draft(), hsnCode: 'abc', lengthMm: '0', sku: 'x' }, false);
    expect(!bad.ok && Object.keys(bad.errors).sort()).toEqual(['hsnCode', 'lengthMm', 'sku']);
    expect(!buildVariantDetailsPatch(variant, draft(), false).ok).toBe(true);
    const cleared = buildVariantDetailsPatch(variant, { ...draft(), lowStockThreshold: '' }, false);
    expect(!cleared.ok && cleared.errors['lowStockThreshold']).toMatch(/cannot be cleared|can be changed/i);
  });
});

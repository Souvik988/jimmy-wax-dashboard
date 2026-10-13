import { describe, expect, it } from 'vitest';

import {
  buildProductPatch,
  buildVariantPatch,
  productDraftFrom,
  variantPriceDraftFrom,
  type ProductEditorDraft,
} from '@/features/catalog/product-editor-model';
import type { CatalogVariant, Product } from '@/lib/api/resources/catalog';

const product: Product = {
  id: 'leather-cleaner',
  name: 'Leather Cleaner',
  subtitle: 'Gentle care',
  description: 'Cleans finished leather.',
  categoryId: 'cleaners',
  categoryName: 'Cleaners',
  keyBenefits: ['Lifts everyday dirt', 'Leaves no residue'],
  suitableSurfaces: null,
  boxContents: 'One bottle',
  tags: ['leather', 'care'],
  seoTitle: null,
  seoDescription: null,
  active: true,
  archived: false,
  sortOrder: 1,
  version: 7,
  image: null,
  variants: [],
  updatedAt: '2026-10-07T10:00:00.000Z',
};

const variant: CatalogVariant = {
  id: 'cleaner-250',
  sku: 'JWX-CLN-250',
  name: 'Leather Cleaner',
  title: '250 ml',
  pricePaise: 49900,
  comparePaise: 59900,
  active: true,
  updatedAt: '2026-10-07T10:00:00.000Z',
};

describe('product editor model', () => {
  it('builds a minimal versioned patch and exact diff without changing immutable identity', () => {
    const draft = productDraftFrom(product);
    draft.name = 'Leather Cleaner · Refined';
    draft.description = 'A refreshed description.';

    expect(buildProductPatch(product, draft)).toEqual({
      ok: true,
      patch: {
        name: 'Leather Cleaner · Refined',
        description: 'A refreshed description.',
        expectedVersion: 7,
      },
      changes: [
        { path: 'name', label: 'Product name', before: 'Leather Cleaner', after: 'Leather Cleaner · Refined' },
        { path: 'description', label: 'Description', before: 'Cleans finished leather.', after: 'A refreshed description.' },
      ],
    });
  });

  it('maps line-based benefits and tags to trimmed backend arrays', () => {
    const draft: ProductEditorDraft = {
      ...productDraftFrom(product),
      keyBenefits: 'Easy to apply\r\n\n  Leaves a soft finish  ',
      tags: 'Leather care\n\nShoe care',
    };

    expect(buildProductPatch(product, draft)).toMatchObject({
      ok: true,
      patch: {
        keyBenefits: ['Easy to apply', 'Leaves a soft finish'],
        tags: ['leather care', 'shoe care'],
        expectedVersion: 7,
      },
    });
  });

  it('returns no patch for an unchanged product draft', () => {
    expect(buildProductPatch(product, productDraftFrom(product))).toEqual({ ok: true, patch: null, changes: [] });
  });

  it('supports the documented bounded display order and rejects non-integer or out-of-range values', () => {
    const ordered = { ...productDraftFrom(product), sortOrder: '6' };
    expect(buildProductPatch(product, ordered)).toMatchObject({
      ok: true,
      patch: { sortOrder: 6, expectedVersion: 7 },
      changes: [{ path: 'sortOrder', label: 'Display order', before: '1', after: '6' }],
    });
    for (const sortOrder of ['', '1.5', '100001']) {
      expect(buildProductPatch(product, { ...ordered, sortOrder })).toMatchObject({ ok: false, fieldErrors: { sortOrder: expect.any(String) } });
    }
  });

  it('returns field validation errors instead of constructing an invalid product patch', () => {
    const draft = { ...productDraftFrom(product), name: 'x' };

    expect(buildProductPatch(product, draft)).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.any(String) },
    });
  });
});

describe('variant price editor model', () => {
  it('converts rupees to integer paise and keeps the backend timestamp and reason', () => {
    const draft = {
      ...variantPriceDraftFrom(variant),
      price: '₹ 529.00',
      reason: 'Owner approved the revised selling price',
    };

    expect(buildVariantPatch(variant, draft)).toEqual({
      ok: true,
      patch: {
        pricePaise: 52900,
        reason: 'Owner approved the revised selling price',
        expectedUpdatedAt: '2026-10-07T10:00:00.000Z',
      },
      changes: [
        { path: 'pricePaise', label: 'Selling price', before: 49900, after: 52900 },
      ],
    });
  });

  it('rejects a compare-at value below the selling price', () => {
    const draft = {
      ...variantPriceDraftFrom(variant),
      price: '600',
      compareAtPrice: '599',
      reason: 'Owner approved the revised selling price',
    };

    expect(buildVariantPatch(variant, draft)).toMatchObject({ ok: false, fieldErrors: { compareAtPrice: expect.any(String) } });
  });

  it('requires a reason for a changed price and does not create a no-op patch', () => {
    const changed = { ...variantPriceDraftFrom(variant), price: '529', reason: '  ' };
    const unchanged = { ...variantPriceDraftFrom(variant), reason: '' };

    expect(buildVariantPatch(variant, changed)).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(String) } });
    expect(buildVariantPatch(variant, unchanged)).toEqual({ ok: true, patch: null, changes: [] });
  });

  it('rejects malformed or negative rupee input before a request can be built', () => {
    const malformed = { ...variantPriceDraftFrom(variant), price: '499.999', reason: 'Valid reason' };
    const negative = { ...variantPriceDraftFrom(variant), price: '-1', reason: 'Valid reason' };

    expect(buildVariantPatch(variant, malformed)).toMatchObject({ ok: false, fieldErrors: { price: expect.any(String) } });
    expect(buildVariantPatch(variant, negative)).toMatchObject({ ok: false, fieldErrors: { price: expect.any(String) } });
  });
});

import { describe, expect, it } from 'vitest';

import { categoryPageSchema, inventoryMovementPageSchema, inventoryPageSchema, productPageSchema } from '@/lib/api/resources/catalog';

const product = {
  id: 'leather-cleaner',
  name: 'Leather Cleaner',
  subtitle: 'Gentle care',
  description: 'A careful leather cleaner.',
  categoryId: 'cleaners',
  categoryName: 'Cleaners',
  keyBenefits: ['Lifts everyday dirt'],
  suitableSurfaces: null,
  boxContents: 'One bottle',
  tags: ['leather'],
  seoTitle: null,
  seoDescription: null,
  active: true,
  archived: false,
  sortOrder: 1,
  version: 2,
  image: '/v1/media/abc/w1080.webp',
  variants: [{
    id: 'cleaner-250', sku: 'JWX-CLN-250', title: '250 ml', pricePaise: 49900,
    compareAtPricePaise: 59900, active: true, weightGrams: 300, lengthMm: 80,
    widthMm: 80, heightMm: 160, hsnCode: '34051000', barcode: null,
    onHand: 12, reserved: 2, lowStockThreshold: 4,
  }],
  updatedAt: '2026-10-07T10:00:00.000Z',
};

describe('catalogue runtime contracts', () => {
  it('parses category counts as backend display data without implying archived products are absent', () => {
    const page = categoryPageSchema.parse({ items: [{
      id: 'cleaners', name: 'Cleaners', description: '', imageMediaId: null, seoTitle: null,
      seoDescription: null, active: true, sortOrder: 1, productCount: 3, archivedProductCount: 1, rev: 2, updatedAt: '2026-10-07T10:00:00.000Z',
    }] });

    expect(page.items[0]?.productCount).toBe(3);
    expect(page.items[0]?.rev).toBe(2);
    expect(categoryPageSchema.safeParse({ items: [{
      id: 'cleaners', name: 'Cleaners', description: '', imageMediaId: null, seoTitle: null,
      seoDescription: null, active: true, sortOrder: 1, productCount: 3.5, rev: 2,
    }] }).success).toBe(false);
  });

  it('parses a source-shaped product page while preserving integer paise and nullable product fields', () => {
    const page = productPageSchema.parse({ items: [product], nextCursor: 'opaque-next-cursor' });

    expect(page.items[0]?.variants[0]?.pricePaise).toBe(49900);
    expect(page.items[0]?.suitableSurfaces).toBeNull();
    expect(page.nextCursor).toBe('opaque-next-cursor');
  });

  it('rejects decimal money, unsafe counts, and a malformed product timestamp instead of coercing them', () => {
    expect(productPageSchema.safeParse({ items: [{ ...product, variants: [{ ...product.variants[0], pricePaise: 499.5 }] }], nextCursor: null }).success).toBe(false);
    expect(productPageSchema.safeParse({ items: [{ ...product, version: Number.MAX_SAFE_INTEGER + 1 }], nextCursor: null }).success).toBe(false);
    expect(productPageSchema.safeParse({ items: [{ ...product, updatedAt: 'yesterday' }], nextCursor: null }).success).toBe(false);
  });

  it('accepts cost only as an optional nullable admin field and does not require it for catalog role rows', () => {
    const withoutCost = productPageSchema.parse({ items: [product], nextCursor: null });
    const withCost = productPageSchema.parse({
      items: [{ ...product, variants: [{ ...product.variants[0], costPricePaise: 12500 }] }],
      nextCursor: null,
    });

    expect(withoutCost.items[0]?.variants[0]).not.toHaveProperty('costPricePaise');
    expect(withCost.items[0]?.variants[0]?.costPricePaise).toBe(12500);
    expect(productPageSchema.safeParse({ items: [{ ...product, variants: [{ ...product.variants[0], costPricePaise: 125.5 }] }], nextCursor: null }).success).toBe(false);
  });
});

describe('inventory runtime contracts', () => {
  it('parses authoritative available stock and rejects a negative or inconsistent balance', () => {
    const row = { variantId: 'cleaner-250', sku: 'JWX-CLN-250', name: 'Leather Cleaner', variantTitle: '250 ml', onHand: 12, reserved: 2, available: 10, lowStockThreshold: 4, version: 3 };

    expect(inventoryPageSchema.parse({ items: [row] }).items[0]?.available).toBe(10);
    expect(inventoryPageSchema.safeParse({ items: [{ ...row, available: 11 }] }).success).toBe(false);
    expect(inventoryPageSchema.safeParse({ items: [{ ...row, reserved: 13, available: -1 }] }).success).toBe(false);
  });

  it('parses an opaque-cursor movement page with signed integer deltas', () => {
    const movement = { id: 91, kind: 'adjustment', deltaOnHand: -2, deltaReserved: 0, reason: 'Damaged units removed', refType: null, createdAt: '2026-10-07T10:00:00.000Z' };

    expect(inventoryMovementPageSchema.parse({ items: [movement], nextCursor: 'cursor-91' }).items[0]?.deltaOnHand).toBe(-2);
    expect(inventoryMovementPageSchema.safeParse({ items: [{ ...movement, deltaOnHand: -2.5 }], nextCursor: null }).success).toBe(false);
  });
});

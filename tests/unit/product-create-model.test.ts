import { describe, expect, it } from 'vitest';

import { buildProductCreatePayload, buildVariantCreatePayload, type ProductCreateDraft, type VariantCreateDraft } from '@/features/catalog/product-create-model';

const firstVariant = (): VariantCreateDraft => ({
  id: 'care-kit-small', sku: 'JWX-CARE-S', title: 'Small', price: '499.50', compareAtPrice: '599.00',
  weightGrams: '300', lengthMm: '80', widthMm: '80', heightMm: '160', hsnCode: '34051000', barcode: '',
  costPrice: '', lowStockThreshold: '4',
});

const draft = (): ProductCreateDraft => ({
  id: 'leather-care-kit', name: 'Leather Care Kit', subtitle: 'Complete care', description: 'Care for finished leather.',
  categoryId: 'care', keyBenefits: 'Cleans gently\nProtects the finish', suitableSurfaces: 'Finished leather',
  boxContents: 'Cleaner and conditioner', tags: 'leather\ncare', seoTitle: 'Leather care kit',
  seoDescription: 'A complete care kit.', sortOrder: '3', variants: [firstVariant(), { ...firstVariant(), id: 'care-kit-large', sku: 'JWX-CARE-L', title: 'Large', price: '799', compareAtPrice: '' }],
});

describe('product create payload model', () => {
  it('builds explicit inactive product and variant payloads with integer paise and no stock/media attachments', () => {
    const result = buildProductCreatePayload(draft(), [{ id: 'care', active: true }], false);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      id: 'leather-care-kit', name: 'Leather Care Kit', categoryId: 'care', active: false, sortOrder: 3, media: [],
      variants: [
        { id: 'care-kit-small', sku: 'JWX-CARE-S', pricePaise: 49950, compareAtPricePaise: 59900, active: false, lowStockThreshold: 4 },
        { id: 'care-kit-large', sku: 'JWX-CARE-L', pricePaise: 79900, compareAtPricePaise: null, active: false },
      ],
    });
    expect(result.payload.variants[0]).not.toHaveProperty('onHand');
    expect(result.payload.variants[0]).not.toHaveProperty('costPricePaise');
    expect(result.payload.suitableSurfaces).toBe('Finished leather');
    expect(result.payload.keyBenefits).toEqual(['Cleans gently', 'Protects the finish']);
  });

  it('keeps Admin cost price out of Catalog payloads and includes it only when Admin explicitly enters it', () => {
    const value = draft();
    value.variants[0]!.costPrice = '125.25';
    const catalog = buildProductCreatePayload(value, [{ id: 'care', active: true }], false);
    expect(catalog.ok).toBe(false);
    if (!catalog.ok) expect(catalog.errors['variants.0.costPrice']).toMatch(/admin/i);

    const admin = buildProductCreatePayload(value, [{ id: 'care', active: true }], true);
    expect(admin.ok).toBe(true);
    if (admin.ok) expect(admin.payload.variants[0]?.costPricePaise).toBe(12525);
  });

  it('rejects inactive/missing category, duplicate ids or SKUs, invalid prices, and compare-at below selling price', () => {
    expect(buildProductCreatePayload(draft(), [{ id: 'care', active: false }], false).ok).toBe(false);
    expect(buildProductCreatePayload(draft(), [], false).ok).toBe(false);
    const duplicate = draft();
    duplicate.variants[1] = { ...duplicate.variants[1]!, id: duplicate.variants[0]!.id, sku: duplicate.variants[0]!.sku };
    const duplicateResult = buildProductCreatePayload(duplicate, [{ id: 'care', active: true }], false);
    expect(duplicateResult.ok).toBe(false);
    if (!duplicateResult.ok) expect(duplicateResult.errors['variants']).toMatch(/unique/i);

    const badPrice = draft();
    badPrice.variants[0]!.price = '0';
    const badPriceResult = buildProductCreatePayload(badPrice, [{ id: 'care', active: true }], false);
    expect(badPriceResult.ok).toBe(false);
    if (!badPriceResult.ok) expect(badPriceResult.errors['variants.0.price']).toMatch(/positive/i);

    const badCompare = draft();
    badCompare.variants[0]!.compareAtPrice = '400';
    const badCompareResult = buildProductCreatePayload(badCompare, [{ id: 'care', active: true }], false);
    expect(badCompareResult.ok).toBe(false);
    if (!badCompareResult.ok) expect(badCompareResult.errors['variants.0.compareAtPrice']).toMatch(/below/i);
  });

  it('validates all-or-none package dimensions and bounded HSN/SKU fields', () => {
    const partialDimensions = draft();
    partialDimensions.variants[0]!.widthMm = '';
    const dimensionsResult = buildProductCreatePayload(partialDimensions, [{ id: 'care', active: true }], false);
    expect(dimensionsResult.ok).toBe(false);
    if (!dimensionsResult.ok) expect(dimensionsResult.errors['variants.0.dimensions']).toMatch(/all three/i);

    const badHsn = draft();
    badHsn.variants[0]!.hsnCode = 'HSN';
    expect(buildProductCreatePayload(badHsn, [{ id: 'care', active: true }], false).ok).toBe(false);

    const badSku = draft();
    badSku.variants[0]!.sku = 'x';
    expect(buildProductCreatePayload(badSku, [{ id: 'care', active: true }], false).ok).toBe(false);
  });

  it('builds an inactive add-variant payload and rejects a zero or malformed amount', () => {
    const input = firstVariant();
    const result = buildVariantCreatePayload(input, false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toMatchObject({ id: 'care-kit-small', pricePaise: 49950, active: false, compareAtPricePaise: 59900 });

    input.price = '0';
    expect(buildVariantCreatePayload(input, false).ok).toBe(false);
  });
});

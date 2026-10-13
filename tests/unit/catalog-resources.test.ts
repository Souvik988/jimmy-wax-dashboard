import { afterEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn(), apiDownload: vi.fn(), apiPostTextResult: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiGet: client.apiGet, apiPost: client.apiPost, apiPut: client.apiPut, apiPatch: client.apiPatch, apiDelete: client.apiDelete, apiDownload: client.apiDownload, apiPostTextResult: client.apiPostTextResult };
});

import { addProductVariant, adjustInventory, createCategory, createCollection, deleteCategory, deleteCollection, reorderCategories, updateCategory, createProduct, dryRunCatalogImport, downloadCatalogCsv, getCatalogVariants, getCategories, getCollection, getCollections, getInventory, getInventoryMovements, getProduct, getProducts, updateCollection, updateProduct, updateVariant, type ProductCreateInput } from '@/lib/api/resources/catalog';

afterEach(() => vi.resetAllMocks());

describe('catalogue and inventory resource calls', () => {
  const productResult = {
    id: 'care-kit', name: 'Care Kit', subtitle: '', description: '', categoryId: 'care',
    keyBenefits: [], suitableSurfaces: null, boxContents: null, tags: [], seoTitle: null, seoDescription: null,
    active: false, archived: false, sortOrder: 0, version: 1, image: null,
    variants: [{ id: 'kit-small', sku: 'JWX-KIT-S', title: 'Small', pricePaise: 49950, compareAtPricePaise: null, active: false, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, hsnCode: null, barcode: null, onHand: 0, reserved: 0, lowStockThreshold: null }],
    updatedAt: '2026-10-07T10:00:00.000Z',
  };

  it('creates an explicitly inactive product with no stock or media mutation fields and parses the Product response', async () => {
    const input: ProductCreateInput = {
      id: 'care-kit', name: 'Care Kit', subtitle: '', description: '', categoryId: 'care', keyBenefits: [],
      suitableSurfaces: null, boxContents: null, tags: [], seoTitle: null, seoDescription: null,
      active: false, sortOrder: 0, media: [],
      variants: [{ id: 'kit-small', sku: 'JWX-KIT-S', title: 'Small', pricePaise: 49950, compareAtPricePaise: null, active: false }],
    };
    client.apiPost.mockResolvedValue(productResult);

    await expect(createProduct(input)).resolves.toEqual(productResult);
    expect(client.apiPost).toHaveBeenCalledWith('admin/products', input, { idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/u) });
    client.apiPost.mockResolvedValueOnce({ ...productResult, active: true });
    await expect(createProduct(input)).rejects.toThrow(/did not match the reviewed inactive product/i);
    await expect(createProduct({ ...input, active: true } as unknown as ProductCreateInput)).rejects.toThrow();
    await expect(createProduct({ ...input, media: [{ mediaId: '2a469ddd-7466-48a2-963e-33421128a0e8', alt: 'Leather bottle' }] } as unknown as ProductCreateInput)).rejects.toThrow();
    expect(client.apiPost).toHaveBeenCalledTimes(2);
  });

  it('adds only an inactive variant and validates the authoritative product response', async () => {
    const variant = { id: 'kit-large', sku: 'JWX-KIT-L', title: 'Large', pricePaise: 89900, compareAtPricePaise: 99900, active: false as const };
    client.apiPost.mockResolvedValue({ ...productResult, variants: [...productResult.variants, { ...variant, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, hsnCode: null, barcode: null, onHand: 0, reserved: 0, lowStockThreshold: null }] });

    const guard = { expectedVersion: 7, reason: 'Add the large size' };
    await addProductVariant('care-kit', variant, guard, 'idem-key-0001');
    // the version and reason travel with the variant, and one idempotency key per submission
    expect(client.apiPost).toHaveBeenCalledWith('admin/products/care-kit/variants', { ...variant, ...guard }, { idempotencyKey: 'idem-key-0001' });
    const unsafeVariant = { ...variant, active: true as const };
    client.apiPost.mockResolvedValueOnce({ ...productResult, variants: [...productResult.variants, { ...unsafeVariant, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, hsnCode: null, barcode: null, onHand: 0, reserved: 0, lowStockThreshold: null }] });
    await expect(addProductVariant('care-kit', variant, guard)).rejects.toThrow(/did not match the reviewed inactive variant/i);
    await expect(addProductVariant('bad/id', variant, guard)).rejects.toThrow();
    await expect(addProductVariant('care-kit', variant, { expectedVersion: 1, reason: 'x' })).rejects.toThrow();
    await expect(addProductVariant('care-kit', { ...variant, active: true } as never, guard)).rejects.toThrow();
    expect(client.apiPost).toHaveBeenCalledTimes(2);
  });

  it('loads category filter choices from the documented catalogue endpoint', async () => {
    const categories = { items: [{
      id: 'cleaners', name: 'Cleaners', description: '', imageMediaId: null, seoTitle: null,
      seoDescription: null, active: true, sortOrder: 1, productCount: 3, archivedProductCount: 0, rev: 5, updatedAt: null,
    }] };
    const signal = new AbortController().signal;
    client.apiGet.mockResolvedValue(categories);

    await expect(getCategories(signal)).resolves.toEqual(categories);
    expect(client.apiGet).toHaveBeenCalledWith('admin/categories', { signal });
  });

  it('creates only a strict category body and parses the authoritative category row', async () => {
    const category = { id: 'leather-care', name: 'Leather care', description: '', imageMediaId: null, seoTitle: null, seoDescription: null, active: true, sortOrder: 4, rev: 1, updatedAt: null };
    client.apiPost.mockResolvedValue(category);

    await expect(createCategory({ id: 'leather-care', name: 'Leather care' })).resolves.toEqual(category);
    expect(client.apiPost).toHaveBeenCalledWith('admin/categories', { id: 'leather-care', name: 'Leather care', description: '', active: true });
    await expect(createCategory({ id: 'bad/id', name: 'Invalid' })).rejects.toThrow();
    expect(client.apiPost).toHaveBeenCalledTimes(1);
  });

  it('edits a category with only the changed fields and the loaded revision', async () => {
    const row = { id: 'leather-care', name: 'Leather care 2', description: '', imageMediaId: null, seoTitle: null, seoDescription: null, active: true, sortOrder: 4, rev: 6, updatedAt: '2026-10-07T10:00:00.000Z' };
    client.apiPatch.mockResolvedValue(row);
    await expect(updateCategory('leather-care', { name: 'Leather care 2', expectedRev: 5 })).resolves.toEqual(row);
    expect(client.apiPatch).toHaveBeenCalledWith('admin/categories/leather-care', { name: 'Leather care 2', expectedRev: 5 });
    await expect(updateCategory('leather-care', { expectedRev: 5 })).rejects.toThrow();
    await expect(updateCategory('leather-care', { name: 'X', expectedRev: 5 })).rejects.toThrow();
    await expect(updateCategory('leather-care', { name: 'Fine name' } as never)).rejects.toThrow();
    expect(client.apiPatch).toHaveBeenCalledTimes(1);
  });

  it('reorders only with every category once and every loaded revision', async () => {
    client.apiPut.mockResolvedValue({ items: [] });
    await reorderCategories(['b-cat', 'a-cat'], { 'a-cat': 2, 'b-cat': 3 });
    expect(client.apiPut).toHaveBeenCalledWith('admin/categories/order', { ids: ['b-cat', 'a-cat'], expectedRevs: { 'a-cat': 2, 'b-cat': 3 } });
    await expect(reorderCategories(['a-cat', 'a-cat'], { 'a-cat': 2 })).rejects.toThrow();
    await expect(reorderCategories(['a-cat', 'b-cat'], { 'a-cat': 2 })).rejects.toThrow();
    expect(client.apiPut).toHaveBeenCalledTimes(1);
  });

  it('deletes a category by slug and a collection only with revision and reason', async () => {
    client.apiDelete.mockResolvedValue(null);
    await deleteCategory('old-cat');
    expect(client.apiDelete).toHaveBeenLastCalledWith('admin/categories/old-cat');
    await deleteCollection('gift-sets', { expectedRev: 6, reason: 'Season is over' });
    expect(client.apiDelete).toHaveBeenLastCalledWith('admin/collections/gift-sets', {}, { expectedRev: 6, reason: 'Season is over' });
    await expect(deleteCollection('gift-sets', { expectedRev: 6, reason: 'no' })).rejects.toThrow();
    await expect(deleteCategory('../admin')).rejects.toThrow();
    expect(client.apiDelete).toHaveBeenCalledTimes(2);
  });

  it('downloads only the documented complete catalogue CSV export', async () => {
    const file = { blob: new Blob(['product_id,name\n']), filename: 'jimmywax-catalogue.csv', requestId: 'csv-export-2' };
    client.apiDownload.mockResolvedValue(file);
    await expect(downloadCatalogCsv()).resolves.toEqual(file);
    expect(client.apiDownload).toHaveBeenCalledWith('admin/catalog/export');
  });

  it('always runs import in dry-run mode and validates both success and row-error reports', async () => {
    const csv = 'product_id,name\ncleaner,Leather Cleaner\n';
    const report = { dryRun: true, rows: 1, products: { create: 0, update: 1 }, variants: { create: 0, update: 1 }, errors: [{ row: 2, field: 'price_paise', message: 'invalid' }], applied: false };
    client.apiPostTextResult.mockResolvedValue({ data: report, status: 422, requestId: 'catalog-csv-31' });
    await expect(dryRunCatalogImport(csv)).resolves.toEqual({ report: { ...report, changes: [], previewHash: null }, status: 422, requestId: 'catalog-csv-31' });
    expect(client.apiPostTextResult).toHaveBeenCalledWith('admin/catalog/import', csv, [422], { params: { dryRun: true } });

    client.apiPostTextResult.mockResolvedValueOnce({ data: { ...report, errors: [] }, status: 200 });
    await expect(dryRunCatalogImport(csv)).resolves.toMatchObject({ report: { dryRun: true, applied: false, errors: [] }, status: 200 });
    client.apiPostTextResult.mockResolvedValueOnce({ data: { ...report, applied: true }, status: 200 });
    await expect(dryRunCatalogImport(csv)).rejects.toThrow();
    await expect(dryRunCatalogImport('')).rejects.toThrow();
    await expect(dryRunCatalogImport('a'.repeat(2_000_001))).rejects.toThrow();
    expect(client.apiPostTextResult).toHaveBeenCalledTimes(3);
  });

  it('loads manual and smart collections from documented list/detail routes without resolve query', async () => {
    const collection = { id: 'staff-picks', name: 'Staff picks', description: '', kind: 'manual', productIds: ['leather-cleaner'], rule: null, visible: true, seoTitle: null, seoDescription: null, rev: 2, updatedAt: '2026-10-07T10:00:00.000Z' };
    const page = { items: [collection] };
    client.apiGet.mockResolvedValueOnce(page).mockResolvedValueOnce(collection);

    await expect(getCollections()).resolves.toEqual(page);
    await expect(getCollection('staff-picks')).resolves.toEqual(collection);
    expect(client.apiGet).toHaveBeenNthCalledWith(1, 'admin/collections', {});
    expect(client.apiGet).toHaveBeenNthCalledWith(2, 'admin/collections/staff-picks', {});
  });

  it('posts valid manual/smart collection configuration and revision-guards full updates', async () => {
    const manual = { id: 'staff-picks', name: 'Staff picks', description: '', kind: 'manual' as const, productIds: ['leather-cleaner'], visible: true, seoTitle: null, seoDescription: null };
    const result = { ...manual, rule: null, rev: 1, updatedAt: '2026-10-07T10:00:00.000Z' };
    client.apiPost.mockResolvedValue(result);
    await expect(createCollection(manual)).resolves.toEqual(result);
    expect(client.apiPost).toHaveBeenCalledWith('admin/collections', manual);

    const smart = { id: 'new-arrivals', name: 'New arrivals', kind: 'smart' as const, rule: { tags: ['new'], sort: 'newest' as const, limit: 12 } };
    client.apiPost.mockResolvedValue({ ...smart, description: '', productIds: [], rule: { tags: ['new'], sort: 'newest', limit: 12 }, visible: true, seoTitle: null, seoDescription: null, rev: 1, updatedAt: '2026-10-07T10:00:00.000Z' });
    await createCollection(smart);
    expect(client.apiPost).toHaveBeenLastCalledWith('admin/collections', { ...smart, description: '', visible: true });
    await expect(createCollection({ id: 'bad/id', name: 'Bad', kind: 'smart', rule: { limit: 12 } })).rejects.toThrow();

    const updated = { ...result, name: 'Staff favourites', rev: 2, updatedAt: '2026-10-07T10:01:00.000Z' };
    client.apiPut.mockResolvedValue(updated);
    await expect(updateCollection('staff-picks', { ...manual, name: 'Staff favourites', expectedRev: 1 })).resolves.toEqual(updated);
    expect(client.apiPut).toHaveBeenCalledWith('admin/collections/staff-picks', { ...manual, name: 'Staff favourites', expectedRev: 1 });
    await expect(updateCollection('staff-picks', { ...manual, expectedRev: 0 })).rejects.toThrow();
    expect(client.apiPut).toHaveBeenCalledTimes(1);
  });

  it('sends catalogue filters and opaque cursor to the server without local filtering or sorting', async () => {
    const page = { items: [], nextCursor: 'opaque-cursor' };
    const signal = new AbortController().signal;
    client.apiGet.mockResolvedValue(page);

    await expect(getProducts({ q: ' leather ', categoryId: 'cleaners', status: 'active', stock: 'low', limit: 50 }, 'opaque-cursor', signal)).resolves.toEqual(page);
    expect(client.apiGet).toHaveBeenCalledWith('admin/products', {
      params: { q: 'leather', categoryId: 'cleaners', status: 'active', stock: 'low', limit: 50, cursor: 'opaque-cursor' },
      signal,
    });
  });

  it('loads inventory as the non-cursor authoritative snapshot and forwards cancellation', async () => {
    const page = { items: [] };
    const signal = new AbortController().signal;
    client.apiGet.mockResolvedValue(page);

    await expect(getInventory(signal)).resolves.toEqual(page);
    expect(client.apiGet).toHaveBeenCalledWith('admin/inventory', { signal });
  });

  it('requests only the selected variant movement page with the backend cursor contract', async () => {
    const page = { items: [], nextCursor: null };
    client.apiGet.mockResolvedValue(page);

    await expect(getInventoryMovements('cleaner-250', 'opaque-cursor')).resolves.toEqual(page);
    expect(client.apiGet).toHaveBeenCalledWith('admin/inventory/cleaner-250/movements', {
      params: { cursor: 'opaque-cursor', limit: 20 },
    });
  });

  it('rejects malformed variant ids before making an inventory movement request', async () => {
    await expect(getInventoryMovements('bad/id', null)).rejects.toThrow();
    expect(client.apiGet).not.toHaveBeenCalled();
  });

  it('posts only the documented signed delta, reason, and expected version, then validates the authoritative result', async () => {
    const input = { delta: -2, reason: 'Damaged stock count', expectedVersion: 3 };
    const result = { variantId: 'cleaner-250', onHand: 10, reserved: 2, version: 4 };
    client.apiPost.mockResolvedValue(result);

    await expect(adjustInventory('cleaner-250', input)).resolves.toEqual(result);
    expect(client.apiPost).toHaveBeenCalledWith('admin/inventory/cleaner-250/adjust', input);
  });

  it('rejects zero deltas, weak reasons, invalid versions, and unsafe variant ids before posting', async () => {
    await expect(adjustInventory('cleaner-250', { delta: 0, reason: 'test reason', expectedVersion: 3 })).rejects.toThrow();
    await expect(adjustInventory('cleaner-250', { delta: 1, reason: '  ', expectedVersion: 3 })).rejects.toThrow();
    await expect(adjustInventory('cleaner-250', { delta: 1, reason: 'ok', expectedVersion: 0 })).rejects.toThrow();
    await expect(adjustInventory('bad/id', { delta: 1, reason: 'Valid reason', expectedVersion: 3 })).rejects.toThrow();
    expect(client.apiPost).not.toHaveBeenCalled();
  });

  it('loads one product detail by its validated immutable slug', async () => {
    client.apiGet.mockResolvedValue({
      id: 'leather-cleaner', name: 'Cleaner', subtitle: '', description: '', categoryId: 'cleaners',
      keyBenefits: [], suitableSurfaces: null, boxContents: null, tags: [], seoTitle: null, seoDescription: null,
      active: true, archived: false, sortOrder: 1, version: 2, image: null, variants: [], updatedAt: '2026-10-07T10:00:00.000Z',
    });
    const signal = new AbortController().signal;

    const product = await getProduct('leather-cleaner', signal);
    expect(product.id).toBe('leather-cleaner');
    expect(client.apiGet).toHaveBeenCalledWith('admin/products/leather-cleaner', { signal });
    await expect(getProduct('bad/id')).rejects.toThrow();
  });

  it('patches only supported product fields with expectedVersion and parses the authoritative product', async () => {
    const input = { name: 'Leather Cleaner · Gentle', tags: ['leather', 'care'], expectedVersion: 2 };
    const result = {
      id: 'leather-cleaner', name: input.name, subtitle: '', description: '', categoryId: 'cleaners',
      keyBenefits: [], suitableSurfaces: null, boxContents: null, tags: input.tags, seoTitle: null, seoDescription: null,
      active: true, archived: false, sortOrder: 1, version: 3, image: null, variants: [], updatedAt: '2026-10-07T10:01:00.000Z',
    };
    client.apiPatch.mockResolvedValue(result);

    await expect(updateProduct('leather-cleaner', input)).resolves.toEqual(result);
    expect(client.apiPatch).toHaveBeenCalledWith('admin/products/leather-cleaner', input);
    await expect(updateProduct('leather-cleaner', { name: 'x', expectedVersion: 2 })).rejects.toThrow();
    expect(client.apiPatch).toHaveBeenCalledTimes(1);
  });

  it('loads variant timestamps and patches price with the backend reason and expectedUpdatedAt guard', async () => {
    const variants = { items: [{ id: 'cleaner-250', sku: 'JWX-CLN-250', name: 'Leather Cleaner', title: '250 ml', pricePaise: 49900, comparePaise: 59900, active: true, updatedAt: '2026-10-07T10:00:00.000Z' }] };
    client.apiGet.mockResolvedValue(variants);
    const signal = new AbortController().signal;
    await expect(getCatalogVariants(signal)).resolves.toEqual(variants);
    expect(client.apiGet).toHaveBeenCalledWith('admin/catalog/variants', { signal });

    const input = { pricePaise: 52900, comparePaise: 59900, reason: 'Owner approved revised MRP', expectedUpdatedAt: '2026-10-07T10:00:00.000Z' };
    const result = { id: 'cleaner-250', pricePaise: 52900, comparePaise: 59900, active: true, updatedAt: '2026-10-07T10:02:00.000Z' };
    client.apiPatch.mockResolvedValue(result);
    await expect(updateVariant('cleaner-250', input)).resolves.toEqual(result);
    expect(client.apiPatch).toHaveBeenCalledWith('admin/catalog/variants/cleaner-250', input);
    await expect(updateVariant('cleaner-250', { ...input, comparePaise: 52899 })).rejects.toThrow();
    expect(client.apiPatch).toHaveBeenCalledTimes(1);
  });

  it('archives and restores only with a version and a reason, and verifies the result', async () => {
    const { archiveProduct, restoreProduct } = await import('@/lib/api/resources/catalog');
    client.apiPost.mockResolvedValueOnce({ ...productResult, archived: true, active: false, version: 9 });
    const archived = await archiveProduct('care-kit', { expectedVersion: 8, reason: 'Discontinued' });
    expect(client.apiPost).toHaveBeenLastCalledWith('admin/products/care-kit/archive', { expectedVersion: 8, reason: 'Discontinued' });
    expect(archived.archived).toBe(true);
    await expect(archiveProduct('care-kit', { expectedVersion: 8, reason: 'x' })).rejects.toThrow();
    client.apiPost.mockResolvedValueOnce({ ...productResult, archived: false });
    await expect(archiveProduct('care-kit', { expectedVersion: 9, reason: 'Still archived?' })).rejects.toThrow(/did not confirm/i);
    client.apiPost.mockResolvedValueOnce({ ...productResult, archived: false, active: false, version: 10 });
    expect((await restoreProduct('care-kit', { expectedVersion: 9, reason: 'Back in range' })).archived).toBe(false);
    expect(client.apiPost).toHaveBeenLastCalledWith('admin/products/care-kit/restore', { expectedVersion: 9, reason: 'Back in range' });
  });

  it('commits a CSV only with the preview fingerprint and a reason', async () => {
    const { commitCatalogImport } = await import('@/lib/api/resources/catalog');
    const hash = 'a'.repeat(64);
    const report = { dryRun: false, rows: 1, products: { create: 0, update: 1 }, variants: { create: 0, update: 1 }, errors: [], applied: true, changes: [], previewHash: hash };
    client.apiPostTextResult.mockResolvedValueOnce({ data: report, status: 200 });
    const result = await commitCatalogImport('a,b\n1,2', { previewHash: hash, reason: 'Quarterly price review' });
    expect(client.apiPostTextResult).toHaveBeenLastCalledWith('admin/catalog/import', 'a,b\n1,2', [422], { params: { dryRun: false, previewHash: hash, reason: 'Quarterly price review' } });
    expect(result.report.applied).toBe(true);
    await expect(commitCatalogImport('a,b', { previewHash: 'short', reason: 'Quarterly price review' })).rejects.toThrow();
    await expect(commitCatalogImport('a,b', { previewHash: hash, reason: 'x' })).rejects.toThrow();
    client.apiPostTextResult.mockResolvedValueOnce({ data: { ...report, applied: false }, status: 200 });
    await expect(commitCatalogImport('a,b', { previewHash: hash, reason: 'Quarterly price review' })).rejects.toThrow(/did not confirm/i);
  });
});

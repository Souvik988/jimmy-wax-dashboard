import { z } from 'zod';

import { apiDelete, apiDownload, apiGet, apiPatch, apiPost, apiPostTextResult, apiPut, type ApiPath } from '@/lib/api/client';

const count = z.number().int().nonnegative().safe();
const paise = count;
const slugId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).min(2).max(100);
const timestamp = z.string().datetime({ offset: true });

export const productVariantSchema = z.object({
  id: slugId,
  sku: z.string(),
  title: z.string(),
  pricePaise: paise,
  compareAtPricePaise: paise.nullable(),
  active: z.boolean(),
  weightGrams: count.nullable(),
  lengthMm: count.nullable(),
  widthMm: count.nullable(),
  heightMm: count.nullable(),
  hsnCode: z.string().nullable(),
  barcode: z.string().nullable(),
  onHand: count,
  reserved: count,
  lowStockThreshold: count.nullable(),
  costPricePaise: paise.nullable().optional(),
}).strict();

const productMediaSchema = z.object({
  position: count,
  assetPath: z.string(),
  alt: z.string(),
  mediaId: z.string().uuid().nullable(),
}).strict();

export const productSchema = z.object({
  id: slugId,
  name: z.string(),
  subtitle: z.string(),
  description: z.string(),
  categoryId: slugId,
  categoryName: z.string().optional(),
  keyBenefits: z.array(z.string()),
  suitableSurfaces: z.string().nullable(),
  boxContents: z.string().nullable(),
  tags: z.array(z.string()),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  active: z.boolean(),
  archived: z.boolean(),
  sortOrder: count,
  version: z.number().int().positive().safe(),
  image: z.string().nullable(),
  variants: z.array(productVariantSchema),
  media: z.array(productMediaSchema).optional(),
  updatedAt: timestamp,
}).strict();

export const productPageSchema = z.object({
  items: z.array(productSchema),
  nextCursor: z.string().nullable(),
}).strict();

export const productPatchInputSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  subtitle: z.string().trim().max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  categoryId: slugId.optional(),
  keyBenefits: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
  suitableSurfaces: z.string().trim().max(1000).nullable().optional(),
  boxContents: z.string().trim().max(1000).nullable().optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).optional(),
  seoTitle: z.string().trim().max(120).nullable().optional(),
  seoDescription: z.string().trim().max(320).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).safe().optional(),
  expectedVersion: z.number().int().positive().safe(),
}).strict().superRefine((input, ctx) => {
  if (Object.keys(input).every((key) => key === 'expectedVersion')) {
    ctx.addIssue({ code: 'custom', message: 'At least one product field must change.', path: ['expectedVersion'] });
  }
});

// The backend accepts active=true by default. These dashboard creation helpers
// intentionally narrow that contract to inactive records and no media writes.
export const productVariantCreateInputSchema = z.object({
  id: slugId,
  sku: z.string().trim().min(2).max(60),
  title: z.string().trim().min(1).max(80),
  pricePaise: z.number().int().min(1).max(100_000_000).safe(),
  compareAtPricePaise: paise.nullable(),
  active: z.literal(false),
  weightGrams: z.number().int().min(1).max(50_000).safe().nullable().optional(),
  lengthMm: z.number().int().min(1).max(2_000).safe().nullable().optional(),
  widthMm: z.number().int().min(1).max(2_000).safe().nullable().optional(),
  heightMm: z.number().int().min(1).max(2_000).safe().nullable().optional(),
  hsnCode: z.string().regex(/^[0-9]{4,8}$/u).nullable().optional(),
  barcode: z.string().trim().min(4).max(40).nullable().optional(),
  costPricePaise: paise.optional(),
  lowStockThreshold: z.number().int().min(0).max(100_000).safe().nullable().optional(),
}).strict().superRefine((variant, ctx) => {
  if (variant.compareAtPricePaise !== null && variant.compareAtPricePaise < variant.pricePaise) {
    ctx.addIssue({ code: 'custom', path: ['compareAtPricePaise'], message: 'Compare-at price must not be below selling price.' });
  }
});

export const productCreateInputSchema = z.object({
  id: slugId,
  name: z.string().trim().min(2).max(160),
  subtitle: z.string().trim().max(200),
  description: z.string().trim().max(5_000),
  categoryId: slugId,
  keyBenefits: z.array(z.string().trim().min(1).max(120)).max(10),
  suitableSurfaces: z.string().trim().max(1_000).nullable(),
  boxContents: z.string().trim().max(1_000).nullable(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20),
  seoTitle: z.string().trim().max(120).nullable(),
  seoDescription: z.string().trim().max(320).nullable(),
  active: z.literal(false),
  sortOrder: z.number().int().min(0).max(100_000).safe(),
  variants: z.array(productVariantCreateInputSchema).min(1).max(20),
  media: z.array(z.never()).length(0),
}).strict().superRefine((product, ctx) => {
  const variantIds = product.variants.map((variant) => variant.id);
  if (new Set(variantIds).size !== variantIds.length) {
    ctx.addIssue({ code: 'custom', path: ['variants'], message: 'Variant IDs must be unique.' });
  }
  const skus = product.variants.map((variant) => variant.sku.toLowerCase());
  if (new Set(skus).size !== skus.length) {
    ctx.addIssue({ code: 'custom', path: ['variants'], message: 'Variant SKUs must be unique.' });
  }
});

export const catalogVariantSchema = z.object({
  id: slugId,
  sku: z.string(),
  name: z.string(),
  title: z.string(),
  pricePaise: paise,
  comparePaise: paise.nullable(),
  active: z.boolean(),
  updatedAt: timestamp,
  // Contract 1.4.0 additions (DASH-BR-028): owning product and HSN per row.
  productId: slugId.optional(),
  hsnCode: z.string().nullable().optional(),
}).strict();

export const catalogVariantPageSchema = z.object({ items: z.array(catalogVariantSchema), nextCursor: z.string().nullable().optional() }).strict();

export const variantPatchInputSchema = z.object({
  pricePaise: paise.optional(),
  comparePaise: paise.nullable().optional(),
  active: z.boolean().optional(),
  title: z.string().trim().min(1).max(80).optional(),
  sku: z.string().trim().min(2).max(60).optional(),
  weightGrams: z.number().int().min(1).max(50_000).nullable().optional(),
  lengthMm: z.number().int().min(1).max(2_000).nullable().optional(),
  widthMm: z.number().int().min(1).max(2_000).nullable().optional(),
  heightMm: z.number().int().min(1).max(2_000).nullable().optional(),
  hsnCode: z.string().regex(/^[0-9]{4,8}$/u).nullable().optional(),
  barcode: z.string().trim().min(4).max(40).nullable().optional(),
  costPricePaise: paise.nullable().optional(),
  lowStockThreshold: z.number().int().min(0).max(100_000).optional(),
  reason: z.string().trim().min(3).max(300),
  expectedUpdatedAt: timestamp,
}).strict().superRefine((input, ctx) => {
  const { reason: _reason, expectedUpdatedAt: _stamp, ...changes } = input;
  if (Object.values(changes).every((value) => value === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'At least one variant field must change.', path: ['reason'] });
  }
  if (input.pricePaise !== undefined && input.comparePaise !== undefined && input.comparePaise !== null && input.comparePaise < input.pricePaise) {
    ctx.addIssue({ code: 'custom', message: 'Compare-at price must not be below the selling price.', path: ['comparePaise'] });
  }
});

export const variantPatchResultSchema = z.object({
  id: slugId,
  pricePaise: paise,
  comparePaise: paise.nullable(),
  active: z.boolean(),
  updatedAt: timestamp,
}).strict();

export const categorySchema = z.object({
  id: slugId,
  name: z.string(),
  description: z.string(),
  imageMediaId: z.string().uuid().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  active: z.boolean(),
  sortOrder: count,
  /** Live (non-archived) products. */
  productCount: count.optional(),
  /** A category can be deleted only when this and `productCount` are both 0. */
  archivedProductCount: count.optional(),
  /** Revision for guarded writes: sent back as `expectedRev` on edit, reorder and delete. */
  rev: z.number().int().positive().safe(),
  updatedAt: timestamp.nullable().optional(),
}).strict();

export const categoryPageSchema = z.object({ items: z.array(categorySchema) }).strict();

export const categoryCreateInputSchema = z.object({
  id: slugId.optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(''),
  imageMediaId: z.string().uuid().nullable().optional(),
  seoTitle: z.string().trim().max(120).nullable().optional(),
  seoDescription: z.string().trim().max(320).nullable().optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100_000).safe().optional(),
}).strict();

/** Only the fields that change are sent: no defaults, so an untouched field can never be overwritten. */
export const categoryPatchInputSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  imageMediaId: z.string().uuid().nullable().optional(),
  seoTitle: z.string().trim().max(120).nullable().optional(),
  seoDescription: z.string().trim().max(320).nullable().optional(),
  active: z.boolean().optional(),
  expectedRev: z.number().int().positive().safe(),
}).strict().refine((input) => Object.keys(input).some((key) => key !== 'expectedRev'), 'At least one category field must change.');

export const categoryOrderInputSchema = z.object({
  ids: z.array(slugId).min(1).max(500),
  expectedRevs: z.record(slugId, z.number().int().positive().safe()),
}).strict().superRefine((input, ctx) => {
  if (new Set(input.ids).size !== input.ids.length) ctx.addIssue({ code: 'custom', path: ['ids'], message: 'Every category must appear exactly once.' });
  for (const id of input.ids) if (!(id in input.expectedRevs)) ctx.addIssue({ code: 'custom', path: ['expectedRevs', id], message: 'Every category needs the revision you loaded.' });
});

export const collectionDeleteGuardSchema = z.object({ expectedRev: z.number().int().positive().safe(), reason: z.string().trim().min(3).max(300) }).strict();

export const collectionRuleSchema = z.object({
  categoryIds: z.array(slugId).max(20).optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).optional(),
  inStockOnly: z.boolean().optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'name']).default('newest'),
  limit: z.number().int().min(1).max(48).default(12),
}).strict();

export const collectionSchema = z.object({
  id: slugId,
  name: z.string(),
  description: z.string(),
  kind: z.enum(['manual', 'smart']),
  productIds: z.array(slugId).max(100),
  rule: collectionRuleSchema.nullable(),
  visible: z.boolean(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  rev: z.number().int().positive().safe(),
  updatedAt: timestamp,
}).strict().superRefine((collection, ctx) => {
  if (collection.kind === 'manual' && collection.rule !== null) {
    ctx.addIssue({ code: 'custom', path: ['rule'], message: 'Manual collections cannot have a smart rule.' });
  }
  if (collection.kind === 'smart' && collection.rule === null) {
    ctx.addIssue({ code: 'custom', path: ['rule'], message: 'Smart collections require a rule.' });
  }
});

export const collectionPageSchema = z.object({ items: z.array(collectionSchema) }).strict();

export const collectionInputSchema = z.object({
  id: slugId.optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).default(''),
  kind: z.enum(['manual', 'smart']).default('manual'),
  productIds: z.array(slugId).max(100).optional(),
  rule: collectionRuleSchema.optional(),
  visible: z.boolean().default(true),
  seoTitle: z.string().trim().max(120).nullable().optional(),
  seoDescription: z.string().trim().max(320).nullable().optional(),
}).strict().superRefine((input, ctx) => {
  if (input.kind === 'smart' ? !input.rule || input.productIds !== undefined : input.rule !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['kind'], message: 'Smart collections require a rule and no manual product IDs; manual collections cannot have a smart rule.' });
  }
  if (input.productIds && new Set(input.productIds).size !== input.productIds.length) {
    ctx.addIssue({ code: 'custom', path: ['productIds'], message: 'Manual product IDs must be unique.' });
  }
});

export const collectionUpdateInputSchema = collectionInputSchema.and(z.object({
  expectedRev: z.number().int().positive().safe(),
}).strict());

const csvCount = z.number().int().nonnegative().safe();
export const catalogCsvChangeSchema = z.object({
  kind: z.enum(['product', 'variant']),
  id: z.string(),
  action: z.enum(['create', 'update', 'unchanged']),
  fields: z.array(z.string()),
  priceChange: z.object({ fromPaise: z.number().nullable(), toPaise: z.number().nullable() }).strict().optional(),
}).strict();
export const catalogCsvImportReportSchema = z.object({
  dryRun: z.boolean(),
  rows: csvCount,
  products: z.object({ create: csvCount, update: csvCount }).strict(),
  variants: z.object({ create: csvCount, update: csvCount }).strict(),
  errors: z.array(z.object({ row: csvCount, field: z.string().optional(), message: z.string() }).strict()),
  applied: z.boolean(),
  /** Per-record preview (capped at 500 by the backend); empty for older backends. */
  changes: z.array(catalogCsvChangeSchema).default([]),
  /** Fingerprint of this exact file against current data; required to commit. Null when the file has row errors. */
  previewHash: z.string().regex(/^[0-9a-f]{64}$/u).nullable().default(null),
}).strict();

export const productFiltersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.string().max(100).optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  stock: z.enum(['low', 'out']).optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();

export const inventoryRowSchema = z.object({
  variantId: slugId,
  sku: z.string(),
  name: z.string(),
  variantTitle: z.string(),
  onHand: count,
  reserved: count,
  available: count,
  lowStockThreshold: count.nullable(),
  version: z.number().int().positive().safe(),
}).strict().superRefine((item, ctx) => {
  if (item.onHand - item.reserved !== item.available) {
    ctx.addIssue({ code: 'custom', message: 'Inventory balance does not reconcile.', path: ['available'] });
  }
});

export const inventoryPageSchema = z.object({ items: z.array(inventoryRowSchema) }).strict();

export const inventoryMovementSchema = z.object({
  id: z.number().int().positive().safe(),
  kind: z.enum(['receipt', 'adjustment', 'reserve', 'release', 'commit', 'return_restock', 'correction', 'import']),
  deltaOnHand: z.number().int().safe(),
  deltaReserved: z.number().int().safe(),
  reason: z.string().nullable(),
  refType: z.string().nullable(),
  createdAt: timestamp,
}).strict();

export const inventoryMovementPageSchema = z.object({
  items: z.array(inventoryMovementSchema),
  nextCursor: z.string().nullable(),
}).strict();

export const inventoryAdjustmentInputSchema = z.object({
  delta: z.number().int().min(-100_000).max(100_000).refine((value) => value !== 0, 'Adjustment must not be zero.'),
  reason: z.string().trim().min(3).max(300),
  expectedVersion: z.number().int().positive().safe(),
}).strict();

export const inventoryAdjustmentResultSchema = z.object({
  variantId: slugId,
  onHand: count,
  reserved: count,
  version: z.number().int().positive().safe(),
}).strict();

const pageLimit = z.number().int().min(1).max(50).default(20);
const movementVariantId = z.string().regex(/^[a-z0-9-]+$/u).max(100);

export type Product = z.infer<typeof productSchema>;
export type ProductVariant = z.infer<typeof productVariantSchema>;
export type ProductPage = z.infer<typeof productPageSchema>;
export type ProductFilters = z.input<typeof productFiltersSchema>;
export type ProductPatchInput = z.infer<typeof productPatchInputSchema>;
export type ProductCreateInput = z.infer<typeof productCreateInputSchema>;
export type ProductVariantCreateInput = z.infer<typeof productVariantCreateInputSchema>;
export type CatalogVariant = z.infer<typeof catalogVariantSchema>;
export type VariantPatchInput = z.infer<typeof variantPatchInputSchema>;
export type VariantPatchResult = z.infer<typeof variantPatchResultSchema>;
export type Category = z.infer<typeof categorySchema>;
export type CategoryPage = z.infer<typeof categoryPageSchema>;
export type CategoryCreateInput = z.input<typeof categoryCreateInputSchema>;
export type CategoryPatchInput = z.input<typeof categoryPatchInputSchema>;
export type Collection = z.infer<typeof collectionSchema>;
export type CollectionPage = z.infer<typeof collectionPageSchema>;
export type CollectionRule = z.infer<typeof collectionRuleSchema>;
export type CollectionInput = z.input<typeof collectionInputSchema>;
export type CollectionUpdateInput = z.input<typeof collectionUpdateInputSchema>;
export type CatalogCsvImportReport = z.infer<typeof catalogCsvImportReportSchema>;
export type CatalogCsvChange = z.infer<typeof catalogCsvChangeSchema>;
export type CatalogCsvDryRunResult = { report: CatalogCsvImportReport; status: number; requestId?: string };
export type InventoryRow = z.infer<typeof inventoryRowSchema>;
export type InventoryPage = z.infer<typeof inventoryPageSchema>;
export type InventoryMovement = z.infer<typeof inventoryMovementSchema>;
export type InventoryMovementPage = z.infer<typeof inventoryMovementPageSchema>;
export type InventoryAdjustmentInput = z.infer<typeof inventoryAdjustmentInputSchema>;
export type InventoryAdjustmentResult = z.infer<typeof inventoryAdjustmentResultSchema>;

function createdVariantMatches(input: ProductVariantCreateInput, product: Product): boolean {
  const matches = product.variants.filter((variant) => variant.id === input.id);
  if (matches.length !== 1) return false;
  const variant = matches[0];
  if (!variant) return false;
  return variant.sku.toLowerCase() === input.sku.toLowerCase()
    && variant.title === input.title
    && variant.pricePaise === input.pricePaise
    && variant.compareAtPricePaise === input.compareAtPricePaise
    && !variant.active
    && variant.onHand === 0
    && variant.reserved === 0
    && (input.weightGrams === undefined || variant.weightGrams === input.weightGrams)
    && (input.lengthMm === undefined || variant.lengthMm === input.lengthMm)
    && (input.widthMm === undefined || variant.widthMm === input.widthMm)
    && (input.heightMm === undefined || variant.heightMm === input.heightMm)
    && (input.hsnCode === undefined || variant.hsnCode === input.hsnCode)
    && (input.barcode === undefined || variant.barcode === input.barcode)
    && (input.lowStockThreshold === undefined || variant.lowStockThreshold === input.lowStockThreshold)
    && (input.costPricePaise === undefined || variant.costPricePaise === input.costPricePaise);
}

export async function getProducts(
  filters: ProductFilters = {},
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<ProductPage> {
  const params = productFiltersSchema.parse(filters);
  const response = await apiGet<unknown>('admin/products', {
    params: { ...params, cursor: cursor ?? undefined },
    ...(signal ? { signal } : {}),
  });
  return productPageSchema.parse(response);
}

export async function getProduct(id: string, signal?: AbortSignal): Promise<Product> {
  const productId = slugId.parse(id);
  const response = await apiGet<unknown>(`admin/products/${productId}`, signal ? { signal } : {});
  return productSchema.parse(response);
}

export async function updateProduct(id: string, input: ProductPatchInput): Promise<Product> {
  const productId = slugId.parse(id);
  const body = productPatchInputSchema.parse(input);
  const response = await apiPatch<unknown>(`admin/products/${productId}`, body);
  return productSchema.parse(response);
}

/** A fresh Idempotency-Key per submission: a proxy- or browser-level duplicate of the same request can never create the product twice. */
export function newIdempotencyKey(): string { return globalThis.crypto.randomUUID(); }

export async function createProduct(input: ProductCreateInput, idempotencyKey: string = newIdempotencyKey()): Promise<Product> {
  const body = productCreateInputSchema.parse(input);
  const response = await apiPost<unknown>('admin/products', body, { idempotencyKey });
  const product = productSchema.parse(response);
  const expectedVariantIds = new Set(body.variants.map((variant) => variant.id));
  const returnedVariantIds = new Set(product.variants.map((variant) => variant.id));
  const safeInactiveResult = product.id === body.id && !product.active && !product.archived
    && product.name === body.name && product.categoryId === body.categoryId
    && product.variants.length === body.variants.length
    && expectedVariantIds.size === returnedVariantIds.size
    && [...expectedVariantIds].every((id) => returnedVariantIds.has(id))
    && body.variants.every((variant) => createdVariantMatches(variant, product));
  if (!safeInactiveResult) throw new Error('The backend create response did not match the reviewed inactive product payload or zero-stock safeguards. Reconcile the product by ID before continuing.');
  return product;
}

export const variantAddGuardSchema = z.object({ expectedVersion: z.number().int().min(0), reason: z.string().trim().min(3).max(300) }).strict();
export type VariantAddGuard = z.infer<typeof variantAddGuardSchema>;

export async function addProductVariant(id: string, input: ProductVariantCreateInput, guard: VariantAddGuard, idempotencyKey: string = newIdempotencyKey()): Promise<Product> {
  const productId = slugId.parse(id);
  const body = productVariantCreateInputSchema.parse(input);
  const checked = variantAddGuardSchema.parse(guard);
  const response = await apiPost<unknown>(`admin/products/${productId}/variants`, { ...body, ...checked }, { idempotencyKey });
  const product = productSchema.parse(response);
  if (product.id !== productId || !createdVariantMatches(body, product)) {
    throw new Error('The backend add-variant response did not match the reviewed inactive variant payload or zero-stock safeguards. Reconcile the product before continuing.');
  }
  return product;
}

export async function getCatalogVariants(signal?: AbortSignal): Promise<z.infer<typeof catalogVariantPageSchema>> {
  const response = await apiGet<unknown>('admin/catalog/variants', signal ? { signal } : {});
  return catalogVariantPageSchema.parse(response);
}

export async function updateVariant(id: string, input: VariantPatchInput): Promise<VariantPatchResult> {
  const variantId = slugId.parse(id);
  const body = variantPatchInputSchema.parse(input);
  const response = await apiPatch<unknown>(`admin/catalog/variants/${variantId}`, body);
  return variantPatchResultSchema.parse(response);
}

export async function getCategories(signal?: AbortSignal): Promise<CategoryPage> {
  const response = await apiGet<unknown>('admin/categories', signal ? { signal } : {});
  return categoryPageSchema.parse(response);
}

export async function createCategory(input: CategoryCreateInput): Promise<Category> {
  const body = categoryCreateInputSchema.parse(input);
  const response = await apiPost<unknown>('admin/categories', body);
  return categorySchema.parse(response);
}

/** Edits only the supplied fields. 409 CART_VERSION_CONFLICT (current copy in `error.lines[0]`) when `expectedRev` is stale. */
export async function updateCategory(id: string, input: CategoryPatchInput): Promise<Category> {
  const categoryId = slugId.parse(id);
  const body = categoryPatchInputSchema.parse(input);
  return categorySchema.parse(await apiPatch<unknown>(`admin/categories/${categoryId}`, body));
}

/** `ids` is the complete new order; every category's loaded revision must be echoed. The success body is not relied on: callers refetch the list. */
export async function reorderCategories(ids: string[], expectedRevs: Record<string, number>): Promise<void> {
  const body = categoryOrderInputSchema.parse({ ids, expectedRevs });
  z.object({}).passthrough().parse(await apiPut<unknown>('admin/categories/order', body));
}

/** Refused with 409 ILLEGAL_STATE and `error.lines` (up to 50 `{ type: 'product', id, label, archived }`) while ANY product, archived or not, uses the category. */
export async function deleteCategory(id: string): Promise<void> {
  const categoryId = slugId.parse(id);
  await apiDelete<unknown>(`admin/categories/${categoryId}`);
}

/** Refused with 409 ILLEGAL_STATE and `error.lines` while a draft Studio document, a live release or a campaign still points at the collection. */
export async function deleteCollection(id: string, guard: { expectedRev: number; reason: string }): Promise<void> {
  const collectionId = slugId.parse(id);
  await apiDelete<unknown>(`admin/collections/${collectionId}`, {}, collectionDeleteGuardSchema.parse(guard));
}

export async function getCollections(signal?: AbortSignal): Promise<CollectionPage> {
  const response = await apiGet<unknown>('admin/collections', signal ? { signal } : {});
  return collectionPageSchema.parse(response);
}

export async function getCollection(id: string, signal?: AbortSignal): Promise<Collection> {
  const collectionId = slugId.parse(id);
  const response = await apiGet<unknown>(`admin/collections/${collectionId}`, signal ? { signal } : {});
  return collectionSchema.parse(response);
}

export async function createCollection(input: CollectionInput): Promise<Collection> {
  const body = collectionInputSchema.parse(input);
  const response = await apiPost<unknown>('admin/collections', body);
  return collectionSchema.parse(response);
}

export async function updateCollection(id: string, input: CollectionUpdateInput): Promise<Collection> {
  const collectionId = slugId.parse(id);
  const body = collectionUpdateInputSchema.parse(input);
  const response = await apiPut<unknown>(`admin/collections/${collectionId}`, body);
  return collectionSchema.parse(response);
}

export async function downloadCatalogCsv() {
  return apiDownload('admin/catalog/export');
}

export async function dryRunCatalogImport(csvText: string): Promise<CatalogCsvDryRunResult> {
  if (!csvText.trim()) throw new Error('Choose a non-empty CSV file.');
  if (csvText.length > 2_000_000 || new TextEncoder().encode(csvText).byteLength > 2_000_000) {
    throw new Error('CSV files must be no larger than 2 MB.');
  }
  const result = await apiPostTextResult<unknown>('admin/catalog/import', csvText, [422], { params: { dryRun: true } });
  const report = catalogCsvImportReportSchema.parse(result.data);
  if (!report.dryRun) throw new Error('Dashboard previews accept dry-run reports only.');
  if (report.applied) throw new Error('A dry-run must never apply changes.');
  if ((result.status === 422) !== (report.errors.length > 0)) {
    throw new Error('The backend dry-run status did not match its row-error report. Refresh and check the request reference.');
  }
  return { report, status: result.status, ...(result.requestId ? { requestId: result.requestId } : {}) };
}

/** Applies exactly the file that was previewed. The backend refuses a stale or different file (409) and a missing reason (400). */
export async function commitCatalogImport(csvText: string, guard: { previewHash: string; reason: string }): Promise<CatalogCsvDryRunResult> {
  if (!csvText.trim()) throw new Error('Choose a non-empty CSV file.');
  const previewHash = z.string().regex(/^[0-9a-f]{64}$/u).parse(guard.previewHash);
  const reason = z.string().trim().min(3).max(300).parse(guard.reason);
  const result = await apiPostTextResult<unknown>('admin/catalog/import', csvText, [422], { params: { dryRun: false, previewHash, reason } });
  const report = catalogCsvImportReportSchema.parse(result.data);
  if (result.status === 200 && (report.dryRun || !report.applied || report.errors.length > 0)) throw new Error('The backend did not confirm that the import was applied. Check the catalogue before trying again.');
  return { report, status: result.status, ...(result.requestId ? { requestId: result.requestId } : {}) };
}

export async function getInventory(signal?: AbortSignal): Promise<InventoryPage> {
  const response = await apiGet<unknown>('admin/inventory', signal ? { signal } : {});
  return inventoryPageSchema.parse(response);
}

export async function getInventoryMovements(
  variantId: string,
  cursor: string | null = null,
  signal?: AbortSignal,
  limit = 20,
): Promise<InventoryMovementPage> {
  const id = movementVariantId.parse(variantId);
  const pageSize = pageLimit.parse(limit);
  const response = await apiGet<unknown>(`admin/inventory/${id}/movements`, {
    params: { cursor, limit: pageSize },
    ...(signal ? { signal } : {}),
  });
  return inventoryMovementPageSchema.parse(response);
}

export async function adjustInventory(variantId: string, input: InventoryAdjustmentInput): Promise<InventoryAdjustmentResult> {
  const id = movementVariantId.parse(variantId);
  const body = inventoryAdjustmentInputSchema.parse(input);
  const response = await apiPost<unknown>(`admin/inventory/${id}/adjust`, body);
  return inventoryAdjustmentResultSchema.parse(response);
}

/** Replaces the product's gallery (backend contract: up to 12 approved images, each with alt text). */
export async function setProductMedia(id: string, items: Array<{ mediaId: string; alt: string }>): Promise<Product> {
  return productSchema.parse(await apiPut<unknown>(`admin/products/${id}/media` as ApiPath, { items }));
}

/** Creates an inactive copy. Archive/restore remain withheld (DASH-BR-026), but duplicate only creates a new record. */
export async function duplicateProduct(id: string, newId?: string): Promise<{ id: string }> {
  // The create response is not the same DTO as GET; only the new id is needed to navigate to the copy.
  return z.object({ id: z.string() }).passthrough().parse(await apiPost<unknown>(`admin/products/${id}/duplicate` as ApiPath, newId ? { newId } : {}));
}

export const archiveGuardSchema = z.object({ expectedVersion: z.number().int().min(0), reason: z.string().trim().min(3).max(300) }).strict();
export type ArchiveGuard = z.infer<typeof archiveGuardSchema>;

/** Hides a product from the storefront (and deactivates it). Needs the version you loaded and a reason; the backend audits before/after. */
export async function archiveProduct(id: string, guard: ArchiveGuard): Promise<Product> {
  const productId = slugId.parse(id);
  const product = productSchema.parse(await apiPost<unknown>(`admin/products/${productId}/archive`, archiveGuardSchema.parse(guard)));
  if (product.id !== productId || !product.archived || product.active) throw new Error('The backend did not confirm that the product is archived. Reload it before continuing.');
  return product;
}

/** Brings an archived product back (it stays inactive until separately activated). */
export async function restoreProduct(id: string, guard: ArchiveGuard): Promise<Product> {
  const productId = slugId.parse(id);
  const product = productSchema.parse(await apiPost<unknown>(`admin/products/${productId}/restore`, archiveGuardSchema.parse(guard)));
  if (product.id !== productId || product.archived) throw new Error('The backend did not confirm that the product was restored. Reload it before continuing.');
  return product;
}

import {
  collectionInputSchema,
  collectionUpdateInputSchema,
} from '@/lib/api/resources/catalog';
import type { Collection, CollectionInput, CollectionRule } from '@/lib/api/resources/catalog';

export type CollectionDraft = {
  id: string;
  name: string;
  description: string;
  kind: 'manual' | 'smart';
  productIds: string[];
  categoryIds: string[];
  tagsText: string;
  inStockOnly: boolean;
  sort: CollectionRule['sort'];
  limit: number;
  visible: boolean;
  seoTitle: string;
  seoDescription: string;
};

export type CollectionChange = { field: string; before: unknown; after: unknown };

export function collectionDraftFrom(collection: Collection | null): CollectionDraft {
  const rule = collection?.rule;
  return {
    id: collection?.id ?? '',
    name: collection?.name ?? '',
    description: collection?.description ?? '',
    kind: collection?.kind ?? 'manual',
    productIds: collection?.kind === 'manual' ? [...collection.productIds] : [],
    categoryIds: rule?.categoryIds ? [...rule.categoryIds] : [],
    tagsText: rule?.tags?.join('\n') ?? '',
    inStockOnly: rule?.inStockOnly ?? false,
    sort: rule?.sort ?? 'newest',
    limit: rule?.limit ?? 12,
    visible: collection?.visible ?? true,
    seoTitle: collection?.seoTitle ?? '',
    seoDescription: collection?.seoDescription ?? '',
  };
}

function splitTags(tagsText: string): string[] {
  return tagsText.split(/[\n,]/u).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
}

export function buildCollectionPayload(draft: CollectionDraft): CollectionInput {
  const common = {
    ...(draft.id.trim() ? { id: draft.id.trim() } : {}),
    name: draft.name.trim(),
    description: draft.description.trim(),
    kind: draft.kind,
    visible: draft.visible,
    seoTitle: draft.seoTitle.trim() || null,
    seoDescription: draft.seoDescription.trim() || null,
  };
  if (draft.kind === 'manual') {
    return collectionInputSchema.parse({
      ...common,
      productIds: [...draft.productIds],
    });
  }
  return collectionInputSchema.parse({
    ...common,
    rule: {
      ...(draft.categoryIds.length ? { categoryIds: [...draft.categoryIds] } : {}),
      ...(splitTags(draft.tagsText).length ? { tags: splitTags(draft.tagsText) } : {}),
      inStockOnly: draft.inStockOnly,
      sort: draft.sort,
      limit: draft.limit,
    },
  });
}

export function buildCollectionUpdate(id: string, expectedRev: number, draft: CollectionDraft) {
  return collectionUpdateInputSchema.parse({
    ...buildCollectionPayload({ ...draft, id }),
    expectedRev,
  });
}

type RuleLike = {
  categoryIds?: string[] | undefined;
  tags?: string[] | undefined;
  inStockOnly?: boolean | undefined;
  sort?: CollectionRule['sort'] | undefined;
  limit?: number | undefined;
} | null;

function comparableRule(rule: RuleLike) {
  if (!rule) return null;
  return {
    categoryIds: rule.categoryIds ?? [],
    tags: rule.tags ?? [],
    inStockOnly: rule.inStockOnly ?? false,
    sort: rule.sort ?? 'newest',
    limit: rule.limit ?? 12,
  };
}

export function collectionDiff(current: Collection | null, draft: CollectionDraft): CollectionChange[] {
  const payload = buildCollectionPayload(draft);
  const before: Record<string, unknown> = current ? {
    id: current.id,
    name: current.name,
    description: current.description,
    kind: current.kind,
    productIds: current.kind === 'manual' ? current.productIds : undefined,
    rule: current.kind === 'smart' ? comparableRule(current.rule) : undefined,
    visible: current.visible,
    seoTitle: current.seoTitle,
    seoDescription: current.seoDescription,
  } : {};
  const after: Record<string, unknown> = {
    id: payload.id ?? current?.id ?? '(generated from name)',
    name: payload.name,
    description: payload.description,
    kind: payload.kind,
    productIds: payload.kind === 'manual' ? payload.productIds ?? [] : undefined,
    rule: payload.kind === 'smart' ? comparableRule(payload.rule ?? null) : undefined,
    visible: payload.visible,
    seoTitle: payload.seoTitle ?? null,
    seoDescription: payload.seoDescription ?? null,
  };
  const fields = ['id', 'name', 'description', 'kind', 'productIds', 'rule', 'visible', 'seoTitle', 'seoDescription'];
  return fields
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({ field, before: before[field] ?? '(not set)', after: after[field] ?? '(not set)' }));
}

export function mergeCollectionDraft(original: Collection, latest: Collection, draft: CollectionDraft): CollectionDraft {
  if (original.kind !== latest.kind || original.kind !== draft.kind) return collectionDraftFrom(latest);
  const localFields = new Set(collectionDiff(original, draft).map((change) => change.field));
  const merged = collectionDraftFrom(latest);
  if (localFields.has('name')) merged.name = draft.name;
  if (localFields.has('description')) merged.description = draft.description;
  if (localFields.has('productIds')) merged.productIds = [...draft.productIds];
  if (localFields.has('rule')) {
    merged.categoryIds = [...draft.categoryIds];
    merged.tagsText = draft.tagsText;
    merged.inStockOnly = draft.inStockOnly;
    merged.sort = draft.sort;
    merged.limit = draft.limit;
  }
  if (localFields.has('visible')) merged.visible = draft.visible;
  if (localFields.has('seoTitle')) merged.seoTitle = draft.seoTitle;
  if (localFields.has('seoDescription')) merged.seoDescription = draft.seoDescription;
  return merged;
}

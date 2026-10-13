import { describe, expect, it } from 'vitest';

import { buildCollectionPayload, buildCollectionUpdate, collectionDraftFrom, collectionDiff, mergeCollectionDraft } from '@/features/catalog/catalog-taxonomy-model';
import type { Collection } from '@/lib/api/resources/catalog';

const collection: Collection = {
  id: 'staff-picks', name: 'Staff picks', description: 'Owner selected care', kind: 'manual',
  productIds: ['leather-cleaner', 'leather-conditioner'], rule: null, visible: true,
  seoTitle: null, seoDescription: null, rev: 4, updatedAt: '2026-10-07T10:00:00.000Z',
};

describe('catalogue taxonomy model', () => {
  it('builds ordered manual input without smart rules and keeps only the manual ids', () => {
    const draft = { ...collectionDraftFrom(collection), productIds: ['leather-conditioner', 'leather-cleaner'] };
    expect(buildCollectionPayload(draft)).toEqual({
      id: 'staff-picks', name: 'Staff picks', description: 'Owner selected care', kind: 'manual',
      productIds: ['leather-conditioner', 'leather-cleaner'], visible: true, seoTitle: null, seoDescription: null,
    });
  });

  it('builds a bounded smart rule and never sends manual product ids with it', () => {
    const draft = {
      ...collectionDraftFrom(null), id: 'new-arrivals', name: 'New arrivals', kind: 'smart' as const,
      tagsText: 'New, leather\nCare', categoryIds: ['cleaners'], inStockOnly: true, sort: 'price_asc' as const, limit: 8,
    };
    expect(buildCollectionPayload(draft)).toEqual({
      id: 'new-arrivals', name: 'New arrivals', description: '', kind: 'smart',
      rule: { categoryIds: ['cleaners'], tags: ['new', 'leather', 'care'], inStockOnly: true, sort: 'price_asc', limit: 8 },
      visible: true, seoTitle: null, seoDescription: null,
    });
  });

  it('attaches the fetched collection revision to the exact full replacement body', () => {
    const draft = { ...collectionDraftFrom(collection), description: 'Seasonal owner picks' };
    expect(buildCollectionUpdate(collection.id, collection.rev, draft)).toEqual({
      id: 'staff-picks', name: 'Staff picks', description: 'Seasonal owner picks', kind: 'manual',
      productIds: ['leather-cleaner', 'leather-conditioner'], visible: true, seoTitle: null, seoDescription: null, expectedRev: 4,
    });
  });

  it('reports only changed fields in a review diff and does not offer kind changes on existing records', () => {
    const draft = { ...collectionDraftFrom(collection), name: 'Staff favourites', visible: false };
    expect(collectionDiff(collection, draft)).toEqual([
      { field: 'name', before: 'Staff picks', after: 'Staff favourites' },
      { field: 'visible', before: true, after: false },
    ]);
  });

  it('preserves locally changed fields while adopting untouched fields from the newest revision', () => {
    const latest = { ...collection, description: 'Changed by another operator', rev: 5 };
    const local = { ...collectionDraftFrom(collection), name: 'Staff favourites' };
    const merged = mergeCollectionDraft(collection, latest, local);
    expect(merged.name).toBe('Staff favourites');
    expect(merged.description).toBe('Changed by another operator');
    expect(buildCollectionUpdate(collection.id, latest.rev, merged)).toMatchObject({
      name: 'Staff favourites', description: 'Changed by another operator', expectedRev: 5,
    });
  });

  it('rejects duplicate or excessive manual products and invalid smart rule limits', () => {
    expect(() => buildCollectionPayload({ ...collectionDraftFrom(collection), productIds: ['same', 'same'] })).toThrow();
    expect(() => buildCollectionPayload({ ...collectionDraftFrom(null), kind: 'smart', limit: 49 })).toThrow();
  });
});

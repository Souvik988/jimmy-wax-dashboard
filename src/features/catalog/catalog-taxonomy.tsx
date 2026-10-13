'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Layers3, Plus, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge, Button, Checkbox, Input, Select, Switch, Textarea } from '@/components/ui/core';
import { Card, EmptyState, ErrorState, NotAllowedState, OfflineState, Skeleton } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import {
  categoryCreateInputSchema,
  createCategory,
  createCollection,
  getCategories,
  getCollection,
  getCollections,
  getProducts,
  updateCollection,
} from '@/lib/api/resources/catalog';
import type {
  Category,
  CategoryCreateInput,
  Collection,
  CollectionInput,
  CollectionUpdateInput,
} from '@/lib/api/resources/catalog';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { formatIst } from '@/lib/format/time';

import {
  buildCollectionPayload,
  buildCollectionUpdate,
  collectionDiff,
  collectionDraftFrom,
  mergeCollectionDraft,
} from './catalog-taxonomy-model';
import type { CollectionChange, CollectionDraft } from './catalog-taxonomy-model';
import { CatalogCsvTools } from './catalog-csv-tools';
import { CategoryList } from './category-list';
import { CollectionDelete, type CollectionDeleteResult } from './collection-delete';
import styles from './catalog-taxonomy.module.css';

type Section = 'categories' | 'collections';
type CategoryDraft = { id: string; name: string; description: string; seoTitle: string; seoDescription: string; active: boolean };
type Review =
  | { target: 'category'; input: CategoryCreateInput }
  | { target: 'collection-create'; input: CollectionInput; changes: CollectionChange[] }
  | { target: 'collection-update'; input: CollectionUpdateInput; base: Collection; changes: CollectionChange[] };

const blankCategory: CategoryDraft = { id: '', name: '', description: '', seoTitle: '', seoDescription: '', active: true };
const collectionSorts = ['newest', 'price_asc', 'price_desc', 'name'] as const;

function apiError(error: unknown): ApiError | null {
  return error instanceof ApiError ? error : null;
}

function isOffline(error: unknown): boolean {
  const parsed = apiError(error);
  return Boolean(parsed && (parsed.status === 0 || parsed.status >= 500 || parsed.code === 'UNAVAILABLE'));
}

function isAmbiguousWrite(error: unknown): boolean {
  const parsed = apiError(error);
  return Boolean(parsed && (parsed.status === 0 || parsed.status >= 500 || parsed.code === 'CONTRACT_DRIFT' || parsed.code === 'UNAVAILABLE'));
}

function errorRequestId(error: unknown): string | undefined {
  return apiError(error)?.requestId;
}

function errorText(error: unknown): string {
  return apiError(error)?.message ?? 'The backend response could not be verified. Refresh before trying again.';
}

function reviewValue(value: unknown): string {
  if (value === '(not set)') return 'Not set';
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return 'Not set';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function ReviewChanges({ changes }: { changes: CollectionChange[] }): React.ReactNode {
  if (!changes.length) return <p>No fields differ from the current backend record.</p>;
  return <dl className={styles.diff}>
    {changes.map(({ field, before, after }) => <div key={field}>
      <dt>{field}</dt>
      <dd><span>Before</span><code>{reviewValue(before)}</code></dd>
      <dd><span>After</span><code>{reviewValue(after)}</code></dd>
    </div>)}
  </dl>;
}

function RequestReference({ error }: { error: unknown }): React.ReactNode {
  const requestId = errorRequestId(error);
  return requestId ? <code className={styles.requestId}>Request ID: {requestId}</code> : null;
}

function ProductPicker({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }): React.ReactNode {
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const filters = useMemo(() => ({ q: search || undefined, limit: 20 }), [search]);
  const products = useCursorList(queryKeys.catalog.products, filters, getProducts);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim().slice(0, 100)), 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const loadedById = new Map(products.items.map((product) => [product.id, product]));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  const error = apiError(products.error);

  return <div className={styles.picker}>
    <Input label="Find products" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search the live catalogue" />
    <p className={styles.helper}>Choices come only from the backend product list. Selected order is the storefront order; products absent from the current result page remain selected by ID.</p>
    {products.isLoading ? <Skeleton lines={3} /> : null}
    {products.isError && isOffline(products.error) ? <OfflineState title="Product choices are offline" requestId={error?.requestId} actionLabel="Retry product list" onAction={() => void products.refetch()}>{error?.message ?? 'The catalogue could not be reached.'}</OfflineState> : null}
    {products.isError && error?.status === 403 ? <NotAllowedState title="Product choices are not permitted" requestId={error.requestId}>The backend denied the catalogue product list.</NotAllowedState> : null}
    {products.isError && !isOffline(products.error) && error?.status !== 403 ? <ErrorState title="Product choices could not be loaded" requestId={error?.requestId} actionLabel="Retry product list" onAction={() => void products.refetch()}>{errorText(products.error)}</ErrorState> : null}
    {!products.isLoading && !products.isError && !products.items.length ? <p className={styles.helper}>No products matched this backend search.</p> : null}
    {products.items.length ? <ul className={styles.productResults} aria-label="Backend product choices">
      {products.items.map((product) => <li key={product.id}>
        <Checkbox label={<><strong>{product.name}</strong><span>{product.id} · {product.archived ? 'Archived' : product.active ? 'Active' : 'Inactive'}</span></>} checked={selected.includes(product.id)} onChange={() => toggle(product.id)} disabled={product.archived || (!selected.includes(product.id) && selected.length >= 100)} />
      </li>)}
    </ul> : null}
    {products.hasMore ? <Button variant="secondary" size="sm" loading={products.isFetchingNextPage} onClick={() => void products.fetchNextPage()}>Load next product page</Button> : null}
    <div className={styles.selectedProducts}>
      <h3>Storefront order <span>({selected.length}/100)</span></h3>
      {selected.length ? <ol>
        {selected.map((id, index) => <li key={`${id}-${index}`}>
          <span><strong>{loadedById.get(id)?.name ?? id}</strong><small>{id}{!loadedById.has(id) ? ' · label not loaded in this search' : ''}</small></span>
          <span className={styles.orderActions}>
            <Button variant="quiet" size="sm" aria-label={`Move ${id} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} aria-hidden="true" /></Button>
            <Button variant="quiet" size="sm" aria-label={`Move ${id} down`} disabled={index === selected.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} aria-hidden="true" /></Button>
            <Button variant="quiet" size="sm" aria-label={`Remove ${id}`} onClick={() => toggle(id)}><X size={15} aria-hidden="true" /></Button>
          </span>
        </li>)}
      </ol> : <p className={styles.helper}>No products selected. The manual collection will start empty.</p>}
    </div>
  </div>;
}

function TaxonomyTabs({ active, onChange }: { active: Section; onChange: (section: Section) => void }): React.ReactNode {
  const sections: Array<{ id: Section; label: string }> = [
    { id: 'categories', label: 'Categories' }, { id: 'collections', label: 'Collections' },
  ];
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = sections.findIndex((section) => section.id === active);
    const next = sections[(index + (event.key === 'ArrowRight' ? 1 : sections.length - 1)) % sections.length]!;
    onChange(next.id);
    document.getElementById(`taxonomy-tab-${next.id}`)?.focus();
  };
  return <div className={styles.tabs} role="tablist" aria-label="Catalogue management" onKeyDown={onKeyDown}>
    {sections.map((section) => <button key={section.id} id={`taxonomy-tab-${section.id}`} type="button" role="tab" aria-selected={active === section.id} aria-controls={`taxonomy-panel-${section.id}`} tabIndex={active === section.id ? 0 : -1} onClick={() => onChange(section.id)}>{section.label}</button>)}
  </div>;
}

export function CatalogTaxonomy({ canWrite }: { canWrite: boolean }): React.ReactNode {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<Section>('categories');
  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>(blankCategory);
  const [categoryReview, setCategoryReview] = useState<CategoryCreateInput | null>(null);
  const [categoryError, setCategoryError] = useState<unknown>(null);
  const [categoryMessage, setCategoryMessage] = useState('');
  const [categoryCreateBlocked, setCategoryCreateBlocked] = useState(false);
  const [categoryReconcile, setCategoryReconcile] = useState('');
  const [categoryFieldError, setCategoryFieldError] = useState('');
  const [collectionMode, setCollectionMode] = useState<'closed' | 'create' | 'edit'>('closed');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [collectionDetailLoading, setCollectionDetailLoading] = useState(false);
  const [collectionDetailError, setCollectionDetailError] = useState<unknown>(null);
  const [collectionBase, setCollectionBase] = useState<Collection | null>(null);
  const [collectionDraft, setCollectionDraft] = useState<CollectionDraft>(() => collectionDraftFrom(null));
  const [collectionReview, setCollectionReview] = useState<Review | null>(null);
  const [collectionError, setCollectionError] = useState<unknown>(null);
  const [collectionMessage, setCollectionMessage] = useState('');
  const [collectionCreateBlocked, setCollectionCreateBlocked] = useState(false);
  const [collectionConflict, setCollectionConflict] = useState<Collection | null>(null);
  const [collectionConflictError, setCollectionConflictError] = useState<unknown>(null);
  const [collectionUncertain, setCollectionUncertain] = useState(false);
  const [collectionReconcileMessage, setCollectionReconcileMessage] = useState('');
  const [collectionFieldError, setCollectionFieldError] = useState('');
  const [collectionDeleteResult, setCollectionDeleteResult] = useState<CollectionDeleteResult | null>(null);
  const collectionLoadGeneration = useRef(0);

  const categories = useQuery({
    queryKey: queryKeys.catalog.categories,
    queryFn: ({ signal }) => getCategories(signal),
    staleTime: 30_000,
    retry: (count, error) => count < 2 && isOffline(error),
  });
  const collections = useQuery({
    queryKey: queryKeys.catalog.collections,
    queryFn: ({ signal }) => getCollections(signal),
    staleTime: 30_000,
    retry: (count, error) => count < 2 && isOffline(error),
  });
  const updateCategoryCache = (category: Category) => {
    queryClient.setQueryData(queryKeys.catalog.categories, (previous: { items: Category[] } | undefined) => ({
      items: [...(previous?.items ?? []).filter((item) => item.id !== category.id), category].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
    }));
    void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.categories });
  };

  const categoryMutation = useMutation({
    mutationFn: (input: CategoryCreateInput) => createCategory(input),
    retry: false,
    onSuccess: (category) => {
      updateCategoryCache(category);
      setCategoryMessage(`Category created: ${category.name}. The server assigned order ${category.sortOrder}.`);
      setCategoryDraft(blankCategory);
      setCategoryFormOpen(false);
      setCategoryReview(null);
      setCategoryError(null);
      setCategoryReconcile('');
    },
    onError: async (error, input) => {
      setCategoryError(error);
      setCategoryMessage('');
      setCategoryReview(null);
      if (!isAmbiguousWrite(error)) return;
      setCategoryCreateBlocked(true);
      try {
        const latest = await getCategories();
        queryClient.setQueryData(queryKeys.catalog.categories, latest);
        const match = latest.items.find((item) => item.id === input.id || item.name === input.name);
        setCategoryReconcile(match
          ? `A matching category (${match.id}) is visible after the uncertain response. This does not prove this request created it; no repeat POST is available in this page.`
          : 'No matching category is visible yet. The create response was uncertain, so this page will not repeat the POST. Refresh and ask an administrator to check the category list before continuing.');
      } catch {
        setCategoryReconcile('The read-after-write check also failed. Do not repeat this create until an operator has checked the live category list.');
      }
    },
  });

  const collectionMutation = useMutation({
    mutationFn: async (review: Review) => {
      if (review.target === 'collection-update') return updateCollection(review.base.id, review.input);
      return createCollection(review.input);
    },
    retry: false,
    onSuccess: (collection, review) => {
      queryClient.setQueryData(queryKeys.catalog.collections, (previous: { items: Collection[] } | undefined) => ({
        items: [...(previous?.items ?? []).filter((item) => item.id !== collection.id), collection].sort((a, b) => a.name.localeCompare(b.name)),
      }));
      queryClient.setQueryData(['catalog', 'collection', collection.id], collection);
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.collections });
      if (review.target === 'collection-update') {
        setCollectionBase(collection);
        setCollectionDraft(collectionDraftFrom(collection));
        setCollectionMode('edit');
        setEditingId(collection.id);
        setCollectionDetailError(null);
      } else {
        setCollectionDraft(collectionDraftFrom(null));
        setCollectionMode('closed');
        setEditingId(null);
        setCollectionDetailLoading(false);
        setCollectionDetailError(null);
        setCollectionBase(null);
      }
      setCollectionReview(null);
      setCollectionError(null);
      setCollectionConflict(null);
      setCollectionUncertain(false);
      setCollectionReconcileMessage('');
      setCollectionMessage(review.target === 'collection-update' ? 'Collection changes saved from the authoritative server response.' : 'Collection created from the authoritative server response.');
    },
    onError: async (error, review) => {
      setCollectionError(error);
      setCollectionMessage('');
      setCollectionReview(null);
      if (review.target === 'collection-update' && (apiError(error)?.status === 409 || isAmbiguousWrite(error))) {
        setCollectionUncertain(isAmbiguousWrite(error));
        try {
          const latest = await getCollection(review.base.id);
          queryClient.setQueryData(['catalog', 'collection', latest.id], latest);
          setCollectionConflict(latest);
          setCollectionConflictError(error);
        } catch {
          setCollectionConflictError(error);
          setCollectionReconcileMessage('The write may have reached the backend, but its current revision could not be loaded. Use Reconcile collection before any further save.');
        }
        return;
      }
      if (review.target === 'collection-create' && isAmbiguousWrite(error)) {
        setCollectionCreateBlocked(true);
        try {
          const latest = await getCollections();
          queryClient.setQueryData(queryKeys.catalog.collections, latest);
          const match = latest.items.find((item) => item.id === review.input.id || item.name === review.input.name);
          setCollectionReconcileMessage(match
            ? `A matching collection (${match.id}) is visible after the uncertain response. This does not prove this request created it; no repeat POST is available here.`
            : 'No matching collection is visible yet. Because the create outcome is uncertain and the backend has no create idempotency key, this page will not repeat the POST. Check the live list before creating another.');
        } catch {
          setCollectionReconcileMessage('The read-after-write check also failed. Do not repeat this create until the live collection list has been checked.');
        }
      }
    },
  });

  const categoryReadError = apiError(categories.error);
  const collectionReadError = apiError(collections.error);
  const currentCategories = categories.data?.items ?? [];

  const buildCategoryReview = () => {
    const parsed = categoryCreateInputSchema.safeParse({
      ...(categoryDraft.id.trim() ? { id: categoryDraft.id.trim() } : {}),
      name: categoryDraft.name,
      description: categoryDraft.description,
      seoTitle: categoryDraft.seoTitle.trim() || null,
      seoDescription: categoryDraft.seoDescription.trim() || null,
      active: categoryDraft.active,
    });
    if (!parsed.success) {
      setCategoryFieldError(parsed.error.issues[0]?.message ?? 'Check the category fields.');
      return;
    }
    setCategoryFieldError('');
    setCategoryError(null);
    setCategoryReview(parsed.data);
  };

  const openCreateCategory = () => {
    setCategoryDraft(blankCategory);
    setCategoryError(null);
    setCategoryMessage('');
    setCategoryReconcile('');
    setCategoryFormOpen(true);
  };

  const openCreateCollection = () => {
    collectionLoadGeneration.current += 1;
    setCollectionMode('create');
    setEditingId(null);
    setCollectionDetailLoading(false);
    setCollectionDetailError(null);
    setCollectionBase(null);
    setCollectionDraft(collectionDraftFrom(null));
    setCollectionError(null);
    setCollectionMessage('');
    setCollectionFieldError('');
    setCollectionConflict(null);
    setCollectionUncertain(false);
    setCollectionReconcileMessage('');
  };

  const openEditCollection = async (id: string) => {
    const generation = ++collectionLoadGeneration.current;
    setCollectionMode('edit');
    setEditingId(id);
    setCollectionBase(null);
    setCollectionDetailLoading(true);
    setCollectionDetailError(null);
    setCollectionDraft(collectionDraftFrom(null));
    setCollectionError(null);
    setCollectionMessage('');
    setCollectionFieldError('');
    setCollectionConflict(null);
    setCollectionUncertain(false);
    setCollectionReconcileMessage('');
    try {
      const record = await queryClient.fetchQuery({
        queryKey: ['catalog', 'collection', id],
        queryFn: ({ signal }) => getCollection(id, signal),
        staleTime: 0,
      });
      if (collectionLoadGeneration.current !== generation) return;
      setCollectionBase(record);
      setCollectionDraft(collectionDraftFrom(record));
    } catch (error) {
      if (collectionLoadGeneration.current === generation) setCollectionDetailError(error);
    } finally {
      if (collectionLoadGeneration.current === generation) setCollectionDetailLoading(false);
    }
  };

  const closeCollectionForm = () => {
    collectionLoadGeneration.current += 1;
    setCollectionMode('closed');
    setEditingId(null);
    setCollectionDetailLoading(false);
    setCollectionDetailError(null);
    setCollectionBase(null);
    setCollectionReview(null);
    setCollectionConflict(null);
  };

  const requestCollectionReview = () => {
    try {
      if (collectionUncertain) {
        setCollectionFieldError('Load the latest server revision and explicitly review the draft before saving.');
        return;
      }
      const changes = collectionDiff(collectionBase, collectionDraft);
      if (collectionBase && changes.length === 0) {
        setCollectionFieldError('No collection fields have changed.');
        return;
      }
      setCollectionFieldError('');
      setCollectionError(null);
      if (collectionBase) {
        const input = buildCollectionUpdate(collectionBase.id, collectionBase.rev, collectionDraft);
        setCollectionReview({ target: 'collection-update', input, base: collectionBase, changes });
      } else {
        const input = buildCollectionPayload(collectionDraft);
        setCollectionReview({ target: 'collection-create', input, changes });
      }
    } catch (error) {
      setCollectionFieldError(error instanceof Error ? error.message : 'Check the collection fields.');
    }
  };

  const reconcileCollectionUpdate = async () => {
    if (!collectionBase) return;
    setCollectionConflictError(null);
    setCollectionReconcileMessage('Checking the authoritative collection revision…');
    try {
      const latest = await getCollection(collectionBase.id);
      queryClient.setQueryData(['catalog', 'collection', latest.id], latest);
      setCollectionConflict(latest);
      setCollectionReconcileMessage('The latest backend revision loaded. Compare it below; saving still requires an explicit rebase and a second review.');
    } catch (error) {
      setCollectionConflictError(error);
      setCollectionReconcileMessage('The latest revision is still unavailable. No write was repeated.');
    }
  };

  const useLatestCollection = () => {
    if (!collectionConflict) return;
    const original = collectionBase;
    if (original) setCollectionDraft(mergeCollectionDraft(original, collectionConflict, collectionDraft));
    setCollectionBase(collectionConflict);
    setCollectionConflict(null);
    setCollectionUncertain(false);
    setCollectionReview(null);
    setCollectionError(null);
    setCollectionFieldError('');
    setCollectionMessage('The form now uses the latest backend revision. Review the full replacement again before saving.');
  };

  const categoryRows = currentCategories;
  const collectionRows = collections.data?.items ?? [];

  return <div className={styles.root}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>CATALOGUE WORKSPACE</p>
        <h1>Categories &amp; collections</h1>
        <p>Organize the single storefront from live backend records. Storefront product resolution remains owned by the backend.</p>
      </div>
      <Badge tone={canWrite ? 'positive' : 'neutral'}>{canWrite ? 'Catalogue writes available' : 'Read-only access'}</Badge>
    </header>

    <section className={styles.guardrail} aria-label="Backend safety limits">
      <strong>Safe controls only</strong>
      <p>Every change is checked against the revision you loaded, so nobody&apos;s work is silently overwritten. Deleting a category or collection is refused while anything still uses it, and what blocks it is listed.</p>
    </section>

    <CatalogCsvTools canWrite={canWrite} />

    {categoryMessage ? <p className={styles.success} role="status">{categoryMessage}</p> : null}
    {collectionMessage ? <p className={styles.success} role="status">{collectionMessage}</p> : null}

    <TaxonomyTabs active={active} onChange={setActive} />
    <section id={`taxonomy-panel-${active}`} role="tabpanel" aria-labelledby={`taxonomy-tab-${active}`} tabIndex={0} className={styles.panel}>
      {active === 'categories' ? <>
        <div className={styles.sectionHead}>
          <div><p className={styles.eyebrow}>PRODUCT GROUPS</p><h2>Categories</h2><p>Every row and count is returned by the backend. Live and archived products are counted separately; a category can be deleted only when both are zero.</p></div>
          {canWrite ? <Button onClick={openCreateCategory}><Plus size={16} aria-hidden="true" />New category</Button> : null}
        </div>
        {categories.isLoading ? <Card title="Loading categories"><Skeleton lines={4} /></Card> : null}
        {categories.isError && categoryReadError?.status === 403 ? <NotAllowedState title="Categories are not permitted" requestId={categoryReadError.requestId}>The backend denied the category list. Your role does not receive fallback data.</NotAllowedState> : null}
        {categories.isError && isOffline(categories.error) ? <OfflineState title="Category list is offline" requestId={categoryReadError?.requestId} actionLabel="Retry category list" onAction={() => void categories.refetch()}>{categoryReadError?.message ?? 'The backend could not be reached.'}</OfflineState> : null}
        {categories.isError && !isOffline(categories.error) && categoryReadError?.status !== 403 ? <ErrorState title="Categories could not be loaded" requestId={categoryReadError?.requestId} actionLabel="Retry category list" onAction={() => void categories.refetch()}>{errorText(categories.error)}</ErrorState> : null}
        {categories.isError && categories.data ? <p className={styles.stale} role="status">Showing the last backend response; refresh failed. Do not use it as a current edit token.</p> : null}
        {!categories.isLoading && !categories.isError && !categoryRows.length ? <EmptyState title="No categories yet">Create a category after confirming its name and storefront effect.</EmptyState> : null}
        {categoryRows.length ? <CategoryList categories={categoryRows} canWrite={canWrite} /> : null}
        <p className={styles.helper}>Image selection is unavailable until the approved media library is connected. Existing image references are not changed here.</p>
        {categoryFormOpen ? <Card title="Create category" className={styles.formCard}>
          <p className={styles.helper}>Creation is audited by the backend. A blank ID lets the backend derive a slug; order is assigned by the server. Existing categories are edited, reordered and deleted from the list above.</p>
          <div className={styles.formGrid}>
            <Input label="Category name" value={categoryDraft.name} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })} maxLength={80} required />
            <Input label="Category ID (optional)" value={categoryDraft.id} onChange={(event) => setCategoryDraft({ ...categoryDraft, id: event.target.value })} maxLength={100} description="Lowercase slug. Leave blank for the backend to derive it from the name." />
            <Textarea label="Description" value={categoryDraft.description} onChange={(event) => setCategoryDraft({ ...categoryDraft, description: event.target.value })} maxLength={500} />
            <Input label="SEO title" value={categoryDraft.seoTitle} onChange={(event) => setCategoryDraft({ ...categoryDraft, seoTitle: event.target.value })} maxLength={120} />
            <Textarea label="SEO description" value={categoryDraft.seoDescription} onChange={(event) => setCategoryDraft({ ...categoryDraft, seoDescription: event.target.value })} maxLength={320} />
            <Switch label="Active" checked={categoryDraft.active} onChange={(active) => setCategoryDraft({ ...categoryDraft, active })} />
          </div>
          {categoryFieldError ? <p className={styles.errorText} role="alert">{categoryFieldError}</p> : null}
          {categoryError ? <div className={styles.errorPanel} role="alert"><p>{errorText(categoryError)}</p><RequestReference error={categoryError} /></div> : null}
          {categoryReconcile ? <p className={styles.warning} role="status">{categoryReconcile}</p> : null}
          <div className={styles.formActions}>
            <Button variant="secondary" onClick={() => { setCategoryFormOpen(false); setCategoryReview(null); }}>Cancel</Button>
            <Button onClick={buildCategoryReview} disabled={categoryCreateBlocked || !canWrite || categoryMutation.isPending} loading={categoryMutation.isPending}>Review category creation</Button>
          </div>
        </Card> : null}
      </> : <>
        <div className={styles.sectionHead}>
          <div><p className={styles.eyebrow}>CURATED STOREFRONT GROUPS</p><h2>Collections</h2><p>Manual product order and smart rules are shown as backend configuration—not as resolved storefront previews.</p></div>
          {canWrite ? <Button onClick={openCreateCollection}><Plus size={16} aria-hidden="true" />New collection</Button> : null}
        </div>
        {collections.isLoading ? <Card title="Loading collections"><Skeleton lines={4} /></Card> : null}
        {collections.isError && collectionReadError?.status === 403 ? <NotAllowedState title="Collections are not permitted" requestId={collectionReadError.requestId}>The backend denied the collection list. Your role does not receive fallback data.</NotAllowedState> : null}
        {collections.isError && isOffline(collections.error) ? <OfflineState title="Collection list is offline" requestId={collectionReadError?.requestId} actionLabel="Retry collection list" onAction={() => void collections.refetch()}>{collectionReadError?.message ?? 'The backend could not be reached.'}</OfflineState> : null}
        {collections.isError && !isOffline(collections.error) && collectionReadError?.status !== 403 ? <ErrorState title="Collections could not be loaded" requestId={collectionReadError?.requestId} actionLabel="Retry collection list" onAction={() => void collections.refetch()}>{errorText(collections.error)}</ErrorState> : null}
        {collections.isError && collections.data ? <p className={styles.stale} role="status">Showing the last backend response; refresh failed. Do not treat it as a current revision.</p> : null}
        {!collections.isLoading && !collections.isError && !collectionRows.length ? <EmptyState title="No collections yet">Create a manual or rule-based collection to organize products in the storefront.</EmptyState> : null}
        {collectionRows.length ? <ul className={styles.collectionList}>
          {collectionRows.map((collection) => <li key={collection.id}>
            <span className={styles.rowIcon} aria-hidden="true"><Layers3 size={18} /></span>
            <div className={styles.recordName}><h3>{collection.name}</h3><code>{collection.id} · revision {collection.rev}</code><p>{collection.description || 'No description supplied'}</p>
              {collection.kind === 'manual' ? <p className={styles.configuration}>Configured product IDs in order: {collection.productIds.length ? collection.productIds.join(' → ') : 'none'}</p> : <p className={styles.configuration}>Configured smart rule: {JSON.stringify(collection.rule)}</p>}
            </div>
            <div className={styles.recordMeta}><Badge tone={collection.visible ? 'positive' : 'neutral'}>{collection.visible ? 'Visible' : 'Hidden'}</Badge><Badge>{collection.kind === 'manual' ? 'Manual' : 'Smart rule'}</Badge><time dateTime={collection.updatedAt}>{formatIst(collection.updatedAt)}</time>{canWrite ? <Button variant="secondary" size="sm" onClick={() => void openEditCollection(collection.id)} aria-label={`Edit ${collection.name}`}>Edit</Button> : null}{canWrite ? <CollectionDelete collection={collection} onResult={(result) => { setCollectionDeleteResult(result); setCollectionMessage(result.kind === 'deleted' ? result.message : ''); }} /> : null}</div>
          </li>)}
        </ul> : null}
        {collectionDeleteResult && collectionDeleteResult.kind !== 'deleted' ? <div className={styles.errorPanel} role="alert"><p>{collectionDeleteResult.message}</p>
          {collectionDeleteResult.kind === 'blocked' && collectionDeleteResult.blockers.length ? <ul aria-label="References that block deleting this collection">{collectionDeleteResult.blockers.map((blocker) => <li key={`${blocker.type}:${blocker.id}`}>{blocker.type.replaceAll('_', ' ')} · {blocker.label}</li>)}</ul> : null}
        </div> : null}
        <p className={styles.helper}>Collections show their stored configuration, not a resolved storefront preview.</p>
        {collectionMode !== 'closed' ? <Card title={collectionMode === 'edit' ? `Edit ${collectionBase?.name ?? 'collection'}` : 'Create collection'} className={styles.formCard}>
        {collectionMode === 'edit' && !collectionBase ? collectionDetailLoading ? <Skeleton lines={4} /> : collectionDetailError ? <ErrorState title="Collection detail could not be loaded" {...(apiError(collectionDetailError)?.requestId ? { requestId: apiError(collectionDetailError)!.requestId } : {})} actionLabel="Retry collection detail" onAction={() => { if (editingId) void openEditCollection(editingId); }}>{errorText(collectionDetailError)}</ErrorState> : null : null}
          {collectionBase ? <p className={styles.versionLine}>Backend revision {collectionBase.rev} · last updated {formatIst(collectionBase.updatedAt)}. Kind is fixed as {collectionBase.kind}.</p> : null}
          {(collectionMode === 'create' || collectionBase) ? <>
            <div className={styles.formGrid}>
              <Input label="Collection name" value={collectionDraft.name} onChange={(event) => setCollectionDraft({ ...collectionDraft, name: event.target.value })} maxLength={120} required />
              <Input label="Collection ID (optional)" value={collectionDraft.id} onChange={(event) => setCollectionDraft({ ...collectionDraft, id: event.target.value })} maxLength={100} disabled={collectionMode === 'edit'} description={collectionMode === 'edit' ? 'Record IDs are immutable.' : 'Leave blank for the backend to derive a slug.'} />
              <Select label="Collection type" value={collectionDraft.kind} disabled={collectionMode === 'edit'} onChange={(event) => setCollectionDraft({ ...collectionDraft, kind: event.target.value as CollectionDraft['kind'] })}>
                <option value="manual">Manual product order</option><option value="smart">Smart rule</option>
              </Select>
              <Textarea label="Description" value={collectionDraft.description} onChange={(event) => setCollectionDraft({ ...collectionDraft, description: event.target.value })} maxLength={1000} />
              <Input label="SEO title" value={collectionDraft.seoTitle} onChange={(event) => setCollectionDraft({ ...collectionDraft, seoTitle: event.target.value })} maxLength={120} />
              <Textarea label="SEO description" value={collectionDraft.seoDescription} onChange={(event) => setCollectionDraft({ ...collectionDraft, seoDescription: event.target.value })} maxLength={320} />
              <Switch label="Visible in storefront" checked={collectionDraft.visible} onChange={(visible) => setCollectionDraft({ ...collectionDraft, visible })} />
            </div>
            {collectionDraft.kind === 'manual' ? <ProductPicker selected={collectionDraft.productIds} onChange={(productIds) => setCollectionDraft({ ...collectionDraft, productIds })} /> : <div className={styles.ruleEditor}>
              <p className={styles.helper}>This is the exact rule configuration sent to the backend. The dashboard does not locally resolve products.</p>
              <fieldset className={styles.categoryChoices}><legend>Categories in rule (up to 20)</legend>
                {categories.isError ? <p className={styles.warning}>Category choices could not be refreshed. {categories.data ? 'The visible choices are the last backend response.' : 'No category IDs are available to select.'} {categoryReadError?.requestId ? `Request ID: ${categoryReadError.requestId}` : ''}</p> : null}
                {currentCategories.length ? currentCategories.map((category) => <Checkbox key={category.id} label={`${category.name} (${category.id})`} checked={collectionDraft.categoryIds.includes(category.id)} onChange={(checked) => setCollectionDraft({ ...collectionDraft, categoryIds: checked ? [...collectionDraft.categoryIds, category.id] : collectionDraft.categoryIds.filter((id) => id !== category.id) })} disabled={!collectionDraft.categoryIds.includes(category.id) && collectionDraft.categoryIds.length >= 20} />) : <p className={styles.helper}>No category choices are loaded. Tag-only rules remain available.</p>}
              </fieldset>
              <Textarea label="Tags (one per line or comma-separated, up to 20)" value={collectionDraft.tagsText} onChange={(event) => setCollectionDraft({ ...collectionDraft, tagsText: event.target.value })} maxLength={900} />
              <div className={styles.formGrid}>
                <Select label="Sort products" value={collectionDraft.sort} onChange={(event) => setCollectionDraft({ ...collectionDraft, sort: event.target.value as CollectionDraft['sort'] })}>{collectionSorts.map((sort) => <option value={sort} key={sort}>{sort.replaceAll('_', ' ')}</option>)}</Select>
                <Input label="Result limit (1–48)" type="number" min={1} max={48} value={collectionDraft.limit} onChange={(event) => setCollectionDraft({ ...collectionDraft, limit: Number(event.target.value) })} />
                <Switch label="In-stock products only" checked={collectionDraft.inStockOnly} onChange={(inStockOnly) => setCollectionDraft({ ...collectionDraft, inStockOnly })} />
              </div>
            </div>}
          </> : null}
          {collectionFieldError ? <p className={styles.errorText} role="alert">{collectionFieldError}</p> : null}
          {collectionError ? <div className={styles.errorPanel} role="alert"><p>{errorText(collectionError)}</p><RequestReference error={collectionError} /></div> : null}
          {collectionReconcileMessage ? <p className={styles.warning} role="status">{collectionReconcileMessage}</p> : null}
          {collectionMode === 'create' && collectionCreateBlocked ? <p className={styles.warning} role="status">A collection create had an uncertain outcome. This form is locked against another POST to avoid creating a duplicate.</p> : null}
          <div className={styles.formActions}>
            <Button variant="secondary" onClick={closeCollectionForm}>Close</Button>
            {collectionUncertain ? <Button variant="secondary" onClick={() => void reconcileCollectionUpdate()}><RefreshCw size={15} aria-hidden="true" />Reconcile collection</Button> : null}
            <Button onClick={requestCollectionReview} disabled={!canWrite || collectionMutation.isPending || collectionCreateBlocked || collectionUncertain || (collectionMode === 'edit' && !collectionBase)} loading={collectionMutation.isPending}>{collectionMode === 'edit' ? 'Review collection changes' : 'Review collection creation'}</Button>
          </div>
        </Card> : null}
      </>}
    </section>

    <Dialog open={categoryReview !== null} onOpenChange={(open) => { if (!open) setCategoryReview(null); }} title="Review new category" footer={<><Button variant="secondary" onClick={() => setCategoryReview(null)}>Back to form</Button><Button loading={categoryMutation.isPending} disabled={!categoryReview || !canWrite || categoryCreateBlocked} onClick={() => { if (categoryReview) categoryMutation.mutate(categoryReview); }}>Create category</Button></>}>
      {categoryReview ? <>
        <p>This sends one audited POST. {categoryReview.active ? 'The new category will be active and may affect storefront grouping.' : 'The new category will be created inactive.'}</p>
        <dl className={styles.diff}>
          <div><dt>ID</dt><dd><span>Backend outcome</span><code>{categoryReview.id ?? 'Generated by the backend from the name'}</code></dd></div>
          {Object.entries(categoryReview).filter(([key]) => key !== 'id').map(([key, value]) => <div key={key}><dt>{key}</dt><dd><span>Submitted value</span><code>{reviewValue(value)}</code></dd></div>)}
        </dl>
      </> : null}
    </Dialog>

    <Dialog open={collectionReview !== null} onOpenChange={(open) => { if (!open) setCollectionReview(null); }} title="Review collection changes" footer={<><Button variant="secondary" onClick={() => setCollectionReview(null)}>Back to form</Button><Button loading={collectionMutation.isPending} disabled={!collectionReview || !canWrite || collectionCreateBlocked} onClick={() => { if (collectionReview) collectionMutation.mutate(collectionReview); }}>{collectionReview?.target === 'collection-update' ? 'Save reviewed collection' : 'Create collection'}</Button></>}>
      {collectionReview ? <>
        <p>{collectionReview.target === 'collection-update' ? `The backend will replace the full collection configuration using revision ${collectionReview.base.rev}.` : 'This creates one collection. A blank ID is generated by the backend; the dashboard does not invent its slug.'}</p>
        <p className={styles.warning}>If this collection is visible, saving can change its customer-facing placement or product order. A resolved storefront preview is unavailable, so verify the configuration below before confirming.</p>
        {collectionReview.target === 'collection-create' && !collectionReview.input.id ? <p className={styles.warning}>Collection ID will be generated by the backend from the name. Confirm the resulting ID in the authoritative response.</p> : null}
        {collectionReview.target === 'category' ? null : <ReviewChanges changes={collectionReview.changes} />}
      </> : null}
    </Dialog>

    <Dialog open={collectionConflict !== null} onOpenChange={(open) => { if (!open) setCollectionConflict(null); }} title="This collection changed while you were editing" footer={<><Button variant="secondary" onClick={() => setCollectionConflict(null)}>Keep editing draft</Button><Button disabled={!collectionConflict || collectionConflict.kind !== collectionDraft.kind} onClick={useLatestCollection}>Use latest revision and review my draft</Button></>}>
      {collectionConflict ? <>
        <p>{collectionUncertain ? 'The previous write outcome was uncertain. This is a fresh read only; no write was repeated.' : 'The backend rejected the stale revision before accepting this update.'} Current revision: {collectionConflict.rev}. Fields you did not change will adopt the latest server values; locally changed fields remain in the draft.</p>
        <dl className={styles.diff}>
          <div><dt>Latest name</dt><dd><span>Server</span><code>{collectionConflict.name}</code></dd><dd><span>Your draft</span><code>{collectionDraft.name}</code></dd></div>
          <div><dt>Latest description</dt><dd><span>Server</span><code>{collectionConflict.description || 'Not set'}</code></dd><dd><span>Your draft</span><code>{collectionDraft.description || 'Not set'}</code></dd></div>
          <div><dt>Kind</dt><dd><span>Server</span><code>{collectionConflict.kind}</code></dd><dd><span>Your draft</span><code>{collectionDraft.kind}</code></dd></div>
        </dl>
        {collectionConflict.kind !== collectionDraft.kind ? <p className={styles.warning}>Collection kind is immutable. Create a new collection of the desired kind; this draft cannot be merged into the current record.</p> : null}
      </> : <p>{collectionReconcileMessage}</p>}
      {collectionConflictError ? <p className={styles.errorText} role="alert">{errorText(collectionConflictError)} <RequestReference error={collectionConflictError} /></p> : null}
    </Dialog>
  </div>;
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, RefreshCw, Search } from 'lucide-react';

import { Badge, Button, Input, Select } from '@/components/ui/core';
import { Card, EmptyState, ErrorState, NotAllowedState, OfflineState, Skeleton } from '@/components/ui/feedback';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { getCategories, getProducts, type Product, type ProductFilters } from '@/lib/api/resources/catalog';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { formatMoney } from '@/lib/format/money';
import Link from 'next/link';

import styles from './products-queue.module.css';

type ProductStatus = 'active' | 'inactive' | 'archived';
type StockFilter = 'low' | 'out';
export type ProductInitialFilters = {
  q?: string;
  categoryId?: string;
  status?: ProductStatus;
  stock?: StockFilter;
};

const productStatuses: ProductStatus[] = ['active', 'inactive', 'archived'];
const stockFilters: StockFilter[] = ['low', 'out'];

function displayWord(value: string): string {
  return value.replaceAll('_', ' ');
}

function isOffline(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500 || error.code === 'UNAVAILABLE');
}

function apiError(error: unknown): ApiError | null {
  return error instanceof ApiError ? error : null;
}

function readUrlFilters(): ProductInitialFilters {
  const params = new URLSearchParams(window.location.search);
  const rawStatus = params.get('status') ?? '';
  const rawStock = params.get('stock') ?? '';
  const q = params.get('q')?.trim().slice(0, 100) ?? '';
  const categoryId = params.get('categoryId') ?? '';
  return {
    ...(q ? { q } : {}),
    ...(categoryId && /^[a-z0-9-]{1,100}$/u.test(categoryId) ? { categoryId } : {}),
    ...(productStatuses.includes(rawStatus as ProductStatus) ? { status: rawStatus as ProductStatus } : {}),
    ...(stockFilters.includes(rawStock as StockFilter) ? { stock: rawStock as StockFilter } : {}),
  };
}

function writeUrlFilters(filters: ProductInitialFilters): void {
  const url = new URL(window.location.href);
  if (filters.q) url.searchParams.set('q', filters.q);
  else url.searchParams.delete('q');
  if (filters.categoryId) url.searchParams.set('categoryId', filters.categoryId);
  else url.searchParams.delete('categoryId');
  if (filters.status) url.searchParams.set('status', filters.status);
  else url.searchParams.delete('status');
  if (filters.stock) url.searchParams.set('stock', filters.stock);
  else url.searchParams.delete('stock');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function ProductCard({ product }: { product: Product }): React.ReactNode {
  const state = product.archived ? 'Archived' : product.active ? 'Active' : 'Inactive';
  const tone = product.archived ? 'warning' : product.active ? 'positive' : 'neutral';

  return <li className={styles.product}>
    <div className={styles.productHead}>
      <div className={styles.productIdentity}>
        <span className={styles.productMark} aria-hidden="true"><Package size={19} strokeWidth={1.7} /></span>
        <div className={styles.productNameBlock}>
          <p className={styles.productId}>{product.id} · v{product.version}</p>
          <h2>{product.name}</h2>
          <p className={styles.subtitle}>{product.subtitle || 'No subtitle supplied'}</p>
        </div>
      </div>
      <Badge tone={tone}>{state}</Badge>
    </div>

    <div className={styles.productAction}>
      <Link className={styles.reviewLink} href={`/products/${encodeURIComponent(product.id)}`} aria-label={`Review product record for ${product.name}`}>
        Review product record <span aria-hidden="true">→</span>
      </Link>
    </div>

    <div className={styles.productMeta}>
      <span>{product.categoryName ?? product.categoryId}</span>
      <span>{product.variants.length} {product.variants.length === 1 ? 'variant' : 'variants'}</span>
    </div>

    <ul className={styles.variants} aria-label={`${product.name} variants`}>
      {product.variants.map((variant) => <li className={styles.variant} key={variant.id}>
        <div className={styles.variantIdentity}>
          <strong>{variant.title}</strong>
          <code>{variant.sku}</code>
        </div>
        <div className={styles.variantPrice}>
          <strong>{formatMoney(variant.pricePaise)}</strong>
          <span>GST included</span>
        </div>
        <div className={styles.variantStock}>
          <strong>{variant.onHand} on hand</strong>
          <span>{variant.reserved} reserved</span>
          <small>{variant.lowStockThreshold === null ? 'No low-stock threshold' : `Alert at ${variant.lowStockThreshold} units`}</small>
        </div>
        {!variant.active ? <Badge tone="neutral">Variant inactive</Badge> : null}
      </li>)}
    </ul>
  </li>;
}

export function ProductsQueue({ initialFilters, canWrite = false }: { initialFilters: ProductInitialFilters; canWrite?: boolean }): React.ReactNode {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(initialFilters.status ?? '');
  const [stock, setStock] = useState(initialFilters.stock ?? '');
  const [categoryId, setCategoryId] = useState(initialFilters.categoryId ?? '');
  const [searchDraft, setSearchDraft] = useState(initialFilters.q ?? '');
  const [search, setSearch] = useState(initialFilters.q ?? '');

  const filters = useMemo<ProductInitialFilters>(() => ({
    ...(status ? { status: status as ProductStatus } : {}),
    ...(stock ? { stock: stock as StockFilter } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(search ? { q: search } : {}),
  }), [categoryId, search, status, stock]);
  const queryFilters = useMemo<ProductFilters>(() => ({
    q: search || undefined,
    categoryId: categoryId || undefined,
    status: status ? status as ProductStatus : undefined,
    stock: stock ? stock as StockFilter : undefined,
    limit: 20,
  }), [categoryId, search, status, stock]);
  const products = useCursorList(queryKeys.catalog.products, queryFilters, getProducts);
  const categories = useQuery({
    queryKey: queryKeys.catalog.categories,
    queryFn: ({ signal }) => getCategories(signal),
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim().slice(0, 100)), 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => writeUrlFilters(filters), [filters]);

  useEffect(() => {
    const onPopState = () => {
      const next = readUrlFilters();
      setStatus(next.status ?? '');
      setStock(next.stock ?? '');
      setCategoryId(next.categoryId ?? '');
      setSearchDraft(next.q ?? '');
      setSearch(next.q ?? '');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const resetFilters = useCallback(() => {
    setStatus('');
    setStock('');
    setCategoryId('');
    setSearchDraft('');
    setSearch('');
  }, []);

  const currentError = apiError(products.error);
  const categoryError = apiError(categories.error);
  const hasFilters = Boolean(filters.status || filters.stock || filters.categoryId || filters.q || searchDraft);

  return <div className={styles.root}>
    <header className={styles.header}>
      <div>
        <p className="eyebrow">CATALOGUE · LIVE BACKEND</p>
        <h1>Products</h1>
        <p>Manage the products and variants customers can buy. Prices are the backend’s GST-inclusive integer-paise values; stock is shown as on hand and reserved.</p>
      </div>
      <div className={styles.headerActions}>
        {canWrite ? <Link className="ui-button ui-button--primary ui-button--md" href="/products/new"><Package size={16} aria-hidden="true" /> Create product</Link> : null}
        <Button variant="secondary" onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all })} disabled={products.isFetching || categories.isFetching}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh
        </Button>
      </div>
    </header>

    <Card className={styles.card!}>
      <div className={styles.filters} aria-label="Product filters">
        <div className={styles.search}>
          <Search size={17} aria-hidden="true" />
          <Input label="Search products" value={searchDraft} maxLength={100} placeholder="Name, product ID, SKU or barcode" onChange={(event) => setSearchDraft(event.target.value)} />
        </div>
        <Select label="Filter products by status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All product statuses</option>
          {productStatuses.map((value) => <option value={value} key={value}>{displayWord(value)}</option>)}
        </Select>
        <Select label="Filter products by stock" value={stock} onChange={(event) => setStock(event.target.value)}>
          <option value="">All stock states</option>
          {stockFilters.map((value) => <option value={value} key={value}>{value === 'low' ? 'Low stock' : 'Out of stock'}</option>)}
        </Select>
        <Select label="Filter products by category" value={categoryId} disabled={categories.isLoading || categories.isError} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">All categories</option>
          {(categories.data?.items ?? []).map((category) => <option value={category.id} key={category.id}>{category.name}{category.active ? '' : ' · inactive'}</option>)}
        </Select>
        <Button variant="quiet" onClick={resetFilters} disabled={!hasFilters}>Reset filters</Button>
      </div>

      {categories.isError ? <p className={styles.categoryError} role="status">
        Category filters are unavailable; search, status and stock filters still work. {categoryError?.requestId ? `Request ID: ${categoryError.requestId}` : categoryError?.message ?? 'The categories response could not be verified.'}
      </p> : null}

      {products.isLoading ? <div className={styles.loading}><Skeleton lines={5} /></div> : null}
      {!products.isLoading && products.error && !products.data ? (
        currentError?.status === 403 && currentError.code === 'FORBIDDEN'
          ? <NotAllowedState title="Catalogue access denied" {...(currentError.requestId ? { requestId: currentError.requestId } : {})}>The backend denied access to the product catalogue. Your role permissions remain enforced by the service.</NotAllowedState>
          : isOffline(products.error)
            ? <OfflineState title="Catalogue service unavailable" {...(currentError?.requestId ? { requestId: currentError.requestId } : {})} actionLabel="Try again" onAction={() => void products.refetch()}>{currentError?.message ?? 'Reconnect to the backend to load real products. No sample products are substituted.'}</OfflineState>
            : <ErrorState title="Products could not be loaded" {...(currentError?.requestId ? { requestId: currentError.requestId } : {})} actionLabel="Retry" onAction={() => void products.refetch()}>{currentError?.message ?? 'The response did not match the expected catalogue contract.'}</ErrorState>
      ) : null}

      {products.data ? <>
        {products.isFetching ? <p className={styles.freshness} role="status">Updating catalogue; the visible records may be stale.</p> : null}
        {products.error ? <p className={styles.stale} role="alert">Refresh failed. Showing the last successful result for these filters. {currentError?.requestId ? `Request ID: ${currentError.requestId}` : ''}</p> : null}
        {products.items.length ? <>
          <p className={styles.count}>{products.items.length} products loaded · server ordering retained.</p>
          <ul className={styles.products} aria-label="Products returned by the backend">
            {products.items.map((product) => <ProductCard key={product.id} product={product} />)}
          </ul>
          <div className={styles.pagination}>
            <span>{products.hasMore ? 'More results are available.' : 'End of available results.'}</span>
            <Button variant="secondary" loading={products.isFetchingNextPage} disabled={!products.hasMore} onClick={() => void products.fetchNextPage()}>Load more products</Button>
          </div>
        </> : <EmptyState title={hasFilters ? 'No matching products' : 'No products in the catalogue'} {...(hasFilters ? { actionLabel: 'Clear filters', onAction: resetFilters } : {})}>{hasFilters ? 'Try another search or filter. No sample products are substituted for a real empty result.' : 'The backend returned an empty catalogue. No sample products are substituted.'}</EmptyState>}
      </> : null}
    </Card>

    <Card title="Catalogue guardrails" className={styles.guardrails!}>
      <p>Price and inventory changes are reviewed and saved through their guarded backend workflows. This list is read-only; it does not edit price, stock or low-stock thresholds.</p>
      <p>Cost prices are restricted to the administrator workflow and are not shown in this catalogue view.</p>
      <small>Product edits affect future storefront reads. Historical order item snapshots do not change.</small>
    </Card>
  </div>;
}

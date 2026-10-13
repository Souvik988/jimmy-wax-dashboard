// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductsQueue } from '@/features/catalog/products-queue';
import { ApiError } from '@/lib/api/errors';
import type { Product } from '@/lib/api/resources/catalog';

const resources = vi.hoisted(() => ({ getProducts: vi.fn(), getCategories: vi.fn() }));
vi.mock('@/lib/api/resources/catalog', () => ({
  getProducts: resources.getProducts,
  getCategories: resources.getCategories,
}));

const product: Product = {
  id: 'leather-cleaner', name: 'Leather Cleaner', subtitle: 'Gentle care', description: 'A careful leather cleaner.',
  categoryId: 'cleaners', categoryName: 'Cleaners', keyBenefits: ['Lifts everyday dirt'], suitableSurfaces: null,
  boxContents: 'One bottle', tags: ['leather'], seoTitle: null, seoDescription: null, active: true, archived: false,
  sortOrder: 1, version: 2, image: null, updatedAt: '2026-10-07T10:00:00.000Z',
  variants: [{
    id: 'cleaner-250', sku: 'JWX-CLN-250', title: '250 ml', pricePaise: 49900,
    compareAtPricePaise: 59900, active: true, weightGrams: 300, lengthMm: 80, widthMm: 80,
    heightMm: 160, hsnCode: '34051000', barcode: null, onHand: 12, reserved: 2,
    lowStockThreshold: 4, costPricePaise: 12500,
  }],
};

function renderQueue(
  initialFilters: { q?: string; categoryId?: string; status?: 'active' | 'inactive' | 'archived'; stock?: 'low' | 'out' },
  data: Product[] = [product],
  pages?: Array<{ items: Product[]; nextCursor: string | null }>,
  canWrite = false,
) {
  if (pages) {
    resources.getProducts.mockReset();
    pages.forEach((page) => resources.getProducts.mockResolvedValueOnce(page));
  } else resources.getProducts.mockResolvedValue({ items: data, nextCursor: null });
  resources.getCategories.mockResolvedValue({ items: [{
    id: 'cleaners', name: 'Cleaners', description: '', imageMediaId: null, seoTitle: null,
    seoDescription: null, active: true, sortOrder: 1, productCount: 1,
  }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ProductsQueue initialFilters={initialFilters} canWrite={canWrite} /></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); window.history.replaceState({}, '', '/'); });

describe('ProductsQueue', () => {
  it('renders only backend product and stock facts, with GST-inclusive paise and no restricted cost field', async () => {
    renderQueue({});

    expect(await screen.findByRole('heading', { name: 'Leather Cleaner' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review product record for Leather Cleaner' })).toHaveAttribute('href', '/products/leather-cleaner');
    expect(screen.getByText('₹499')).toBeInTheDocument();
    expect(screen.getByText(/GST included/i)).toBeInTheDocument();
    expect(screen.getByText(/12 on hand/)).toBeInTheDocument();
    expect(screen.getByText(/2 reserved/)).toBeInTheDocument();
    expect(screen.queryByText('₹125')).not.toBeInTheDocument();
    expect(screen.getByText(/JWX-CLN-250/)).toBeInTheDocument();
  });

  it('shows product creation only to an operator whose server-derived permissions include catalog:write', async () => {
    renderQueue({}, [product], undefined, true);
    expect(await screen.findByRole('link', { name: 'Create product' })).toHaveAttribute('href', '/products/new');
  });

  it('does not show product creation to catalog readers without write permission', async () => {
    renderQueue({});
    await screen.findByRole('heading', { name: 'Leather Cleaner' });
    expect(screen.queryByRole('link', { name: 'Create product' })).not.toBeInTheDocument();
  });

  it('sends status and category filters to the backend and never sorts a partial page locally', async () => {
    renderQueue({});
    await screen.findByRole('heading', { name: 'Leather Cleaner' });

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter products by status' }), { target: { value: 'archived' } });
    await waitFor(() => expect(resources.getProducts).toHaveBeenLastCalledWith(
      { status: 'archived', categoryId: undefined, stock: undefined, q: undefined, limit: 20 },
      null,
      expect.any(AbortSignal),
    ));

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter products by category' }), { target: { value: 'cleaners' } });
    await waitFor(() => expect(resources.getProducts).toHaveBeenLastCalledWith(
      { status: 'archived', categoryId: 'cleaners', stock: undefined, q: undefined, limit: 20 },
      null,
      expect.any(AbortSignal),
    ));
    expect(screen.queryByRole('button', { name: /sort/i })).not.toBeInTheDocument();
  });

  it('debounces search, sends the query to the backend, and keeps applied filters in the URL', async () => {
    renderQueue({});
    await screen.findByRole('heading', { name: 'Leather Cleaner' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search products' }), { target: { value: ' leather cleaner ' } });

    await waitFor(() => expect(resources.getProducts).toHaveBeenLastCalledWith(
      { q: 'leather cleaner', categoryId: undefined, status: undefined, stock: undefined, limit: 20 },
      null,
      expect.any(AbortSignal),
    ));
    expect(window.location.search).toContain('q=leather+cleaner');
  });

  it('loads the next backend cursor exactly once and appends only the returned products', async () => {
    const nextProduct = { ...product, id: 'leather-conditioner', name: 'Leather Conditioner' };
    renderQueue({}, [product], [
      { items: [product], nextCursor: 'opaque-page-two' },
      { items: [nextProduct], nextCursor: null },
    ]);
    await screen.findByRole('heading', { name: 'Leather Cleaner' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more products' }));

    expect(await screen.findByRole('heading', { name: 'Leather Conditioner' })).toBeInTheDocument();
    expect(resources.getProducts).toHaveBeenLastCalledWith(
      { q: undefined, categoryId: undefined, status: undefined, stock: undefined, limit: 20 },
      'opaque-page-two',
      expect.any(AbortSignal),
    );
  });

  it('shows the real empty result and a clear-filter action without inventing product rows', async () => {
    renderQueue({ q: 'nonexistent' }, []);

    expect(await screen.findByRole('heading', { name: 'No matching products' })).toBeInTheDocument();
    expect(screen.getByText(/No sample products are substituted/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('shows an offline state with the backend request id and no cached fixture fallback', async () => {
    resources.getProducts.mockRejectedValueOnce(new ApiError(503, 'UNAVAILABLE', 'Backend is not ready.', 'req-cat-7', false));
    resources.getCategories.mockResolvedValue({ items: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ProductsQueue initialFilters={{}} /></QueryClientProvider>);

    expect(await screen.findByRole('heading', { name: 'Catalogue service unavailable' })).toBeInTheDocument();
    expect(screen.getByText(/req-cat-7/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Leather Cleaner' })).not.toBeInTheDocument();
  });

  it('renders a distinct permission-denied state when the backend denies catalogue access', async () => {
    resources.getProducts.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Permission denied.', 'req-cat-denied', false));
    resources.getCategories.mockResolvedValue({ items: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ProductsQueue initialFilters={{}} /></QueryClientProvider>);

    const deniedState = await screen.findByRole('heading', { name: 'Catalogue access denied' });
    expect(deniedState.parentElement?.parentElement).toHaveClass('ui-state--warning');
    expect(screen.getByText(/req-cat-denied/)).toBeInTheDocument();
  });
});

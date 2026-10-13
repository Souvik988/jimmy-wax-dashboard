// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogTaxonomy } from '@/features/catalog/catalog-taxonomy';
import { ApiError } from '@/lib/api/errors';
import type { Category, Collection, Product, ProductPage } from '@/lib/api/resources/catalog';

const resources = vi.hoisted(() => ({
  getCategories: vi.fn(), getCollections: vi.fn(), getCollection: vi.fn(), getProducts: vi.fn(),
  createCategory: vi.fn(), createCollection: vi.fn(), updateCollection: vi.fn(),
}));

vi.mock('@/lib/api/resources/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/resources/catalog')>();
  return { ...actual, ...resources };
});

const category: Category = {
  id: 'cleaners', name: 'Cleaners', description: '', imageMediaId: null, seoTitle: null,
  seoDescription: null, active: true, sortOrder: 1, productCount: 2, archivedProductCount: 0, rev: 3, updatedAt: '2026-10-07T10:00:00.000Z',
};
const collection: Collection = {
  id: 'staff-picks', name: 'Staff picks', description: '', kind: 'manual', productIds: [], rule: null,
  visible: true, seoTitle: null, seoDescription: null, rev: 3, updatedAt: '2026-10-07T10:00:00.000Z',
};
const products: ProductPage = { items: [], nextCursor: null };
const product = (id: string, name: string): Product => ({
  id, name, subtitle: '', description: '', categoryId: 'cleaners', keyBenefits: [], suitableSurfaces: null,
  boxContents: null, tags: [], seoTitle: null, seoDescription: null, active: true, archived: false,
  sortOrder: 1, version: 1, image: null, variants: [], updatedAt: '2026-10-07T10:00:00.000Z',
});

function renderTaxonomy(canWrite = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <CatalogTaxonomy canWrite={canWrite} />
  </QueryClientProvider>);
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
  resources.getCategories.mockResolvedValue({ items: [category] });
  resources.getCollections.mockResolvedValue({ items: [collection] });
  resources.getCollection.mockResolvedValue(collection);
  resources.getProducts.mockResolvedValue(products);
  resources.createCategory.mockResolvedValue({ ...category, id: 'leather-care', name: 'Leather care' });
  resources.createCollection.mockResolvedValue({ ...collection, id: 'seasonal-picks', name: 'Seasonal picks', rev: 1 });
  resources.updateCollection.mockResolvedValue({ ...collection, name: 'Staff favourites', rev: 4 });
});

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('catalogue categories and collections', () => {
  it('offers revision-guarded category edit, ordering and delete to writers, never resolved previews', async () => {
    renderTaxonomy();
    expect(await screen.findByRole('heading', { name: 'Categories' })).toBeInTheDocument();
    expect(screen.getByText(/checked against the revision you loaded/i)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Edit Cleaners' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Cleaners' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /preview resolved products/i })).not.toBeInTheDocument();
    expect(resources.getCategories).toHaveBeenCalledTimes(1);
  });

  it('requires exact category creation review before anything is sent', async () => {
    renderTaxonomy();
    fireEvent.click(await screen.findByRole('button', { name: 'New category' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Category name' }), { target: { value: 'Leather care' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review category creation' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review new category' });
    expect(within(dialog).getByText('Leather care')).toBeInTheDocument();
    expect(resources.createCategory).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create category' }));
    await waitFor(() => expect(resources.createCategory).toHaveBeenCalledWith({
      name: 'Leather care', description: '', seoTitle: null, seoDescription: null, active: true,
    }));
    expect(await screen.findByText(/category created/i)).toBeInTheDocument();
  });

  it('creates only backend-backed manual collection configuration and never calls an undocumented preview', async () => {
    renderTaxonomy();
    fireEvent.click(await screen.findByRole('tab', { name: 'Collections' }));
    expect(await screen.findByRole('heading', { name: 'Collections' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New collection' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Collection name' }), { target: { value: 'Seasonal picks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review collection creation' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review collection changes' });
    expect(within(dialog).getAllByText(/generated by the backend/i).length).toBeGreaterThan(0);
    expect(resources.createCollection).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create collection' }));
    await waitFor(() => expect(resources.createCollection).toHaveBeenCalledWith({
      name: 'Seasonal picks', description: '', kind: 'manual', visible: true, seoTitle: null, seoDescription: null, productIds: [],
    }));
    expect(resources.getCollection).not.toHaveBeenCalled();
    expect(resources.getCollections).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /preview resolved products/i })).not.toBeInTheDocument();
  });

  it('refetches a stale collection, preserves the draft, and requires a second review using the new revision', async () => {
    const latest = { ...collection, description: 'Another operator change', rev: 4 };
    resources.getCollection.mockResolvedValueOnce(collection).mockResolvedValueOnce(latest);
    resources.updateCollection
      .mockRejectedValueOnce(new ApiError(409, 'CART_VERSION_CONFLICT', 'Collection changed', 'collection-conflict-22'))
      .mockResolvedValueOnce({ ...latest, name: 'Staff favourites', rev: 5 });
    renderTaxonomy();
    fireEvent.click(await screen.findByRole('tab', { name: 'Collections' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Staff picks' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Collection name' }), { target: { value: 'Staff favourites' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review collection changes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save reviewed collection' }));

    const conflict = await screen.findByRole('dialog', { name: 'This collection changed while you were editing' });
    expect(within(conflict).getByText('Another operator change')).toBeInTheDocument();
    expect(within(conflict).getByText('Staff favourites')).toBeInTheDocument();
    expect(within(conflict).getByText(/collection-conflict-22/)).toBeInTheDocument();
    expect(resources.updateCollection).toHaveBeenCalledTimes(1);
    fireEvent.click(within(conflict).getByRole('button', { name: 'Use latest revision and review my draft' }));
    expect(screen.getByRole('textbox', { name: 'Collection name' })).toHaveValue('Staff favourites');
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Another operator change');
    fireEvent.click(screen.getByRole('button', { name: 'Review collection changes' }));
    const secondReview = await screen.findByRole('dialog', { name: 'Review collection changes' });
    expect(within(secondReview).getByText(/revision 4/)).toBeInTheDocument();
    expect(resources.updateCollection).toHaveBeenCalledTimes(1);
    fireEvent.click(within(secondReview).getByRole('button', { name: 'Save reviewed collection' }));
    await waitFor(() => expect(resources.updateCollection).toHaveBeenLastCalledWith('staff-picks', expect.objectContaining({
      name: 'Staff favourites', description: 'Another operator change', expectedRev: 4,
    })));
  });

  it('keeps read-only roles from reaching any create/edit workflow', async () => {
    renderTaxonomy(false);
    await screen.findByRole('heading', { name: 'Categories' });
    expect(screen.queryByRole('button', { name: 'New category' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Collections' }));
    await screen.findByRole('heading', { name: 'Collections' });
    expect(screen.queryByRole('button', { name: 'New collection' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument();
  });

  it('uses only backend product results and preserves the operator-selected manual order', async () => {
    resources.getProducts.mockResolvedValue({ items: [product('cleaner-250', 'Leather Cleaner'), product('conditioner-250', 'Leather Conditioner')], nextCursor: null });
    renderTaxonomy();
    fireEvent.click(await screen.findByRole('tab', { name: 'Collections' }));
    fireEvent.click(await screen.findByRole('button', { name: 'New collection' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Collection name' }), { target: { value: 'Owner picks' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: /Leather Cleaner/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Leather Conditioner/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Move conditioner-250 up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review collection creation' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create collection' }));
    await waitFor(() => expect(resources.createCollection).toHaveBeenCalledWith(expect.objectContaining({
      productIds: ['conditioner-250', 'cleaner-250'],
    })));
  });

  it('reports an unavailable category read with its request ID instead of substituting examples', async () => {
    resources.getCategories.mockRejectedValue(new ApiError(503, 'UNAVAILABLE', 'Category service unavailable', 'categories-offline-9'));
    renderTaxonomy();
    await waitFor(() => expect(resources.getCategories).toHaveBeenCalledTimes(3), { timeout: 5_000 });
    expect(await screen.findByRole('heading', { name: 'Category list is offline' }, { timeout: 5_000 })).toBeInTheDocument();
    expect(screen.getByText(/categories-offline-9/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cleaners' })).not.toBeInTheDocument();
  });

  it('supports arrow-key navigation between the two taxonomy tabs', async () => {
    renderTaxonomy(false);
    const categoriesTab = await screen.findByRole('tab', { name: 'Categories' });
    fireEvent.keyDown(categoriesTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Collections' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Collections' })).toHaveFocus();
  });
});

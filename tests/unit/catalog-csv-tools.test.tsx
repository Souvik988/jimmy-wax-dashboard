// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogCsvTools } from '@/features/catalog/catalog-csv-tools';

const resources = vi.hoisted(() => ({ downloadCatalogCsv: vi.fn(), dryRunCatalogImport: vi.fn(), commitCatalogImport: vi.fn(), downloadBlob: vi.fn() }));
vi.mock('@/lib/api/resources/catalog', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/api/resources/catalog')>(), ...resources }));
vi.mock('@/lib/api/client', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/api/client')>(), downloadBlob: resources.downloadBlob }));

const report = {
  dryRun: true, rows: 2, products: { create: 1, update: 0 }, variants: { create: 1, update: 0 },
  errors: [{ row: 3, field: 'price_paise', message: 'Expected a non-negative integer' }], applied: false, changes: [], previewHash: null,
};

function renderTools(canWrite = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const result = render(<QueryClientProvider client={queryClient}><CatalogCsvTools canWrite={canWrite} /></QueryClientProvider>);
  fireEvent.click(screen.getByText('Catalogue CSV tools'));
  return result;
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
  resources.downloadCatalogCsv.mockResolvedValue({ blob: new Blob(['product_id,name\n']), filename: 'jimmywax-catalogue.csv', requestId: 'csv-export-2' });
  resources.dryRunCatalogImport.mockResolvedValue({ report, status: 422, requestId: 'catalog-csv-31' });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('catalogue CSV tools', () => {
  it('downloads only after an explicit action and uses the backend file and safe filename', async () => {
    renderTools();
    expect(resources.downloadCatalogCsv).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Export complete catalogue CSV' }));
    await waitFor(() => expect(resources.downloadCatalogCsv).toHaveBeenCalledTimes(1));
    expect(resources.downloadBlob).toHaveBeenCalledWith(expect.objectContaining({ filename: 'jimmywax-catalogue.csv' }));
    expect(await screen.findByText(/download started/i)).toBeInTheDocument();
  });

  it('keeps import disabled for read-only catalogue roles while leaving permitted export available', async () => {
    renderTools(false);
    expect(await screen.findByRole('button', { name: 'Export complete catalogue CSV' })).toBeEnabled();
    expect(screen.queryByLabelText('Choose catalogue CSV')).not.toBeInTheDocument();
    expect(screen.getByText(/dry-run import requires catalog:write/i)).toBeInTheDocument();
  });

  it('sends a bounded UTF-8 file for dry-run only and renders the 422 row report without a commit action', async () => {
    renderTools();
    const file = new File(['product_id,name\ncleaner,Leather Cleaner\n'], 'catalogue.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText('Choose catalogue CSV'), { target: { files: [file] } });
    expect(screen.getByText('catalogue.csv')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run dry-run, apply nothing' }));

    await waitFor(() => expect(resources.dryRunCatalogImport).toHaveBeenCalledWith('product_id,name\ncleaner,Leather Cleaner\n'));
    const results = await screen.findByRole('region', { name: 'Dry-run report' });
    expect(within(results).getByText('catalog-csv-31')).toBeInTheDocument();
    expect(within(results).getByText('Expected a non-negative integer')).toBeInTheDocument();
    expect(within(results).getByText(/nothing was applied/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /commit|apply import/i })).not.toBeInTheDocument();
  });

  it('rejects a file over 2 MB before reading or contacting the backend', async () => {
    renderTools();
    const file = new File([new Uint8Array(2_000_001)], 'too-large.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText('Choose catalogue CSV'), { target: { files: [file] } });
    expect(await screen.findByText(/no larger than 2 mb/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run dry-run, apply nothing' })).toBeDisabled();
    expect(resources.dryRunCatalogImport).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8 locally without sending replacement-decoded text', async () => {
    renderTools();
    const file = new File([new Uint8Array([0xff, 0xfe, 0x00])], 'bad.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText('Choose catalogue CSV'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Run dry-run, apply nothing' }));
    expect(await screen.findByText(/valid UTF-8 CSV/i)).toBeInTheDocument();
    expect(resources.dryRunCatalogImport).not.toHaveBeenCalled();
  });

  it('applies only the exact previewed file, with a reason, and shows the price change first', async () => {
    const hash = 'b'.repeat(64);
    const clean = { dryRun: true, rows: 1, products: { create: 0, update: 1 }, variants: { create: 0, update: 1 }, errors: [], applied: false, previewHash: hash,
      changes: [{ kind: 'variant', id: 'cleaner-250', action: 'update', fields: ['pricePaise'], priceChange: { fromPaise: 49900, toPaise: 52900 } }, { kind: 'product', id: 'cleaner', action: 'unchanged', fields: [] }] };
    resources.dryRunCatalogImport.mockResolvedValue({ report: clean, status: 200, requestId: 'preview-1' });
    resources.commitCatalogImport.mockResolvedValue({ report: { ...clean, dryRun: false, applied: true }, status: 200, requestId: 'commit-1' });
    renderTools();
    const text = 'product_id,name\ncleaner,Leather Cleaner\n';
    fireEvent.change(await screen.findByLabelText('Choose catalogue CSV'), { target: { files: [new File([text], 'catalogue.csv', { type: 'text/csv' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Run dry-run, apply nothing' }));
    const changes = await screen.findByRole('list', { name: 'Changes in this import' });
    expect(within(changes).getByText(/cleaner-250/)).toBeInTheDocument();
    expect(within(changes).getByText(/₹499\.00 → ₹529\.00/)).toBeInTheDocument();
    expect(within(changes).queryByText(/Product · cleaner · unchanged/)).not.toBeInTheDocument();
    expect(resources.commitCatalogImport).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /Apply this exact import/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply this import' });
    expect(within(dialog).getByRole('button', { name: 'Apply import' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Reason for this import'), { target: { value: 'Quarterly price review' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply import' }));
    await waitFor(() => expect(resources.commitCatalogImport).toHaveBeenCalledWith(text, { previewHash: hash, reason: 'Quarterly price review' }));
    expect(await screen.findByText(/import applied: 0 product\(s\) created, 1 updated/i)).toBeInTheDocument();
  });
});

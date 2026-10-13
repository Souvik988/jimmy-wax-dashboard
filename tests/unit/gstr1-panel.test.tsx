// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Gstr1Panel, currentIstMonth } from '@/features/insights/gstr1-panel';
import type { Gstr1Report } from '@/lib/api/resources/admin-ops';

const resources = vi.hoisted(() => ({ getGstr1: vi.fn(), downloadGstr1Csv: vi.fn(), downloadBlob: vi.fn() }));
vi.mock('@/lib/api/resources/admin-ops', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/resources/admin-ops')>()), getGstr1: resources.getGstr1, downloadGstr1Csv: resources.downloadGstr1Csv }));
vi.mock('@/lib/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/client')>()), downloadBlob: resources.downloadBlob }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const report: Gstr1Report = {
  month: '2026-10', merchantStateCode: null, orders: 2,
  warnings: ['Working paper for your accountant, not a filing.', 'Merchant GSTIN is not set (or invalid) in store settings, so every sale is shown as inter-state (IGST).'],
  b2cs: [{ placeOfSupply: '27-Maharashtra', rateBps: 1800, taxablePaise: 100000, igstPaise: 18000, cgstPaise: 0, sgstPaise: 0, orders: 2 }],
  hsn: [{ hsn: 'NOT SET', description: 'Leather polish', uqc: 'PCS', quantity: 3, totalValuePaise: 118000, taxablePaise: 100000, igstPaise: 18000, cgstPaise: 0, sgstPaise: 0, rateBps: 1800 }],
  totals: { taxablePaise: 100000, igstPaise: 18000, cgstPaise: 0, sgstPaise: 0 },
};

const renderPanel = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Gstr1Panel /></QueryClientProvider>);

describe('GSTR-1 panel', () => {
  it('uses the India month and shows the warnings before the tables', async () => {
    resources.getGstr1.mockResolvedValue(report);
    renderPanel();
    expect(await screen.findByText(/Working paper for your accountant/)).toBeInTheDocument();
    expect(screen.getByText(/GSTIN is not set/)).toBeInTheDocument();
    expect(resources.getGstr1).toHaveBeenCalledWith(currentIstMonth(), expect.anything());
    expect(screen.getByRole('region', { name: 'Table 7, B2C small supplies' })).toHaveTextContent('27-Maharashtra');
    expect(screen.getByRole('region', { name: 'Table 12, HSN summary' })).toHaveTextContent('NOT SET');
    expect(screen.getByText(/2 orders in 2026-10/)).toBeInTheDocument();
  });

  it('downloads each table as CSV for the chosen month, one at a time', async () => {
    const user = userEvent.setup();
    resources.getGstr1.mockResolvedValue(report);
    resources.downloadGstr1Csv.mockResolvedValue({ blob: new Blob(['x']), filename: 'jimmywax-gstr1-hsn-2026-10.csv' });
    renderPanel();
    await screen.findByText(/Working paper for your accountant/);
    await user.click(screen.getByRole('button', { name: /Download table 12 CSV/ }));
    await waitFor(() => expect(resources.downloadGstr1Csv).toHaveBeenCalledWith(currentIstMonth(), 'hsn'));
    expect(resources.downloadBlob).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Downloaded jimmywax-gstr1-hsn/)).toBeInTheDocument();
  });

  it('shows an empty-month message instead of blank tables', async () => {
    resources.getGstr1.mockResolvedValue({ ...report, orders: 0, b2cs: [], hsn: [], totals: { taxablePaise: 0, igstPaise: 0, cgstPaise: 0, sgstPaise: 0 } });
    renderPanel();
    expect(await screen.findByText(/No taxable sales in this month/)).toBeInTheDocument();
    expect(screen.getByText(/No goods lines in this month/)).toBeInTheDocument();
  });

  it('computes the month in IST, not UTC', () => {
    expect(currentIstMonth(new Date('2026-10-31T19:00:00Z'))).toBe('2026-11'); // 00:30 IST on 1 Nov
    expect(currentIstMonth(new Date('2026-10-31T17:00:00Z'))).toBe('2026-10');
  });
});

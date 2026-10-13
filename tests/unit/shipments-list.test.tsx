// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import { ShipmentsList } from '@/features/shipping/shipments-list';

const resources = vi.hoisted(() => ({ getShipments: vi.fn() }));
vi.mock('@/lib/api/resources/shipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/resources/shipping')>();
  return { ...actual, getShipments: resources.getShipments };
});

const record = {
  id: '5396faa7-139e-4054-8c4e-ac6c73525118', orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', orderNumber: 'JW-20261007-5396FAA7',
  provider: 'manual', courier: 'Blue Dart', awb: 'BD12345', trackingUrl: null, status: 'in_transit', rawStatus: null,
  codAmountPaise: 36400, chargesPaise: null, weightGrams: null, etd: null, pickupScheduledAt: null,
  lastEventAt: '2026-10-07T00:00:00.000Z', ndrCount: 0, rtoState: null, hasLabel: false,
  createdAt: '2026-10-06T20:00:00.000Z',
};

function renderList(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ShipmentsList /></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('shipments list', () => {
  it('renders real shipment identifiers, tracking state and server COD value', async () => {
    resources.getShipments.mockResolvedValue({ items: [record], nextCursor: null });
    renderList();

    expect(await screen.findByRole('heading', { name: 'Shipment register' })).toBeInTheDocument();
    expect(await screen.findByText(/Manual courier entry/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /JW-20261007-5396FAA7/i })).toHaveAttribute('href', `/shipping/shipments/${record.id}`);
    expect(screen.getByText(/BD12345/)).toBeInTheDocument();
    expect(screen.getByText('In Transit')).toBeInTheDocument();
    expect(screen.getByText('₹364')).toBeInTheDocument();
  });

  it('shows the backend request reference instead of replacing an unavailable list with sample rows', async () => {
    resources.getShipments.mockRejectedValue(new ApiError(503, 'UNAVAILABLE', 'The shipping service is unavailable.', 'ship-list-42', false));
    renderList();

    expect(await screen.findByRole('heading', { name: 'Shipments are unavailable' })).toBeInTheDocument();
    expect(screen.getByText(/ship-list-42/i)).toBeInTheDocument();
    expect(screen.queryByText('BD12345')).not.toBeInTheDocument();
  });

  it('describes an unfiltered empty register as having no recorded shipments yet', async () => {
    resources.getShipments.mockResolvedValue({ items: [], nextCursor: null });
    renderList();

    expect(await screen.findByRole('heading', { name: 'No shipments recorded yet' })).toBeInTheDocument();
    expect(screen.getByText(/empty shipment register/i)).toBeInTheDocument();
  });

  it('sends search terms to the backend and never filters only the currently loaded page', async () => {
    const user = userEvent.setup();
    resources.getShipments.mockResolvedValue({ items: [record], nextCursor: null });
    renderList();

    await user.type(await screen.findByRole('textbox', { name: 'Search order or tracking' }), 'BD12345');
    await vi.waitFor(() => expect(resources.getShipments).toHaveBeenLastCalledWith(null, expect.any(AbortSignal), expect.objectContaining({ q: 'BD12345' })));
    expect(await screen.findByText(/BD12345/)).toBeInTheDocument();
  });
});

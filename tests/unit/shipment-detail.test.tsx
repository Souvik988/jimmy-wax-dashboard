// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import { ShipmentDetail } from '@/features/shipping/shipment-detail';

const resources = vi.hoisted(() => ({ getShipment: vi.fn(), addManualShipmentEvent: vi.fn() }));
vi.mock('@/lib/api/resources/shipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/resources/shipping')>();
  return { ...actual, getShipment: resources.getShipment, addManualShipmentEvent: resources.addManualShipmentEvent };
});

const shipment = {
  id: '5396faa7-139e-4054-8c4e-ac6c73525118', orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', orderNumber: 'JW-20261007-5396FAA7',
  provider: 'manual', courier: 'Blue Dart', awb: 'BD12345', trackingUrl: 'https://track.example/BD12345', status: 'in_transit', rawStatus: null,
  codAmountPaise: 36400, chargesPaise: null, weightGrams: null, etd: null, pickupScheduledAt: null,
  lastEventAt: '2026-10-07T00:00:00.000Z', ndrCount: 0, rtoState: null, hasLabel: false,
  createdAt: '2026-10-06T20:00:00.000Z',
  events: [
    { status: 'label_created', description: 'Handed to courier', occurredAt: '2026-10-06T20:00:00.000Z', source: 'manual' },
    { status: 'in_transit', description: 'Pickup scan', occurredAt: '2026-10-07T00:00:00.000Z', source: 'manual' },
  ],
};

const deliveredDetail = {
  ...shipment,
  status: 'out_for_delivery',
  events: [...shipment.events, { status: 'out_for_delivery', description: 'Parcel scanned at local hub', occurredAt: '2026-10-07T01:00:00.000Z', source: 'manual' }],
};

function renderDetail(canFulfilOrders: boolean): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ShipmentDetail shipmentId={shipment.id} canFulfilOrders={canFulfilOrders} /></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('shipment detail', () => {
  it('renders the backend timeline and leaves event changes unavailable to read-only roles', async () => {
    resources.getShipment.mockResolvedValue(shipment);
    renderDetail(false);

    expect(await screen.findByRole('heading', { name: 'Shipment tracking' })).toBeInTheDocument();
    expect(screen.getByText('BD12345')).toBeInTheDocument();
    expect(screen.getByText('Pickup scan')).toBeInTheDocument();
    expect(screen.getByText('Handed to courier')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open courier tracking' })).toHaveAttribute('href', 'https://track.example/BD12345');
    expect(screen.queryByRole('combobox', { name: 'Tracking status event' })).not.toBeInTheDocument();
  });

  it('records a confirmed next event and refreshes the server timeline', async () => {
    const user = userEvent.setup();
    resources.getShipment.mockResolvedValueOnce(shipment).mockResolvedValue(deliveredDetail);
    resources.addManualShipmentEvent.mockResolvedValue(undefined);
    renderDetail(true);

    expect(await screen.findByRole('heading', { name: 'Shipment tracking' })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tracking status event' }), 'out_for_delivery');
    await user.type(screen.getByRole('textbox', { name: 'Event note · optional' }), 'Parcel scanned at local hub');
    await user.click(screen.getByRole('checkbox', { name: /I confirm this tracking update is accurate/i }));
    await user.click(screen.getByRole('button', { name: 'Record tracking event' }));

    expect(resources.addManualShipmentEvent).toHaveBeenCalledWith(shipment.id, { status: 'out_for_delivery', description: 'Parcel scanned at local hub' });
    expect(await screen.findByText(/backend confirmed this tracking update/i)).toBeInTheDocument();
    expect(await screen.findByText('Parcel scanned at local hub')).toBeInTheDocument();
  });

  it('reconciles an ambiguous event response before offering any retry', async () => {
    const user = userEvent.setup();
    resources.getShipment.mockResolvedValue(shipment);
    resources.addManualShipmentEvent.mockRejectedValueOnce(new ApiError(0, 'UNAVAILABLE', 'The backend could not be reached.', undefined, true));
    renderDetail(true);

    await screen.findByRole('heading', { name: 'Shipment tracking' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tracking status event' }), 'out_for_delivery');
    await user.type(screen.getByRole('textbox', { name: 'Event note · optional' }), 'Parcel scanned at local hub');
    await user.click(screen.getByRole('checkbox', { name: /I confirm this tracking update is accurate/i }));
    await user.click(screen.getByRole('button', { name: 'Record tracking event' }));
    expect(await screen.findByText(/event outcome is unknown/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry event/i })).not.toBeInTheDocument();

    resources.getShipment.mockResolvedValueOnce(deliveredDetail).mockResolvedValueOnce(deliveredDetail);
    await user.click(screen.getByRole('button', { name: 'Check shipment timeline' }));

    expect(await screen.findByText(/tracking update was found in the shipment timeline/i, {}, { timeout: 4_000 })).toBeInTheDocument();
    expect(resources.getShipment).toHaveBeenCalledTimes(3);
    expect(resources.addManualShipmentEvent).toHaveBeenCalledTimes(1);
  });
});

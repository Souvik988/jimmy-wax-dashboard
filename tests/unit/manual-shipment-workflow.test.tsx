// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import { ManualShipmentWorkflow } from '@/features/shipping/manual-shipment-workflow';

const resources = vi.hoisted(() => ({ createManualShipment: vi.fn(), getOrderShipments: vi.fn() }));

vi.mock('@/lib/api/resources/shipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/resources/shipping')>();
  return { ...actual, createManualShipment: resources.createManualShipment, getOrderShipments: resources.getOrderShipments };
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('manual shipment workflow', () => {
  it('requires two authoritative reads and explicit review before retrying an ambiguous create', async () => {
    const user = userEvent.setup();
    resources.createManualShipment.mockRejectedValueOnce(new ApiError(0, 'UNAVAILABLE', 'The backend could not be reached.', undefined, true));
    resources.getOrderShipments.mockResolvedValue({ items: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ManualShipmentWorkflow order={{ id: '5396faa7-139e-4054-8c4e-ac6c73525118', orderNumber: 'JW-20261007-TEST' }} onClose={vi.fn()} /></QueryClientProvider>);

    await user.type(screen.getByRole('textbox', { name: 'Courier' }), 'Blue Dart');
    await user.type(screen.getByRole('textbox', { name: 'Tracking number' }), 'BD12345');
    await user.click(screen.getByRole('button', { name: 'Record shipment' }));
    expect(await screen.findByText(/outcome is unknown/i)).toBeInTheDocument();
    expect(resources.createManualShipment).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /retry recording/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Check order shipments' }));
    expect(await screen.findByText(/no matching shipment appeared in two checks/i, {}, { timeout: 4_000 })).toBeInTheDocument();
    expect(resources.getOrderShipments).toHaveBeenCalledTimes(2);
    const retry = screen.getByRole('button', { name: 'Retry recording shipment' });
    expect(retry).toBeDisabled();
    await user.click(screen.getByLabelText(/I reviewed the latest backend records/i));
    expect(retry).toBeEnabled();
    expect(resources.createManualShipment).toHaveBeenCalledTimes(1);
  });

  it('reconciles an already-accepted shipment instead of offering a duplicate retry', async () => {
    const user = userEvent.setup();
    resources.createManualShipment.mockRejectedValueOnce(new ApiError(0, 'UNAVAILABLE', 'The backend could not be reached.', undefined, true));
    resources.getOrderShipments.mockResolvedValue({ items: [{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', courier: 'Blue Dart', trackingNumber: 'BD12345',
      trackingUrl: null, status: 'label_created', events: [{ status: 'label_created', description: 'Handed to courier', occurredAt: '2026-10-07T00:00:00.000Z' }],
    }] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ManualShipmentWorkflow order={{ id: '5396faa7-139e-4054-8c4e-ac6c73525118', orderNumber: 'JW-20261007-TEST' }} onClose={vi.fn()} /></QueryClientProvider>);

    await user.type(screen.getByRole('textbox', { name: 'Courier' }), 'Blue Dart');
    await user.type(screen.getByRole('textbox', { name: 'Tracking number' }), 'BD12345');
    await user.click(screen.getByRole('button', { name: 'Record shipment' }));
    await user.click(await screen.findByRole('button', { name: 'Check order shipments' }));

    expect(await screen.findByRole('heading', { name: 'Shipment already recorded' })).toBeInTheDocument();
    expect(resources.getOrderShipments).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /retry recording/i })).not.toBeInTheDocument();
  });
});

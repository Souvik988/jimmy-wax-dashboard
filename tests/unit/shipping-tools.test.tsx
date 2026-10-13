// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShippingTools } from '@/features/shipping/shipping-tools';
import type { ShippingProvider, ShippingSettings } from '@/lib/api/resources/shipping';

const resources = vi.hoisted(() => ({
  getShippingSettings: vi.fn(),
  getShippingPins: vi.fn(),
  getShippingPickupLocations: vi.fn(),
  checkShippingServiceability: vi.fn(),
}));

vi.mock('@/lib/api/resources/shipping', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api/resources/shipping')>(),
  getShippingSettings: resources.getShippingSettings,
  getShippingPins: resources.getShippingPins,
  getShippingPickupLocations: resources.getShippingPickupLocations,
  checkShippingServiceability: resources.checkShippingServiceability,
}));

const settings: ShippingSettings = {
  pickupLocation: null,
  pickupPin: null,
  defaultWeightGrams: 300,
  defaultLengthMm: 200,
  defaultWidthMm: 150,
  defaultHeightMm: 100,
  courierRule: 'balanced',
  preferredCouriers: [],
  autoShip: false,
  bulkConfirmThreshold: 20,
  requireProviderCheck: true,
  stuckAfterHours: 48,
};
const manualProvider: ShippingProvider = {
  provider: 'manual', configured: false, reachable: null, walletBalancePaise: null, pickupLocations: [], settings,
  overview: { activeShipments: 0, exceptions: 0, stuck: 0, webhook: { pendingEvents: 0, eventsWithErrors: 0, lastReceivedAt: null }, stalledRequests: 0 },
};
const connectedProvider: ShippingProvider = {
  ...manualProvider,
  provider: 'shiprocket', configured: true, reachable: true,
  pickupLocations: ['Main warehouse'],
};

function renderTools(provider: ShippingProvider, canWriteShippingSettings = false, canWriteDeliveryAreas = false): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><ShippingTools provider={provider} canWriteShippingSettings={canWriteShippingSettings} canWriteDeliveryAreas={canWriteDeliveryAreas} /></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('shipping delivery tools', () => {
  it('uses the manual allow-list tester and keeps configuration views read-only', async () => {
    const user = userEvent.setup();
    resources.getShippingSettings.mockResolvedValue(settings);
    resources.getShippingPins.mockResolvedValue({ items: [{ prefix: '743', note: 'Kolkata area' }] });
    resources.checkShippingServiceability.mockResolvedValue({ pin: '743287', allowListed: true, allowListConfigured: true, provider: null });
    renderTools(manualProvider, true, true);

    expect(await screen.findByText('Kolkata area')).toBeInTheDocument();
    expect(screen.getByText(/manual mode checks the backend allow-list only/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Provider pickup locations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save shipping settings|update delivery areas/i })).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Delivery PIN code' }), '743287');
    await user.type(screen.getByRole('spinbutton', { name: 'Parcel weight (grams)' }), '600');
    await user.click(screen.getByRole('radio', { name: 'COD collection' }));
    await user.type(screen.getByRole('textbox', { name: 'Declared item value' }), '364');
    await user.click(screen.getByRole('button', { name: 'Check delivery area' }));
    expect(resources.checkShippingServiceability.mock.calls[0]?.[0]).toEqual({ pin: '743287', weightGrams: 600, cod: true, declaredValuePaise: 36400 });
    expect(await screen.findByText(/accepted by allow-list/i)).toBeInTheDocument();
    expect(screen.getByText(/no provider result was returned/i)).toBeInTheDocument();
    expect(resources.getShippingPickupLocations).not.toHaveBeenCalled();
  });

  it('reveals provider pickup capabilities only when the backend says configured', async () => {
    resources.getShippingSettings.mockResolvedValue(settings);
    resources.getShippingPins.mockResolvedValue({ items: [] });
    resources.getShippingPickupLocations.mockResolvedValue({ items: ['Main warehouse'] });
    renderTools(connectedProvider);

    expect(await screen.findByRole('heading', { name: 'shiprocket pickup locations' })).toBeInTheDocument();
    expect(await screen.findByText('Main warehouse')).toBeInTheDocument();
    expect(screen.getAllByText(/mock-tested only; not verified against live Shiprocket/i)).toHaveLength(2);
  });
});

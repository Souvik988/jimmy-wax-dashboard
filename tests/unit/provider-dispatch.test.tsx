// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { providerCapabilities, walletShortfallPaise } from '@/features/shipping/provider-capabilities';
import { ProviderDispatch, ProviderReadinessCard } from '@/features/shipping/provider-dispatch';
import { ApiError } from '@/lib/api/errors';
import type { ShippingProvider } from '@/lib/api/resources/shipping';

const resources = vi.hoisted(() => ({ planProviderShipment: vi.fn(), shipViaProvider: vi.fn() }));
vi.mock('@/lib/api/resources/shipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/resources/shipping')>();
  return { ...actual, planProviderShipment: resources.planProviderShipment, shipViaProvider: resources.shipViaProvider };
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const settings = {
  pickupLocation: 'Primary', pickupPin: '400001', defaultWeightGrams: 300, defaultLengthMm: 100, defaultWidthMm: 100, defaultHeightMm: 100,
  courierRule: 'balanced' as const, preferredCouriers: [], autoShip: false, bulkConfirmThreshold: 20, requireProviderCheck: true, stuckAfterHours: 72,
};
const overview = { activeShipments: 0, exceptions: 0, stuck: 0, webhook: { pendingEvents: 0, eventsWithErrors: 0, lastReceivedAt: null }, stalledRequests: 0 };
const provider = (patch: Partial<ShippingProvider>): ShippingProvider => ({ provider: 'shiprocket', configured: true, reachable: true, walletBalancePaise: 100000, pickupLocations: ['Primary'], settings, overview, ...patch });

describe('provider capabilities', () => {
  it('stays in manual mode with nothing connected, and manual entry is always allowed', () => {
    const caps = providerCapabilities(provider({ provider: 'manual', configured: false, reachable: null }));
    expect(caps).toMatchObject({ mode: 'manual', canDispatch: false, canEnterManually: true });
    expect(providerCapabilities(null).canDispatch).toBe(false);
  });

  it('turns dispatch on only for a reachable provider with a pickup location and PIN', () => {
    expect(providerCapabilities(provider({})).canDispatch).toBe(true);
    const unreachable = providerCapabilities(provider({ reachable: false }));
    expect(unreachable).toMatchObject({ mode: 'provider-unreachable', canDispatch: false });
    expect(unreachable.blockers[0]).toMatch(/did not answer/);
    const noPickup = providerCapabilities(provider({ settings: { ...settings, pickupLocation: null, pickupPin: null } }));
    expect(noPickup.canDispatch).toBe(false);
    expect(noPickup.blockers).toHaveLength(2);
  });

  it('marks the local fake provider as simulated and reports wallet shortfall', () => {
    expect(providerCapabilities(provider({ provider: 'fake' })).isSimulated).toBe(true);
    expect(providerCapabilities(provider({})).isSimulated).toBe(false);
    expect(walletShortfallPaise(5000, { freightPaise: 6000, codChargesPaise: 1500 })).toBe(2500);
    expect(walletShortfallPaise(9000, { freightPaise: 6000, codChargesPaise: 1500 })).toBe(0);
    expect(walletShortfallPaise(null, { freightPaise: 1, codChargesPaise: 0 })).toBeNull();
  });
});

const plan = {
  order: { id: '5396faa7-139e-4054-8c4e-ac6c73525118', orderNumber: 'JW-1', paymentMethod: 'cod', totalPaise: 49900, codAmountPaise: 49900, pincode: '400001' },
  package: { weightGrams: 300, lengthMm: 100, widthMm: 100, heightMm: 100 }, volumetricGrams: 200, serviceable: true,
  options: [
    { courierId: 'a', name: 'Blue Dart', freightPaise: 6000, codChargesPaise: 1500, etdDays: 2, etd: null, rating: 4.5 },
    { courierId: 'b', name: 'Delhivery', freightPaise: 5000, codChargesPaise: 1500, etdDays: 4, etd: null, rating: null },
  ],
  recommended: 'b', rule: 'balanced' as const, walletBalancePaise: 100000, warnings: ['Payment has not been received for this order'],
};
const order = { id: plan.order.id, orderNumber: 'JW-1' };
const renderDispatch = (provider0: ShippingProvider, onDone = vi.fn()) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><ProviderDispatch order={order} capabilities={providerCapabilities(provider0)} onDone={onDone} /></QueryClientProvider>);
};

describe('provider dispatch', () => {
  it('shows why dispatch is off instead of provider buttons when not ready', () => {
    renderDispatch(provider({ provider: 'manual', configured: false, reachable: null }));
    expect(screen.getByText(/Provider dispatch is off/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Check couriers/ })).not.toBeInTheDocument();
  });

  it('plans first (no booking), preselects the recommended courier, then ships that courier', async () => {
    const user = userEvent.setup();
    resources.planProviderShipment.mockResolvedValue(plan);
    resources.shipViaProvider.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', courier: 'Delhivery', awb: 'AWB123' });
    renderDispatch(provider({}));
    await user.click(screen.getByRole('button', { name: 'Check couriers and cost' }));
    expect(await screen.findByText(/Payment has not been received/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Delhivery/ })).toBeChecked();
    expect(resources.shipViaProvider).not.toHaveBeenCalled();

    await user.click(screen.getByRole('radio', { name: /Blue Dart/ }));
    await user.click(screen.getByRole('button', { name: 'Create shipment with Blue Dart' }));
    expect(resources.shipViaProvider).toHaveBeenCalledWith(order.id, { courierId: 'a' });
    expect(await screen.findByText(/AWB123/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open label/ })).toHaveAttribute('href', '/api/backend/admin/shipments/11111111-1111-4111-8111-111111111111/label');
  });

  it('blocks shipping when the destination is not serviceable or the wallet is short', async () => {
    const user = userEvent.setup();
    resources.planProviderShipment.mockResolvedValue({ ...plan, serviceable: false });
    renderDispatch(provider({}));
    await user.click(screen.getByRole('button', { name: 'Check couriers and cost' }));
    expect(await screen.findByText('Not serviceable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create shipment/ })).toBeDisabled();
    cleanup();

    resources.planProviderShipment.mockResolvedValue({ ...plan, walletBalancePaise: 1000 });
    renderDispatch(provider({}));
    await user.click(screen.getByRole('button', { name: 'Check couriers and cost' }));
    expect(await screen.findByText(/wallet is short by/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create shipment/ })).toBeDisabled();
  });

  it('after an uncertain failure offers a safe resume, never a duplicate-looking retry', async () => {
    const user = userEvent.setup();
    resources.planProviderShipment.mockResolvedValue(plan);
    resources.shipViaProvider.mockRejectedValueOnce(new ApiError(0, 'UNAVAILABLE', 'The backend could not be reached.', undefined, true));
    renderDispatch(provider({}));
    await user.click(screen.getByRole('button', { name: 'Check couriers and cost' }));
    await user.click(await screen.findByRole('button', { name: /Create shipment/ }));
    expect(await screen.findByText(/cannot create a duplicate/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume shipment' })).toBeEnabled();
  });

  it('labels the simulated provider so nobody mistakes it for a real courier', async () => {
    renderDispatch(provider({ provider: 'fake' }));
    expect(screen.getByText(/nothing is booked with a real courier/)).toBeInTheDocument();
  });
});

describe('provider readiness card', () => {
  it('lists the connection steps in manual mode and hides once a provider works', () => {
    render(<ProviderReadinessCard capabilities={providerCapabilities(provider({ provider: 'manual', configured: false, reachable: null }))} />);
    expect(screen.getByText(/Ready to connect Shiprocket/)).toBeInTheDocument();
    expect(screen.getByText(/SHIPROCKET_WEBHOOK_TOKEN/)).toBeInTheDocument();
    cleanup();
    const { container } = render(<ProviderReadinessCard capabilities={providerCapabilities(provider({}))} />);
    expect(container).toBeEmptyDOMElement();
  });
});

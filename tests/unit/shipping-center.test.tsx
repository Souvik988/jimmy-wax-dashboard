// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ShippingCenterView } from '@/features/shipping/shipping-center';
import type { ShippingProvider, ShippingReadyItem } from '@/lib/api/resources/shipping';

const readyItem: ShippingReadyItem = {
  id: '5396faa7-139e-4054-8c4e-ac6c73525118', orderNumber: 'JW-20261007-5396FAA7',
  customerName: 'Local fixture', city: 'Kolkata', pincode: '743287', lines: 2,
  paymentMethod: 'cod', codAmountPaise: 36400, totalPaise: 36400,
  package: { weightGrams: 600, lengthMm: 200, widthMm: 150, heightMm: 200 },
  volumetricGrams: 1200, serviceable: null, ageHours: 3, warnings: ['No pickup location is configured'],
};

const manualProvider: ShippingProvider = {
  provider: 'manual', configured: false, reachable: null, walletBalancePaise: null, pickupLocations: [],
  settings: {
    pickupLocation: null, pickupPin: null, defaultWeightGrams: 300, defaultLengthMm: 200,
    defaultWidthMm: 150, defaultHeightMm: 100, courierRule: 'balanced', preferredCouriers: [],
    autoShip: false, bulkConfirmThreshold: 20, requireProviderCheck: true, stuckAfterHours: 48,
  },
  overview: {
    activeShipments: 2, exceptions: 1, stuck: 0,
    webhook: { pendingEvents: 0, eventsWithErrors: 0, lastReceivedAt: null }, stalledRequests: 0,
  },
};

describe('shipping centre view', () => {
  afterEach(cleanup);

  it('makes manual shipping the primary capability without exposing provider controls', () => {
    render(<ShippingCenterView provider={manualProvider} readyItems={[readyItem]} />);

    expect(screen.getByText(/manual courier entry/i)).toBeInTheDocument();
    expect(screen.getByText('JW-20261007-5396FAA7')).toBeInTheDocument();
    expect(screen.getByText('₹364')).toBeInTheDocument();
    expect(screen.getByText('3 h')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /plan shipment|create manifest|provider ship/i })).not.toBeInTheDocument();
    expect(screen.getByText(/No pickup location is configured/i)).toBeInTheDocument();
  });

  it('does not infer manual mode when provider status is unavailable', () => {
    render(<ShippingCenterView provider={null} readyItems={[]} providerError={{ message: 'The provider status could not be confirmed.', requestId: 'ship-123' }} />);

    expect(screen.getByRole('heading', { name: 'Provider status could not be confirmed' })).toBeInTheDocument();
    expect(screen.getByText(/Request ID: ship-123/i)).toBeInTheDocument();
    expect(screen.queryByText(/manual courier entry/i)).not.toBeInTheDocument();
  });

  it('links operators to the complete shipment register', () => {
    render(<ShippingCenterView provider={manualProvider} readyItems={[]} />);

    expect(screen.getByRole('link', { name: 'Shipment register' })).toHaveAttribute('href', '/shipping/shipments');
    expect(screen.getByRole('link', { name: 'Returns & refunds' })).toHaveAttribute('href', '/shipping/returns');
  });
});

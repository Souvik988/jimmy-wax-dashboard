import { describe, expect, it } from 'vitest';

import { manualShipmentInputSchema, orderShipmentsSchema, pickupLocationsSchema, pinPrefixListSchema, refundPageSchema, returnDecisionInputSchema, returnPageSchema, serviceabilityInputSchema, serviceabilityResultSchema, shipmentDetailSchema, shipmentEventInputSchema, shipmentPageSchema, shippingProviderSchema, shippingReadyPageSchema } from '@/lib/api/resources/shipping';

describe('shipping read runtime contracts', () => {
  it('parses the manual provider status without inventing provider capability', () => {
    const result = shippingProviderSchema.parse({
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
    });

    expect(result.configured).toBe(false);
    expect(result.reachable).toBeNull();
    expect(result.overview.activeShipments).toBe(2);
  });

  it('parses the observed ready queue using integer paise and server-computed package data', () => {
    const page = shippingReadyPageSchema.parse({
      items: [{
        id: '5396faa7-139e-4054-8c4e-ac6c73525118', orderNumber: 'JW-20261007-5396FAA7',
        customerName: 'Local fixture', city: 'Kolkata', pincode: '743287', lines: 2,
        paymentMethod: 'cod', codAmountPaise: 36400, totalPaise: 36400,
        package: { weightGrams: 600, lengthMm: 200, widthMm: 150, heightMm: 200 },
        volumetricGrams: 1200, serviceable: null, ageHours: 3, warnings: ['No pickup location is configured'],
      }],
      nextCursor: 'opaque-cursor',
    });

    expect(page.items[0]?.codAmountPaise).toBe(36400);
    expect(page.items[0]?.package.weightGrams).toBe(600);
    expect(page.nextCursor).toBe('opaque-cursor');
  });

  it('rejects malformed money, package dimensions and pagination envelopes', () => {
    const validItem = {
      id: '5396faa7-139e-4054-8c4e-ac6c73525118', orderNumber: 'JW-20261007-5396FAA7',
      customerName: 'Local fixture', city: 'Kolkata', pincode: '743287', lines: 1,
      paymentMethod: 'cod', codAmountPaise: 36400, totalPaise: 36400,
      package: { weightGrams: 300, lengthMm: 200, widthMm: 150, heightMm: 100 },
      volumetricGrams: 600, serviceable: null, ageHours: 3, warnings: [],
    };

    expect(shippingReadyPageSchema.safeParse({ items: [{ ...validItem, totalPaise: 36400.5 }], nextCursor: null }).success).toBe(false);
    expect(shippingReadyPageSchema.safeParse({ items: [{ ...validItem, package: { ...validItem.package, weightGrams: 0 } }], nextCursor: null }).success).toBe(false);
    expect(shippingReadyPageSchema.safeParse({ items: [validItem] }).success).toBe(false);
  });
});

describe('manual shipment contracts', () => {
  it('normalizes optional tracking URLs and accepts only safe HTTPS links', () => {
    expect(manualShipmentInputSchema.parse({ courier: '  Blue Dart ', trackingNumber: '  BD12345 ', trackingUrl: '' })).toEqual({
      courier: 'Blue Dart', trackingNumber: 'BD12345', trackingUrl: undefined,
    });
    expect(manualShipmentInputSchema.parse({ courier: 'Blue Dart', trackingNumber: 'BD12345', trackingUrl: 'https://track.example/BD12345' }).trackingUrl).toBe('https://track.example/BD12345');
    expect(manualShipmentInputSchema.safeParse({ courier: 'Blue Dart', trackingNumber: 'BD12345', trackingUrl: 'http://track.example/BD12345' }).success).toBe(false);
    expect(manualShipmentInputSchema.safeParse({ courier: 'Blue Dart', trackingNumber: 'BD12345', trackingUrl: 'https://user:pass@track.example/BD12345' }).success).toBe(false);
  });

  it('accepts only the backend manual shipment confirmation and event timeline shape', () => {
    const shipment = orderShipmentsSchema.parse({ items: [{
      id: '5396faa7-139e-4054-8c4e-ac6c73525118', courier: 'Blue Dart', trackingNumber: 'BD12345',
      trackingUrl: null, status: 'label_created',
      events: [{ status: 'label_created', description: 'Handed to courier', occurredAt: '2026-10-07T00:00:00.000Z' }],
    }] });
    expect(shipment.items[0]?.events[0]?.status).toBe('label_created');
    expect(orderShipmentsSchema.safeParse({ items: [{ ...shipment.items[0], events: [{ status: 'delivered' }] }] }).success).toBe(false);
  });
});

describe('shipment list and detail contracts', () => {
  const shipment = {
    id: '5396faa7-139e-4054-8c4e-ac6c73525118', orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', orderNumber: 'JW-20261007-5396FAA7',
    provider: 'manual', courier: 'Blue Dart', awb: 'BD12345', trackingUrl: null, status: 'in_transit', rawStatus: null,
    codAmountPaise: 36400, chargesPaise: null, weightGrams: null, etd: null, pickupScheduledAt: null,
    lastEventAt: '2026-10-07T00:00:00.000Z', ndrCount: 0, rtoState: null, hasLabel: false,
    createdAt: '2026-10-06T20:00:00.000Z',
  };

  it('parses the backend shipment list DTO without dropping tracking, COD or exception metadata', () => {
    const page = shipmentPageSchema.parse({ items: [shipment], nextCursor: 'opaque-cursor' });

    expect(page.items[0]).toMatchObject({ orderNumber: 'JW-20261007-5396FAA7', awb: 'BD12345', codAmountPaise: 36400, hasLabel: false });
    expect(page.nextCursor).toBe('opaque-cursor');
    expect(shipmentPageSchema.safeParse({ items: [{ ...shipment, codAmountPaise: 36400.5 }], nextCursor: null }).success).toBe(false);
  });

  it('parses the shipment detail event source and rejects an incomplete event timeline', () => {
    const detail = shipmentDetailSchema.parse({ ...shipment, events: [{ status: 'in_transit', description: 'Handed to courier', occurredAt: '2026-10-07T00:00:00.000Z', source: 'manual' }] });

    expect(detail.events[0]).toEqual({ status: 'in_transit', description: 'Handed to courier', occurredAt: '2026-10-07T00:00:00.000Z', source: 'manual' });
    expect(shipmentDetailSchema.safeParse({ ...shipment, events: [{ status: 'in_transit' }] }).success).toBe(false);
  });

  it('accepts only a known event and an optional bounded customer-visible description', () => {
    expect(shipmentEventInputSchema.parse({ status: 'in_transit', description: '  Bag handed to courier  ' })).toEqual({ status: 'in_transit', description: 'Bag handed to courier' });
    expect(shipmentEventInputSchema.safeParse({ status: 'cancelled' }).success).toBe(false);
    expect(shipmentEventInputSchema.safeParse({ status: 'delivered', description: 'x'.repeat(301) }).success).toBe(false);
  });
});

describe('return and refund runtime contracts', () => {
  const returned = {
    id: '5396faa7-139e-4054-8c4e-ac6c73525118', orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    orderNumber: 'JW-20261007-5396FAA7', status: 'requested', reason: 'Product arrived damaged',
    items: [{ sku: 'JW-TS-100', name: 'Leather polish', quantity: 1 }], createdAt: '2026-10-07T00:00:00.000Z',
  };

  it('parses the capped return envelope and rejects malformed quantities or statuses', () => {
    const page = returnPageSchema.parse({ items: [returned] });
    expect(page.items[0]).toMatchObject({ status: 'requested', orderNumber: 'JW-20261007-5396FAA7', items: [{ quantity: 1 }] });
    expect(returnPageSchema.safeParse({ items: [{ ...returned, status: 'restocked' }] }).success).toBe(false);
    expect(returnPageSchema.safeParse({ items: [{ ...returned, items: [{ sku: 'x', name: 'x', quantity: 0 }] }] }).success).toBe(false);
    expect(returnPageSchema.safeParse({}).success).toBe(false);
  });

  it('parses refund amounts as safe integer paise whether PostgreSQL returns a number or string', () => {
    const base = { id: returned.id, orderId: returned.orderId, status: 'pending', reason: 'customer_return', createdAt: returned.createdAt };
    expect(refundPageSchema.parse({ items: [{ ...base, amountPaise: 12500 }] }).items[0]?.amountPaise).toBe(12500);
    expect(refundPageSchema.parse({ items: [{ ...base, amountPaise: '12500' }] }).items[0]?.amountPaise).toBe(12500);
    expect(refundPageSchema.safeParse({ items: [{ ...base, amountPaise: '12.50' }] }).success).toBe(false);
    expect(refundPageSchema.safeParse({ items: [{ ...base, amountPaise: Number.MAX_SAFE_INTEGER + 1 }] }).success).toBe(false);
  });

  it('normalizes a backend-valid return decision note and rejects short or oversized notes', () => {
    expect(returnDecisionInputSchema.parse({ approve: true, note: '  Return verified  ' })).toEqual({ approve: true, note: 'Return verified' });
    expect(returnDecisionInputSchema.safeParse({ approve: false, note: 'no' }).success).toBe(false);
    expect(returnDecisionInputSchema.safeParse({ approve: false, note: 'x'.repeat(301) }).success).toBe(false);
  });
});

describe('delivery tools runtime contracts', () => {
  it('parses backend allow-list rows and serviceability results without inventing a carrier response', () => {
    expect(pinPrefixListSchema.parse({ items: [{ prefix: '743', note: 'Kolkata area' }] }).items[0]).toEqual({ prefix: '743', note: 'Kolkata area' });
    expect(pinPrefixListSchema.safeParse({ items: [{ prefix: '74', note: null }] }).success).toBe(false);
    expect(serviceabilityResultSchema.parse({ pin: '743287', allowListed: true, allowListConfigured: true, provider: null })).toMatchObject({ allowListed: true, provider: null });
    expect(pickupLocationsSchema.parse({ items: ['Main warehouse'] }).items).toEqual(['Main warehouse']);
  });

  it('validates the exact serviceability request bounds and parses provider paise as integers', () => {
    expect(serviceabilityInputSchema.parse({ pin: '743287', weightGrams: 600, cod: true, declaredValuePaise: 36400 })).toEqual({ pin: '743287', weightGrams: 600, cod: true, declaredValuePaise: 36400 });
    expect(serviceabilityInputSchema.safeParse({ pin: '74328', weightGrams: 600, cod: false, declaredValuePaise: 50000 }).success).toBe(false);
    expect(serviceabilityInputSchema.safeParse({ pin: '743287', weightGrams: 50001, cod: false, declaredValuePaise: 50000 }).success).toBe(false);
    expect(serviceabilityResultSchema.safeParse({ pin: '743287', allowListed: true, allowListConfigured: true, provider: { serviceable: true, couriers: [{ courierId: '1', name: 'Courier', freightPaise: 1234.5, codChargesPaise: 0, etdDays: null, etd: null, rating: null }] } }).success).toBe(false);
  });
});

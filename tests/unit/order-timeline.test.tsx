// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OrderTimeline } from '@/features/orders/order-timeline';
import { adminOrderDetailSchema, type AdminOrderDetail } from '@/lib/api/resources/orders';

afterEach(cleanup);

const base = {
  id: '22222222-2222-4222-8222-222222222222', orderNumber: 'JW-20261013-TEST', status: 'shipped', paymentStatus: 'paid', paymentMethod: 'online', version: 5,
  subtotalPaise: 29900, discountPaise: 0, taxPaise: 4561, shippingPaise: 0, codFeePaise: 0, taxInclusive: true, totalPaise: 29900, currency: 'INR' as const,
  address: { name: 'Buyer', city: 'Pune', state: 'MH', pin: '411001' }, createdAt: '2026-10-13T04:00:00.000Z',
  lines: [], paymentAttempts: [], refunds: [],
};

describe('adminOrderDetailSchema history fields', () => {
  it('accepts an older backend that sends none of them', () => {
    const parsed = adminOrderDetailSchema.parse(base);
    expect(parsed.statusHistory).toBeUndefined();
  });

  it('parses status history, shipments, returns and email delivery state', () => {
    const parsed = adminOrderDetailSchema.parse({
      ...base,
      statusHistory: [{ from: null, to: 'placed', at: '2026-10-13T04:00:00.000Z' }, { from: 'placed', to: 'shipped', at: '2026-10-13T06:00:00.000Z' }],
      shipments: [{ id: '33333333-3333-4333-8333-333333333333', courier: 'Delhivery', trackingNumber: 'DL123', trackingUrl: null, status: 'in_transit', events: [{ status: 'in_transit', description: 'Left hub', occurredAt: '2026-10-13T07:00:00.000Z' }] }],
      returns: [], messages: [{ template: 'order.confirmed', status: 'suppressed', createdAt: '2026-10-13T04:01:00.000Z' }],
    });
    expect(parsed.statusHistory).toHaveLength(2);
    expect(adminOrderDetailSchema.safeParse({ ...base, messages: [{ template: 'x', status: 'delivered', createdAt: '2026-10-13T04:01:00.000Z' }] }).success).toBe(false);
  });
});

describe('OrderTimeline', () => {
  it('renders nothing for an order with no recorded history', () => {
    const { container } = render(<OrderTimeline order={adminOrderDetailSchema.parse(base) as AdminOrderDetail} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows each status change with where it came from, shipment tracking and why an email was not sent', () => {
    const order = adminOrderDetailSchema.parse({
      ...base,
      statusHistory: [{ from: null, to: 'placed', at: '2026-10-13T04:00:00.000Z' }, { from: 'placed', to: 'out_for_delivery', at: '2026-10-13T06:00:00.000Z' }],
      shipments: [{ id: '33333333-3333-4333-8333-333333333333', courier: 'Delhivery', trackingNumber: 'DL123', status: 'in_transit', events: [{ status: 'in_transit', description: 'Left hub', occurredAt: '2026-10-13T07:00:00.000Z' }] }],
      returns: [{ id: '44444444-4444-4444-8444-444444444444', status: 'requested', reason: 'Damaged on arrival', createdAt: '2026-10-13T09:00:00.000Z' }],
      messages: [{ template: 'order_confirmed', status: 'suppressed', createdAt: '2026-10-13T04:01:00.000Z' }, { template: 'order_shipped', status: 'sent', createdAt: '2026-10-13T06:01:00.000Z' }],
    });
    render(<OrderTimeline order={order} />);
    expect(screen.getByText('first recorded status')).toBeInTheDocument();
    expect(screen.getByText('out for delivery')).toBeInTheDocument();
    expect(screen.getByText('from placed')).toBeInTheDocument();
    expect(screen.getByText('Delhivery')).toBeInTheDocument();
    expect(screen.getByText(/DL123 · in transit/)).toBeInTheDocument();
    expect(screen.getByText('Latest: Left hub')).toBeInTheDocument();
    expect(screen.getByText('Damaged on arrival')).toBeInTheDocument();
    expect(screen.getByText(/address is on the suppression list/)).toBeInTheDocument();
    expect(screen.getByText('sent')).toBeInTheDocument();
  });
});

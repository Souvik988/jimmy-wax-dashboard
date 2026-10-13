import { describe, expect, it } from 'vitest';

import { adminOrderDetailSchema, invoiceSnapshotSchema, orderNotesSchema } from '@/lib/api/resources/orders';

describe('admin order runtime contracts', () => {
  const detail = {
    id: '5396faa7-139e-4054-8c4e-ac6c73525118', orderNumber: 'JW-20261007-5396FAA7', status: 'placed', paymentStatus: 'cod_due', paymentMethod: 'cod', version: 1,
    subtotalPaise: 29900, discountPaise: 0, taxPaise: 4561, shippingPaise: 4000, codFeePaise: 2500, taxInclusive: true, totalPaise: 36400, currency: 'INR',
    address: { name: 'Fixture', city: 'Kolkata', state: 'West Bengal', pin: '743287' }, createdAt: '2026-10-07T00:00:00.000Z',
    lines: [{ sku: 'JW-TS-100', productName: 'Twinkle Shine', variantTitle: '100 ml', unitPricePaise: 29900, quantity: 1, lineTotalPaise: 29900 }], paymentAttempts: [], refunds: [],
  };

  it('parses the observed detail shape without inventing coupon or allocation fields', () => {
    const parsed = adminOrderDetailSchema.parse(detail);
    expect(parsed.totalPaise).toBe(36400);
    expect('couponCode' in parsed).toBe(false);
  });

  it('refuses non-integer money and requires the redaction-safe address context', () => {
    expect(adminOrderDetailSchema.safeParse({ ...detail, totalPaise: 36400.5 }).success).toBe(false);
    expect(adminOrderDetailSchema.safeParse({ ...detail, address: { name: 'Fixture', city: 'Kolkata' } }).success).toBe(false);
  });

  it('accepts only authored, timestamped internal notes', () => {
    expect(orderNotesSchema.parse({ items: [{ id: 1, authorId: 'operator', authorRole: 'admin', body: 'Internal only', createdAt: '2026-10-07T00:00:00.000Z' }] }).items).toHaveLength(1);
    expect(orderNotesSchema.safeParse({ items: [{ id: 1, body: 'Missing audit fields' }] }).success).toBe(false);
  });
});

describe('admin invoice runtime contract', () => {
  const invoice = {
    invoiceNumber: 'JW/2026-27/000001', issuedAt: '2026-10-07T07:00:00.000Z', orderNumber: 'JW-20261007-5396FAA7',
    seller: { legalName: 'Jimmy & Wax', gstin: '22AAAAA0000A1Z5', state: 'West Bengal', address: 'Kolkata' },
    buyer: { name: 'Buyer', address: 'Street, Kolkata', state: 'West Bengal', pin: '700001' }, placeOfSupply: 'West Bengal',
    supply: 'intra_state', gstRatePercent: 18, priceBasis: 'inclusive',
    lines: [{ description: 'Leather polish (100 ml)', sku: 'JW-TS-100', quantity: 1, unitPricePaise: 29900, taxablePaise: 25339, gstPaise: 4561, totalPaise: 29900 }],
    shipping: { taxablePaise: 3389, gstPaise: 611, totalPaise: 4000 }, codFee: { taxablePaise: 2119, gstPaise: 381, totalPaise: 2500 },
    totals: { taxablePaise: 30847, cgstPaise: 2777, sgstPaise: 2776, igstPaise: 0, gstPaise: 5553, grandTotalPaise: 36400 }, currency: 'INR', hsnIncluded: false,
  };

  it('parses the observed immutable GST invoice snapshot', () => {
    const parsed = invoiceSnapshotSchema.parse(invoice);
    expect(parsed.totals.grandTotalPaise).toBe(36400);
    expect(parsed.hsnIncluded).toBe(false);
  });

  it('accepts per-line HSN codes when the backend reports them', () => {
    const withHsn = { ...invoice, hsnIncluded: true, lines: [{ ...invoice.lines[0]!, hsn: '3405' }] };
    expect(invoiceSnapshotSchema.parse(withHsn).lines[0]?.hsn).toBe('3405');
    expect(invoiceSnapshotSchema.parse({ ...invoice, lines: [{ ...invoice.lines[0]!, hsn: null }] }).hsnIncluded).toBe(false);
  });

  it('rejects non-integer invoice money and unknown supply types', () => {
    expect(invoiceSnapshotSchema.safeParse({ ...invoice, totals: { ...invoice.totals, gstPaise: 55.53 } }).success).toBe(false);
    expect(invoiceSnapshotSchema.safeParse({ ...invoice, supply: 'cross_border' }).success).toBe(false);
  });
});

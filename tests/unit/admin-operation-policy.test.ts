import { describe, expect, it } from 'vitest';

import { invoiceAccessError, invoiceGuardApplies, safeResponseHeaders } from '@/server/auth/proxy';

const orderId = '11111111-1111-4111-8111-111111111111';

describe('invoice BFF access boundary', () => {
  it('guards only issuing, never the read-only GET', () => {
    expect(invoiceGuardApplies('POST', `/v1/admin/orders/${orderId}/invoice`)).toBe(true);
    expect(invoiceGuardApplies('GET', `/v1/admin/orders/${orderId}/invoice`)).toBe(false);
    expect(invoiceGuardApplies('POST', `/v1/admin/orders/${orderId}/notes`)).toBe(false);
  });

  it('blocks roles without fulfilment before forwarding an issue request', () => {
    expect(invoiceAccessError(['orders:read'], 'aal2')).toBe('FORBIDDEN');
  });

  it('requires step-up for fulfillment when the operator session is aal1', () => {
    expect(invoiceAccessError(['orders:read', 'orders:fulfil'], 'aal1')).toBe('MFA_REQUIRED');
  });

  it('forwards an invoice request only for fulfillment with an aal2 session', () => {
    expect(invoiceAccessError(['orders:read', 'orders:fulfil'], 'aal2')).toBeNull();
  });
});

describe('BFF response headers', () => {
  it('forwards the ETag so clients can send If-Match without reading the body', () => {
    const headers = safeResponseHeaders(new Headers({ etag: '"rev-7"', 'content-type': 'application/json', 'set-cookie': 'a=b', 'x-internal': '1' }));
    expect(headers.get('etag')).toBe('"rev-7"');
    expect(headers.get('set-cookie')).toBeNull();
    expect(headers.get('x-internal')).toBeNull();
    expect(headers.get('cache-control')).toBe('no-store, max-age=0');
  });
});

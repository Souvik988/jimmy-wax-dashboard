import { describe, expect, it } from 'vitest';

import { apiErrorFromResponse } from '@/lib/api/errors';

describe('API error mapping', () => {
  it('keeps the backend error taxonomy and the request reference', async () => {
    const response = new Response(JSON.stringify({ error: {
      code: 'VALIDATION_FAILED', message: 'Review the marked fields.', requestId: 'req-123', retryable: false,
      fields: { reason: 'Too short' }, lines: [{ line: 3, message: 'Invalid row' }], reason: 'invalid', paused: true,
    } }), { status: 400, headers: { 'content-type': 'application/json', 'retry-after': '12' } });
    const error = await apiErrorFromResponse(response);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', requestId: 'req-123', fields: { reason: 'Too short' }, reason: 'invalid', paused: true, retryAfter: 12 });
    expect(error.lines).toHaveLength(1);
  });

  it('does not trust malformed error bodies and uses a safe message', async () => {
    const response = new Response('<secret html>', { status: 502, headers: { 'x-request-id': 'req-gateway' } });
    const error = await apiErrorFromResponse(response);
    expect(error).toMatchObject({ status: 502, code: 'UNAVAILABLE', requestId: 'req-gateway', retryable: true });
    expect(error.message).not.toContain('secret');
  });

  it('keeps an unknown backend code visible without treating it as a known union', async () => {
    const response = new Response(JSON.stringify({ error: { code: 'FUTURE_BACKEND_CODE', message: 'New behavior', retryable: false } }), { status: 409 });
    expect((await apiErrorFromResponse(response)).code).toBe('FUTURE_BACKEND_CODE');
  });
});

import { describe, expect, it } from 'vitest';

import { safeManualNextEvents } from '@/features/shipping/shipment-event-policy';

describe('manual shipment event policy', () => {
  it('guides forward without skipping directly to customer-confirmed delivery', () => {
    expect(safeManualNextEvents('label_created')).toEqual(['in_transit', 'failed']);
    expect(safeManualNextEvents('in_transit')).toEqual(['out_for_delivery', 'failed', 'returned_to_origin']);
    expect(safeManualNextEvents('out_for_delivery')).toEqual(['delivered', 'failed', 'returned_to_origin']);
  });

  it('treats delivery, failure and return-to-origin as closed manual timelines', () => {
    expect(safeManualNextEvents('delivered')).toEqual([]);
    expect(safeManualNextEvents('returned_to_origin')).toEqual([]);
    expect(safeManualNextEvents('failed')).toEqual([]);
    expect(safeManualNextEvents('unmapped_provider_status')).toEqual([]);
  });
});

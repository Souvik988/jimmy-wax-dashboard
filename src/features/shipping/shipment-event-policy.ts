export const manualShipmentEventStatuses = [
  'label_created', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned_to_origin',
] as const;

export type ManualShipmentEventStatus = (typeof manualShipmentEventStatuses)[number];

const nextEvents: Partial<Record<ManualShipmentEventStatus, readonly ManualShipmentEventStatus[]>> = {
  label_created: ['in_transit', 'failed'],
  in_transit: ['out_for_delivery', 'failed', 'returned_to_origin'],
  out_for_delivery: ['delivered', 'failed', 'returned_to_origin'],
};

export function safeManualNextEvents(status: string): readonly ManualShipmentEventStatus[] {
  if (!manualShipmentEventStatuses.includes(status as ManualShipmentEventStatus)) return [];
  return nextEvents[status as ManualShipmentEventStatus] ?? [];
}

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { kit, useNotice } from '@/components/kit/kit';
import { Button } from '@/components/ui/core';
import { ReasonDialog } from '@/components/ui/overlays';
import { queryKeys } from '@/lib/api/query-keys';
import { cancelShipment, cancellableShipmentStatuses, getShipment } from '@/lib/api/resources/shipping';

/** Cancel a shipment that has not been picked up yet (reason + verified identity). Works for manual shipments with no provider configured. */
export function ShipmentCancel({ shipmentId, canCancel }: { shipmentId: string; canCancel: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const [open, setOpen] = useState(false);
  const shipment = useQuery({ queryKey: queryKeys.shipping.shipment(shipmentId), queryFn: ({ signal }) => getShipment(shipmentId, signal), staleTime: 10_000 });
  const cancel = useMutation({
    mutationFn: (reason: string) => cancelShipment(shipmentId, reason),
    onSuccess: (updated) => {
      setOpen(false);
      queryClient.setQueryData(queryKeys.shipping.shipment(shipmentId), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.shipping.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      notice.success('Shipment cancelled. The order is ready for a new shipment.');
    },
    onError: (error) => { setOpen(false); notice.failure(error); },
  });
  const status = shipment.data?.status;
  if (!canCancel || !status || !(cancellableShipmentStatuses as readonly string[]).includes(status)) return notice.element;
  return <section className={kit.stack} aria-label="Cancel shipment">
    {notice.element}
    <p className={kit.muted}>This shipment has not been picked up, so it can still be cancelled (for example a wrong address or courier). Picked-up shipments cannot be cancelled here.</p>
    <div className={kit.actions}><Button variant="danger" onClick={() => setOpen(true)}>Cancel this shipment</Button></div>
    <ReasonDialog open={open} onOpenChange={setOpen} pending={cancel.isPending} title="Cancel this shipment" onConfirm={(reason) => cancel.mutate(reason)}>
      The tracking record is cancelled and any courier booking is released. Your reason is saved in the audit log. Requires a verified identity.
    </ReasonDialog>
  </section>;
}

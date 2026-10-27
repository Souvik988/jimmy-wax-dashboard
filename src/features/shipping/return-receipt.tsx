'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/core';
import { ConfirmDialog } from '@/components/ui/overlays';
import { receiveReturn, type AdminReturn } from '@/lib/api/resources/shipping';
import { formatMoney } from '@/lib/format/money';

export function ReturnReceipt({ item, onReceived }: { item: AdminReturn; onReceived?: (notice: string) => void }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const queries = useQueryClient();
  const receipt = useMutation({
    mutationFn: () => receiveReturn(item.id),
    retry: false,
    onSuccess: async (result) => {
      setOpen(false);
      const nextNotice = `Return received. ${formatMoney(result.refundValuePaise)} item value. ${result.manualRefundRequired ? 'Arrange and reconcile the COD refund manually.' : result.refundQueued ? 'Refund queued for finance; payment is not confirmed yet.' : 'No gateway refund was queued.'}`;
      setNotice(nextNotice);
      onReceived?.(nextNotice);
      await queries.invalidateQueries({ queryKey: ['shipping', 'returns'] });
      await queries.invalidateQueries({ queryKey: ['shipping', 'refunds'] });
    },
    onError: async () => {
      setOpen(false);
      await queries.invalidateQueries({ queryKey: ['shipping', 'returns'] });
    },
  });
  return <>
    <p>Confirm physical receipt only after inspecting the returned units. Receipt restocks the selected quantities once.</p>
    <Button variant="secondary" disabled={receipt.isPending} onClick={() => { receipt.reset(); setOpen(true); }}>Receive return {item.orderNumber}</Button>
    <ConfirmDialog open={open} onOpenChange={setOpen} phrase="RECEIVE RETURN" title="Receive and restock this return" pending={receipt.isPending} onConfirm={() => receipt.mutate()}>
      This records physical receipt and adds the returned quantities to inventory. Eligible prepaid refunds are queued for finance. COD refunds require a separate manual transfer and reconciliation.
    </ConfirmDialog>
    {notice && <p role="status">{notice}</p>}
    {receipt.error && <p role="alert">{receipt.error instanceof Error ? receipt.error.message : 'Receipt could not be confirmed.'} The return list was refreshed. Check its status before making another request.</p>}
  </>;
}

'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { Button, Checkbox } from '@/components/ui/core';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { createManualShipment, getOrderShipments, type ManualShipmentInput, type OrderShipment } from '@/lib/api/resources/shipping';

import { ManualShipmentForm } from './manual-shipment-form';

type WorkflowOrder = { id: string; orderNumber: string };
type ReconciliationState = 'idle' | 'checking' | 'no-match' | 'failed';
type CreateResult = { id: string; orderId: string; status: 'label_created' };

function isAmbiguous(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.message}${error.requestId ? ` Request ID: ${error.requestId}` : ''}`;
  return 'The response could not be verified. Share the request reference with an administrator before retrying.';
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function ManualShipmentWorkflow({ order, onClose, onSafetyStateChange }: { order: WorkflowOrder; onClose: () => void; onSafetyStateChange?: (blocked: boolean) => void }): ReactNode {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const [attempt, setAttempt] = useState<ManualShipmentInput | null>(null);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [reconciliation, setReconciliation] = useState<ReconciliationState>('idle');
  const [reconciliationError, setReconciliationError] = useState<string | undefined>();
  const [reviewed, setReviewed] = useState(false);
  const [created, setCreated] = useState<CreateResult | null>(null);
  const [matched, setMatched] = useState<OrderShipment | null>(null);

  useEffect(() => {
    onSafetyStateChange?.(pending || outcomeUnknown);
  }, [onSafetyStateChange, outcomeUnknown, pending]);

  const refreshAuthoritativeState = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.shipping.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(order.id) });
  };

  const submit = async (input: ManualShipmentInput) => {
    if (pending || (outcomeUnknown && !(reconciliation === 'no-match' && reviewed))) return;
    setPending(true);
    setFormError(undefined);
    setReconciliationError(undefined);
    setAttempt(input);
    try {
      const result = await createManualShipment(order.id, input);
      setCreated(result);
      setOutcomeUnknown(false);
      refreshAuthoritativeState();
    } catch (error) {
      if (isAmbiguous(error)) {
        setOutcomeUnknown(true);
        setReviewed(false);
        setReconciliation('idle');
        setFormError(undefined);
      } else {
        setOutcomeUnknown(false);
        setReconciliation('idle');
        setReviewed(false);
        setFormError(errorMessage(error));
        refreshAuthoritativeState();
      }
    } finally {
      setPending(false);
    }
  };

  const reconcile = async () => {
    if (!attempt || pending || reconciliation === 'checking') return;
    setReconciliation('checking');
    setReconciliationError(undefined);
    try {
      for (let check = 0; check < 2; check += 1) {
        if (check > 0) await wait(1_500);
        const snapshot = await getOrderShipments(order.id);
        const existing = snapshot.items.find((shipment) =>
          shipment.courier.trim().toLocaleLowerCase() === attempt.courier.trim().toLocaleLowerCase() &&
          shipment.trackingNumber.trim().toLocaleLowerCase() === attempt.trackingNumber.trim().toLocaleLowerCase(),
        );
        if (existing) {
          setMatched(existing);
          setOutcomeUnknown(false);
          setReconciliation('idle');
          refreshAuthoritativeState();
          return;
        }
      }
      setReconciliation('no-match');
    } catch (error) {
      setReconciliation('failed');
      setReconciliationError(errorMessage(error));
    }
  };

  if (created) return <section aria-live="polite">
    <p className="eyebrow">Backend confirmed</p>
    <h3>Shipment recorded</h3>
    <p>Order {order.orderNumber} is now shipped. The backend queued the customer tracking message; this does not confirm delivery of that message.</p>
    <p><strong>Shipment status:</strong> {created.status.replaceAll('_', ' ')} · <strong>Shipment ID:</strong> <code>{created.id}</code></p>
    <Button variant="secondary" onClick={onClose}>Close</Button>
  </section>;

  if (matched) return <section aria-live="polite">
    <p className="eyebrow">Reconciled with backend</p>
    <h3>Shipment already recorded</h3>
    <p>The same courier and tracking number are present in the order’s shipment records. No duplicate was submitted.</p>
    <p><strong>{matched.courier}</strong> · {matched.trackingNumber} · {matched.status.replaceAll('_', ' ')}</p>
    <Button variant="secondary" onClick={onClose}>Close</Button>
  </section>;

  return <div>
    <ManualShipmentForm
      onSubmit={submit}
      pending={pending}
      fieldsDisabled={outcomeUnknown}
      submitDisabled={outcomeUnknown && !(reconciliation === 'no-match' && reviewed)}
      submitLabel={outcomeUnknown ? 'Retry recording shipment' : 'Record shipment'}
      error={formError}
    />
    {outcomeUnknown ? <section aria-live="polite" className="security-notice">
      <h3>Shipment outcome is unknown</h3>
      <p>The request may have reached the backend before the connection failed. Do not submit again until the order’s shipment records have been checked.</p>
      {reconciliation === 'no-match' ? <>
        <p>No matching shipment appeared in two checks spaced 1.5 seconds apart. Review the courier and tracking number before deciding whether to retry.</p>
        <Checkbox label="I reviewed the latest backend records and confirm this shipment was not created." checked={reviewed} onChange={setReviewed} />
      </> : null}
      {reconciliationError ? <p role="alert">Shipment records could not be checked: {reconciliationError}</p> : null}
      <Button variant="secondary" loading={reconciliation === 'checking'} disabled={pending || reconciliation === 'checking'} onClick={() => void reconcile()}>
        {reconciliation === 'failed' ? 'Check order shipments again' : 'Check order shipments'}
      </Button>
    </section> : null}
  </div>;
}

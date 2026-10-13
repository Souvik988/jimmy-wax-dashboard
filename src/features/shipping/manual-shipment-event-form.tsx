'use client';

import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import { Button, Checkbox, Select, Textarea } from '@/components/ui/core';
import { shipmentEventInputSchema, type ShipmentEventInput } from '@/lib/api/resources/shipping';

import { safeManualNextEvents } from './shipment-event-policy';

const eventLabels: Record<ShipmentEventInput['status'], string> = {
  label_created: 'Label created',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  failed: 'Failed',
  returned_to_origin: 'Returned to origin',
};

export function ManualShipmentEventForm({
  currentStatus,
  ...props
}: {
  currentStatus: string;
  onSubmit: (input: ShipmentEventInput) => void | Promise<void>;
  pending?: boolean;
  error?: string | undefined;
}): ReactNode {
  return <ManualShipmentEventFormState key={currentStatus} currentStatus={currentStatus} {...props} />;
}

function ManualShipmentEventFormState({
  currentStatus,
  onSubmit,
  pending = false,
  error,
}: {
  currentStatus: string;
  onSubmit: (input: ShipmentEventInput) => void | Promise<void>;
  pending?: boolean;
  error?: string | undefined;
}): ReactNode {
  const [status, setStatus] = useState<ShipmentEventInput['status'] | ''>('');
  const [description, setDescription] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [validationError, setValidationError] = useState<string | undefined>();
  const nextStatuses = safeManualNextEvents(currentStatus);

  if (!nextStatuses.length) return <p role="status">{['delivered', 'returned_to_origin'].includes(currentStatus)
    ? 'This shipment is closed; no further manual events can be recorded.'
    : 'No safe next manual event is available from this backend status. Ask an administrator to review it before making a further change.'}</p>;

  const canSubmit = Boolean(status) && confirmed && !pending;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || !status) return;
    const parsed = shipmentEventInputSchema.safeParse({ status, description });
    if (!parsed.success) {
      setValidationError('Keep the event note within 300 characters.');
      return;
    }
    setValidationError(undefined);
    void onSubmit(parsed.data);
  };

  return <form className="security-form" onSubmit={submit}>
    <p>Tracking status, time and any note are recorded on this shipment and may appear in the customer tracking timeline. Record only a carrier-confirmed event; the backend currently does not enforce event order.</p>
    <Select label="Tracking status event" value={status} onChange={(event) => { setStatus(event.target.value as ShipmentEventInput['status'] | ''); setConfirmed(false); }}>
      <option value="">Choose a tracking event</option>
      {nextStatuses.map((next) => <option key={next} value={next}>{eventLabels[next]}</option>)}
    </Select>
    {status === 'failed' || status === 'returned_to_origin' ? <p role="note">This records a delivery exception only. It does not cancel the order, issue a refund or restock returned items.</p> : null}
    <Textarea label="Event note · optional" maxLength={300} value={description} onChange={(event) => setDescription(event.target.value)} />
    {validationError || error ? <p role="alert">{validationError ?? error}</p> : null}
    <Checkbox label="I confirm this tracking update is accurate and may be visible to the customer." checked={confirmed} onChange={setConfirmed} disabled={!status || pending} />
    <Button type="submit" disabled={!canSubmit} loading={pending}>Record tracking event</Button>
  </form>;
}

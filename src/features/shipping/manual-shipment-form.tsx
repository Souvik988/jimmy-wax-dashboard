'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';

import { Button, Input } from '@/components/ui/core';
import { manualShipmentInputSchema, type ManualShipmentInput } from '@/lib/api/resources/shipping';

export function ManualShipmentForm({
  onSubmit,
  pending = false,
  disabled = false,
  fieldsDisabled = disabled,
  error,
  submitLabel = 'Record shipment',
  submitDisabled = false,
}: {
  onSubmit: (input: ManualShipmentInput) => void | Promise<void>;
  pending?: boolean;
  disabled?: boolean;
  fieldsDisabled?: boolean;
  error?: string | undefined;
  submitLabel?: string;
  submitDisabled?: boolean;
}): ReactNode {
  const form = useForm<ManualShipmentInput>({
    resolver: zodResolver(manualShipmentInputSchema),
    defaultValues: { courier: '', trackingNumber: '', trackingUrl: '' },
  });

  return <form className="security-form" onSubmit={form.handleSubmit((values) => { void onSubmit(values); })}>
    <p>After submission, the backend marks this order as shipped and queues a tracking message for the customer. The current backend cannot cancel a manual shipment, so verify the courier and tracking number before saving.</p>
    <p>This records courier details you already received; it does not book a courier or generate a label.</p>
    <Input label="Courier" maxLength={80} required disabled={fieldsDisabled || pending} error={form.formState.errors.courier?.message} {...form.register('courier')} />
    <Input label="Tracking number" maxLength={80} required disabled={fieldsDisabled || pending} error={form.formState.errors.trackingNumber?.message} {...form.register('trackingNumber')} />
    <Input label="Tracking URL · optional" type="text" inputMode="url" autoComplete="url" maxLength={2048} disabled={fieldsDisabled || pending} description="HTTPS only; links with embedded credentials are rejected." error={form.formState.errors.trackingUrl?.message} {...form.register('trackingUrl')} />
    {error ? <p role="alert" className="auth-error">{error}</p> : null}
    <Button type="submit" loading={pending} disabled={disabled || pending || submitDisabled}>{submitLabel}</Button>
  </form>;
}

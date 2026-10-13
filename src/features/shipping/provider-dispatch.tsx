'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink, PlugZap } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { kit } from '@/components/kit/kit';
import { Badge, Button } from '@/components/ui/core';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { planProviderShipment, shipViaProvider, shipmentLabelPath, type ShipmentDetail, type ShipmentPlan } from '@/lib/api/resources/shipping';
import { formatMoney } from '@/lib/format/money';

import { type ProviderCapabilities, PROVIDER_SETUP_STEPS, walletShortfallPaise } from './provider-capabilities';

function problem(error: unknown): { message: string; requestId?: string; uncertain: boolean } {
  if (error instanceof ApiError) return { message: error.message, ...(error.requestId ? { requestId: error.requestId } : {}), uncertain: error.status === 0 || error.status >= 500 };
  return { message: 'The request could not be verified.', uncertain: true };
}

/** Plan with the connected provider, choose a courier, then create the shipment. Planning books nothing. */
export function ProviderDispatch({ order, capabilities, onDone }: { order: { id: string; orderNumber: string }; capabilities: ProviderCapabilities; onDone: () => void }): ReactNode {
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<ShipmentPlan | null>(null);
  const [courierId, setCourierId] = useState('');
  const [created, setCreated] = useState<ShipmentDetail | null>(null);

  const planMutation = useMutation({
    mutationFn: () => planProviderShipment(order.id),
    retry: false,
    onSuccess: (result) => { setPlan(result); setCourierId(result.recommended ?? result.options[0]?.courierId ?? ''); },
  });
  const ship = useMutation({
    mutationFn: () => shipViaProvider(order.id, courierId ? { courierId } : {}),
    retry: false,
    onSuccess: (shipment) => {
      setCreated(shipment);
      void queryClient.invalidateQueries({ queryKey: queryKeys.shipping.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
    },
  });

  if (!capabilities.canDispatch) return <ProviderNotReady capabilities={capabilities} />;

  if (created) return <section className={kit.stack} aria-label="Shipment created">
    <p className={kit.notice} role="status"><CheckCircle2 size={16} aria-hidden="true" /> Shipment created with {created.courier}. Tracking number <strong>{created.awb}</strong>.</p>
    <div className={kit.actions}>
      <a className="ui-button ui-button--secondary ui-button--md" href={shipmentLabelPath(created.id)} target="_blank" rel="noreferrer">Open label (PDF) <ExternalLink size={14} aria-hidden="true" /></a>
      <Link className="ui-button ui-button--secondary ui-button--md" href={`/shipping/shipments/${created.id}`}>Open shipment</Link>
      <Button onClick={onDone}>Done</Button>
    </div>
  </section>;

  const chosen = plan?.options.find((option) => option.courierId === courierId);
  const shortfall = plan ? walletShortfallPaise(plan.walletBalancePaise, chosen) : null;
  const planError = planMutation.error ? problem(planMutation.error) : null;
  const shipError = ship.error ? problem(ship.error) : null;

  return <section className={kit.stack} aria-label={`Ship ${order.orderNumber} through ${capabilities.providerName}`}>
    {capabilities.isSimulated ? <p className={kit.notice} role="note"><PlugZap size={14} aria-hidden="true" /> Local simulated provider: nothing is booked with a real courier.</p> : null}
    {!plan ? <>
      <p>Check couriers, cost and delivery time for <strong>{order.orderNumber}</strong> with {capabilities.providerName}. This contacts the provider but books nothing.</p>
      <div className={kit.actions}><Button loading={planMutation.isPending} onClick={() => planMutation.mutate()}>Check couriers and cost</Button></div>
      {planError ? <p className={`${kit.notice} ${kit.danger}`} role="alert">{planError.message}{planError.requestId ? ` (request ${planError.requestId})` : ''}</p> : null}
    </> : <>
      <dl className={kit.kv}>
        <dt>Parcel</dt><dd>{plan.package.weightGrams} g · {plan.package.lengthMm} × {plan.package.widthMm} × {plan.package.heightMm} mm (volumetric {plan.volumetricGrams} g)</dd>
        <dt>Payment</dt><dd>{plan.order.paymentMethod === 'cod' ? `COD · collect ${formatMoney(plan.order.codAmountPaise)}` : 'Prepaid'}</dd>
        <dt>Destination PIN</dt><dd>{plan.order.pincode} <Badge tone={plan.serviceable ? 'positive' : 'negative'}>{plan.serviceable ? 'Serviceable' : 'Not serviceable'}</Badge></dd>
        <dt>Selection rule</dt><dd>{plan.rule}</dd>
        {plan.walletBalancePaise !== null ? <><dt>Provider wallet</dt><dd>{formatMoney(plan.walletBalancePaise)}</dd></> : null}
      </dl>
      {plan.warnings.map((warning) => <p key={warning} className={kit.notice} role="alert"><AlertTriangle size={14} aria-hidden="true" /> {warning}</p>)}
      {plan.options.length === 0 ? <p className={`${kit.notice} ${kit.danger}`} role="alert">The provider returned no courier for this parcel and PIN. Use manual entry or fix the address.</p> : <fieldset className={kit.stack}>
        <legend>Courier</legend>
        {plan.options.map((option) => <label key={option.courierId} className={kit.row}>
          <input type="radio" name="courier" value={option.courierId} checked={courierId === option.courierId} onChange={() => setCourierId(option.courierId)} />
          <span><strong>{option.name}</strong>{option.courierId === plan.recommended ? ' · recommended' : ''}<br /><small>{option.etdDays === null ? 'Transit time not given' : `${option.etdDays} days`}{option.rating === null ? '' : ` · rating ${option.rating}`}</small></span>
          <span>{formatMoney(option.freightPaise + option.codChargesPaise)}<br /><small>freight {formatMoney(option.freightPaise)}{option.codChargesPaise ? ` + COD ${formatMoney(option.codChargesPaise)}` : ''}</small></span>
        </label>)}
      </fieldset>}
      {shortfall ? <p className={`${kit.notice} ${kit.danger}`} role="alert">The provider wallet is short by {formatMoney(shortfall)} for this courier. Top it up before shipping.</p> : null}
      {shipError ? <p className={`${kit.notice} ${kit.danger}`} role="alert">{shipError.message}{shipError.requestId ? ` (request ${shipError.requestId})` : ''}{shipError.uncertain ? ' The shipment may already have been created. Pressing the button again resumes the same request and cannot create a duplicate.' : ''}</p> : null}
      <div className={kit.actions}>
        <Button disabled={!plan.serviceable || !chosen || Boolean(shortfall)} loading={ship.isPending} onClick={() => ship.mutate()}>{shipError?.uncertain ? 'Resume shipment' : `Create shipment${chosen ? ` with ${chosen.name}` : ''}`}</Button>
        <Button variant="quiet" disabled={ship.isPending} onClick={onDone}>Cancel</Button>
      </div>
    </>}
  </section>;
}

/** Shown wherever provider actions would appear while the provider is not usable. */
export function ProviderNotReady({ capabilities }: { capabilities: ProviderCapabilities }): ReactNode {
  return <section className={kit.stack} aria-label="Provider dispatch is not available">
    <p><strong>Provider dispatch is off.</strong> Manual courier entry works as usual.</p>
    <ul>{capabilities.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
  </section>;
}

/** Explains what connecting the real provider involves and what turns on. Pure display; no secrets are collected here. */
export function ProviderReadinessCard({ capabilities }: { capabilities: ProviderCapabilities }): ReactNode {
  if (capabilities.mode === 'provider' && capabilities.canDispatch) return null;
  return <details className={kit.stack} aria-label="Connect a courier provider">
    <summary><PlugZap size={16} aria-hidden="true" /> Ready to connect Shiprocket — what happens when you do</summary>
    <p className={kit.muted}>This dashboard is already wired for provider dispatch: courier comparison and cost, one-click shipment creation, label PDFs, pickup scheduling, bulk shipping and tracking webhooks. It stays off until the backend reports a working provider. No dashboard change is needed.</p>
    <ol>{PROVIDER_SETUP_STEPS.map((step) => <li key={step.title}><strong>{step.title}.</strong> {step.detail}</li>)}</ol>
    <p className={kit.muted}>Credentials are set on the backend only. This page never asks for, shows or stores them.</p>
  </details>;
}

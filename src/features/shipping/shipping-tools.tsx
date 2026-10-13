'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { MapPinned, PackageCheck, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import { Badge, Button, Input, MoneyInput, RadioGroup } from '@/components/ui/core';
import { Card, EmptyState, ErrorState, OfflineState, Skeleton } from '@/components/ui/feedback';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import {
  checkShippingServiceability,
  getShippingPickupLocations,
  getShippingPins,
  getShippingSettings,
  serviceabilityInputSchema,
  type ServiceabilityResult,
  type ShippingProvider,
} from '@/lib/api/resources/shipping';
import { formatMoney } from '@/lib/format/money';

import { PinListEditor, ShippingSettingsEditor } from './shipping-config-editors';
import styles from './shipping-tools.module.css';

type QueryProblem = { message: string; requestId?: string; offline: boolean };

function problemFor(error: unknown): QueryProblem {
  if (error instanceof ApiError) return {
    message: error.message,
    ...(error.requestId ? { requestId: error.requestId } : {}),
    offline: error.status === 0 || error.status >= 500 || error.code === 'UNAVAILABLE',
  };
  return { message: 'The backend response could not be verified. No sample configuration is shown.', offline: false };
}

function QueryProblemState({ error, retry, title }: { error: unknown; retry: () => void; title: string }): ReactNode {
  const problem = problemFor(error);
  const props = { title, actionLabel: 'Retry', onAction: retry, ...(problem.requestId ? { requestId: problem.requestId } : {}) };
  return problem.offline
    ? <OfflineState {...props}>{problem.message}</OfflineState>
    : <ErrorState {...props}>{problem.message}</ErrorState>;
}

function Value({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return <div className={styles.value}><dt>{label}</dt><dd>{children}</dd></div>;
}

function SettingsPanel({ canWriteShippingSettings }: { canWriteShippingSettings: boolean }): ReactNode {
  const query = useQuery({
    queryKey: queryKeys.shipping.settings,
    queryFn: ({ signal }) => getShippingSettings(signal),
    staleTime: 30_000,
    retry: (count, error) => count < 1 && (error instanceof ApiError ? error.retryable || error.status === 0 : false),
  });
  return <Card className={styles.card!}>
    <div className={styles.panelHeader}>
      <div><p className={styles.eyebrow}>Backend configuration</p><h2>Shipping settings</h2></div>
      <Badge tone="neutral">{canWriteShippingSettings ? 'Editable' : 'Read only'}</Badge>
    </div>
    <p className={styles.description}>These values are returned by the shipping settings endpoint. Every change needs a reason, is checked against the version you loaded, and is recorded in the audit log.</p>
    {query.isLoading ? <Skeleton lines={4} /> : null}
    {query.error && !query.data ? <QueryProblemState error={query.error} retry={() => void query.refetch()} title="Shipping settings could not be loaded" /> : null}
    {query.error && query.data ? <p className={styles.stale} role="alert">Refresh failed; showing the last verified settings. {problemFor(query.error).requestId ? `Request ID: ${problemFor(query.error).requestId}` : ''}</p> : null}
    {query.data ? <dl className={styles.values}>
      <Value label="Default parcel">{query.data.defaultWeightGrams} g · {query.data.defaultLengthMm} × {query.data.defaultWidthMm} × {query.data.defaultHeightMm} mm</Value>
      <Value label="Courier selection">{query.data.courierRule}{query.data.preferredCouriers.length ? ` · ${query.data.preferredCouriers.join(', ')}` : ''}</Value>
      <Value label="Provider serviceability check">{query.data.requireProviderCheck ? 'Required' : 'Optional'}</Value>
      <Value label="Automatic provider dispatch">{query.data.autoShip ? 'Enabled' : 'Disabled'}</Value>
      <Value label="Bulk confirmation threshold">{query.data.bulkConfirmThreshold} orders</Value>
      <Value label="Stuck shipment threshold">{query.data.stuckAfterHours} hours</Value>
      <Value label="Pickup location">{query.data.pickupLocation ?? 'Not set'}</Value>
      <Value label="Pickup PIN">{query.data.pickupPin ?? 'Not set'}</Value>
    </dl> : null}
    {query.data && canWriteShippingSettings ? <ShippingSettingsEditor settings={query.data} /> : null}
    {!canWriteShippingSettings ? <p className={styles.guardNote}><ShieldCheck size={15} aria-hidden="true" />Editing shipping settings needs the shipping write permission; values above are authoritative.</p> : null}
  </Card>;
}

function PinsPanel({ canWriteDeliveryAreas }: { canWriteDeliveryAreas: boolean }): ReactNode {
  const query = useQuery({
    queryKey: queryKeys.shipping.pins,
    queryFn: ({ signal }) => getShippingPins(signal),
    staleTime: 30_000,
    retry: (count, error) => count < 1 && (error instanceof ApiError ? error.retryable || error.status === 0 : false),
  });
  return <Card className={styles.card!}>
    <div className={styles.panelHeader}>
      <div><p className={styles.eyebrow}>Delivery coverage</p><h2>Serviceable PIN prefixes</h2></div>
      <MapPinned size={24} strokeWidth={1.5} aria-hidden="true" className={styles.icon} />
    </div>
    <p className={styles.description}>The list is read from the backend allow-list. The delivery check below keeps this result separate from any configured carrier response.</p>
    {query.isLoading ? <Skeleton lines={3} /> : null}
    {query.error && !query.data ? <QueryProblemState error={query.error} retry={() => void query.refetch()} title="Delivery areas could not be loaded" /> : null}
    {query.error && query.data ? <p className={styles.stale} role="alert">Refresh failed; showing the last verified prefixes. {problemFor(query.error).requestId ? `Request ID: ${problemFor(query.error).requestId}` : ''}</p> : null}
    {!query.isLoading && !query.error && query.data?.items.length === 0 ? <EmptyState title="No PIN prefixes configured">The backend returned an empty allow-list. Serviceability is still decided by the backend response, not by this screen.</EmptyState> : null}
    {query.data?.items.length ? <ul className={styles.prefixList} aria-label="Serviceable PIN prefixes">{query.data.items.map((item) => <li key={item.prefix}><code>{item.prefix.padEnd(6, '•')}</code><span>{item.note || 'No note recorded'}</span></li>)}</ul> : null}
    {query.data && canWriteDeliveryAreas ? <PinListEditor list={query.data} /> : null}
    {!canWriteDeliveryAreas ? <p className={styles.guardNote}><ShieldCheck size={15} aria-hidden="true" />Changing delivery areas is an admin action that needs fresh MFA verification; the list above is authoritative.</p> : null}
  </Card>;
}

function ProviderPickupPanel({ provider }: { provider: ShippingProvider }): ReactNode {
  const query = useQuery({
    queryKey: queryKeys.shipping.pickupLocations,
    queryFn: ({ signal }) => getShippingPickupLocations(signal),
    enabled: provider.configured && provider.reachable === true,
    retry: false,
  });
  if (!provider.configured) return <aside className={styles.providerInfo}>
    <p className={styles.eyebrow}>Provider capability</p>
    <h2>Manual courier entry</h2>
    <p>No provider is configured. Manual shipment entry remains the active path; provider pickup locations are not requested.</p>
  </aside>;
  return <aside className={styles.providerInfo}>
    <p className={styles.eyebrow}>Provider capability</p>
    <h2>{provider.provider} pickup locations</h2>
    <p className={styles.providerWarning}>{provider.provider.toLowerCase() === 'fake'
      ? 'Local fake provider only; not Shiprocket.'
      : 'Mock-tested only; not verified against live Shiprocket.'}</p>
    {provider.reachable !== true ? <p role="status">The provider is not currently reachable; pickup locations are not requested.</p> : null}
    {query.isLoading ? <Skeleton lines={2} /> : null}
    {query.error ? <QueryProblemState error={query.error} retry={() => void query.refetch()} title="Provider pickup locations are unavailable" /> : null}
    {query.data?.items.length === 0 ? <EmptyState title="No pickup locations returned">The configured provider returned an empty location list.</EmptyState> : null}
    {query.data?.items.length ? <ul className={styles.locationList}>{query.data.items.map((name) => <li key={name}><PackageCheck size={15} aria-hidden="true" />{name}</li>)}</ul> : null}
  </aside>;
}

function ServiceabilityPanel({ provider }: { provider: ShippingProvider }): ReactNode {
  const [pin, setPin] = useState('');
  const [weightText, setWeightText] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [declaredValuePaise, setDeclaredValuePaise] = useState<number | null>(null);
  const mutation = useMutation({ mutationFn: checkShippingServiceability, retry: false });
  const cod = paymentMode === 'cod';
  const input = declaredValuePaise === null ? null : {
    pin: pin.trim(), weightGrams: Number(weightText), cod, declaredValuePaise,
  };
  const parsedInput = input === null ? null : serviceabilityInputSchema.safeParse(input);
  const valid = paymentMode !== '' && parsedInput?.success === true;
  const providerMayBeCalled = provider.configured;
  const canCheck = !providerMayBeCalled || provider.reachable === true;
  const result = mutation.data as ServiceabilityResult | undefined;
  const error = mutation.error ? problemFor(mutation.error) : undefined;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (parsedInput?.success && canCheck) {
      mutation.reset();
      mutation.mutate(parsedInput.data);
    }
  }

  return <Card className={styles.card!}>
    <div className={styles.panelHeader}>
      <div><p className={styles.eyebrow}>Live backend check</p><h2>Test a delivery PIN</h2></div>
      <Badge tone={provider.configured ? provider.reachable ? 'info' : 'warning' : 'neutral'}>{provider.configured ? provider.reachable ? 'Provider configured' : 'Provider unreachable' : 'Manual mode'}</Badge>
    </div>
    <p className={styles.description}>{provider.configured
      ? `This check may contact ${provider.provider} and update the backend serviceability cache. It does not reserve a courier or create a shipment.`
      : 'Manual mode checks the backend allow-list only; no courier is contacted.'}</p>
    {provider.configured ? <p className={styles.providerWarning}>{provider.provider.toLowerCase() === 'fake'
      ? 'Local fake provider only; not Shiprocket.'
      : 'Mock-tested only; not verified against live Shiprocket.'}</p> : null}
    <form className={styles.checkForm} onSubmit={submit}>
      <Input label="Delivery PIN code" value={pin} maxLength={6} inputMode="numeric" autoComplete="postal-code" pattern="[0-9]{6}" required onChange={(event) => { mutation.reset(); setPin(event.target.value.replace(/[^0-9]/gu, '').slice(0, 6)); }} />
      <Input label="Parcel weight (grams)" type="number" min={1} max={50_000} step={1} value={weightText} required onChange={(event) => { mutation.reset(); setWeightText(event.target.value); }} />
      <RadioGroup label="Payment collection" value={paymentMode} onChange={(value) => { mutation.reset(); setPaymentMode(value); }} options={[{ value: 'cod', label: 'COD collection' }, { value: 'prepaid', label: 'Prepaid' }]} />
      <div className={styles.moneyInput}><MoneyInput label="Declared item value" paise={declaredValuePaise} onChange={(value) => { mutation.reset(); setDeclaredValuePaise(value); }} /><small>Required; sent as integer paise to the backend.</small></div>
      <div className={styles.formAction}><Button type="submit" loading={mutation.isPending} disabled={!valid || !canCheck}>Check delivery area</Button></div>
    </form>
    {!canCheck ? <p className={styles.stale} role="status">Provider state is not reachable. The check is disabled; no manual result is substituted.</p> : null}
    {error ? <div className={styles.mutationError} role="alert"><strong>{error.message}</strong>{error.requestId ? <code>Request ID: {error.requestId}</code> : null}<span>No order or shipment was created. No automatic retry was made.</span></div> : null}
    {result && !mutation.error ? <ServiceabilityResultView result={result} /> : null}
  </Card>;
}

function ServiceabilityResultView({ result }: { result: ServiceabilityResult }): ReactNode {
  const allowListLabel = !result.allowListConfigured ? 'No allow-list configured' : result.allowListed ? 'Accepted by allow-list' : 'Not in allow-list';
  const allowListTone = !result.allowListConfigured ? 'neutral' : result.allowListed ? 'positive' : 'warning';
  return <section className={styles.result} aria-label="Serviceability result" aria-live="polite">
    <div className={styles.resultHeading}><h3>Backend response · PIN {result.pin}</h3><Badge tone={allowListTone}>{allowListLabel}</Badge></div>
    {result.note ? <p>{result.note}</p> : null}
    {result.provider === null ? <p>No provider result was returned. This is an allow-list result, not a courier serviceability promise.</p> : <>
      <p>Provider result: <strong>{result.provider.serviceable ? 'Serviceable' : 'Not serviceable'}</strong>. This does not book or reserve a shipment.</p>
      {result.provider.couriers.length ? <ul className={styles.courierList}>{result.provider.couriers.map((courier) => <li key={courier.courierId}>
        <span><strong>{courier.name}</strong>{courier.etdDays === null ? null : <small>Estimated transit · {courier.etdDays} days</small>}</span>
        <span><strong>{formatMoney(courier.freightPaise)}</strong><small>Freight</small></span>
        <span><strong>{formatMoney(courier.codChargesPaise)}</strong><small>COD charges</small></span>
      </li>)}</ul> : null}
    </>}
    <p className={styles.resultFootnote}>A check reflects backend data at request time; it is not a delivery guarantee.</p>
  </section>;
}

export function ShippingTools({ provider, canWriteShippingSettings, canWriteDeliveryAreas }: { provider: ShippingProvider; canWriteShippingSettings: boolean; canWriteDeliveryAreas: boolean }): ReactNode {
  return <section className={styles.root} aria-label="Delivery settings and serviceability">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Coverage & configuration</p><h2>Delivery tools</h2></div>
      <p>View the backend’s parcel rules and delivery areas, then test a specific destination without creating an order.</p>
    </header>
    <div className={styles.grid}>
      <SettingsPanel canWriteShippingSettings={canWriteShippingSettings} />
      <PinsPanel canWriteDeliveryAreas={canWriteDeliveryAreas} />
      <ServiceabilityPanel provider={provider} />
      <ProviderPickupPanel provider={provider} />
    </div>
  </section>;
}

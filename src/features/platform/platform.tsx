'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Loadable, PageHeader, kit, labelOf, toneOf, useNotice } from '@/components/kit/kit';
import { Badge, Button, Input, Select, Switch } from '@/components/ui/core';
import { ConfirmDialog, ReasonDialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { resourceInvalidation } from '@/lib/api/query-keys';
import {
  type SettingsView, deleteFlag, getSettings, getTeam, inviteMember, listAppVersions, listFlags, listIntegrations, patchSettings, resetMemberMfa, revokeInvite,
  saveAppVersion, saveFlag, testIntegration, updateMember,
} from '@/lib/api/resources/admin-ops';
import { formatMoney, parseRupeesToPaise } from '@/lib/format/money';
import { formatIst } from '@/lib/format/time';

type S = SettingsView['settings'];
type Draft = { shippingFee: string; freeShipping: string; codEnabled: boolean; codMax: string; codFee: string; onlinePayments: boolean; paymentWindow: string; gstPct: string; taxInclusive: boolean;
  returnWindow: string; legalName: string; gstin: string; state: string; address: string; brandName: string; supportEmail: string; supportPhone: string };
const rupees = (paise: number | null): string => (paise === null ? '' : String(paise / 100));

export function toDraft(s: S): Draft {
  return { shippingFee: rupees(s.shippingFeePaise), freeShipping: rupees(s.freeShippingThresholdPaise), codEnabled: s.codEnabled, codMax: rupees(s.codMaxOrderPaise), codFee: rupees(s.codFeePaise),
    onlinePayments: s.onlinePaymentsEnabled, paymentWindow: s.paymentWindowMinutes === null ? '' : String(s.paymentWindowMinutes), gstPct: String(s.gstRateBps / 100), taxInclusive: s.taxInclusive,
    returnWindow: s.returnWindowDays === null ? '' : String(s.returnWindowDays), legalName: s.merchantLegalName ?? '', gstin: s.merchantGstin ?? '', state: s.merchantState ?? '', address: s.merchantAddress ?? '',
    brandName: s.brandName, supportEmail: s.supportEmail ?? '', supportPhone: s.supportPhone ?? '' };
}

/** Only changed fields are sent; returns human-readable changes for the review step. */
export function settingsDiff(s: S, d: Draft): { patch: Record<string, string | number | boolean | null>; changes: Array<{ label: string; before: string; after: string }>; errors: Record<string, string> } {
  const patch: Record<string, string | number | boolean | null> = {}; const changes: Array<{ label: string; before: string; after: string }> = []; const errors: Record<string, string> = {};
  const money = (key: keyof Draft, field: string, current: number | null, label: string, nullable: boolean): void => {
    const text = (d[key] as string).trim();
    if (text === '') { if (!nullable) errors[key] = 'Required.'; else if (current !== null) { patch[field] = null; changes.push({ label, before: formatMoney(current), after: 'Not set' }); } return; }
    const paise = parseRupeesToPaise(text);
    if (paise === null || paise < 0) { errors[key] = 'Enter a rupee amount.'; return; }
    if (paise !== current) { patch[field] = paise; changes.push({ label, before: current === null ? 'Not set' : formatMoney(current), after: formatMoney(paise) }); }
  };
  const flag = (key: keyof Draft, field: string, current: boolean, label: string): void => { if (d[key] !== current) { patch[field] = d[key] as boolean; changes.push({ label, before: current ? 'On' : 'Off', after: d[key] ? 'On' : 'Off' }); } };
  const text = (key: keyof Draft, field: string, current: string | null, label: string, nullable = true): void => {
    const value = (d[key] as string).trim();
    if ((current ?? '') !== value) { patch[field] = value === '' && nullable ? null : value; changes.push({ label, before: current || 'Not set', after: value || 'Not set' }); }
  };
  money('shippingFee', 'shippingFeePaise', s.shippingFeePaise, 'Shipping fee', false);
  money('freeShipping', 'freeShippingThresholdPaise', s.freeShippingThresholdPaise, 'Free-shipping threshold', true);
  money('codMax', 'codMaxOrderPaise', s.codMaxOrderPaise, 'Maximum COD order', true);
  money('codFee', 'codFeePaise', s.codFeePaise, 'COD fee', false);
  flag('codEnabled', 'codEnabled', s.codEnabled, 'Cash on delivery'); flag('onlinePayments', 'onlinePaymentsEnabled', s.onlinePaymentsEnabled, 'Online payments'); flag('taxInclusive', 'taxInclusive', s.taxInclusive, 'Prices include GST');
  const gst = Number(d.gstPct); if (!Number.isFinite(gst) || gst < 0 || gst > 40) errors['gstPct'] = '0–40%.'; else if (Math.round(gst * 100) !== s.gstRateBps) { patch['gstRateBps'] = Math.round(gst * 100); changes.push({ label: 'GST rate', before: `${s.gstRateBps / 100}%`, after: `${gst}%` }); }
  const win = d.paymentWindow.trim(); if (win === '') { if (s.paymentWindowMinutes !== null) { patch['paymentWindowMinutes'] = null; changes.push({ label: 'Payment window', before: `${s.paymentWindowMinutes} min`, after: 'Not set' }); } } else { const n = Number(win); if (!Number.isInteger(n) || n < 5 || n > 1440) errors['paymentWindow'] = '5–1440 minutes.'; else if (n !== s.paymentWindowMinutes) { patch['paymentWindowMinutes'] = n; changes.push({ label: 'Payment window', before: s.paymentWindowMinutes === null ? 'Not set' : `${s.paymentWindowMinutes} min`, after: `${n} min` }); } }
  const rw = d.returnWindow.trim(); if (rw === '') { if (s.returnWindowDays !== null) { patch['returnWindowDays'] = null; changes.push({ label: 'Return window', before: `${s.returnWindowDays} days`, after: 'Not set' }); } } else { const n = Number(rw); if (!Number.isInteger(n) || n < 1 || n > 90) errors['returnWindow'] = '1–90 days.'; else if (n !== s.returnWindowDays) { patch['returnWindowDays'] = n; changes.push({ label: 'Return window', before: s.returnWindowDays === null ? 'Not set' : `${s.returnWindowDays} days`, after: `${n} days` }); } }
  text('legalName', 'merchantLegalName', s.merchantLegalName, 'Legal name'); text('state', 'merchantState', s.merchantState, 'Merchant state'); text('address', 'merchantAddress', s.merchantAddress, 'Merchant address');
  text('brandName', 'brandName', s.brandName, 'Brand name', false); text('supportEmail', 'supportEmail', s.supportEmail, 'Support email'); text('supportPhone', 'supportPhone', s.supportPhone, 'Support phone');
  const gstin = d.gstin.trim().toUpperCase(); if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/u.test(gstin)) errors['gstin'] = 'Not a valid GSTIN.'; else if (gstin !== (s.merchantGstin ?? '')) { patch['merchantGstin'] = gstin || null; changes.push({ label: 'GSTIN', before: s.merchantGstin ?? 'Not set', after: gstin || 'Not set' }); }
  if (d.supportEmail.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(d.supportEmail.trim())) errors['supportEmail'] = 'Not a valid email.';
  if (d.supportPhone.trim() && !/^[0-9+() -]{7,20}$/u.test(d.supportPhone.trim())) errors['supportPhone'] = 'Not a valid phone.';
  return { patch, changes, errors };
}

export function SettingsPanel({ canWrite }: { canWrite: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const q = useQuery({ queryKey: ['settings'], queryFn: ({ signal }) => getSettings(signal) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [review, setReview] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const s = q.data?.settings;
  const current = draft ?? (s ? toDraft(s) : null);
  const diff = s && current ? settingsDiff(s, current) : null;
  const errors = { ...diff?.errors, ...serverErrors };
  const set = (patch: Partial<Draft>): void => { if (current) { setDraft({ ...current, ...patch }); setServerErrors({}); } };

  const save = useMutation({
    mutationFn: (reason: string) => patchSettings({ expectedVersion: s!.version, reason, ...diff!.patch }),
    onSuccess: () => { setReview(false); setDraft(null); notice.success('Settings saved and recorded in the audit log.'); for (const key of resourceInvalidation.settings) void queryClient.invalidateQueries({ queryKey: key as readonly unknown[] }); void queryClient.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (error) => { setReview(false); if (error instanceof ApiError && error.fields) setServerErrors(error.fields); notice.failure(error.constructor === ApiError && (error as ApiError).status === 409 ? new ApiError(409, 'CONFLICT', 'Settings changed since you opened this page. Reload and re-apply your changes.') : error); },
  });

  const field = (key: keyof Draft, label: string, extra: { description?: string; type?: string } = {}): ReactNode => <Input label={label} value={current![key] as string} disabled={!canWrite} error={errors[key]} {...(extra.description ? { description: extra.description } : {})} onChange={(event) => set({ [key]: event.target.value } as Partial<Draft>)} />;
  return <div className={kit.page}>
    <PageHeader eyebrow="Settings" title="Store settings">Changes apply to checkout, the app and the website. Each save needs a reason, a verified identity, and is audited.</PageHeader>
    {notice.element}
    <Loadable query={q} noun="Settings">{s && current ? <>
      <section className={kit.stack} aria-label="Go-live readiness">
        <h2>Checkout readiness <Badge tone={q.data!.readiness.allOk ? 'positive' : 'warning'}>{q.data!.readiness.allOk ? 'All checks pass' : 'Not ready'}</Badge></h2>
        <ul className={kit.rows}>{q.data!.readiness.checks.map((check) => <li key={check.id} className={kit.row}><strong>{labelOf(check.id)}</strong><Badge tone={check.ok ? 'positive' : 'negative'}>{check.ok ? 'OK' : 'Needs attention'}</Badge><small>{check.detail}</small></li>)}</ul>
        <p className={kit.muted}>Checkout is currently <strong>{s.checkoutEnabled ? 'open' : 'closed'}</strong>. Opening or closing checkout is done from the Home overview, which has its own safeguards.</p>
      </section>
      <section className={kit.stack}><h2>Pricing & payment</h2><div className={kit.formGrid}>
        {field('shippingFee', 'Shipping fee (₹)')}{field('freeShipping', 'Free-shipping threshold (₹)', { description: 'Empty = never free.' })}
        {field('codFee', 'COD fee (₹)')}{field('codMax', 'Maximum COD order (₹)', { description: 'Empty = no limit.' })}
        {field('gstPct', 'GST rate (%)')}{field('paymentWindow', 'Online payment window (minutes)')}{field('returnWindow', 'Return window (days)', { description: 'Empty = returns not offered.' })}
      </div>
        <Switch label="Cash on delivery enabled" checked={current.codEnabled} disabled={!canWrite} onChange={(codEnabled) => set({ codEnabled })} />
        <Switch label="Online payments enabled" checked={current.onlinePayments} disabled={!canWrite} onChange={(onlinePayments) => set({ onlinePayments })} />
        <Switch label="Listed prices include GST" checked={current.taxInclusive} disabled={!canWrite} onChange={(taxInclusive) => set({ taxInclusive })} />
      </section>
      <section className={kit.stack}><h2>Business details (printed on invoices)</h2><div className={kit.formGrid}>
        {field('brandName', 'Brand name')}{field('legalName', 'Legal name')}{field('gstin', 'GSTIN')}{field('state', 'State')}{field('address', 'Address')}{field('supportEmail', 'Support email')}{field('supportPhone', 'Support phone')}
      </div></section>
      {canWrite ? <div className={kit.actions}>
        <Button disabled={!diff || diff.changes.length === 0 || Object.keys(diff.errors).length > 0} onClick={() => setReview(true)}>Review {diff?.changes.length ?? 0} change(s)</Button>
        <Button variant="secondary" disabled={!draft} onClick={() => { setDraft(null); setServerErrors({}); }}>Discard edits</Button>
      </div> : <p className={kit.notice}>Read only — your role cannot change settings.</p>}
      <ReasonDialog open={review} onOpenChange={setReview} pending={save.isPending} title="Confirm settings change" onConfirm={(reason) => save.mutate(reason)}>
        <span>{diff?.changes.map((change) => `${change.label}: ${change.before} → ${change.after}`).join(' · ')}</span>
      </ReasonDialog>
    </> : null}</Loadable>
  </div>;
}

export function TeamPanel(): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const team = useQuery({ queryKey: ['team'], queryFn: ({ signal }) => getTeam(signal) });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('support');
  const [confirm, setConfirm] = useState<{ kind: 'disable' | 'mfa'; id: string; email: string; disabled?: boolean } | null>(null);
  const refresh = (): void => { void queryClient.invalidateQueries({ queryKey: ['team'] }); };
  const invite = useMutation({ mutationFn: () => inviteMember({ email: email.trim(), role }), onSuccess: () => { notice.success('Invitation sent. It expires automatically.'); setEmail(''); refresh(); }, onError: notice.failure });
  const revoke = useMutation({ mutationFn: (id: string) => revokeInvite(id), onSuccess: () => { notice.success('Invitation revoked.'); refresh(); }, onError: notice.failure });
  const change = useMutation({ mutationFn: (input: { id: string; role?: string; disabled?: boolean }) => updateMember(input.id, { ...(input.role ? { role: input.role } : {}), ...(input.disabled !== undefined ? { disabled: input.disabled } : {}) }), onSuccess: () => { setConfirm(null); notice.success('Team member updated.'); refresh(); }, onError: (e) => { setConfirm(null); notice.failure(e); } });
  const mfa = useMutation({ mutationFn: (id: string) => resetMemberMfa(id), onSuccess: () => { setConfirm(null); notice.success('Authenticator reset. They must enrol again at next sign-in.'); refresh(); }, onError: (e) => { setConfirm(null); notice.failure(e); } });
  const roles = ['admin', 'support', 'catalog', 'fulfillment', 'finance', 'designer'];
  return <div className={kit.page}>
    <PageHeader eyebrow="Settings" title="Team">Invite operators and assign roles. Every change needs a verified identity. Never share accounts.</PageHeader>
    {notice.element}
    <Loadable query={team} noun="Team">{team.data ? <>
      <ul className={kit.rows} aria-label="Members">{team.data.members.map((member) => <li key={member.userId} className={kit.row}>
        <div><strong>{member.email}</strong><br /><small>{member.lastLogin ? `Last sign-in ${formatIst(member.lastLogin, { dateStyle: 'medium', timeStyle: 'short' })} IST` : 'Never signed in'} · {member.mfaEnrolled ? 'Authenticator enrolled' : 'No authenticator yet'}</small></div>
        <div><Badge tone={member.disabled ? 'negative' : 'positive'}>{member.disabled ? 'Disabled' : 'Active'}</Badge></div>
        <div><Select label="Role" value={member.role} onChange={(event) => change.mutate({ id: member.userId, role: event.target.value })}>{roles.map((r) => <option key={r} value={r}>{labelOf(r)}</option>)}</Select></div>
        <div className={kit.actions}><Button variant="secondary" onClick={() => setConfirm({ kind: 'disable', id: member.userId, email: member.email, disabled: !member.disabled })}>{member.disabled ? 'Enable' : 'Disable'}</Button><Button variant="quiet" onClick={() => setConfirm({ kind: 'mfa', id: member.userId, email: member.email })}>Reset authenticator</Button></div>
      </li>)}</ul>
      {team.data.invites.length > 0 ? <section className={kit.stack}><h2>Pending invitations</h2><ul className={kit.rows}>{team.data.invites.map((inv) => <li key={inv.id} className={kit.row}><strong>{inv.email}</strong><Badge>{labelOf(inv.role)}</Badge><Button variant="quiet" onClick={() => revoke.mutate(inv.id)}>Revoke</Button></li>)}</ul></section> : null}
      <section className={kit.stack}><h2>Invite someone</h2><div className={kit.toolbar}>
        <Input label="Work email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <Select label="Role" value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((r) => <option key={r} value={r}>{labelOf(r)}</option>)}</Select>
        <Button loading={invite.isPending} disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email.trim())} onClick={() => invite.mutate()}>Send invitation</Button>
      </div></section>
    </> : null}</Loadable>
    <ConfirmDialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open) setConfirm(null); }} phrase={confirm?.email ?? 'confirm'} pending={change.isPending || mfa.isPending} title={confirm?.kind === 'mfa' ? 'Reset authenticator' : confirm?.disabled ? 'Disable account' : 'Enable account'}
      onConfirm={() => { if (!confirm) return; if (confirm.kind === 'mfa') mfa.mutate(confirm.id); else change.mutate({ id: confirm.id, disabled: confirm.disabled! }); }}>
      {confirm?.kind === 'mfa' ? 'They will have to enrol a new authenticator before using sensitive features.' : confirm?.disabled ? 'They are signed out and cannot sign in until re-enabled.' : 'They will be able to sign in again.'}
    </ConfirmDialog>
  </div>;
}

export function IntegrationsPanel({ canManage }: { canManage: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const q = useQuery({ queryKey: ['integrations'], queryFn: ({ signal }) => listIntegrations(signal) });
  const test = useMutation({ mutationFn: (name: string) => testIntegration(name), onSuccess: (result) => { notice.success(`Test finished: ${JSON.stringify(result)}`); void queryClient.invalidateQueries({ queryKey: ['integrations'] }); }, onError: notice.failure });
  return <div className={kit.page}>
    <PageHeader eyebrow="Settings" title="Integrations">Status of connected services. Secrets are never shown here — they are set on the server. Testing needs a verified identity.</PageHeader>
    {notice.element}
    <Loadable query={q} noun="Integrations"><ul className={kit.rows}>{q.data?.map((item) => <li key={item.name} className={kit.row}>
      <div><strong>{labelOf(item.name)}</strong><br /><small>{Object.entries(item.facts).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') || 'No details'}</small></div>
      <div><Badge tone={item.configured ? 'positive' : 'warning'}>{item.configured ? 'Configured' : 'Not configured'}</Badge></div>
      <div><small>{item.lastCheck ? JSON.stringify(item.lastCheck) : 'Never tested'}</small></div>
      <div>{canManage ? <Button variant="secondary" loading={test.isPending && test.variables === item.name} onClick={() => test.mutate(item.name)}>Run test</Button> : null}</div>
    </li>)}</ul></Loadable>
  </div>;
}

export function PlatformPanel({ canFlags, canWrite }: { canFlags: boolean; canWrite: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const flags = useQuery({ queryKey: ['flags'], queryFn: ({ signal }) => listFlags(signal) });
  const versions = useQuery({ queryKey: ['app-versions'], queryFn: ({ signal }) => listAppVersions(signal) });
  const [flag, setFlag] = useState({ key: '', description: '', enabled: false, rolloutPercent: '100' });
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { latestVersion: string; minSupportedVersion: string; storeUrl: string; message: string }>>({});
  const saveF = useMutation({ mutationFn: (f: { key: string; description: string; enabled: boolean; rolloutPercent: number }) => saveFlag(f), onSuccess: () => { notice.success('Flag saved.'); setFlag({ key: '', description: '', enabled: false, rolloutPercent: '100' }); void queryClient.invalidateQueries({ queryKey: ['flags'] }); }, onError: notice.failure });
  const delF = useMutation({ mutationFn: (key: string) => deleteFlag(key), onSuccess: () => { setDeleteKey(null); notice.success('Flag deleted.'); void queryClient.invalidateQueries({ queryKey: ['flags'] }); }, onError: (e) => { setDeleteKey(null); notice.failure(e); } });
  const saveV = useMutation({ mutationFn: (input: { platform: 'android' | 'ios'; value: { latestVersion: string; minSupportedVersion: string; storeUrl: string; message: string } }) => saveAppVersion(input.platform, input.value), onSuccess: () => { notice.success('App version policy saved. Older builds below the minimum will be asked to update.'); setEdits({}); void queryClient.invalidateQueries({ queryKey: ['app-versions'] }); }, onError: notice.failure });
  const pct = Number(flag.rolloutPercent);
  const flagValid = /^[a-z][a-z0-9_.-]{1,63}$/u.test(flag.key) && Number.isInteger(pct) && pct >= 0 && pct <= 100;
  return <div className={kit.page}>
    <PageHeader eyebrow="Settings" title="Feature flags & app versions">Flags gate features in the apps. App versions decide which builds are told to update.</PageHeader>
    {notice.element}
    <section className={kit.stack}><h2>App version policy</h2>
      <Loadable query={versions} noun="App versions"><div className={kit.split}>{versions.data?.map((v) => { const e = edits[v.platform] ?? { latestVersion: v.latestVersion, minSupportedVersion: v.minSupportedVersion, storeUrl: v.storeUrl, message: v.message }; const bad = !/^\d+\.\d+\.\d+$/u.test(e.latestVersion) || !/^\d+\.\d+\.\d+$/u.test(e.minSupportedVersion) || (e.storeUrl !== '' && !e.storeUrl.startsWith('https://'));
        return <fieldset key={v.platform} className={kit.stack}><legend>{v.platform === 'ios' ? 'iOS' : 'Android'}</legend>
          <Input label="Latest version" value={e.latestVersion} disabled={!canWrite} onChange={(event) => setEdits({ ...edits, [v.platform]: { ...e, latestVersion: event.target.value } })} />
          <Input label="Minimum supported version" value={e.minSupportedVersion} disabled={!canWrite} onChange={(event) => setEdits({ ...edits, [v.platform]: { ...e, minSupportedVersion: event.target.value } })} description="Builds older than this are forced to update." />
          <Input label="Store URL (https)" value={e.storeUrl} disabled={!canWrite} onChange={(event) => setEdits({ ...edits, [v.platform]: { ...e, storeUrl: event.target.value } })} />
          <Input label="Update message" value={e.message} maxLength={300} disabled={!canWrite} onChange={(event) => setEdits({ ...edits, [v.platform]: { ...e, message: event.target.value } })} />
          {canWrite ? <Button disabled={bad || !edits[v.platform]} loading={saveV.isPending} onClick={() => saveV.mutate({ platform: v.platform, value: e })}>Save {v.platform}</Button> : null}
        </fieldset>; })}</div></Loadable></section>
    <section className={kit.stack}><h2>Feature flags</h2>
      <Loadable query={flags} noun="Flags">{flags.data?.length === 0 ? <p className={kit.notice}>No flags defined.</p> : <ul className={kit.rows}>{flags.data?.map((f) => <li key={f.key} className={kit.row}>
        <div><strong>{f.key}</strong><br /><small>{f.description || 'No description'}</small></div><div><Badge tone={f.enabled ? 'positive' : 'neutral'}>{f.enabled ? `On · ${f.rolloutPercent}%` : 'Off'}</Badge></div>
        <div className={kit.actions}>{canFlags ? <><Button variant="secondary" onClick={() => saveF.mutate({ key: f.key, description: f.description, enabled: !f.enabled, rolloutPercent: f.rolloutPercent })}>{f.enabled ? 'Turn off' : 'Turn on'}</Button><Button variant="quiet" onClick={() => setDeleteKey(f.key)}>Delete</Button></> : null}</div>
      </li>)}</ul>}</Loadable>
      {canFlags ? <div className={kit.toolbar}>
        <Input label="Key" value={flag.key} onChange={(event) => setFlag({ ...flag, key: event.target.value })} description="lowercase, e.g. new_checkout" />
        <Input label="Description" value={flag.description} maxLength={200} onChange={(event) => setFlag({ ...flag, description: event.target.value })} />
        <Input label="Rollout %" inputMode="numeric" value={flag.rolloutPercent} onChange={(event) => setFlag({ ...flag, rolloutPercent: event.target.value })} />
        <Switch label="Enabled" checked={flag.enabled} onChange={(enabled) => setFlag({ ...flag, enabled })} />
        <Button disabled={!flagValid} loading={saveF.isPending} onClick={() => saveF.mutate({ key: flag.key, description: flag.description, enabled: flag.enabled, rolloutPercent: pct })}>Save flag</Button>
      </div> : <p className={kit.muted}>Only operators with flags:manage can change flags.</p>}
    </section>
    <ConfirmDialog open={Boolean(deleteKey)} onOpenChange={(open) => { if (!open) setDeleteKey(null); }} phrase={deleteKey ?? 'delete'} pending={delF.isPending} title="Delete flag" onConfirm={() => deleteKey && delF.mutate(deleteKey)}>Apps that read this flag fall back to its built-in default.</ConfirmDialog>
  </div>;
}

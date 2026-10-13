'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { Loadable, PageHeader, kit, labelOf, toneOf, useNotice } from '@/components/kit/kit';
import { Badge, Button, Input, Select, Textarea } from '@/components/ui/core';
import { ApiError } from '@/lib/api/errors';
import { type Campaign, type CampaignInput, createCampaign, listCampaigns, updateCampaign } from '@/lib/api/resources/studio';
import { formatIst } from '@/lib/format/time';

export function overlappingCampaigns(campaigns: readonly Pick<Campaign, 'id' | 'name' | 'startsAt' | 'endsAt' | 'status'>[]): Array<[string, string]> {
  const active = campaigns.filter((campaign) => campaign.status === 'active').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const pairs: Array<[string, string]> = [];
  for (let index = 1; index < active.length; index += 1) {
    if (new Date(active[index]!.startsAt) < new Date(active[index - 1]!.endsAt)) pairs.push([active[index - 1]!.name, active[index]!.name]);
  }
  return pairs;
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

type Form = { id?: string; rev?: number; name: string; startsAt: string; endsAt: string; status: 'draft' | 'active' | 'archived'; app: string; web: string };
const blank: Form = { name: '', startsAt: '', endsAt: '', status: 'draft', app: '', web: '' };
const OVERLAY_HINT = '{"tokens":{"color":{"roles":{"accent.primary":"#B8242B"}}},"announcement":{"text":"Festive offer","tone":"promo"}}';

function parseOverlay(text: string): { value: Record<string, unknown> | null } | { error: string } {
  if (!text.trim()) return { value: null };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'An overlay must be a JSON object.' };
    return { value: parsed as Record<string, unknown> };
  } catch { return { error: 'This overlay is not valid JSON.' }; }
}

export function CampaignsPanel({ canWrite }: { canWrite: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const campaigns = useQuery({ queryKey: ['studio', 'campaigns'], queryFn: ({ signal }) => listCampaigns(signal) });
  const [form, setForm] = useState<Form | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const overlaps = useMemo(() => overlappingCampaigns(campaigns.data ?? []), [campaigns.data]);

  const save = useMutation({
    mutationFn: (input: CampaignInput) => (form?.id ? updateCampaign(form.id, input, form.rev ?? 1) : createCampaign(input)),
    onSuccess: () => { notice.success('Campaign saved. It applies only after a release that includes it is published, and only inside its window.'); setForm(null); setFieldErrors({}); void queryClient.invalidateQueries({ queryKey: ['studio', 'campaigns'] }); },
    onError: (error) => { if (error instanceof ApiError && error.fields) setFieldErrors(error.fields); notice.failure(error); },
  });

  const submit = (): void => {
    if (!form) return;
    const app = parseOverlay(form.app); const web = parseOverlay(form.web);
    const errors: Record<string, string> = {};
    if ('error' in app) errors['app'] = app.error;
    if ('error' in web) errors['web'] = web.error;
    if (form.name.trim().length < 2) errors['name'] = 'Use at least 2 characters.';
    if (!form.startsAt || !form.endsAt) errors['startsAt'] = 'Choose a start and end.';
    else if (new Date(form.endsAt) <= new Date(form.startsAt)) errors['endsAt'] = 'The end must be after the start.';
    setFieldErrors(errors);
    if (Object.keys(errors).length || 'error' in app || 'error' in web) return;
    save.mutate({ name: form.name.trim(), startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(), status: form.status, app: 'value' in app ? app.value : null, web: 'value' in web ? web.value : null });
  };

  return <div className={kit.page}>
    <PageHeader eyebrow="Experience Studio" title="Campaigns" actions={<><Link href="/studio"><Button variant="secondary">Back to Studio</Button></Link><Button disabled={!canWrite} onClick={() => { setForm(blank); setFieldErrors({}); notice.clear(); }}>New campaign</Button></>}>
      A campaign is a scheduled seasonal skin for the app and/or website: token overrides, an announcement, and an optional extra hero slide. Overlapping active campaigns block publishing.
    </PageHeader>
    {notice.element}
    {overlaps.length > 0 ? <p className={`${kit.notice} ${kit.danger}`} role="alert">Overlap: {overlaps.map(([a, b]) => `“${a}” and “${b}”`).join('; ')}. Adjust the windows before publishing.</p> : null}
    <Loadable query={campaigns} noun="Campaigns">
      {campaigns.data?.length === 0 ? <p className={kit.notice}>No campaigns yet.</p> : <ul className={kit.rows}>
        {campaigns.data?.map((campaign) => <li key={campaign.id} className={kit.row}>
          <div><strong>{campaign.name}</strong><br /><small>{formatIst(campaign.startsAt, { dateStyle: 'medium', timeStyle: 'short' })} → {formatIst(campaign.endsAt, { dateStyle: 'medium', timeStyle: 'short' })} IST · {campaign.app ? 'App' : ''}{campaign.app && campaign.web ? ' + ' : ''}{campaign.web ? 'Website' : ''}</small></div>
          <div><Badge tone={toneOf(campaign.status)}>{labelOf(campaign.status)}</Badge></div>
          <div><Button variant="secondary" onClick={() => { setForm({ id: campaign.id, rev: campaign.rev ?? 1, name: campaign.name, startsAt: toLocalInput(campaign.startsAt), endsAt: toLocalInput(campaign.endsAt), status: campaign.status as Form['status'], app: campaign.app ? JSON.stringify(campaign.app, null, 2) : '', web: campaign.web ? JSON.stringify(campaign.web, null, 2) : '' }); setFieldErrors({}); notice.clear(); }}>{canWrite ? 'Edit' : 'View'}</Button></div>
        </li>)}
      </ul>}
    </Loadable>
    {form ? <section className={kit.stack} aria-label="Campaign form">
      <h2>{form.id ? 'Edit campaign' : 'New campaign'}</h2>
      <div className={kit.formGrid}>
        <Input label="Name" value={form.name} maxLength={120} error={fieldErrors['name']} disabled={!canWrite} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <Select label="Status" value={form.status} disabled={!canWrite} onChange={(event) => setForm({ ...form, status: event.target.value as Form['status'] })}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></Select>
        <Input label="Starts" type="datetime-local" value={form.startsAt} error={fieldErrors['startsAt']} disabled={!canWrite} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} />
        <Input label="Ends" type="datetime-local" value={form.endsAt} error={fieldErrors['endsAt']} disabled={!canWrite} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} />
      </div>
      <Textarea label="App overlay (JSON, optional)" rows={8} spellCheck={false} placeholder={OVERLAY_HINT} value={form.app} error={fieldErrors['app'] ?? fieldErrors['app.tokens']} disabled={!canWrite} onChange={(event) => setForm({ ...form, app: event.target.value })} description="tokens (subset of the shared design), announcement, extraHeroSlide. Unknown keys are rejected." />
      <Textarea label="Website overlay (JSON, optional)" rows={8} spellCheck={false} placeholder={OVERLAY_HINT} value={form.web} error={fieldErrors['web'] ?? fieldErrors['web.tokens']} disabled={!canWrite} onChange={(event) => setForm({ ...form, web: event.target.value })} />
      <div className={kit.actions}><Button disabled={!canWrite} loading={save.isPending} onClick={submit}>Save campaign</Button><Button variant="secondary" onClick={() => setForm(null)}>Close</Button></div>
    </section> : null}
  </div>;
}

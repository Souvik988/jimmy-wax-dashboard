'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Loadable, PageHeader, kit, labelOf, problemOf, toneOf, useNotice } from '@/components/kit/kit';
import { Badge, Button, Checkbox, Input, Textarea } from '@/components/ui/core';
import { ReasonDialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import {
  type Channel, type Release, cancelRelease, channels, createPreviewToken, createRelease, getDiff, getExperienceState, listReleases,
  rollbackRelease, setKillSwitch, validateChannel,
} from '@/lib/api/resources/studio';
import { formatIst } from '@/lib/format/time';

function newKey(): string { return globalThis.crypto.randomUUID(); }

function ChannelPublish({ channel, canPublish, isAdmin }: { channel: Channel; canPublish: boolean; isAdmin: boolean }): ReactNode {
  const diff = useQuery({ queryKey: ['studio', 'diff', channel], queryFn: ({ signal }) => getDiff(channel, signal) });
  const state = useQuery({ queryKey: ['studio', 'state'], queryFn: ({ signal }) => getExperienceState(signal) });
  const validation = useMutation({ mutationFn: () => validateChannel(channel) });
  const live = state.data?.find((item) => item.channel === channel);
  const changed = diff.data?.docs.filter((doc) => doc.status !== 'unchanged') ?? [];
  const [killOpen, setKillOpen] = useState(false);
  const queryClient = useQueryClient();
  const notice = useNotice();
  const kill = useMutation({
    mutationFn: (reason: string) => setKillSwitch(channel, !(live?.enabled ?? true), reason),
    onSuccess: () => {
      setKillOpen(false);
      notice.success(live?.enabled ? 'Studio content switched off. Clients now use bundled defaults.' : 'Studio content switched back on.');
      void queryClient.invalidateQueries({ queryKey: ['studio', 'state'] });
    },
    onError: (error) => { setKillOpen(false); notice.failure(error); },
  });
  const preview = useMutation({ mutationFn: () => createPreviewToken(channel, 240), onError: notice.failure });

  return <section className={kit.stack} aria-label={`${labelOf(channel)} status`}>
    <h2>{channel === 'app' ? 'Mobile app' : 'Website'}</h2>
    {notice.element}
    <Loadable query={diff} noun="Draft comparison">
      {changed.length === 0 ? <p className={`${kit.notice} ${kit.ok}`}>The draft matches the live release.</p> : <>
        <p className={kit.notice}>{changed.length} document(s) differ from live.</p>
        <ul className={kit.rows}>{changed.map((doc) => <li key={doc.doc} className={kit.row}><strong>{doc.doc}</strong><Badge tone={toneOf(doc.status)}>{labelOf(doc.status)}</Badge><small>{doc.summary.length} change(s)</small></li>)}</ul></>}
    </Loadable>
    <div className={kit.actions}>
      <Button variant="secondary" loading={validation.isPending} onClick={() => validation.mutate()}>Validate before publishing</Button>
      <Button variant="secondary" loading={preview.isPending} onClick={() => preview.mutate()}>Create 4-hour preview link</Button>
      <Link href={`/studio?channel=${channel}`}><Button variant="quiet">Open {channel} editor</Button></Link>
      {canPublish && isAdmin ? <Button variant="danger" onClick={() => setKillOpen(true)}>{live?.enabled === false ? 'Switch Studio content back on' : 'Kill switch: use bundled defaults'}</Button> : null}
    </div>
    {preview.data ? <p className={kit.notice} role="status">Preview link: <code>{preview.data.path}</code> (expires {formatIst(preview.data.expiresAt, { dateStyle: 'medium', timeStyle: 'short' })} IST). Treat it as secret until it expires.</p> : null}
    {validation.error ? <p className={`${kit.notice} ${kit.danger}`} role="alert">Validation could not run: {problemOf(validation.error).message}</p> : null}
    {validation.data ? <div role="status"><p className={`${kit.notice} ${validation.data.canPublish ? kit.ok : kit.danger}`}>{validation.data.canPublish ? 'No blocking errors.' : `${validation.data.errors.length} blocking error(s).`} {validation.data.warnings.length} warning(s).</p>
      <ul className={kit.rows}>{[...validation.data.errors, ...validation.data.warnings].slice(0, 25).map((issue, index) => <li key={index} className={kit.row}><Badge tone={issue.level === 'error' ? 'negative' : 'warning'}>{issue.level}</Badge><span>{issue.message}</span></li>)}</ul></div> : null}
    <ReasonDialog open={killOpen} onOpenChange={setKillOpen} pending={kill.isPending} title={live?.enabled === false ? 'Switch Studio content back on' : 'Switch Studio content off'} onConfirm={(reason) => kill.mutate(reason)}>
      {live?.enabled === false ? 'Clients will fetch the live release again.' : 'Customers will see the bundled app/website defaults until you switch this back on. Admin + verified identity required.'}
    </ReasonDialog>
  </section>;
}

export function ReleasesPanel({ canPublish, isAdmin }: { canPublish: boolean; isAdmin: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const releases = useQuery({ queryKey: ['studio', 'releases'], queryFn: ({ signal }) => listReleases({}, signal) });
  const [selected, setSelected] = useState<Channel[]>(['app', 'web']);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [rollbackTarget, setRollbackTarget] = useState<Release | null>(null);

  const publish = useMutation({
    mutationFn: () => createRelease({ channels: selected, label: label.trim(), ...(note.trim() ? { note: note.trim() } : {}), ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}) }, idempotencyKey),
    onSuccess: () => {
      notice.success(scheduledAt ? 'Release scheduled.' : 'Release published. Customers get it at their next refresh.');
      setLabel(''); setNote(''); setScheduledAt(''); setIdempotencyKey(newKey());
      void queryClient.invalidateQueries({ queryKey: ['studio'] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 422) notice.failure(new ApiError(422, error.code, 'The validation report has blocking errors. Fix them, then publish again.', error.requestId));
      else notice.failure(error);
    },
  });
  const rollback = useMutation({
    mutationFn: (reason: string) => rollbackRelease(rollbackTarget!.id, reason),
    onSuccess: () => { setRollbackTarget(null); notice.success('Rolled back: the older snapshot was published as a new release.'); void queryClient.invalidateQueries({ queryKey: ['studio'] }); },
    onError: (error) => { setRollbackTarget(null); notice.failure(error); },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelRelease(id),
    onSuccess: () => { notice.success('Scheduled release cancelled.'); void queryClient.invalidateQueries({ queryKey: ['studio'] }); },
    onError: notice.failure,
  });

  const labelOk = label.trim().length >= 2 && label.trim().length <= 120;
  return <div className={kit.page}>
    <PageHeader eyebrow="Experience Studio" title="Releases & publishing"
      actions={<Link href="/studio"><Button variant="secondary">Back to Studio</Button></Link>}>
      A release is an immutable snapshot of the draft. Publishing flips the live pointer; rolling back publishes an older snapshot again as a new release.
    </PageHeader>
    {notice.element}
    <div className={kit.split}>{channels.map((channel) => <ChannelPublish key={channel} channel={channel} canPublish={canPublish} isAdmin={isAdmin} />)}</div>

    {canPublish ? <section className={kit.stack} aria-label="Publish a release">
      <h2>Publish a release</h2>
      <p className={kit.muted}>Requires a verified identity (authenticator code). The same request is never applied twice: it carries a single-use idempotency key.</p>
      <fieldset className={kit.toolbar}><legend>Channels</legend>
        {channels.map((channel) => <Checkbox key={channel} label={channel === 'app' ? 'Mobile app' : 'Website'} checked={selected.includes(channel)} onChange={(checked) => setSelected(checked ? [...selected, channel] : selected.filter((item) => item !== channel))} />)}
      </fieldset>
      <Input label="Release label" value={label} maxLength={120} placeholder="e.g. Diwali hero refresh" onChange={(event) => setLabel(event.target.value)} error={label && !labelOk ? 'Use 2–120 characters.' : undefined} />
      <Textarea label="Note (optional)" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
      <Input label="Schedule for (optional)" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} description="Leave empty to publish immediately. Shown in your local time." />
      <div className={kit.actions}>
        <Button loading={publish.isPending} disabled={!labelOk || selected.length === 0} onClick={() => publish.mutate()}>{scheduledAt ? 'Schedule release' : 'Publish now'}</Button>
      </div>
    </section> : <p className={kit.notice}>Your role can review releases but cannot publish them (requires experience:publish).</p>}

    <section className={kit.stack} aria-label="Release history">
      <h2>History</h2>
      <Loadable query={releases} noun="Releases">
        <ul className={kit.rows}>
          {releases.data?.map((release) => <li key={release.id} className={kit.row}>
            <div><strong>{release.channel === 'app' ? 'App' : 'Website'} #{release.number} — {release.label}</strong><br /><small>{release.note ?? 'No note'} · created {formatIst(release.createdAt, { dateStyle: 'medium', timeStyle: 'short' })} IST{release.scheduledAt ? ` · scheduled ${formatIst(release.scheduledAt, { dateStyle: 'medium', timeStyle: 'short' })} IST` : ''}</small></div>
            <div><Badge tone={toneOf(release.status)}>{labelOf(release.status)}</Badge></div>
            <div className={kit.actions}>
              {canPublish && release.status === 'scheduled' ? <Button variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate(release.id)}>Cancel schedule</Button> : null}
              {canPublish && ['superseded', 'rolled_back'].includes(release.status) ? <Button variant="secondary" onClick={() => setRollbackTarget(release)}>Roll back to this</Button> : null}
            </div>
          </li>)}
        </ul>
      </Loadable>
    </section>
    <ReasonDialog open={Boolean(rollbackTarget)} onOpenChange={(open) => { if (!open) setRollbackTarget(null); }} pending={rollback.isPending} title="Roll back to an earlier release" onConfirm={(reason) => rollback.mutate(reason)}>
      {rollbackTarget ? `Re-publish ${rollbackTarget.channel} release #${rollbackTarget.number} (“${rollbackTarget.label}”) as the live release.` : ''}
    </ReasonDialog>
  </div>;
}

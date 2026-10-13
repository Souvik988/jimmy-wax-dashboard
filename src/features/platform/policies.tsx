'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Loadable, PageHeader, kit, labelOf, problemOf, toneOf, useNotice } from '@/components/kit/kit';
import { Badge, Button, Input, Select, Textarea } from '@/components/ui/core';
import { ConfirmDialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { contentKinds, getContent, listContent, publishContent, saveContent } from '@/lib/api/resources/admin-ops';
import { Markdown, unsupportedMarkdown } from '@/lib/markdown';
import { formatIst } from '@/lib/format/time';

/** Suggested legal pages a store normally needs. Creating one is a draft until published. */
export const policyPresets = [
  { slug: 'privacy-policy', title: 'Privacy policy' },
  { slug: 'terms-of-service', title: 'Terms of service' },
  { slug: 'shipping-policy', title: 'Shipping policy' },
  { slug: 'return-refund-policy', title: 'Return and refund policy' },
  { slug: 'cancellation-policy', title: 'Cancellation policy' },
] as const;

export function validSlug(value: string): boolean { return /^[a-z0-9-]{2,60}$/u.test(value); }

type Draft = { slug: string; kind: string; title: string; bodyMd: string; version?: number; isNew: boolean };

export function PoliciesPanel({ canWrite }: { canWrite: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const list = useQuery({ queryKey: ['content', 'list'], queryFn: ({ signal }) => listContent(signal) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [customSlug, setCustomSlug] = useState('');
  const refresh = (): void => { void queryClient.invalidateQueries({ queryKey: ['content'] }); };

  const open = useMutation({
    mutationFn: (slug: string) => getContent(slug),
    onSuccess: (page) => { setDraft({ slug: page.slug, kind: page.kind, title: page.title, bodyMd: page.bodyMd, version: page.version, isNew: false }); setDirty(false); notice.clear(); },
    onError: notice.failure,
  });
  const save = useMutation({
    mutationFn: (value: Draft) => saveContent(value.slug, { kind: value.kind, title: value.title.trim(), bodyMd: value.bodyMd, ...(value.version !== undefined ? { expectedVersion: value.version } : {}) }),
    onSuccess: () => { notice.success('Draft saved. It is not shown to customers until you publish it.'); setDirty(false); refresh(); if (draft) open.mutate(draft.slug); },
    onError: (error) => notice.failure(problemOf(error).conflict ? new ApiError(409, 'CONFLICT', 'Someone else saved a newer version. Reopen this page to see it before saving again.') : error),
  });
  const publish = useMutation({
    mutationFn: (slug: string) => publishContent(slug),
    onSuccess: () => { setConfirmPublish(false); notice.success('Published. Customers see this version now.'); refresh(); },
    onError: (error) => { setConfirmPublish(false); notice.failure(error); },
  });

  const issues = draft ? unsupportedMarkdown(draft.bodyMd) : [];
  const titleOk = draft ? draft.title.trim().length >= 2 && draft.title.trim().length <= 160 : false;
  const bodyOk = draft ? draft.bodyMd.trim().length > 0 && draft.bodyMd.length <= 60_000 : false;
  const existing = new Set(list.data?.map((item) => item.slug));

  return <div className={kit.page}>
    <PageHeader eyebrow="Settings" title="Policy documents">
      Legal and policy pages written in a safe Markdown subset (headings, lists, bold, italic, https links). Saving creates a draft; publishing makes it visible to customers.
    </PageHeader>
    {notice.element}
    <section className={kit.stack} aria-label="Pages">
      <Loadable query={list} noun="Policy pages">
        <ul className={kit.rows}>
          {list.data?.map((item) => <li key={item.slug} className={kit.row}>
            <div><strong>{item.title}</strong><br /><small>{item.slug} · {labelOf(item.kind)} · v{item.version} · {formatIst(item.updatedAt, { dateStyle: 'medium' })}</small></div>
            <div><Badge tone={toneOf(item.status)}>{labelOf(item.status)}</Badge></div>
            <div><Button variant="secondary" loading={open.isPending && open.variables === item.slug} onClick={() => open.mutate(item.slug)}>{canWrite ? 'Edit' : 'View'}</Button></div>
          </li>)}
        </ul>
        {canWrite ? <div className={kit.toolbar}>
          {policyPresets.filter((preset) => !existing.has(preset.slug)).map((preset) => <Button key={preset.slug} variant="secondary" onClick={() => { setDraft({ slug: preset.slug, kind: 'policy', title: preset.title, bodyMd: '', isNew: true }); setDirty(true); notice.clear(); }}>Create “{preset.title}”</Button>)}
          <Input label="Custom page slug" value={customSlug} maxLength={60} onChange={(event) => setCustomSlug(event.target.value.toLowerCase())} error={customSlug && !validSlug(customSlug) ? 'Lowercase letters, digits and hyphens, 2–60 characters.' : undefined} />
          <Button variant="secondary" disabled={!validSlug(customSlug) || existing.has(customSlug)} onClick={() => { setDraft({ slug: customSlug, kind: 'page', title: '', bodyMd: '', isNew: true }); setDirty(true); setCustomSlug(''); }}>Create custom page</Button>
        </div> : null}
      </Loadable>
    </section>

    {draft ? <section className={kit.split} aria-label="Editor">
      <div className={kit.stack}>
        <h2>{draft.isNew ? 'New page' : 'Edit page'} · <code>{draft.slug}</code></h2>
        <Select label="Kind" value={draft.kind} disabled={!canWrite || !draft.isNew} onChange={(event) => { setDraft({ ...draft, kind: event.target.value }); setDirty(true); }}>{contentKinds.map((kind) => <option key={kind} value={kind}>{labelOf(kind)}</option>)}</Select>
        <Input label="Title" value={draft.title} maxLength={160} disabled={!canWrite} onChange={(event) => { setDraft({ ...draft, title: event.target.value }); setDirty(true); }} error={draft.title && !titleOk ? 'Use 2–160 characters.' : undefined} />
        <Textarea label="Body (Markdown)" rows={18} spellCheck value={draft.bodyMd} disabled={!canWrite} onChange={(event) => { setDraft({ ...draft, bodyMd: event.target.value }); setDirty(true); }} description={`${draft.bodyMd.length}/60000 characters`} />
        {issues.map((issue) => <p key={issue} className={kit.notice} role="status">{issue}</p>)}
        {canWrite ? <div className={kit.actions}>
          <Button disabled={!dirty || !titleOk || !bodyOk} loading={save.isPending} onClick={() => save.mutate(draft)}>Save draft</Button>
          <Button variant="secondary" disabled={draft.isNew || dirty} onClick={() => setConfirmPublish(true)}>Publish</Button>
          <Button variant="quiet" onClick={() => { setDraft(null); setDirty(false); }}>Close</Button>
        </div> : null}
        {dirty && !draft.isNew ? <p className={kit.muted}>Unsaved changes — save the draft before publishing.</p> : null}
      </div>
      <section className={kit.stack} aria-label="Preview">
        <h2>Preview</h2>
        <article className={kit.notice}>{draft.title ? <h2>{draft.title}</h2> : null}<Markdown source={draft.bodyMd || '*Nothing to preview yet.*'} /></article>
      </section>
    </section> : null}

    <ConfirmDialog open={confirmPublish} onOpenChange={setConfirmPublish} phrase="publish" pending={publish.isPending} title="Publish this page" onConfirm={() => draft && publish.mutate(draft.slug)}>
      Customers will see the saved draft of “{draft?.title}” immediately. Policy text can have legal effect — have it reviewed first.
    </ConfirmDialog>
  </div>;
}

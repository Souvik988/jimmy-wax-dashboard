'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Loadable, PageHeader, kit, labelOf, problemOf, toneOf, useNotice } from '@/components/kit/kit';
import { Badge, Button, Select } from '@/components/ui/core';
import { ConfirmDialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { type LibraryEntity, type LibraryItem, createLibraryItem, deleteLibraryItem, getVariables, libraryEntities, listLibrary, updateLibraryItem } from '@/lib/api/resources/studio';

import { minimalInstance } from './engine/schema';
import { SchemaForm } from './engine/schema-form';
import { libraryHelp, librarySchemas, titleOf } from './library-schemas';

type Editing = { mode: 'new' } | { mode: 'edit'; id: string; rev: number };

export function LibraryPanel({ entity, canWrite }: { entity: LibraryEntity; canWrite: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [value, setValue] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<LibraryItem | null>(null);
  const schema = librarySchemas[entity];

  const items = useQuery({ queryKey: ['studio', 'library', entity, status], queryFn: ({ signal }) => listLibrary(entity, status || undefined, signal) });
  const variables = useQuery({ queryKey: ['studio', 'variables'], queryFn: ({ signal }) => getVariables(signal), staleTime: 60_000 });
  const refresh = (): void => { void queryClient.invalidateQueries({ queryKey: ['studio', 'library', entity] }); };

  const save = useMutation({
    mutationFn: () => {
      const { rev: _rev, updatedAt: _updated, ...body } = value as Record<string, unknown>;
      const clean = Object.fromEntries(Object.entries(body).filter(([, field]) => field !== null && field !== undefined));
      if (editing?.mode === 'edit') { const { id: _id, ...patch } = clean; return updateLibraryItem(entity, editing.id, patch, editing.rev); }
      return createLibraryItem(entity, clean);
    },
    onSuccess: (saved) => { notice.success(editing?.mode === 'new' ? 'Created. It is used by a channel only after the next published release.' : 'Saved. Channels pick it up at their next release.'); setEditing(null); setErrors({}); refresh(); void saved; },
    onError: (error) => {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      const problem = problemOf(error);
      notice.failure(problem.conflict ? new ApiError(409, 'CONFLICT', 'Someone else changed this entry. Reload it before saving again.', problem.requestId) : error);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteLibraryItem(entity, id),
    onSuccess: () => { setDeleteTarget(null); notice.success('Entry deleted.'); refresh(); },
    onError: (error) => { setDeleteTarget(null); notice.failure(error); },
  });

  const open = (item: LibraryItem): void => {
    const { rev, updatedAt: _u, ...rest } = item as LibraryItem & { rev?: number; updatedAt?: string };
    setValue(Object.fromEntries(Object.entries(rest).filter(([, field]) => field !== null)));
    setEditing({ mode: 'edit', id: item.id, rev: rev ?? 1 });
    setErrors({}); notice.clear();
  };

  return <div className={kit.page}>
    <PageHeader eyebrow="Experience Studio · Content library" title={labelOf(entity)}
      actions={<><Link href="/studio"><Button variant="secondary">Back to Studio</Button></Link>
        <Button disabled={!canWrite} onClick={() => { setValue(minimalInstance(schema) as Record<string, unknown>); setEditing({ mode: 'new' }); setErrors({}); notice.clear(); }}>New entry</Button></>}>
      {libraryHelp[entity]} Entries are shared by the app and the website; editing one changes both channels at their next release.
    </PageHeader>
    <nav aria-label="Content types" className={kit.actions}>
      {libraryEntities.map((name) => <Link key={name} href={`/studio/library/${name}`} aria-current={name === entity ? 'page' : undefined}><Badge tone={name === entity ? 'info' : 'neutral'}>{labelOf(name)}</Badge></Link>)}
    </nav>
    {notice.element}
    <div className={kit.toolbar}>
      <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">All</option><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option>
      </Select>
    </div>
    <div className={editing ? kit.split : undefined}>
      <Loadable query={items} noun="Entries">
        {items.data?.length === 0 ? <p className={kit.notice}>No entries{status ? ` with status “${status}”` : ''} yet.</p> : <ul className={kit.rows} aria-label="Entries">
          {items.data?.map((item) => {
            const itemStatus = String((item as Record<string, unknown>)['status'] ?? 'draft');
            return <li key={item.id} className={kit.row}>
              <div><strong>{titleOf(item)}</strong><br /><small>{item.id}</small></div>
              <div><Badge tone={toneOf(itemStatus)}>{labelOf(itemStatus)}</Badge></div>
              <div className={kit.actions}>
                <Button variant="secondary" onClick={() => open(item)}>{canWrite ? 'Edit' : 'View'}</Button>
                {canWrite ? <Button variant="quiet" onClick={() => setDeleteTarget(item)}>Delete</Button> : null}
              </div>
            </li>;
          })}
        </ul>}
      </Loadable>
      {editing ? <section className={kit.stack} aria-label={editing.mode === 'new' ? 'New entry' : 'Edit entry'}>
        <h2>{editing.mode === 'new' ? 'New entry' : `Edit ${titleOf(value)}`}</h2>
        <SchemaForm schema={schema} value={value} variables={variables.data ?? []} disabled={!canWrite} errors={errors} onChange={(next) => { setValue(next as Record<string, unknown>); setErrors({}); }} />
        <div className={kit.actions}>
          <Button disabled={!canWrite} loading={save.isPending} onClick={() => save.mutate()}>{editing.mode === 'new' ? 'Create entry' : 'Save changes'}</Button>
          <Button variant="secondary" onClick={() => { setEditing(null); setErrors({}); }}>Close</Button>
        </div>
      </section> : null}
    </div>
    <ConfirmDialog open={Boolean(deleteTarget)} onOpenChange={(openState) => { if (!openState) setDeleteTarget(null); }} phrase="delete" pending={remove.isPending} title="Delete this entry" onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}>
      {deleteTarget ? `“${titleOf(deleteTarget)}” will be removed from the library. Blocks that reference it will fail validation until updated.` : ''}
    </ConfirmDialog>
  </div>;
}

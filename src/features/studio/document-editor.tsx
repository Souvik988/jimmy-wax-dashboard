'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ClipboardPaste, Copy, Download, Eye, EyeOff, Plus, Redo2, Trash2, Undo2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { Loadable, PageHeader, kit, problemOf, useNotice } from '@/components/kit/kit';
import { FormDraftNotice, FormLeaveGuard, useFormDraft } from '@/components/forms/draft-protection';
import { Badge, Button, IconButton, Tabs, Textarea } from '@/components/ui/core';
import { ConflictDialog } from '@/components/ui/conflict-dialog';
import { Dialog, ReasonDialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { queryKeys, resourceInvalidation } from '@/lib/api/query-keys';
import {
  type Channel, type StudioDoc, createPreviewToken, deleteDoc, discardDraft, getDoc, listDocs, getPresence, getVariables, heartbeat, listRevisions, putDoc, validateChannel,
} from '@/lib/api/resources/studio';
import { formatIst } from '@/lib/format/time';

import {
  type Block, type PageBody, blockSpecs, blockStyleSchema, blockTitle, duplicateBlock, ensurePage, errorCountsByBlock, moveBlock, newBlock,
  buildStarter, convertBlock, paletteFor, parsePastedBlock, refinementErrors, removeBlock, startersFor, seoSchema, toSaveBody, visibilityRulesSchema, maxBlocks,
} from './doc-model';
import { checkContrast, checkTypeScale } from './contrast';
import { schemaForDoc } from './doc-schemas';
import { SchemaForm } from './engine/schema-form';
import { TokenOverrideEditor } from './token-overrides';
import { type JsonSchema, errorsUnder, inferSchema, validate } from './engine/schema';
import { StudioPreview } from './studio-preview';
import styles from './document-editor.module.css';

type Body = Record<string, unknown>;
type Tab = 'edit' | 'json' | 'revisions' | 'validation' | 'preview';

function downloadJson(name: string, body: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Client-side mirror of the server validator, keyed exactly like the backend's `fields`. */
export function clientErrors(kind: string, body: Body, channel: Channel | 'shared' = 'shared'): Record<string, string> {
  if (kind !== 'page') {
    const schema = schemaForDoc(channel, kind);
    if (!schema) return {};
    const { schemaVersion: _v, ...rest } = body;
    const out: Record<string, string> = {};
    for (const [path, message] of Object.entries(validate(schema, rest))) out[path === '_' ? '' : path] = message;
    return out;
  }
  const out: Record<string, string> = {};
  const blocks = Array.isArray(body['blocks']) ? (body['blocks'] as Block[]) : [];
  blocks.forEach((block, index) => {
    const spec = blockSpecs[block.type];
    if (!spec) { out[`blocks.${index}.type`] = `Unknown block type “${block.type}”. Remove it or migrate its content.`; return; }
    for (const [path, message] of Object.entries({ ...validate(spec.props, block.props ?? {}), ...refinementErrors(block.type, block.props ?? {}) })) out[`blocks.${index}.props${path === '_' || path === '' ? '' : `.${path}`}`] = message;
  });
  return out;
}

function TokenGuardrails({ body, channel }: { body: Body; channel: Channel | 'shared' }): ReactNode {
  const roles = ((body['color'] as { roles?: Record<string, unknown> } | undefined)?.roles ?? {}) as Record<string, unknown>;
  const results = checkContrast(roles).filter((result) => result.ratio !== null);
  const failing = results.filter((result) => !result.pass);
  const typeIssues = checkTypeScale(channel, (body['type'] as { scale?: Record<string, { size?: unknown }> } | undefined)?.scale);
  if (results.length === 0 && typeIssues.length === 0) return null;
  return <section className={styles.single} aria-label="Design guard-rails">
    <h2>Guard-rails</h2>
    <p className={`${kit.notice} ${failing.length + typeIssues.length === 0 ? kit.ok : kit.danger}`} role="status">
      {failing.length + typeIssues.length === 0 ? `All ${results.length} contrast checks pass WCAG 2.2 AA.` : `${failing.length} contrast and ${typeIssues.length} type-size guard-rail(s) fail. The server enforces the same rules on publish.`}
    </p>
    <ul className={kit.rows}>
      {results.map(({ rule, ratio, pass }) => <li key={rule.id} className={kit.row}><span>{rule.label}</span><Badge tone={pass ? 'positive' : 'negative'}>{`${ratio!.toFixed(2)}:1 (min ${rule.minimum})`}</Badge></li>)}
      {typeIssues.map((issue) => <li key={issue.path} className={kit.row}><span>{issue.path}</span><Badge tone="negative">{issue.message}</Badge></li>)}
    </ul>
  </section>;
}

export function DocumentEditor({ channel, kind, docKey, operatorId, canWrite, storefrontOrigin }: { channel: Channel | 'shared'; kind: string; docKey: string; operatorId: string; canWrite: boolean; storefrontOrigin?: string | undefined }): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const docQuery = useQuery({
    queryKey: queryKeys.experience.document(channel, kind, docKey),
    queryFn: async ({ signal }): Promise<StudioDoc | null> => {
      try { return await getDoc(channel, kind, docKey, signal); } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    staleTime: 0,
  });
  const variables = useQuery({ queryKey: ['studio', 'variables'], queryFn: ({ signal }) => getVariables(signal), staleTime: 60_000 });

  const loaded = docQuery.data;
  const etag = loaded?.etag ?? '"0"';
  const baseline = useMemo<Body>(() => (kind === 'page' ? ensurePage(loaded?.body) : (loaded?.body ?? (kind === 'tokens' && channel !== 'shared' ? { schemaVersion: 1, overrides: {} } : { schemaVersion: 1 }))), [kind, loaded, channel]);

  const [draft, setDraft] = useState<Body | null>(null);
  const [past, setPast] = useState<Body[]>([]);
  const [future, setFuture] = useState<Body[]>([]);
  const [tab, setTab] = useState<Tab>('edit');
  const [selected, setSelected] = useState(0);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<{ requestId?: string } | null>(null);
  const [removedBlock, setRemovedBlock] = useState<{ block: Block; index: number } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const body = draft ?? baseline;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(baseline);

  const resource = `studio-${channel}-${kind}-${docKey}`.toLowerCase().replace(/[^a-z0-9-]/gu, '-').slice(0, 110);
  const localDraft = useFormDraft<Body>({
    resource, operatorId, value: body, dirty, sensitive: false,
    parseDraft: (value) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Body) : null),
    onRestore: (restored) => { setDraft(restored); setPast([]); setFuture([]); },
  });

  const edit = useCallback((next: Body) => {
    setPast((history) => [...history.slice(-49), draft ?? baseline]);
    setFuture([]);
    setDraft(next);
    setServerErrors({});
  }, [baseline, draft]);
  const undo = (): void => { const previous = past.at(-1); if (!previous) return; setFuture((f) => [body, ...f]); setPast((p) => p.slice(0, -1)); setDraft(previous); };
  const redo = (): void => { const next = future[0]; if (!next) return; setPast((p) => [...p, body]); setFuture((f) => f.slice(1)); setDraft(next); };

  const errors = useMemo(() => ({ ...clientErrors(kind, body, channel), ...serverErrors }), [kind, body, serverErrors, channel]);
  const blockErrors = useMemo(() => errorCountsByBlock(errors), [errors]);
  const errorCount = Object.keys(errors).length;

  const save = useMutation({
    mutationFn: () => putDoc(channel, kind, docKey, toSaveBody(kind, body), etag),
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKeys.experience.document(channel, kind, docKey), saved);
      for (const key of resourceInvalidation.experienceDocument(channel, kind, docKey)) void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['studio', 'docs', channel] });
      localDraft.discard();
      setDraft(null); setPast([]); setFuture([]); setServerErrors({});
      notice.success(`Saved draft revision ${saved.rev}. It is not live until you publish a release.`);
    },
    onError: (error) => {
      const problem = problemOf(error);
      if (problem.conflict) { setConflict(problem.requestId ? { requestId: problem.requestId } : {}); return; }
      if (error instanceof ApiError && error.fields) { setServerErrors(error.fields); notice.failure(new ApiError(error.status, error.code, `${Object.keys(error.fields).length} field(s) need attention.`, error.requestId)); return; }
      notice.failure(error);
    },
  });

  const docsList = useQuery({ queryKey: ['studio', 'docs', channel], queryFn: ({ signal }) => listDocs(channel, signal), enabled: Boolean(loaded) });
  const differsFromLive = docsList.data?.find((doc) => doc.kind === kind && doc.key === docKey)?.dirtyVsLive === true;
  const [discardOpen, setDiscardOpen] = useState(false);
  const discard = useMutation({
    mutationFn: (reason: string) => discardDraft(channel, kind, docKey, etag, reason),
    onSuccess: (saved) => {
      setDiscardOpen(false);
      queryClient.setQueryData(queryKeys.experience.document(channel, kind, docKey), saved);
      for (const key of resourceInvalidation.experienceDocument(channel, kind, docKey)) void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['studio', 'docs', channel] });
      localDraft.discard();
      setDraft(null); setPast([]); setFuture([]); setServerErrors({});
      notice.success(`The draft now matches the live version (new revision ${saved.rev}). Earlier revisions are kept under Revisions.`);
    },
    onError: (error) => {
      setDiscardOpen(false);
      const problem = problemOf(error);
      if (problem.conflict) { setConflict(problem.requestId ? { requestId: problem.requestId } : {}); return; }
      notice.failure(error);
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteDoc(channel, kind, docKey),
    onSuccess: () => { notice.success('Document deleted from the draft workspace.'); void docQuery.refetch(); void queryClient.invalidateQueries({ queryKey: ['studio', 'docs', channel] }); },
    onError: notice.failure,
  });

  const preview = useMutation({
    mutationFn: () => createPreviewToken('web', 60),
    onSuccess: (result) => {
      const origin = storefrontOrigin?.replace(/\/$/u, '');
      if (origin) window.open(`${origin}/?jw_preview=${encodeURIComponent(result.token)}`, '_blank', 'noopener,noreferrer');
      notice.success(`Draft preview opened for 60 minutes${dirty ? ' (it shows the last SAVED draft, not your unsaved edits)' : ''}. The link is secret until it expires.`);
    },
    onError: notice.failure,
  });
  const validation = useMutation({ mutationFn: () => validateChannel(channel as Channel), onError: notice.failure });
  const revisions = useQuery({ queryKey: queryKeys.experience.revisions(channel, kind, docKey), queryFn: ({ signal }) => listRevisions(channel, kind, docKey, signal), enabled: tab === 'revisions' });

  // Presence: heartbeat every 20 s while a writer is on this document; show everyone else on the same page.
  const presenceKey = kind === 'page' ? docKey : `${kind}-${docKey}`.slice(0, 80);
  const presence = useQuery({ queryKey: ['studio', 'presence', channel], queryFn: ({ signal }) => getPresence(channel as Channel, signal), enabled: channel !== 'shared', refetchInterval: 20_000 });
  useEffect(() => {
    if (!canWrite || channel === 'shared') return;
    const beat = (): void => { void heartbeat(channel, presenceKey).catch(() => undefined); };
    beat();
    const timer = window.setInterval(beat, 20_000);
    return () => window.clearInterval(timer);
  }, [canWrite, channel, presenceKey]);
  const others = (presence.data ?? []).filter((item) => item.pageKey === presenceKey);

  const blocks: Block[] = kind === 'page' ? (body['blocks'] as Block[]) ?? [] : [];
  const setBlocks = (next: Block[]): void => edit({ ...body, blocks: next });
  const palette = channel === 'shared' ? [] : paletteFor(channel, blocks);
  const current = blocks[selected];

  const knownSchema = schemaForDoc(channel, kind);
  const schemaForBody: JsonSchema = useMemo(() => knownSchema ?? inferSchema(Object.fromEntries(Object.entries(body).filter(([name]) => name !== 'schemaVersion'))), [body, knownSchema]);

  const syncJson = (nextTab: Tab): void => {
    if (nextTab === 'json') { setJsonText(JSON.stringify(body, null, 2)); setJsonError(null); }
    setTab(nextTab);
  };
  const applyJson = (): void => {
    try {
      const parsed: unknown = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The document must be a JSON object.');
      edit(parsed as Body); setJsonError(null); setTab('edit');
    } catch (error) { setJsonError(error instanceof Error ? error.message : 'Invalid JSON.'); }
  };
  const importRef = useRef<HTMLInputElement>(null);
  const onImport = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (file.size > 512 * 1024) { notice.failure(new ApiError(400, 'VALIDATION_FAILED', 'Documents must be smaller than 512 KB.')); return; }
    try { const parsed: unknown = JSON.parse(await file.text()); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); edit(parsed as Body); notice.success('Imported into the editor. Review, then save.'); } catch { notice.failure(new ApiError(400, 'VALIDATION_FAILED', 'That file is not a valid JSON document.')); }
  };

  const title = `${kind === 'page' ? 'Page' : kind[0]!.toUpperCase() + kind.slice(1)} · ${docKey}`;
  return <FormLeaveGuard dirty={dirty}>
    <div className={kit.page}>
      <PageHeader eyebrow={`Experience Studio · ${channel === 'app' ? 'Mobile app' : channel === 'web' ? 'Website' : 'Shared'}`} title={title}
        actions={<>
          <Badge tone={channel === 'app' ? 'info' : 'neutral'}>{channel === 'app' ? 'EDITING: APP' : channel === 'web' ? 'EDITING: WEBSITE' : 'SHARED'}</Badge>
          {loaded ? <Badge>{`Draft revision ${loaded.rev}`}</Badge> : <Badge tone="warning">Not created yet</Badge>}
        </>}>
        Changes here are saved as a <strong>draft</strong>. Nothing reaches customers until a release is published.
      </PageHeader>
      <nav aria-label="Studio navigation"><Link href="/studio">← Studio workspace</Link></nav>
      {others.length > 0 ? <p className={`${kit.notice}`} role="status">{others.map((item) => item.label).join(', ')} {others.length === 1 ? 'is' : 'are'} also editing this page. Saving may overwrite their changes — the editor will warn you if a newer revision exists.</p> : null}
      {notice.element}
      <Loadable query={docQuery} noun="Document">
        <FormDraftNotice dirty={dirty} draftAvailable={localDraft.draftAvailable} draftSaved={localDraft.draftSaved} onRestore={() => void localDraft.restore()} onDiscard={localDraft.discard} />
        <div className={styles.toolbar} role="toolbar" aria-label="Document actions">
          <Button disabled={!canWrite || !dirty || save.isPending} loading={save.isPending} onClick={() => save.mutate()}>Save draft</Button>
          <IconButton label="Undo" disabled={!past.length} onClick={undo}><Undo2 size={18} aria-hidden="true" /></IconButton>
          <IconButton label="Redo" disabled={!future.length} onClick={redo}><Redo2 size={18} aria-hidden="true" /></IconButton>
          {channel === 'web' && storefrontOrigin ? <Button variant="secondary" loading={preview.isPending} onClick={() => preview.mutate()}>Preview draft on website</Button> : null}
          <Button variant="secondary" disabled={channel === 'shared'} onClick={() => { validation.mutate(); setTab('validation'); }} loading={validation.isPending}>Validate channel</Button>
          <Button variant="secondary" onClick={() => downloadJson(`${channel}-${kind}-${docKey}.json`, toSaveBody(kind, body))}><Download size={16} aria-hidden="true" />Export</Button>
          <Button variant="secondary" disabled={!canWrite} onClick={() => importRef.current?.click()}><Upload size={16} aria-hidden="true" />Import</Button>
          <input ref={importRef} type="file" accept="application/json,.json" hidden aria-label="Import document JSON" onChange={(event) => { void onImport(event.target.files?.[0]); event.target.value = ''; }} />
          {loaded && canWrite && differsFromLive ? <Button variant="secondary" onClick={() => setDiscardOpen(true)}>Return to live version</Button> : null}
          {loaded && canWrite ? <Button variant="quiet" loading={remove.isPending} onClick={() => { if (window.confirm('Delete this document from the draft workspace? Live releases are not affected, but a release that references it will be refused by the backend.')) remove.mutate(); }}>Delete document</Button> : null}
          {!canWrite ? <Badge tone="warning">Read only — you need experience:write</Badge> : null}
          {errorCount > 0 ? <Badge tone="negative">{`${errorCount} issue${errorCount === 1 ? '' : 's'}`}</Badge> : <Badge tone="positive">No issues found</Badge>}
        </div>

        <Tabs value={tab} onChange={(value) => syncJson(value as Tab)} tabs={[{ id: 'edit', label: 'Edit' }, { id: 'json', label: 'JSON' }, { id: 'revisions', label: 'Revisions', disabled: !loaded }, { id: 'validation', label: 'Validation' }, { id: 'preview', label: 'Preview', disabled: channel === 'shared' || !loaded }]} />

        {tab === 'edit' && kind === 'page' ? <div className={styles.workspace}>
          <aside className={styles.tree} aria-label="Blocks on this page">
            <header><strong>Blocks</strong><span>{blocks.length}/{channel === 'shared' ? 40 : maxBlocks[channel as Channel]}</span></header>
            <ol>
              {blocks.map((block, index) => <li key={block.id} className={index === selected ? styles.active : ''}>
                <button type="button" className={styles.blockButton} aria-current={index === selected} onClick={() => setSelected(index)}>
                  <span>{blockTitle(block.type)}</span>
                  <small>{block.visible ? 'Visible' : 'Hidden'}{blockErrors[index] ? ` · ${blockErrors[index]} issue(s)` : ''}</small>
                </button>
                <span className={styles.rowTools}>
                  <IconButton label={`Move ${blockTitle(block.type)} up`} disabled={!canWrite || index === 0} onClick={() => { setBlocks(moveBlock(blocks, index, index - 1)); setSelected(index - 1); }}><ArrowUp size={14} aria-hidden="true" /></IconButton>
                  <IconButton label={`Move ${blockTitle(block.type)} down`} disabled={!canWrite || index === blocks.length - 1} onClick={() => { setBlocks(moveBlock(blocks, index, index + 1)); setSelected(index + 1); }}><ArrowDown size={14} aria-hidden="true" /></IconButton>
                </span>
              </li>)}
            </ol>
            {blocks.length === 0 ? <div className={kit.stack}>
              <p className={kit.muted}>This page has no blocks yet.</p>
              {channel !== 'shared' && canWrite ? startersFor(channel, docKey).map((layout) => <Button key={layout.id} variant="secondary" onClick={() => { setBlocks(buildStarter(layout.id)); setSelected(0); notice.success(`Started from “${layout.title}”. Fill in the media and copy, then save the draft.`); }}>Start from: {layout.title}</Button>) : null}
            </div> : null}
            <Button variant="secondary" disabled={!canWrite || channel === 'shared'} onClick={() => setPaletteOpen(true)}><Plus size={16} aria-hidden="true" />Add block</Button>
            <Button variant="quiet" disabled={!canWrite} onClick={async () => {
              const result = parsePastedBlock(await navigator.clipboard.readText().catch(() => ''));
              if ('error' in result) { notice.failure(new ApiError(400, 'VALIDATION_FAILED', result.error)); return; }
              setBlocks([...blocks, result.block]); setSelected(blocks.length);
            }}><ClipboardPaste size={16} aria-hidden="true" />Paste block</Button>
          </aside>

          <section className={styles.inspector} aria-label="Block inspector">
            {removedBlock ? <p className={kit.notice} role="status">Removed {blockTitle(removedBlock.block.type)}. <Button variant="quiet" onClick={() => { const next = [...blocks]; next.splice(removedBlock.index, 0, removedBlock.block); setBlocks(next); setSelected(removedBlock.index); setRemovedBlock(null); }}>Undo remove</Button></p> : null}
            {current ? <>
              <header className={styles.inspectorHead}>
                <h2>{blockTitle(current.type)}</h2>
                <div className={kit.actions}>
                  <IconButton label={current.visible ? 'Hide block' : 'Show block'} disabled={!canWrite} onClick={() => setBlocks(blocks.map((block, index) => index === selected ? { ...block, visible: !block.visible } : block))}>{current.visible ? <Eye size={18} aria-hidden="true" /> : <EyeOff size={18} aria-hidden="true" />}</IconButton>
                  <IconButton label="Duplicate block" disabled={!canWrite || blocks.length >= maxBlocks[channel as Channel]} onClick={() => { setBlocks(duplicateBlock(blocks, selected)); setSelected(selected + 1); }}><Copy size={18} aria-hidden="true" /></IconButton>
                  <Button variant="quiet" onClick={() => void navigator.clipboard.writeText(JSON.stringify(current, null, 2)).then(() => notice.success('Block JSON copied.'))}>Copy JSON</Button>
                  {channel !== 'shared' ? <Button variant="quiet" onClick={() => {
                    const target = channel === 'app' ? 'web' : 'app';
                    const result = convertBlock(current, target);
                    if ('error' in result) { notice.failure(new ApiError(400, 'VALIDATION_FAILED', result.error)); return; }
                    void navigator.clipboard.writeText(JSON.stringify(result.block, null, 2)).then(() => notice.success(`Equivalent ${target === 'app' ? 'mobile app' : 'website'} block copied. Open that channel's page and use “Paste block”; it is independent afterwards.`));
                  }}>Copy to {channel === 'app' ? 'Website' : 'App'}</Button> : null}
                  <IconButton label="Delete block" disabled={!canWrite} onClick={() => { const { blocks: next, removed } = removeBlock(blocks, selected); setBlocks(next); if (removed) setRemovedBlock({ block: removed, index: selected }); setSelected(Math.max(0, selected - 1)); }}><Trash2 size={18} aria-hidden="true" /></IconButton>
                </div>
              </header>
              <p className={kit.muted}>Block id <code>{current.id}</code> · {current.type}</p>
              {blockSpecs[current.type]
                ? <SchemaForm schema={blockSpecs[current.type]!.props} value={current.props} variables={variables.data ?? []} disabled={!canWrite}
                    errors={errorsUnder(errors, `blocks.${selected}.props`)}
                    onChange={(props) => setBlocks(blocks.map((block, index) => index === selected ? { ...block, props: props as Record<string, unknown> } : block))} />
                : <p className={`${kit.notice} ${kit.danger}`} role="alert">This block type is not in the current schema. It needs migration — remove it or edit it in the JSON tab.</p>}
              <details className={styles.more}>
                <summary>Visibility rules</summary>
                <SchemaForm schema={visibilityRulesSchema} value={current.rules ?? {}} disabled={!canWrite} errors={errorsUnder(errors, `blocks.${selected}.rules`)} variables={[]}
                  onChange={(rules) => setBlocks(blocks.map((block, index) => index === selected ? { ...block, rules: rules as Record<string, unknown> } : block))} />
              </details>
              <details className={styles.more}>
                <summary>Style</summary>
                <SchemaForm schema={blockStyleSchema} value={current.style ?? {}} disabled={!canWrite} errors={errorsUnder(errors, `blocks.${selected}.style`)} variables={[]}
                  onChange={(style) => setBlocks(blocks.map((block, index) => index === selected ? { ...block, style: style as Record<string, unknown> } : block))} />
              </details>
            </> : <p className={kit.muted}>Select a block, or add one to begin.</p>}
            {channel === 'web' ? <details className={styles.more}>
              <summary>Page title and SEO</summary>
              <SchemaForm schema={{ type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 120 }, seo: seoSchema } }} value={{ title: (body as PageBody).title, seo: (body as PageBody).seo }} disabled={!canWrite} errors={errors}
                onChange={(next) => { const value = next as { title?: string; seo?: Record<string, unknown> }; const { title: _t, seo: _s, ...rest } = body; edit({ ...rest, ...(value.title !== undefined ? { title: value.title } : {}), ...(value.seo !== undefined ? { seo: value.seo } : {}) }); }} />
            </details> : null}
          </section>
        </div> : null}

        {tab === 'edit' && kind === 'tokens' ? <TokenGuardrails body={body} channel={channel} /> : null}

        {tab === 'edit' && kind === 'tokens' && channel !== 'shared' ? <div className={styles.single}>
          <TokenOverrideEditor overrides={(body['overrides'] as Record<string, unknown> | undefined) ?? {}} disabled={!canWrite} onChange={(overrides) => edit({ ...body, schemaVersion: 1, overrides })} />
        </div> : null}

        {tab === 'edit' && kind !== 'page' && !(kind === 'tokens' && channel !== 'shared') ? <div className={styles.single}>
          <p className={kit.muted}>{knownSchema ? 'Fields, limits and options come from the backend document schema; the backend validates again on save.' : 'This document has no published schema, so the form is derived from its current content. The backend still validates every field on save; use the JSON tab for fields not shown.'}</p>
          <SchemaForm schema={schemaForBody} value={Object.fromEntries(Object.entries(body).filter(([name]) => name !== 'schemaVersion'))} variables={variables.data ?? []} disabled={!canWrite} errors={errors}
            onChange={(next) => edit({ ...(next as Body), schemaVersion: 1 })} />
        </div> : null}

        {tab === 'json' ? <div className={styles.single}>
          <Textarea label="Document JSON" value={jsonText} rows={22} spellCheck={false} disabled={!canWrite} error={jsonError ?? undefined} onChange={(event) => setJsonText(event.target.value)} description="Edits apply to the editor only after “Apply JSON”. Unknown keys are rejected by the backend on save." />
          <div className={kit.actions}><Button onClick={applyJson} disabled={!canWrite}>Apply JSON</Button><Button variant="secondary" onClick={() => setJsonText(JSON.stringify(body, null, 2))}>Reset to editor</Button></div>
        </div> : null}

        {tab === 'preview' && channel !== 'shared' ? <div className={styles.single}><StudioPreview channel={channel} storefrontOrigin={storefrontOrigin} unsaved={dirty} /></div> : null}

        {tab === 'revisions' ? <div className={styles.single}>
          <Loadable query={revisions} noun="Revisions">
            {revisions.data?.length === 0 ? <p>No revisions recorded.</p> : <ul className={kit.rows}>
              {revisions.data?.map((revision) => <li key={revision.rev} className={kit.row}>
                <div><strong>Revision {revision.rev}</strong><br /><small>{formatIst(revision.createdAt, { dateStyle: 'medium', timeStyle: 'short' })} IST</small></div>
                <Button variant="secondary" disabled={!canWrite} onClick={() => { edit(kind === 'page' ? ensurePage(revision.body) : revision.body); setTab('edit'); notice.success(`Revision ${revision.rev} loaded as a new unsaved draft. Save to make it the latest revision.`); }}>Restore as new draft</Button>
                <Button variant="quiet" onClick={() => downloadJson(`${channel}-${kind}-${docKey}-rev${revision.rev}.json`, revision.body)}>Export</Button>
              </li>)}
            </ul>}
          </Loadable>
        </div> : null}

        {tab === 'validation' ? <div className={styles.single}>
          {validation.isPending ? <p role="status">Validating the whole {channel} channel…</p> : null}
          {Object.keys(errors).length > 0 ? <section aria-label="Editor issues"><h2>Issues in this document</h2><ul>
            {Object.entries(errors).map(([path, message]) => <li key={path}><button type="button" className={styles.link} onClick={() => { const index = Number(/^blocks\.(\d+)/u.exec(path)?.[1]); if (Number.isFinite(index)) { setSelected(index); setTab('edit'); } }}><code>{path}</code></button> — {message}</li>)}
          </ul></section> : <p className={`${kit.notice} ${kit.ok}`}>No client-side issues in this document.</p>}
          {validation.data ? <section aria-label="Channel validation report">
            <h2>Channel report <small>{formatIst(validation.data.checkedAt, { timeStyle: 'short' })} IST</small></h2>
            <p className={`${kit.notice} ${validation.data.canPublish ? kit.ok : kit.danger}`}>{validation.data.canPublish ? 'The channel can be published.' : 'The channel cannot be published until errors are fixed.'}</p>
            {[...validation.data.errors.map((issue) => ({ issue, tone: 'negative' as const })), ...validation.data.warnings.map((issue) => ({ issue, tone: 'warning' as const }))].map(({ issue, tone }, index) =>
              <p key={index} className={kit.row}><Badge tone={tone}>{issue.level}</Badge><span>{issue.message}{issue.docKey ? ` (${issue.docKey}${issue.path ? ` · ${issue.path}` : ''})` : ''}</span></p>)}
            {validation.data.errors.length + validation.data.warnings.length === 0 ? <p>No errors or warnings.</p> : null}
          </section> : null}
        </div> : null}
      </Loadable>

      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen} title="Add a block">
        <p className={kit.muted}>Only blocks allowed on the {channel === 'app' ? 'mobile app' : 'website'} are listed. Some may need a newer app build before customers see them.</p>
        <ul className={styles.palette}>
          {palette.map((entry) => <li key={entry.type}>
            <button type="button" disabled={Boolean(entry.disabledReason)} onClick={() => { const block = newBlock(entry.type); setBlocks([...blocks, block]); setSelected(blocks.length); setPaletteOpen(false); }}>
              <strong>{entry.title}</strong><small>{entry.disabledReason ?? entry.type}</small>
            </button>
          </li>)}
        </ul>
      </Dialog>

      <ReasonDialog open={discardOpen} onOpenChange={setDiscardOpen} pending={discard.isPending} title="Return this draft to the live version" onConfirm={(reason) => discard.mutate(reason)}>
        Your draft is replaced by what customers see now, saved as a new revision. Unsaved edits on this screen are lost; earlier revisions stay available under Revisions. Your reason is saved in the audit log.
      </ReasonDialog>
      <ConflictDialog open={Boolean(conflict)} onOpenChange={(open) => { if (!open) setConflict(null); }} strategy="if-match" {...(conflict?.requestId ? { requestId: conflict.requestId } : {})}
        fields={[{ path: `${kind}:${docKey}`, before: `revision ${loaded?.rev ?? 0}`, latest: 'A newer revision exists on the server', draft: `${blocks.length} block(s) / unsaved edits` }]}
        onReload={() => { setConflict(null); setDraft(null); setPast([]); setFuture([]); void docQuery.refetch(); }}
        onMerge={() => { setConflict(null); void docQuery.refetch().then(() => notice.success('Latest revision loaded; your edits are kept. Saving now replaces the newer revision — review first.')); }} />
    </div>
  </FormLeaveGuard>;
}

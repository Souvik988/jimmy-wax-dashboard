'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, FolderTree, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge, Button, Input, Switch, Textarea } from '@/components/ui/core';
import { ConfirmDialog, Dialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { deleteCategory, reorderCategories, updateCategory, type Category, type CategoryPatchInput } from '@/lib/api/resources/catalog';

import styles from './catalog-taxonomy.module.css';

type Blocker = { type: string; id: string; label: string; archived?: boolean };
type Draft = { name: string; description: string; seoTitle: string; seoDescription: string; active: boolean };

function draftFrom(category: Category): Draft {
  return { name: category.name, description: category.description, seoTitle: category.seoTitle ?? '', seoDescription: category.seoDescription ?? '', active: category.active };
}

/** Only the fields that differ from the loaded record are sent, together with the revision that was loaded. */
export function buildCategoryPatch(category: Category, draft: Draft): CategoryPatchInput | null {
  const patch: CategoryPatchInput = { expectedRev: category.rev };
  const seoTitle = draft.seoTitle.trim() || null;
  const seoDescription = draft.seoDescription.trim() || null;
  if (draft.name.trim() !== category.name) patch.name = draft.name.trim();
  if (draft.description.trim() !== category.description) patch.description = draft.description.trim();
  if (seoTitle !== category.seoTitle) patch.seoTitle = seoTitle;
  if (seoDescription !== category.seoDescription) patch.seoDescription = seoDescription;
  if (draft.active !== category.active) patch.active = draft.active;
  return Object.keys(patch).length > 1 ? patch : null;
}

function blockersFrom(error: ApiError): Blocker[] {
  return (error.lines ?? []).filter((line): line is Blocker => typeof line === 'object' && line !== null && 'label' in line && 'type' in line).slice(0, 50);
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return `${error.message}${error.requestId ? ` (Request ID: ${error.requestId})` : ''}`;
  return 'The change did not complete. Refresh and check the category list before trying again.';
}

export function CategoryList({ categories, canWrite }: { categories: Category[]; canWrite: boolean }): React.ReactNode {
  const queryClient = useQueryClient();
  const [order, setOrder] = useState<string[] | null>(null);
  const [editing, setEditing] = useState<Category | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');

  const rows = useMemo(() => {
    if (!order) return categories;
    const byId = new Map(categories.map((category) => [category.id, category]));
    const arranged = order.map((id) => byId.get(id)).filter((category): category is Category => Boolean(category));
    return arranged.length === categories.length ? arranged : categories;
  }, [categories, order]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.catalog.categories });

  const edit = useMutation({
    mutationFn: ({ category, patch }: { category: Category; patch: CategoryPatchInput }) => updateCategory(category.id, patch),
    retry: false,
    onSuccess: async (category) => { setEditing(null); setProblem(''); setMessage(`Saved ${category.name}.`); await refresh(); },
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'CART_VERSION_CONFLICT') {
        setEditing(null);
        setMessage('');
        setProblem('This category changed while you were editing it. The latest copy has been loaded; open it again and review your change.');
        await refresh();
        return;
      }
      setProblem(describe(error));
    },
  });

  const reorder = useMutation({
    mutationFn: ({ ids }: { ids: string[] }) => reorderCategories(ids, Object.fromEntries(categories.map((category) => [category.id, category.rev]))),
    retry: false,
    onSuccess: async () => { setOrder(null); setProblem(''); setMessage('Category order saved.'); await refresh(); },
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'CART_VERSION_CONFLICT') {
        setOrder(null);
        setMessage('');
        setProblem('Another operator changed the categories while you were arranging them. The latest order has been loaded; arrange them again.');
        await refresh();
        return;
      }
      setProblem(describe(error));
    },
  });

  const remove = useMutation({
    mutationFn: (category: Category) => deleteCategory(category.id),
    retry: false,
    onSuccess: async (_value, category) => { setDeleting(null); setBlockers([]); setProblem(''); setMessage(`Deleted ${category.name}.`); await refresh(); },
    onError: async (error) => {
      setDeleting(null);
      if (error instanceof ApiError && error.code === 'ILLEGAL_STATE') {
        setBlockers(blockersFrom(error));
        setMessage('');
        setProblem(`Not deleted: products still use this category${error.requestId ? ` (Request ID: ${error.requestId})` : ''}. Move them to another category first.`);
        await refresh();
        return;
      }
      setProblem(describe(error));
    },
  });

  const move = (index: number, direction: -1 | 1) => {
    const ids = rows.map((category) => category.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    setOrder(ids);
    setMessage('');
  };

  const startEdit = (category: Category) => { setEditing(category); setDraft(draftFrom(category)); setProblem(''); setMessage(''); };
  const patch = editing && draft ? buildCategoryPatch(editing, draft) : null;
  const nameValid = !draft || (draft.name.trim().length >= 2 && draft.name.trim().length <= 80);
  const orderChanged = order !== null && order.some((id, index) => id !== categories[index]?.id);

  return <>
    {message ? <p className={styles.success} role="status">{message}</p> : null}
    {problem ? <div className={styles.errorPanel} role="alert"><p>{problem}</p>
      {blockers.length ? <ul aria-label="Products that block deleting this category">{blockers.map((blocker) => <li key={`${blocker.type}:${blocker.id}`}>{blocker.label} <code>{blocker.id}</code>{blocker.archived ? ' · archived' : ''}</li>)}</ul> : null}
    </div> : null}
    {orderChanged ? <div className={styles.orderBar} role="status">
      <span>The new order is not saved yet.</span>
      <Button size="sm" variant="secondary" onClick={() => setOrder(null)}>Discard order change</Button>
      <Button size="sm" loading={reorder.isPending} onClick={() => reorder.mutate({ ids: rows.map((category) => category.id) })}>Save category order</Button>
    </div> : null}
    <ul className={styles.categoryList}>
      {rows.map((category, index) => {
        const inUse = (category.productCount ?? 0) + (category.archivedProductCount ?? 0);
        return <li key={category.id}>
          <span className={styles.rowIcon} aria-hidden="true"><FolderTree size={18} /></span>
          <div className={styles.recordName}><h3>{category.name}</h3><code>{category.id} · revision {category.rev}</code><p>{category.description || 'No description supplied'}</p></div>
          <div className={styles.recordMeta}>
            <Badge tone={category.active ? 'positive' : 'neutral'}>{category.active ? 'Active' : 'Inactive'}</Badge>
            <span>{category.productCount ?? '—'} live products{category.archivedProductCount ? ` · ${category.archivedProductCount} archived` : ''}</span>
            <span>Position {index + 1}</span>
            {canWrite ? <span className={styles.rowActions}>
              <Button variant="quiet" size="sm" aria-label={`Move ${category.name} up`} disabled={index === 0 || reorder.isPending} onClick={() => move(index, -1)}><ArrowUp size={15} aria-hidden="true" /></Button>
              <Button variant="quiet" size="sm" aria-label={`Move ${category.name} down`} disabled={index === rows.length - 1 || reorder.isPending} onClick={() => move(index, 1)}><ArrowDown size={15} aria-hidden="true" /></Button>
              <Button variant="secondary" size="sm" aria-label={`Edit ${category.name}`} onClick={() => startEdit(category)}><Pencil size={14} aria-hidden="true" />Edit</Button>
              <Button variant="danger" size="sm" aria-label={`Delete ${category.name}`} disabled={inUse > 0} title={inUse > 0 ? 'Move every product, archived ones too, to another category first.' : undefined} onClick={() => { setBlockers([]); setProblem(''); setMessage(''); setDeleting(category); }}><Trash2 size={14} aria-hidden="true" />Delete</Button>
            </span> : null}
          </div>
        </li>;
      })}
    </ul>

    <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }} title={editing ? `Edit ${editing.name}` : 'Edit category'} footer={<>
      <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
      <Button loading={edit.isPending} disabled={!patch || !nameValid} onClick={() => { if (editing && patch) edit.mutate({ category: editing, patch }); }}>Save changes</Button>
    </>}>
      {editing && draft ? <div className={styles.formGrid}>
        <p className={styles.helper}>Saving sends only the fields you changed together with revision {editing.rev}. If someone else saved first, nothing is overwritten.</p>
        <Input label="Category name" value={draft.name} maxLength={80} required onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <Textarea label="Description" value={draft.description} maxLength={500} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        <Input label="SEO title" value={draft.seoTitle} maxLength={120} onChange={(event) => setDraft({ ...draft, seoTitle: event.target.value })} />
        <Textarea label="SEO description" value={draft.seoDescription} maxLength={320} onChange={(event) => setDraft({ ...draft, seoDescription: event.target.value })} />
        <Switch label="Active" checked={draft.active} onChange={(active) => setDraft({ ...draft, active })} />
        {!editing.active || draft.active ? null : <p className={styles.warning}>Deactivating hides this category from the storefront.</p>}
      </div> : null}
    </Dialog>

    <ConfirmDialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }} phrase="DELETE CATEGORY" title={deleting ? `Delete ${deleting.name}` : 'Delete category'} pending={remove.isPending} onConfirm={() => { if (deleting) remove.mutate(deleting); }}>
      This permanently removes the category. The backend refuses if any product, archived ones included, still uses it.
    </ConfirmDialog>
  </>;
}

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { kit, useNotice } from '@/components/kit/kit';
import { Button, IconButton, Input } from '@/components/ui/core';
import { Dialog, ReasonDialog } from '@/components/ui/overlays';
import { archiveProduct, duplicateProduct, getProduct, restoreProduct, setProductMedia } from '@/lib/api/resources/catalog';
import { localMediaUrl } from '@/lib/api/resources/media-validation';
import { queryKeys, resourceInvalidation } from '@/lib/api/query-keys';
import { MediaBrowser } from '@/features/studio/engine/schema-form';

type Item = { mediaId: string; alt: string; assetPath?: string };
export const maxGallery = 12;

/** Pure: list edits used by the gallery (kept separate so the rules are unit-tested). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}
export function galleryProblems(items: readonly Item[]): string[] {
  const problems: string[] = [];
  if (items.length > maxGallery) problems.push(`A product can have at most ${maxGallery} images.`);
  items.forEach((item, index) => { if (!item.alt.trim()) problems.push(`Image ${index + 1} needs alt text.`); if (item.alt.length > 200) problems.push(`Image ${index + 1}: alt text is longer than 200 characters.`); });
  if (new Set(items.map((item) => item.mediaId)).size !== items.length) problems.push('The same image is listed twice.');
  return problems;
}

export function ProductExtras({ id, canWrite }: { id: string; canWrite: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const router = useRouter();
  const notice = useNotice();
  const product = useQuery({ queryKey: queryKeys.catalog.product(id), queryFn: ({ signal }) => getProduct(id, signal) });
  const [items, setItems] = useState<Item[] | null>(null);
  const [browse, setBrowse] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [newId, setNewId] = useState('');

  const saved: Item[] = (product.data?.media ?? []).map((media) => ({ mediaId: media.mediaId ?? '', alt: media.alt, assetPath: media.assetPath }));
  const current = items ?? saved;
  const dirty = items !== null && JSON.stringify(items.map(({ mediaId, alt }) => ({ mediaId, alt }))) !== JSON.stringify(saved.map(({ mediaId, alt }) => ({ mediaId, alt })));
  const problems = galleryProblems(current);
  const hasLegacy = current.some((item) => !item.mediaId);

  const save = useMutation({
    mutationFn: () => setProductMedia(id, current.map(({ mediaId, alt }) => ({ mediaId, alt: alt.trim() }))),
    onSuccess: () => { notice.success('Gallery saved.'); setItems(null); for (const key of resourceInvalidation.catalog) void queryClient.invalidateQueries({ queryKey: key as readonly unknown[] }); },
    onError: notice.failure,
  });
  const duplicate = useMutation({
    mutationFn: () => duplicateProduct(id, newId.trim() || undefined),
    onSuccess: (copy) => { setDuplicateOpen(false); void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all }); router.push(`/products/${copy.id}`); },
    onError: (error) => { setDuplicateOpen(false); notice.failure(error); },
  });

  const lifecycle = useMutation({
    mutationFn: (reason: string) => (product.data!.archived
      ? restoreProduct(id, { expectedVersion: product.data!.version, reason })
      : archiveProduct(id, { expectedVersion: product.data!.version, reason })),
    onSuccess: (updated) => {
      setLifecycleOpen(false);
      notice.success(updated.archived ? 'Product archived: hidden from the storefront and deactivated. It can be restored.' : 'Product restored. It stays inactive until you activate it.');
      queryClient.setQueryData(queryKeys.catalog.product(id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all });
      router.refresh();
    },
    onError: (error) => { setLifecycleOpen(false); notice.failure(error); void product.refetch(); },
  });

  if (!product.data) return null;
  return <section className={kit.stack} aria-label="Product images and copy">
    <h2>Gallery</h2>
    {notice.element}
    <p className={kit.muted}>Only approved, non-archived images from the Media library can be attached. Alt text is required for every image. The first image is the main picture.</p>
    {hasLegacy ? <p className={kit.notice}>Some images were attached before the media library existed (no media id). Saving replaces the gallery with library images only, so they would be dropped — add their library equivalents first.</p> : null}
    {current.length === 0 ? <p className={kit.notice}>No images attached.</p> : <ol className={kit.rows}>
      {current.map((item, index) => {
        const src = item.assetPath ? localMediaUrl(item.assetPath) : null;
        return <li key={`${item.mediaId}-${index}`} className={kit.row}>
          <div>{/* eslint-disable-next-line @next/next/no-img-element -- content-addressed local media proxy */}
          {src ? <img src={src} alt="" width={64} height={64} loading="lazy" /> : <code>{item.mediaId || 'legacy image'}</code>}</div>
          <Input label={`Alt text for image ${index + 1}`} value={item.alt} maxLength={200} disabled={!canWrite} onChange={(event) => setItems(current.map((entry, position) => position === index ? { ...entry, alt: event.target.value } : entry))} />
          <div className={kit.actions}>
            <IconButton label={`Move image ${index + 1} up`} disabled={!canWrite || index === 0} onClick={() => setItems(moveItem(current, index, index - 1))}><ArrowUp size={16} aria-hidden="true" /></IconButton>
            <IconButton label={`Move image ${index + 1} down`} disabled={!canWrite || index === current.length - 1} onClick={() => setItems(moveItem(current, index, index + 1))}><ArrowDown size={16} aria-hidden="true" /></IconButton>
            <IconButton label={`Remove image ${index + 1}`} disabled={!canWrite} onClick={() => setItems(current.filter((_, position) => position !== index))}><Trash2 size={16} aria-hidden="true" /></IconButton>
          </div>
        </li>;
      })}
    </ol>}
    {problems.map((problem) => <p key={problem} className={`${kit.notice} ${kit.danger}`} role="alert">{problem}</p>)}
    {canWrite ? <div className={kit.actions}>
      <Button variant="secondary" disabled={current.length >= maxGallery} onClick={() => setBrowse(true)}>Add image from library</Button>
      <Button disabled={!dirty || problems.length > 0 || hasLegacy} loading={save.isPending} onClick={() => save.mutate()}>Save gallery</Button>
      <Button variant="quiet" disabled={!dirty} onClick={() => setItems(null)}>Discard changes</Button>
      <Button variant="secondary" onClick={() => setDuplicateOpen(true)}>Duplicate product</Button>
      <Button variant={product.data.archived ? 'secondary' : 'danger'} onClick={() => setLifecycleOpen(true)}>{product.data.archived ? 'Restore product' : 'Archive product'}</Button>
    </div> : null}
    <ReasonDialog open={lifecycleOpen} onOpenChange={setLifecycleOpen} pending={lifecycle.isPending} title={product.data.archived ? 'Restore this product' : 'Archive this product'} onConfirm={(reason) => lifecycle.mutate(reason)}>
      {product.data.archived
        ? 'The product returns to the catalogue list but stays inactive until you activate it. Your reason is saved in the audit log.'
        : 'The product is deactivated and hidden from the storefront. Orders keep their snapshots; nothing is deleted and it can be restored. Your reason is saved in the audit log.'}
    </ReasonDialog>
    {browse ? <MediaBrowser open={browse} onOpenChange={setBrowse} onPick={(media) => { setItems([...current, { mediaId: media.id, alt: media.alt || '' }]); }} /> : null}
    <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen} title="Duplicate this product" footer={<><Button variant="secondary" onClick={() => setDuplicateOpen(false)}>Cancel</Button><Button loading={duplicate.isPending} onClick={() => duplicate.mutate()}>Create inactive copy</Button></>}>
      <p>A new inactive copy is created (its variants start at zero stock). Choose its id below or leave it empty to let the backend choose one.</p>
      <Input label="New product id (optional)" value={newId} maxLength={100} onChange={(event) => setNewId(event.target.value.toLowerCase())} />
    </Dialog>
  </section>;
}

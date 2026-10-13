'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/core';
import { ReasonDialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { deleteCollection, type Collection } from '@/lib/api/resources/catalog';

export type CollectionDeleteResult =
  | { kind: 'deleted'; message: string }
  | { kind: 'blocked'; message: string; blockers: Array<{ type: string; id: string; label: string }> }
  | { kind: 'problem'; message: string };

function blockersFrom(error: ApiError): Array<{ type: string; id: string; label: string }> {
  return (error.lines ?? []).filter((line): line is { type: string; id: string; label: string } => typeof line === 'object' && line !== null && 'label' in line && 'type' in line).slice(0, 50);
}

/**
 * Deleting needs the revision that was loaded and a reason. The backend refuses (409 ILLEGAL_STATE with `error.lines`) while a Studio draft, a live
 * release or a campaign still points at the collection, and answers a stale revision with 409 CART_VERSION_CONFLICT.
 */
export function CollectionDelete({ collection, onResult }: { collection: Collection; onResult: (result: CollectionDeleteResult) => void }): React.ReactNode {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: (reason: string) => deleteCollection(collection.id, { expectedRev: collection.rev, reason }),
    retry: false,
    onSuccess: async () => {
      setOpen(false);
      onResult({ kind: 'deleted', message: `Deleted ${collection.name}.` });
      await queryClient.invalidateQueries({ queryKey: queryKeys.catalog.collections });
    },
    onError: async (error) => {
      setOpen(false);
      if (error instanceof ApiError && error.code === 'ILLEGAL_STATE') {
        onResult({ kind: 'blocked', message: `${collection.name} was not deleted: it is still used${error.requestId ? ` (Request ID: ${error.requestId})` : ''}. Remove these references first.`, blockers: blockersFrom(error) });
      } else if (error instanceof ApiError && error.code === 'CART_VERSION_CONFLICT') {
        onResult({ kind: 'problem', message: `${collection.name} changed while you were looking at it. The latest revision has been loaded; review it and try again.` });
        await queryClient.invalidateQueries({ queryKey: queryKeys.catalog.collections });
      } else {
        onResult({ kind: 'problem', message: error instanceof ApiError ? `${error.message}${error.requestId ? ` (Request ID: ${error.requestId})` : ''}` : 'The delete did not complete. Refresh the list before trying again.' });
      }
    },
  });
  return <>
    <Button variant="danger" size="sm" aria-label={`Delete ${collection.name}`} onClick={() => setOpen(true)}><Trash2 size={14} aria-hidden="true" />Delete</Button>
    <ReasonDialog open={open} onOpenChange={setOpen} title={`Delete ${collection.name}`} pending={remove.isPending} onConfirm={(reason) => remove.mutate(reason)}>
      Deleting removes the collection permanently. The backend refuses if a Studio draft, a live release or a campaign still points at it, and lists what to change first. The reason is stored in the audit log.
    </ReasonDialog>
  </>;
}

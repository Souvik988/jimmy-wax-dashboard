'use client';

import { Button } from './core';
import { Dialog } from './overlays';
import { conflictActions, type ConcurrencyStrategy } from '@/lib/api/conflicts';

export type ConflictField = { path: string; before: string; latest: string; draft: string };

export function ConflictDialog({
  open,
  onOpenChange,
  strategy,
  fields,
  requestId,
  onReload,
  onMerge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategy: ConcurrencyStrategy;
  fields: ConflictField[];
  requestId?: string;
  onReload: () => void;
  onMerge?: () => void;
}): React.ReactNode {
  const actions = conflictActions(strategy);
  return <Dialog open={open} onOpenChange={onOpenChange} title="This changed while you were editing" dismissible={false} footer={<>
    <Button variant="secondary" onClick={onReload}>Reload latest version</Button>
    {actions.includes('merge') && onMerge ? <Button onClick={onMerge}>Review and merge my changes</Button> : null}
  </>}>
    <p>The backend rejected this save before applying it. Review the latest values below; nothing was overwritten.</p>
    <div role="table" aria-label="Changed fields">
      <div role="row"><strong role="columnheader">Field</strong><strong role="columnheader">Latest saved value</strong><strong role="columnheader">Your unsaved draft</strong></div>
      {fields.map((field) => <div role="row" key={field.path}>
        <span role="cell">{field.path}</span>
        <span role="cell"><strong>Current</strong> {field.latest || '—'}</span>
        <span role="cell"><strong>Your edit</strong> {field.draft || '—'}</span>
      </div>)}
    </div>
    {strategy === 'none' ? <p>This endpoint has no version guard, so the safe choice is to reload before trying again.</p> : null}
    <p>There is no automatic retry. {requestId ? `Request ID: ${requestId}` : 'Keep the unsaved draft in this tab until you choose.'}</p>
  </Dialog>;
}

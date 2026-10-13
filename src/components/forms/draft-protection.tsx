'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/core';
import { Dialog } from '@/components/ui/overlays';
import { browserStorage, notifyBrowserStorageChanged, subscribeBrowserStorage } from '@/lib/api/browser-storage';
import { discardDraft, draftStorageKey, hasSavedDraft, readDraft, saveDraft } from '@/lib/api/drafts';

export type FormDraftOptions<T> = {
  resource: string;
  operatorId: string;
  value: T;
  dirty: boolean;
  parseDraft: (value: unknown) => T | null;
  sensitive?: boolean;
  delayMs?: number;
  onRestore: (value: T) => void;
};

export function useFormDraft<T>({
  resource,
  operatorId,
  value,
  dirty,
  parseDraft,
  sensitive = true,
  delayMs = 750,
  onRestore,
}: FormDraftOptions<T>) {
  const [lastSavedKey, setLastSavedKey] = useState<string | null>(null);
  const storageKey = draftStorageKey(resource, operatorId);
  const getDraftSnapshot = useCallback(() => {
    if (sensitive) return false;
    const storage = browserStorage();
    return Boolean(storage && hasSavedDraft(storage, resource, operatorId));
  }, [operatorId, resource, sensitive]);
  const draftAvailable = useSyncExternalStore(subscribeBrowserStorage, getDraftSnapshot, () => false);
  const draftSaved = draftAvailable && lastSavedKey === storageKey;

  useEffect(() => {
    if (!dirty || sensitive) return;
    const timer = window.setTimeout(() => {
      const storage = browserStorage();
      const saved = Boolean(storage && saveDraft(storage, resource, operatorId, value, { safeToPersist: !sensitive }));
      if (saved) {
        setLastSavedKey(storageKey);
        notifyBrowserStorageChanged();
      }
    }, Math.min(Math.max(delayMs, 250), 5_000));
    return () => window.clearTimeout(timer);
  }, [delayMs, dirty, operatorId, resource, sensitive, storageKey, value]);

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty]);

  const restore = useCallback((): boolean => {
    if (sensitive) return false;
    const storage = browserStorage();
    const stored = storage ? readDraft<unknown>(storage, resource, operatorId) : null;
    const saved = stored === null ? null : parseDraft(stored);
    if (stored !== null && saved === null && storage) {
      discardDraft(storage, resource, operatorId);
      setLastSavedKey(null);
      notifyBrowserStorageChanged();
    }
    if (saved === null) return false;
    onRestore(saved);
    setLastSavedKey(storageKey);
    return true;
  }, [onRestore, operatorId, parseDraft, resource, sensitive, storageKey]);

  const discard = useCallback(() => {
    const storage = browserStorage();
    if (storage) discardDraft(storage, resource, operatorId);
    setLastSavedKey(null);
    notifyBrowserStorageChanged();
  }, [operatorId, resource]);

  return { draftAvailable, draftSaved, restore, discard, canPersist: !sensitive } as const;
}

export function FormDraftNotice({
  dirty,
  draftAvailable,
  draftSaved,
  canPersist = true,
  onRestore,
  onDiscard,
}: {
  dirty: boolean;
  draftAvailable: boolean;
  draftSaved: boolean;
  canPersist?: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}): ReactNode {
  if (!dirty && !draftAvailable) return null;
  return <section className="form-draft-notice" aria-label="Unsaved changes and saved draft">
    <p role="status" aria-live="polite">
      {dirty ? 'Unsaved changes. ' : ''}
      {canPersist ? draftSaved ? 'A draft is saved on this device for your operator account.' : 'A safe draft will be saved on this device after a short pause.' : 'For security, this form is not saved on this device.'}
    </p>
    {draftAvailable && !dirty ? <Button variant="secondary" onClick={onRestore}>Restore saved draft</Button> : null}
    {draftAvailable ? <Button variant="quiet" onClick={onDiscard}>Discard saved draft</Button> : null}
  </section>;
}

export function FormLeaveGuard({ dirty, children }: { dirty: boolean; children: ReactNode }): ReactNode {
  const router = useRouter();
  const [destination, setDestination] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const interceptLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const target = new URL(link.href, window.location.href);
      if (target.origin !== window.location.origin) return;
      const current = new URL(window.location.href);
      if (target.pathname === current.pathname && target.search === current.search) return;
      event.preventDefault();
      event.stopPropagation();
      setDestination(`${target.pathname}${target.search}${target.hash}`);
    };
    document.addEventListener('click', interceptLink, true);
    return () => {
      document.removeEventListener('click', interceptLink, true);
    };
  }, [dirty]);

  const stay = () => setDestination(null);
  const leave = () => {
    if (!destination) return;
    const safeDestination = destination.startsWith('/') && !destination.startsWith('//') ? destination : '/';
    setDestination(null);
    router.push(safeDestination);
  };

  return <>
    {children}
    <Dialog
      open={destination !== null}
      onOpenChange={(open) => { if (!open) stay(); }}
      title="Leave without saving?"
      footer={<>
        <Button variant="secondary" onClick={stay}>Stay on this page</Button>
        <Button variant="danger" onClick={leave}>Leave without saving</Button>
      </>}
    >
      <p>Your unsaved changes may be lost. If this form contains sensitive information, it is not stored on this device.</p>
    </Dialog>
  </>;
}


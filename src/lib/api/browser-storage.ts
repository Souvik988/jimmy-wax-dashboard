'use client';

import { invalidateDraftAvailabilityCache } from './drafts';

export function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export function subscribeBrowserStorage(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = () => {
    invalidateDraftAvailabilityCache();
    onChange();
  };
  window.addEventListener('storage', listener);
  window.addEventListener('jw:dashboard-storage', listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener('jw:dashboard-storage', listener);
  };
}

export function notifyBrowserStorageChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('jw:dashboard-storage'));
}

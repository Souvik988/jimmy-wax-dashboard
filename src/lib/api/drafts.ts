const DRAFT_VERSION = 1;
const availabilityCache = new Map<string, boolean>();

export function draftStorageKey(resource: string, operatorId: string): string {
  if (!/^[a-z][a-z0-9-]{0,119}$/u.test(resource) || !/^[A-Za-z0-9_-]{1,100}$/u.test(operatorId)) throw new TypeError('Invalid draft scope.');
  return `jw:draft:v${DRAFT_VERSION}:${resource}:${operatorId}`;
}

export function saveDraft(storage: Pick<Storage, 'setItem'>, resource: string, operatorId: string, value: unknown, options: { safeToPersist?: boolean } = {}): boolean {
  if (options.safeToPersist !== true) return false;
  try { storage.setItem(draftStorageKey(resource, operatorId), JSON.stringify({ version: DRAFT_VERSION, value })); invalidateDraftAvailabilityCache(); return true; } catch { return false; }
}

export function readDraft<T>(storage: Pick<Storage, 'getItem'>, resource: string, operatorId: string): T | null {
  try {
    const raw = storage.getItem(draftStorageKey(resource, operatorId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('version' in parsed) || !('value' in parsed) || parsed.version !== DRAFT_VERSION) return null;
    return parsed.value as T;
  } catch { return null; }
}

export function hasSavedDraft(storage: Pick<Storage, 'getItem'>, resource: string, operatorId: string): boolean {
  const key = draftStorageKey(resource, operatorId);
  const cached = availabilityCache.get(key);
  if (cached !== undefined) return cached;
  const available = readDraft(storage, resource, operatorId) !== null;
  availabilityCache.set(key, available);
  return available;
}

export function invalidateDraftAvailabilityCache(): void {
  availabilityCache.clear();
}

export function discardDraft(storage: Pick<Storage, 'removeItem'>, resource: string, operatorId: string): boolean {
  try { storage.removeItem(draftStorageKey(resource, operatorId)); invalidateDraftAvailabilityCache(); return true; } catch { return false; }
}

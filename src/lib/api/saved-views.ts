import { z } from 'zod';

const viewSchema = z.object({
  version: z.literal(1),
  columns: z.array(z.string().max(60)).max(60),
  density: z.enum(['compact', 'regular', 'comfortable']),
  filters: z.record(z.string(), z.union([z.string().max(80), z.boolean()])).default({}),
});

const allowedViewFilters: Record<string, readonly string[]> = {
  orders: ['status'],
  customers: ['tag', 'blocked'],
  catalogue: ['category', 'status'],
  studio: ['channel', 'kind'],
};

export type SavedTableView = z.infer<typeof viewSchema>;

export function savedViewKey(resource: string, operatorId: string): string {
  if (!/^[a-z][a-z0-9-]{0,39}$/u.test(resource) || !/^[A-Za-z0-9_-]{1,100}$/u.test(operatorId)) {
    throw new TypeError('Invalid local table-view scope.');
  }
  return `jw:data-table:v1:${resource}:${operatorId}`;
}

export function parseSavedView(raw: string | null, resource: string): SavedTableView | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { return null; }
  const parsed = viewSchema.safeParse(value);
  if (!parsed.success) return null;
  const allowed = new Set(allowedViewFilters[resource] ?? []);
  const filters = Object.fromEntries(Object.entries(parsed.data.filters).filter(([key]) => allowed.has(key)));
  return { ...parsed.data, filters };
}

export function readSavedView(storage: Pick<Storage, 'getItem'>, resource: string, operatorId: string): SavedTableView | null {
  try { return parseSavedView(storage.getItem(savedViewKey(resource, operatorId)), resource); } catch { return null; }
}

export function writeSavedView(storage: Pick<Storage, 'setItem'>, resource: string, operatorId: string, value: SavedTableView): boolean {
  const key = savedViewKey(resource, operatorId);
  const parsed = viewSchema.safeParse(value);
  if (!parsed.success) return false;
  const allowed = new Set(allowedViewFilters[resource] ?? []);
  const safe = { ...parsed.data, filters: Object.fromEntries(Object.entries(parsed.data.filters).filter(([name]) => allowed.has(name))) };
  try { storage.setItem(key, JSON.stringify(safe)); return true; } catch { return false; }
}

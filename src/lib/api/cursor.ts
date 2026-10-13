export type CursorPage<T> = { items: T[]; nextCursor: string | null };

export function mergeCursorPages<T>(pages: readonly CursorPage<T>[]): T[] {
  const items: T[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const item of page.items) {
      const id = typeof item === 'object' && item !== null && 'id' in item ? String(item.id) : undefined;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      items.push(item);
    }
  }
  return items;
}

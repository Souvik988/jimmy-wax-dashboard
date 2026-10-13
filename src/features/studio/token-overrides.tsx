'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { kit } from '@/components/kit/kit';
import { Badge, Button, Input, Switch } from '@/components/ui/core';
import { getDoc } from '@/lib/api/resources/studio';

import styles from './token-overrides.module.css';

/** Overrides are a nested partial of the shared design (absent key = inherit). Paths are arrays because role names contain dots. */
export type Path = readonly string[];
export type Leaf = { path: Path; value: unknown };

export function leafEntries(value: unknown, prefix: Path = []): Leaf[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => leafEntries(child, [...prefix, key]));
  }
  return prefix.length ? [{ path: prefix, value }] : [];
}

export function getPath(root: unknown, path: Path): unknown {
  let node = root;
  for (const key of path) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

export function setPath(root: Record<string, unknown>, path: Path, value: unknown): Record<string, unknown> {
  if (path.length === 0) return root;
  const [head, ...rest] = path as [string, ...string[]];
  const child = root[head];
  return { ...root, [head]: rest.length === 0 ? value : setPath(child && typeof child === 'object' && !Array.isArray(child) ? (child as Record<string, unknown>) : {}, rest, value) };
}

/** Removes a leaf and prunes objects left empty, so "unify" truly returns to inheriting. */
export function unsetPath(root: Record<string, unknown>, path: Path): Record<string, unknown> {
  if (path.length === 0) return root;
  const [head, ...rest] = path as [string, ...string[]];
  if (!(head in root)) return root;
  if (rest.length === 0) { const { [head]: _gone, ...others } = root; return others; }
  const child = root[head];
  if (!child || typeof child !== 'object' || Array.isArray(child)) return root;
  const pruned = unsetPath(child as Record<string, unknown>, rest);
  if (Object.keys(pruned).length === 0) { const { [head]: _gone, ...others } = root; return others; }
  return { ...root, [head]: pruned };
}

/** Parses an edited value to the base leaf's type; null means the text is not valid for that type. */
export function parseLike(base: unknown, text: string): unknown | null {
  if (typeof base === 'number') { const n = Number(text); return text.trim() !== '' && Number.isFinite(n) ? n : null; }
  if (typeof base === 'boolean') return text === 'true' ? true : text === 'false' ? false : null;
  if (Array.isArray(base)) { try { const parsed: unknown = JSON.parse(text); return Array.isArray(parsed) ? parsed : null; } catch { return null; } }
  return text;
}

const pathKey = (path: Path): string => JSON.stringify(path);

export function TokenOverrideEditor({ overrides, onChange, disabled }: { overrides: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void; disabled: boolean }): ReactNode {
  const base = useQuery({ queryKey: ['studio', 'doc-base-tokens'], queryFn: ({ signal }) => getDoc('shared', 'tokens', 'base', signal), staleTime: 60_000 });
  const [filter, setFilter] = useState('');
  const [onlyOverridden, setOnlyOverridden] = useState(false);
  const leaves = useMemo(() => leafEntries(Object.fromEntries(Object.entries(base.data?.body ?? {}).filter(([key]) => key !== 'schemaVersion'))), [base.data]);
  const overridden = new Set(leafEntries(overrides).map((leaf) => pathKey(leaf.path)));
  const shown = leaves.filter((leaf) => (!onlyOverridden || overridden.has(pathKey(leaf.path))) && leaf.path.join('.').toLowerCase().includes(filter.toLowerCase())).slice(0, 80);

  if (base.isLoading) return <p role="status">Loading the shared design…</p>;
  if (base.error || !base.data) return <p className={`${kit.notice} ${kit.danger}`} role="alert">The shared design base could not be loaded, so overrides cannot be edited here. Use the JSON tab.</p>;
  return <section className={kit.stack} aria-label="Token overrides">
    <p className={kit.muted}>Everything not listed as <Badge tone="info">Override</Badge> follows the shared design. Set a value to make this channel differ; “Unify” returns it to the shared value. Changes are validated against the full design system on save.</p>
    <div className={kit.toolbar}>
      <Input label="Filter values" value={filter} onChange={(event) => setFilter(event.target.value)} />
      <Switch label="Only overridden" checked={onlyOverridden} onChange={setOnlyOverridden} />
      <span className={kit.muted}>{overridden.size} override(s) · showing {shown.length} of {leaves.length}</span>
    </div>
    <ul className={kit.rows}>
      {shown.map((leaf) => {
        const current = getPath(overrides, leaf.path);
        const isOver = current !== undefined;
        const shownValue = isOver ? current : leaf.value;
        const text = Array.isArray(shownValue) ? JSON.stringify(shownValue) : String(shownValue);
        const isHex = typeof leaf.value === 'string' && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u.test(leaf.value);
        return <li key={pathKey(leaf.path)} className={`${kit.row} ${styles.token}`}>
          <div><code>{leaf.path.join(' › ')}</code><br /><small>Shared: {Array.isArray(leaf.value) ? JSON.stringify(leaf.value) : String(leaf.value)}</small></div>
          <div className={styles.valueCell}>
            {typeof leaf.value === 'boolean'
              ? <Switch label={`${leaf.path.join(' ')} value`} checked={shownValue === true} disabled={disabled} onChange={(next) => onChange(setPath(overrides, leaf.path, next))} />
              : <Input label={`${leaf.path.join(' ')} value`} value={text} disabled={disabled} onChange={(event) => { const parsed = parseLike(leaf.value, event.target.value); if (parsed !== null) onChange(setPath(overrides, leaf.path, parsed)); }} />}
            {isHex ? <input type="color" aria-label={`${leaf.path.join(' ')} colour picker`} disabled={disabled} value={/^#[0-9a-fA-F]{6}/u.test(text) ? text.slice(0, 7) : '#000000'} onChange={(event) => onChange(setPath(overrides, leaf.path, event.target.value))} /> : null}
          </div>
          <div className={kit.actions}>{isOver ? <><Badge tone="info">Override</Badge><Button variant="quiet" disabled={disabled} onClick={() => onChange(unsetPath(overrides, leaf.path))}>Unify</Button></> : <Badge>Inherits</Badge>}</div>
        </li>;
      })}
    </ul>
  </section>;
}

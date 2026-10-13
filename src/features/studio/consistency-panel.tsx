'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { Loadable, kit, labelOf } from '@/components/kit/kit';
import { Badge, Button } from '@/components/ui/core';
import { type Channel, getDoc, listDocs, validateChannel } from '@/lib/api/resources/studio';

/** Flattens an override document into dotted leaf paths ("color.roles.accent.primary" style, arrays kept whole). */
export function leafPaths(value: unknown, prefix = ''): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return prefix ? [prefix] : [];
    return entries.flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
  }
  return prefix ? [prefix] : [];
}

/** Groups validator issues by code so repeated problems (for example out-of-stock links) read as one line. */
export function groupIssues(issues: ReadonlyArray<{ code: string; message: string }>): Array<{ code: string; count: number; example: string }> {
  const groups = new Map<string, { code: string; count: number; example: string }>();
  for (const issue of issues) {
    const group = groups.get(issue.code) ?? { code: issue.code, count: 0, example: issue.message };
    group.count += 1;
    groups.set(issue.code, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export function ConsistencyPanel({ channel }: { channel: Channel }): ReactNode {
  const docs = useQuery({ queryKey: ['studio', 'docs', channel], queryFn: ({ signal }) => listDocs(channel, signal) });
  const hasOverride = Boolean(docs.data?.some((doc) => doc.kind === 'tokens' && doc.key === 'override'));
  const override = useQuery({ queryKey: ['studio', 'override', channel], enabled: hasOverride, queryFn: ({ signal }) => getDoc(channel, 'tokens', 'override', signal) });
  const report = useMutation({ mutationFn: () => validateChannel(channel) });
  const paths = override.data ? leafPaths(Object.fromEntries(Object.entries(override.data.body).filter(([key]) => key !== 'schemaVersion'))) : [];
  const grouped = report.data ? groupIssues([...report.data.errors, ...report.data.warnings]) : [];

  return <section className={kit.stack} aria-label="Consistency">
    <h2>Consistency <small className={kit.muted}>{channel === 'app' ? 'mobile app' : 'website'} vs the shared design</small></h2>
    <Loadable query={docs} noun="Consistency data">
      <p>{hasOverride
        ? <>This channel overrides <strong>{paths.length}</strong> design value(s) from the shared base{paths.length ? '.' : ' (none yet).'}</>
        : <>This channel follows the shared design base exactly (no overrides).</>}</p>
      {paths.length > 0 ? <ul className={kit.rows}>{paths.slice(0, 12).map((path) => <li key={path} className={kit.row}><code>{path}</code><Badge tone="info">Override</Badge></li>)}
        {paths.length > 12 ? <li className={kit.muted}>…and {paths.length - 12} more. Open the override document to unify them (delete the key to inherit the base again).</li> : null}</ul> : null}
    </Loadable>
    <div className={kit.actions}><Button variant="secondary" loading={report.isPending} onClick={() => report.mutate()}>Check links and content</Button></div>
    {report.data ? (grouped.length === 0
      ? <p className={`${kit.notice} ${kit.ok}`}>No broken links, missing media or content problems found.</p>
      : <ul className={kit.rows}>{grouped.map((group) => <li key={group.code} className={kit.row}><strong>{labelOf(group.code.replace(/\./gu, '_'))}</strong><Badge tone="warning">{`${group.count}×`}</Badge><small>{group.example}</small></li>)}</ul>) : null}
  </section>;
}

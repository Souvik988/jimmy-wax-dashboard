'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Loadable, PageHeader, kit, labelOf, toneOf } from '@/components/kit/kit';
import { Badge, Button, Input } from '@/components/ui/core';
import { type Channel, type DocSummary, getExperienceState, libraryEntities, listDocs, pageKeysFor } from '@/lib/api/resources/studio';
import { formatIst } from '@/lib/format/time';

import { ConsistencyPanel } from './consistency-panel';
import styles from './studio-workspace.module.css';

function DocRow({ channel, kind, docKey, summary, label }: { channel: string; kind: string; docKey: string; summary: DocSummary | undefined; label: string }): ReactNode {
  return <li className={kit.row}>
    <div><strong>{label}</strong><br /><small>{summary ? `Revision ${summary.rev} · ${formatIst(summary.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })} IST` : 'Not created yet'}</small></div>
    <div>{summary ? (summary.dirtyVsLive === null ? <Badge>Shared</Badge> : <Badge tone={summary.dirtyVsLive ? 'warning' : 'positive'}>{summary.dirtyVsLive ? 'Draft differs from live' : 'Matches live'}</Badge>) : <Badge tone="neutral">Missing</Badge>}</div>
    <div><Link className={styles.open} href={`/studio/doc/${channel}/${kind}/${docKey}`}>{summary ? 'Open' : 'Create'}<span className={styles.sr}> {label}</span></Link></div>
  </li>;
}

/** Creates a website page at `custom:<slug>`; the backend validates the key, and the editor creates the draft on first save. */
function NewCustomPage(): ReactNode {
  const router = useRouter();
  const [slug, setSlug] = useState('');
  const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) && slug.length >= 2 && slug.length <= 60;
  return <form className={kit.actions} aria-label="New custom page" onSubmit={(event) => { event.preventDefault(); if (valid) router.push(`/studio/doc/web/page/custom:${slug}`); }}>
    <Input label="New custom page address" value={slug} maxLength={60} placeholder="our-story" description="Lowercase letters, digits and hyphens. The page will live at /custom/…" error={slug && !valid ? 'Use 2–60 lowercase letters, digits or single hyphens.' : undefined} onChange={(event) => setSlug(event.target.value.toLowerCase())} />
    <Button type="submit" variant="secondary" disabled={!valid}>Create page</Button>
  </form>;
}

export function StudioWorkspace({ channel, canPublish }: { channel: Channel; canPublish: boolean }): ReactNode {
  const state = useQuery({ queryKey: ['studio', 'state'], queryFn: ({ signal }) => getExperienceState(signal), refetchInterval: 60_000 });
  const docs = useQuery({ queryKey: ['studio', 'docs', channel], queryFn: ({ signal }) => listDocs(channel, signal) });
  const shared = useQuery({ queryKey: ['studio', 'docs', 'shared'], queryFn: ({ signal }) => listDocs('shared', signal) });
  const channelState = state.data?.find((item) => item.channel === channel);
  const find = (kind: string, key: string): DocSummary | undefined => docs.data?.find((doc) => doc.kind === kind && doc.key === key);
  const standardPages = new Set(pageKeysFor(channel));
  const extraPages = (docs.data ?? []).filter((doc) => doc.kind === 'page' && !standardPages.has(doc.key));
  const sharedBase = shared.data?.find((doc) => doc.kind === 'tokens' && doc.key === 'base');

  return <div className={kit.page}>
    <PageHeader eyebrow="Experience Studio" title={channel === 'app' ? 'Mobile app' : 'Website'}
      actions={<>
        <nav aria-label="Channel" className={styles.switcher}>
          <Link aria-current={channel === 'app' ? 'page' : undefined} href="/studio?channel=app">App</Link>
          <Link aria-current={channel === 'web' ? 'page' : undefined} href="/studio?channel=web">Website</Link>
        </nav>
        <Link href="/studio/releases"><Button variant="secondary">Releases{canPublish ? ' & publishing' : ''}</Button></Link>
      </>}>
      You are editing the <strong>{channel === 'app' ? 'mobile app' : 'website'}</strong>. App and website have their own layouts; they share one design base and one content library.
      Customers only see changes after a release is published.
    </PageHeader>

    <Loadable query={state} noun="Channel status">
      {channelState ? <p className={`${kit.notice} ${channelState.enabled ? kit.ok : kit.danger}`} role="status">
        {channelState.enabled
          ? <>Live release {channelState.live ? <strong>#{channelState.live.number} — {channelState.live.label}</strong> : <strong>none</strong>}. </>
          : <>Studio content is <strong>switched off</strong> for this channel{channelState.killReason ? ` (${channelState.killReason})` : ''}; clients use their bundled defaults.</>}
        {' '}<Badge tone={toneOf(channelState.enabled ? 'live' : 'killed')}>{channelState.enabled ? 'Serving' : 'Kill switch on'}</Badge>
      </p> : null}
    </Loadable>

    <Loadable query={docs} noun="Documents">
      <section aria-label="Design" className={kit.stack}>
        <h2>Design system</h2>
        <ul className={kit.rows}>
          <DocRow channel="shared" kind="tokens" docKey="base" summary={sharedBase} label="Shared design base (tokens)" />
          <DocRow channel={channel} kind="tokens" docKey="override" summary={find('tokens', 'override')} label={`${labelOf(channel)} token overrides`} />
        </ul>
      </section>
      <section aria-label="Navigation and chrome" className={kit.stack}>
        <h2>Navigation and chrome</h2>
        <ul className={kit.rows}>
          <DocRow channel={channel} kind="navigation" docKey="main" summary={find('navigation', 'main')} label="Navigation" />
          <DocRow channel={channel} kind="chrome" docKey="main" summary={find('chrome', 'main')} label="Chrome (header, splash, help)" />
        </ul>
      </section>
      <section aria-label="Pages" className={kit.stack}>
        <h2>Pages</h2>
        <ul className={kit.rows}>
          {pageKeysFor(channel).map((key) => <DocRow key={key} channel={channel} kind="page" docKey={key} summary={find('page', key)} label={`${labelOf(key)} page`} />)}
          {extraPages.map((doc) => <DocRow key={doc.key} channel={channel} kind="page" docKey={doc.key} summary={doc} label={doc.key.startsWith('product:') ? `Product template · ${doc.key.slice(8)}` : `Custom page · ${doc.key.replace(/^custom:/u, '')}`} />)}
        </ul>
        {channel === 'web' ? <NewCustomPage /> : null}
      </section>
    </Loadable>

    <ConsistencyPanel channel={channel} />

    <section aria-label="Content library" className={kit.stack}>
      <h2>Content library <small className={kit.muted}>shared by both channels</small></h2>
      <div className={kit.grid}>
        {libraryEntities.map((entity) => <Link key={entity} className={styles.card} href={`/studio/library/${entity}`}><strong>{labelOf(entity)}</strong><small>Manage entries</small></Link>)}
        <Link className={styles.card} href="/studio/campaigns"><strong>Campaigns</strong><small>Seasonal overlays and schedules</small></Link>
        <Link className={styles.card} href="/media"><strong>Media library</strong><small>Approved images and video</small></Link>
      </div>
    </section>
  </div>;
}

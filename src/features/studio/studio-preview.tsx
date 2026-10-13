'use client';

import { useMutation } from '@tanstack/react-query';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { kit, useNotice } from '@/components/kit/kit';
import { Button, Input } from '@/components/ui/core';
import { type Channel, createPreviewToken } from '@/lib/api/resources/studio';

import { appPreviewCommand, buildStorefrontPreviewUrl, devices, minutesLeft, safePreviewPath, type DeviceId } from './preview-model';
import styles from './studio-preview.module.css';

/**
 * Preview the SAVED draft. Website: the real storefront is framed with a short-lived preview token (what customers will see, rendered by
 * the real site). App: there is no browser rendering of the Flutter app, so the dashboard issues a token and shows how to point a debug
 * build at the draft. Unsaved edits are never included; the token only reads the draft documents of its own channel.
 */
export function StudioPreview({ channel, storefrontOrigin, apiOrigin, pagePath = '/', unsaved }: { channel: Channel; storefrontOrigin: string | undefined; apiOrigin?: string | undefined; pagePath?: string; unsaved: boolean }): ReactNode {
  const notice = useNotice();
  const [device, setDevice] = useState<DeviceId>('phone');
  const [path, setPath] = useState(pagePath);
  const [issued, setIssued] = useState<{ token: string; expiresAt: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const issue = useMutation({
    mutationFn: () => createPreviewToken(channel, channel === 'web' ? 60 : 240),
    onSuccess: (result) => { setIssued({ token: result.token, expiresAt: result.expiresAt }); setNonce((n) => n + 1); },
    onError: notice.failure,
  });

  const unsavedNote = unsaved ? <p className={kit.notice} role="note">You have unsaved edits. The preview shows the last <strong>saved</strong> draft; save to include them.</p> : null;

  if (channel === 'app') {
    return <section className={kit.stack} aria-label="App preview">
      <p>The mobile app is not rendered in the browser. Create a preview token, then run a debug build of the app with it to see the draft on a device or emulator.</p>
      {unsavedNote}
      {notice.element}
      <div className={kit.actions}><Button loading={issue.isPending} onClick={() => issue.mutate()}>{issued ? 'Create a new app preview token' : 'Create app preview token'}</Button></div>
      {issued ? <>
        <p className={kit.muted}>Valid for about {minutesLeft(issued.expiresAt)} minutes. Anyone with it can read the app draft; treat it like a password and let it expire.</p>
        <code className={styles.token} aria-label="Command to run the app against the draft">{appPreviewCommand(issued.token, apiOrigin)}</code>
        <div className={kit.actions}><Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(appPreviewCommand(issued.token, apiOrigin)).then(() => notice.success('Command copied.'))}>Copy command</Button></div>
      </> : null}
    </section>;
  }

  const url = issued ? buildStorefrontPreviewUrl(storefrontOrigin, issued.token, path) : null;
  const unavailable = !storefrontOrigin ? 'The storefront address is not configured for this dashboard (DASHBOARD_STOREFRONT_ORIGIN), so the website cannot be shown here.' : null;
  return <section className={kit.stack} aria-label="Website preview">
    {unavailable ? <p className={`${kit.notice} ${kit.danger}`} role="alert">{unavailable}</p> : null}
    {unsavedNote}
    {notice.element}
    <div className={styles.bar}>
      <Input label="Page path on the website" value={path} maxLength={120} description="For example / or /about" error={safePreviewPath(path) === null ? 'Use a path starting with / and no spaces or ..' : undefined} onChange={(event) => { setPath(event.target.value); }} />
      <div className={styles.devices} role="group" aria-label="Preview size">
        {devices.map((item) => <Button key={item.id} variant={device === item.id ? 'primary' : 'secondary'} aria-pressed={device === item.id} onClick={() => setDevice(item.id)}>{item.label} · {item.width}px</Button>)}
      </div>
      <Button loading={issue.isPending} disabled={Boolean(unavailable)} onClick={() => issue.mutate()}>{issued ? <><RefreshCw size={16} aria-hidden="true" />Refresh preview</> : 'Load preview'}</Button>
      {url ? <a className="ui-button ui-button--secondary ui-button--md" href={url} target="_blank" rel="noopener noreferrer">Open in a new tab <ExternalLink size={14} aria-hidden="true" /></a> : null}
    </div>
    {issued ? <p className={kit.muted}>Preview link valid for about {minutesLeft(issued.expiresAt)} minutes.</p> : null}
    <div className={styles.stage}>
      {url ? <iframe key={`${nonce}-${path}`} className={styles.frame} data-device={device} src={url} title={`Website draft preview (${device})`} referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        : <p className={kit.muted}>{issued ? 'That page path cannot be previewed.' : 'Choose “Load preview” to render the saved draft with the real website.'}</p>}
    </div>
  </section>;
}

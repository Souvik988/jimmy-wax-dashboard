import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AppShell } from '@/components/layout/app-shell';
import { DocumentEditor } from '@/features/studio/document-editor';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Studio document | Jimmy & Wax operator' };

const kinds = new Set(['tokens', 'navigation', 'chrome', 'page']);
// Standard keys are plain slugs; custom pages use `custom:<slug>` (and product templates `product:<slug>`).
const keyPattern = /^[a-z0-9_-]{1,80}(?::[a-z0-9_-]{1,80})?$/u;

export default async function StudioDocumentPage({ params }: { params: Promise<{ channel: string; kind: string; key: string }> }): Promise<React.ReactNode> {
  const { channel, kind, key: rawKey } = await params;
  let key = '';
  try { key = decodeURIComponent(rawKey); } catch { notFound(); }
  if (!['app', 'web', 'shared'].includes(channel) || !kinds.has(kind) || !keyPattern.test(key)) notFound();
  const operator = await requirePermission('experience:read', `/studio/doc/${channel}/${kind}/${key}`);
  return <AppShell breadcrumbs={['Studio', 'Experience Studio', `${kind} · ${key}`]}>
    <DocumentEditor channel={channel as 'app' | 'web' | 'shared'} kind={kind} docKey={key} operatorId={operator.userId} canWrite={can(operator, 'experience:write')} storefrontOrigin={process.env.DASHBOARD_STOREFRONT_ORIGIN ?? (process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:5174')} />
  </AppShell>;
}

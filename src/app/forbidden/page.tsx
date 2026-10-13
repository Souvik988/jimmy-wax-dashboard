import Link from 'next/link';

import { AppShell } from '@/components/layout/app-shell';
import { NotAllowedState } from '@/components/ui/feedback';

export default function ForbiddenPage(): React.ReactNode {
  return <AppShell breadcrumbs={['Access', 'Not allowed']}><NotAllowedState title="You do not have access to this workspace.">Your operator role does not include the permission required here. Ask an administrator if you believe this is incorrect.</NotAllowedState><p><Link href="/">Return to overview</Link></p></AppShell>;
}

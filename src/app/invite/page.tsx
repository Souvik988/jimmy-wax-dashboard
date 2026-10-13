import type { Metadata } from 'next';

import { InviteForm } from '@/components/auth/invite-form';

export const metadata: Metadata = { title: 'Accept operator invitation | Jimmy & Wax', referrer: 'no-referrer' };

export default function InvitePage(): React.ReactNode {
  return <main className="auth-page"><InviteForm /></main>;
}

import Link from 'next/link';

import kit from '@/components/kit/kit.module.css';
import { EmptyState } from '@/components/ui/feedback';

export default function NotFound(): React.ReactNode {
  return <main className={kit.page}>
    <EmptyState title="That page does not exist">The address may be mistyped or the record may have been removed.</EmptyState>
    <p><Link href="/">Return to overview</Link></p>
  </main>;
}

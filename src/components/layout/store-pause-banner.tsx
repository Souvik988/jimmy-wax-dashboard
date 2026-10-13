'use client';

import { useQuery } from '@tanstack/react-query';
import { PauseCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { getPublicHealth } from '@/lib/api/public-health';
import { queryKeys } from '@/lib/api/query-keys';
import { storeStatusSchema } from '@/lib/api/resources/overview';

export function StorePauseBanner(): React.ReactNode {
  const [optimisticStatus, setOptimisticStatus] = useState<{ ordersPaused: boolean; pauseMessage: string } | null>(null);
  const { data, refetch } = useQuery({
    queryKey: queryKeys.publicHealth,
    queryFn: getPublicHealth,
    staleTime: 15_000,
    refetchInterval: (query) => typeof document !== 'undefined' && document.visibilityState === 'visible' ? 60_000 : false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  useEffect(() => {
    const refresh = (event: Event) => {
      const update = storeStatusSchema.safeParse((event as CustomEvent<unknown>).detail);
      if (update.success) setOptimisticStatus({ ordersPaused: update.data.ordersPaused, pauseMessage: update.data.pauseMessage });
      void refetch();
    };
    window.addEventListener('jw:store-status-updated', refresh);
    return () => window.removeEventListener('jw:store-status-updated', refresh);
  }, [refetch]);
  const status = optimisticStatus ?? data?.policy;
  if (!status?.ordersPaused) return null;
  return (
    <aside className="store-pause-banner" role="status" aria-label="New orders are paused">
      <PauseCircle size={19} aria-hidden="true" />
      <div>
        <strong>New orders are paused</strong>
        <span>{status.pauseMessage || 'Checkout is unavailable to customers until an operator resumes orders.'}</span>
      </div>
    </aside>
  );
}

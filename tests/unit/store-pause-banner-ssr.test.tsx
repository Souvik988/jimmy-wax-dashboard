// @vitest-environment node
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StorePauseBanner } from '@/components/layout/store-pause-banner';

describe('store pause banner server rendering', () => {
  it('does not require browser globals while Next prerenders the shared shell', () => {
    expect(typeof document).toBe('undefined');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    expect(() => renderToString(<QueryClientProvider client={queryClient}><StorePauseBanner /></QueryClientProvider>)).not.toThrow();
  });
});

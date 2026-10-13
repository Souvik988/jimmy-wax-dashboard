import 'server-only';

import { parseStorePolicy, type StorePolicy } from '@/lib/api/public';

const gatewayOrigin = process.env.BACKEND_ORIGIN ?? 'http://localhost:8080';
const timeoutMs = 4_000;

export type GatewaySnapshot = {
  backend: 'connected' | 'unavailable';
  checkedAt: string;
  policy: StorePolicy | null;
  requestId?: string | undefined;
};

function gatewayUrl(path: string): URL {
  return new URL(path, gatewayOrigin);
}

export async function getGatewaySnapshot(): Promise<GatewaySnapshot> {
  const checkedAt = new Date().toISOString();

  try {
    const healthResponse = await fetch(gatewayUrl('/healthz'), {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!healthResponse.ok) {
      return { backend: 'unavailable', checkedAt, policy: null };
    }

    const policyResponse = await fetch(gatewayUrl('/v1/store-settings'), {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!policyResponse.ok) {
      return {
        backend: 'connected',
        checkedAt,
        policy: null,
        requestId: policyResponse.headers.get('x-request-id') ?? undefined,
      };
    }

    const parsedPolicy = await policyResponse.json();
    return {
      backend: 'connected',
      checkedAt,
      policy: (() => {
        try {
          return parseStorePolicy(parsedPolicy);
        } catch {
          return null;
        }
      })(),
      requestId: policyResponse.headers.get('x-request-id') ?? undefined,
    };
  } catch {
    return { backend: 'unavailable', checkedAt, policy: null };
  }
}

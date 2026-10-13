import { NextResponse } from 'next/server';

import { getGatewaySnapshot } from '@/server/gateway';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = await getGatewaySnapshot();
  return NextResponse.json(snapshot, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/server/auth/backend';
import { authorizedBackendJson, coordinatorErrorResponse } from '@/server/auth/coordinator';
import { assertSameOriginCsrf, sessionFromRequest, writeSession } from '@/server/auth/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(10).max(128) });

export async function POST(request: NextRequest) {
  try {
    assertSameOriginCsrf(request);
    const session = sessionFromRequest(request);
    if (!session) throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
    const body = bodySchema.parse(await request.json());
    const result = await authorizedBackendJson(session, '/v1/auth/password/change', { method: 'POST', body: JSON.stringify(body) }, { retryUnauthorized: false });
    const response = new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    if (result.refreshed) writeSession(response, result.session);
    return response;
  } catch (error) { return coordinatorErrorResponse(error); }
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/server/auth/backend';
import { authorizedBackendJson, coordinatorErrorResponse } from '@/server/auth/coordinator';
import { assertSameOriginCsrf, sessionFromRequest, writeSession } from '@/server/auth/http';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    assertSameOriginCsrf(request); const session = sessionFromRequest(request);
    if (!session) throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
    const result = await authorizedBackendJson(session, '/v1/auth/mfa/recovery-codes', { method: 'POST' });
    const codes = z.object({ codes: z.array(z.string()) }).parse(result.body).codes;
    const response = NextResponse.json({ codes }, { headers: { 'Cache-Control': 'no-store' } });
    if (result.refreshed) writeSession(response, result.session);
    return response;
  } catch (error) { return coordinatorErrorResponse(error); }
}

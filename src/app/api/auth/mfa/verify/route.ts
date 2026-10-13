import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/server/auth/backend';
import { authorizedBackendJson, coordinatorErrorResponse } from '@/server/auth/coordinator';
import { assertSameOriginCsrf, nextSession, sessionFromRequest, writeSession } from '@/server/auth/http';

export const dynamic = 'force-dynamic';
const bodySchema = z.union([z.object({ code: z.string().regex(/^\d{6}$/) }), z.object({ recoveryCode: z.string().trim().min(8).max(20) })]);
export async function POST(request: NextRequest) {
  try {
    assertSameOriginCsrf(request); const session = sessionFromRequest(request);
    if (!session) throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
    const result = await authorizedBackendJson(session, '/v1/auth/mfa/verify', { method: 'POST', body: JSON.stringify(bodySchema.parse(await request.json())) }, { retryUnauthorized: false });
    const verified = z.object({ accessToken: z.string(), expiresIn: z.number().int().positive(), aal: z.literal('aal2') }).parse(result.body);
    const response = NextResponse.json({ aal: verified.aal }, { headers: { 'Cache-Control': 'no-store' } });
    writeSession(response, nextSession({ ...result.session, aal: 'aal2', accessToken: verified.accessToken, accessExpiresAt: Date.now() + verified.expiresIn * 1000, loginMfaComplete: true }, session));
    return response;
  } catch (error) { return coordinatorErrorResponse(error); }
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getMe, login } from '@/server/auth/backend';
import { assertSameOriginCsrf, authErrorResponse, nextSession, writeSession } from '@/server/auth/http';

export const dynamic = 'force-dynamic';
const bodySchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(512) });

export async function POST(request: NextRequest) {
  try {
    assertSameOriginCsrf(request, false);
    const body = bodySchema.parse(await request.json()); const auth = await login(body.email, body.password); const me = await getMe(auth.accessToken, auth.aal);
    const response = NextResponse.json({ user: me, mfaRequired: auth.mfa.required && auth.mfa.enrolled, enrollmentRequired: auth.mfa.required && !auth.mfa.enrolled }, { headers: { 'Cache-Control': 'no-store' } });
    writeSession(response, nextSession({ ...me, accessToken: auth.accessToken, refreshToken: auth.refreshToken, accessExpiresAt: Date.now() + auth.expiresIn * 1000, loginMfaComplete: !auth.mfa.required }));
    return response;
  } catch (error) { return authErrorResponse(error); }
}

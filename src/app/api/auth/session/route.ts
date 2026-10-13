import { NextRequest, NextResponse } from 'next/server';

import { parseSafeOperator } from '@/server/auth/backend';
import { SessionExpiredError, authorizedBackendFetch } from '@/server/auth/coordinator';
import { authErrorResponse, clearSession, sessionFromRequest, writeSession } from '@/server/auth/http';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const session = sessionFromRequest(request);
  if (!session) return NextResponse.json({ user: null }, { headers: { 'Cache-Control': 'no-store' } });
  if (!session.loginMfaComplete) return NextResponse.json({ user: null, mfaChallenge: session.mfa ? 'verify' : 'enroll' }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const result = await authorizedBackendFetch(session, '/v1/admin/me');
    if (!result.response.ok) {
      if (result.response.status === 401) { const response = NextResponse.json({ user: null }, { headers: { 'Cache-Control': 'no-store' } }); clearSession(response); return response; }
      return NextResponse.json({ user: null, unavailable: true }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    const currentUser = parseSafeOperator(await result.response.json() as unknown, result.session.aal);
    const response = NextResponse.json({ user: currentUser }, { headers: { 'Cache-Control': 'no-store' } });
    if (result.refreshed) writeSession(response, { ...result.session, ...currentUser });
    return response;
  } catch (error) {
    if (error instanceof SessionExpiredError) { const response = NextResponse.json({ user: null }, { headers: { 'Cache-Control': 'no-store' } }); clearSession(response); return response; }
    return authErrorResponse(error);
  }
}

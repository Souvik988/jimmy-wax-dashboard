import { NextRequest, NextResponse } from 'next/server';

import { logout } from '@/server/auth/backend';
import { assertSameOriginCsrf, clearSession, errorResponse, sessionFromRequest } from '@/server/auth/http';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try { assertSameOriginCsrf(request); } catch (error) { const mapped = errorResponse(error); return NextResponse.json(mapped.body, { status: mapped.status, headers: { 'Cache-Control': 'no-store' } }); }
  const session = sessionFromRequest(request); const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  if (session) { try { await logout(session.refreshToken); } catch { /* local revocation is still authoritative for this browser */ } }
  clearSession(response); return response;
}

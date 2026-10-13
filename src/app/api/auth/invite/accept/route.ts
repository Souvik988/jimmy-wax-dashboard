import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { backendRequest } from '@/server/auth/backend';
import { assertSameOriginCsrf, authErrorResponse } from '@/server/auth/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(10).max(128),
  fullName: z.string().trim().min(2).max(120),
});
const resultSchema = z.object({ email: z.string().email(), role: z.string().min(1) });

export async function POST(request: NextRequest) {
  try {
    assertSameOriginCsrf(request, false);
    const body = bodySchema.parse(await request.json());
    const result = resultSchema.parse(await backendRequest('/v1/auth/invite/accept', { method: 'POST', body: JSON.stringify(body) }));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) {
    const response = authErrorResponse(error);
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  }
}

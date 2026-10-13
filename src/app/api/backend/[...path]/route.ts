import { NextRequest } from 'next/server';

import { ApiError } from '@/server/auth/backend';
import { authErrorResponse } from '@/server/auth/http';
import { proxyAdminRequest } from '@/server/auth/proxy';

export const dynamic = 'force-dynamic';
// `slug`, or `scope:slug` for Studio custom page keys (custom:about); optional `.ext`. No other punctuation.
const safeSegment = /^(?=.{1,100}$)[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?(?:\.[A-Za-z0-9_-]+)?$/u;

async function dispatch(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params; const joined = path.join('/');
  if (path[0] !== 'admin' || path.length < 2 || path.length > 8 || path.some((segment) => !safeSegment.test(segment))) return authErrorResponse(new ApiError(404, 'NOT_FOUND', 'That backend resource is not available.'));
  return proxyAdminRequest(request, `/v1/${joined}`);
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;

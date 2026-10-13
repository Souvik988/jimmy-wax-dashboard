import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { can, type Permission, type SafeOperator } from '@/lib/auth/permissions';

import { SESSION_COOKIE, decryptSession, isSafeNextPath, toSafeOperator } from './session';

async function currentSession() {
  const cookieStore = await cookies();
  const value = cookieStore.get(SESSION_COOKIE)?.value;
  return value ? decryptSession(value) : null;
}

export async function currentOperator(): Promise<SafeOperator | null> {
  const session = await currentSession();
  return session?.loginMfaComplete ? toSafeOperator(session) : null;
}

export async function requireOperator(nextPath: string): Promise<SafeOperator> {
  const safeNext = isSafeNextPath(nextPath) ? nextPath : '/';
  const session = await currentSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(safeNext)}`);
  if (!session.loginMfaComplete) redirect(`/login/${session.mfa ? 'mfa' : 'enroll'}?next=${encodeURIComponent(safeNext)}`);
  return toSafeOperator(session);
}

export async function requirePermission(permission: Permission, nextPath: string): Promise<SafeOperator> {
  const operator = await requireOperator(nextPath);
  if (!can(operator, permission)) redirect('/forbidden');
  return operator;
}

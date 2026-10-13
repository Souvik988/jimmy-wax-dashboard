import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { SafeOperator } from '@/lib/auth/permissions';
export { isSafeNextPath } from '@/lib/auth/navigation';

export const SESSION_COOKIE = 'jw_operator_session';
export const CSRF_COOKIE = 'jw_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export type OperatorSession = SafeOperator & { accessToken: string; refreshToken: string; accessExpiresAt: number; csrfToken: string; loginMfaComplete: boolean };

function getKey(): Buffer {
  const encoded = process.env.DASHBOARD_SESSION_SECRET;
  if (!encoded) throw new Error('DASHBOARD_SESSION_SECRET is not configured.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('DASHBOARD_SESSION_SECRET must be a base64-encoded 32-byte key.');
  return key;
}

export function createCsrfToken(): string { return randomBytes(32).toString('base64url'); }

export function encryptSession(session: OperatorSession): string {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(session), 'utf8'); const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

export function decryptSession(value: string): OperatorSession | null {
  try {
    const payload = Buffer.from(value, 'base64url');
    if (payload.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', getKey(), payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    const decoded = JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8')) as OperatorSession;
    if (!decoded.accessToken || !decoded.refreshToken || !decoded.csrfToken || typeof decoded.loginMfaComplete !== 'boolean' || !Number.isSafeInteger(decoded.accessExpiresAt)) return null;
    return decoded;
  } catch { return null; }
}

export function toSafeOperator(session: OperatorSession): SafeOperator { const { userId, role, permissions, mfa, aal } = session; return { userId, role, permissions, mfa, aal }; }
export function sessionLockKey(session: OperatorSession): string { return createHash('sha256').update(session.refreshToken).digest('hex'); }

export function csrfTokensMatch(cookieToken: string | undefined, headerToken: string | null): boolean {
  if (!cookieToken || !headerToken) return false;
  const left = Buffer.from(cookieToken); const right = Buffer.from(headerToken);
  return left.length === right.length && timingSafeEqual(left, right);
}


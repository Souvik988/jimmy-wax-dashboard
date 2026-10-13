'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { Button, Input } from '@/components/ui/core';
import { authFetch, readError } from '@/lib/auth/client';
import { isSafeNextPath } from '@/lib/auth/navigation';

function LoginForm(): React.ReactNode {
  const router = useRouter(); const search = useSearchParams(); const [email, setEmail] = useState(''); const passwordRef = useRef<HTMLInputElement>(null); const [error, setError] = useState<string | null>(null); const [cooldown, setCooldown] = useState<number | null>(null); const [pending, setPending] = useState(false);
  useEffect(() => { if (cooldown === null || cooldown <= 0) return; const timer = window.setTimeout(() => setCooldown((remaining) => remaining === null || remaining <= 1 ? null : remaining - 1), 1000); return () => window.clearTimeout(timer); }, [cooldown]);
  const destination = search.get('next'); const next = isSafeNextPath(destination) ? destination : '/';
  const submit = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setPending(true); setError(null); try { const response = await authFetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: passwordRef.current?.value ?? '' }) }); if (!response.ok) { const result = await readError(response); setError(result.code === 'RATE_LIMITED' ? 'Too many attempts. Please wait before trying again.' : 'We could not sign you in. Check your details and try again.'); setCooldown(result.retryAfter ?? null); return; } if (passwordRef.current) passwordRef.current.value = ''; const result = await response.json() as { mfaRequired: boolean; enrollmentRequired: boolean }; const query = `?next=${encodeURIComponent(next)}`; router.replace(result.enrollmentRequired ? `/login/enroll${query}` : result.mfaRequired ? `/login/mfa${query}` : next); } catch { setError('The dashboard could not be reached. Your details were not saved. Please try again.'); } finally { setPending(false); } };
  return <main className="auth-page"><section className="auth-card" aria-labelledby="login-title"><Link className="auth-brand" href="/login">JIMMY <em>&amp;</em> WAX<small>OPERATOR CONSOLE</small></Link><p className="eyebrow">SECURE OPERATOR ACCESS</p><h1 id="login-title">Sign in to continue.</h1><p>Use your operator email and password. Customer accounts cannot access this console.</p><form onSubmit={(event) => void submit(event)}><Input label="Work email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /><Input ref={passwordRef} label="Password" type="password" autoComplete="current-password" required />{error ? <p className="auth-error" role="alert">{error}{cooldown !== null ? ` Try again in about ${cooldown} seconds.` : ''}</p> : null}<Button type="submit" loading={pending} disabled={cooldown !== null && cooldown > 0}>Sign in securely</Button></form><small className="auth-footnote">Sign-in attempts are protected by server-side rate limits. Do not share your password or verification codes.</small></section></main>;
}

export default function LoginPage(): React.ReactNode { return <Suspense fallback={<main className="auth-page"><p>Loading secure sign-in…</p></main>}><LoginForm /></Suspense>; }

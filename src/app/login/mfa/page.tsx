'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Button, Input } from '@/components/ui/core';
import { authFetch, readError } from '@/lib/auth/client';
import { isSafeNextPath } from '@/lib/auth/navigation';

function LoginMfaForm(): React.ReactNode {
  const router = useRouter(); const search = useSearchParams(); const [useRecovery, setUseRecovery] = useState(false); const [value, setValue] = useState(''); const [error, setError] = useState<string | null>(null); const [pending, setPending] = useState(false); const nextParam = search.get('next'); const next = isSafeNextPath(nextParam) ? nextParam : '/';
  const submit = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setPending(true); setError(null); const response = await authFetch('/api/auth/mfa/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(useRecovery ? { recoveryCode: value.trim() } : { code: value }) }); if (!response.ok) { const result = await readError(response); setError(result.message === 'That code is not valid' ? 'That verification code is not valid. Check your device time and try again.' : result.message); setPending(false); return; } router.replace(next); };
  return <main className="auth-page"><section className="auth-card" aria-labelledby="mfa-title"><p className="eyebrow">ADDITIONAL VERIFICATION</p><h1 id="mfa-title">Confirm it’s you.</h1><p>{useRecovery ? 'Use one unused recovery code. It will stop working after this sign-in.' : 'Enter the current six-digit code from your authenticator app.'}</p><form onSubmit={(event) => void submit(event)}><Input label={useRecovery ? 'Recovery code' : 'Authenticator code'} inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" value={value} onChange={(event) => setValue(event.target.value)} required pattern={useRecovery ? undefined : '\\d{6}'} maxLength={useRecovery ? 20 : 6} />{error ? <p className="auth-error" role="alert">{error}</p> : null}<Button type="submit" loading={pending}>Verify and continue</Button></form><button type="button" className="auth-link" onClick={() => { setUseRecovery(!useRecovery); setValue(''); setError(null); }}>{useRecovery ? 'Use an authenticator code instead' : 'Use a recovery code instead'}</button></section></main>;
}

export default function LoginMfaPage(): React.ReactNode { return <Suspense fallback={<main className="auth-page"><p>Loading verification…</p></main>}><LoginMfaForm /></Suspense>; }

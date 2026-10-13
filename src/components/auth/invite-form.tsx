'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button, Input } from '@/components/ui/core';
import { authFetch, readError } from '@/lib/auth/client';

export function InviteForm(): React.ReactNode {
  const [token, setToken] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(null); const form = event.currentTarget; const formData = new FormData(form);
    if (!token.trim()) { setError('Enter the one-time invitation code from your email. Ask an administrator for a new invitation if it is missing.'); return; }
    const password = String(formData.get('password') ?? ''); const confirmPassword = String(formData.get('confirmPassword') ?? '');
    if (password !== confirmPassword) { setError('The passwords do not match.'); return; }
    setPending(true);
    try {
      const response = await authFetch('/api/auth/invite/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: token.trim(), fullName, password }) });
      if (!response.ok) { const result = await readError(response); setError(`We could not accept this invitation. ${result.requestId ? `Reference ${result.requestId}. ` : ''}The code may have expired or already been used.`); return; }
      setToken(''); form.reset(); setSuccess(true);
    } catch { setError('The dashboard could not reach the service. Your password was not saved. Please try again.'); }
    finally { setPending(false); }
  };

  if (success) return <section className="auth-card" aria-labelledby="invite-success-title"><p className="eyebrow">INVITATION ACCEPTED</p><h1 id="invite-success-title">You’re ready to sign in.</h1><p>Your operator account is ready. Use the password you just created to continue.</p><Link className="auth-link" href="/login">Go to secure sign in</Link></section>;

  return <section className="auth-card" aria-labelledby="invite-title">
    <Link className="auth-brand" href="/login">JIMMY <em>&amp;</em> WAX<small>OPERATOR CONSOLE</small></Link>
    <p className="eyebrow">OPERATOR INVITATION</p><h1 id="invite-title">Set up your account.</h1>
    <p>Enter the one-time code from your invitation email and choose a password. Invitations can be accepted only once.</p>
    <form onSubmit={(event) => void submit(event)}>
      <Input label="Invitation code" autoComplete="off" spellCheck={false} value={token} onChange={(event) => setToken(event.target.value)} required />
      <Input label="Full name" autoComplete="name" maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} required />
      <Input label="New password" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required description="Use at least 10 characters." />
      <Input label="Confirm new password" name="confirmPassword" type="password" autoComplete="new-password" minLength={10} maxLength={128} required />
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <Button type="submit" loading={pending}>Accept invitation</Button>
    </form>
    <small className="auth-footnote">This invitation link is sensitive. Do not forward or share it.</small>
  </section>;
}

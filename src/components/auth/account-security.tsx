'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';

import { Button, Input } from '@/components/ui/core';
import { Card, EmptyState, ErrorState, OfflineState } from '@/components/ui/feedback';
import { ConfirmDialog, Dialog } from '@/components/ui/overlays';
import { permissions, roles, type SafeOperator } from '@/lib/auth/permissions';
import { authFetch, readError } from '@/lib/auth/client';
import { formatIst } from '@/lib/format/time';

const sessionSchema = z.object({ id: z.string(), client: z.string(), aal: z.string(), current: z.boolean(), startedAt: z.string(), lastSeenAt: z.string() });
const sessionsSchema = z.object({ items: z.array(sessionSchema) });
const operatorSchema = z.object({ userId: z.string(), role: z.enum(roles), permissions: z.array(z.enum(permissions)), mfa: z.boolean(), aal: z.enum(['aal1', 'aal2']) });

type OperatorSessionInfo = z.infer<typeof sessionSchema>;
type SecurityError = { message: string; requestId?: string | undefined };

export function AccountSecurity({ initialOperator }: { initialOperator: SafeOperator }): React.ReactNode {
  const [operator, setOperator] = useState(initialOperator);
  const [sessions, setSessions] = useState<OperatorSessionInfo[]>([]);
  const [sessionsState, setSessionsState] = useState<'loading' | 'ready' | 'error' | 'offline'>('loading');
  const [sessionsError, setSessionsError] = useState<SecurityError | null>(null);
  const [securityError, setSecurityError] = useState<SecurityError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState(false);
  const [pendingCodes, setPendingCodes] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [codesSaved, setCodesSaved] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordPending, setPasswordPending] = useState(false);

  const loadSessions = useCallback(async () => {
    setSessionsState('loading'); setSessionsError(null);
    try {
      const response = await authFetch('/api/auth/sessions');
      if (!response.ok) { const error = await readError(response); setSessionsError({ message: error.message, ...(error.requestId ? { requestId: error.requestId } : {}) }); setSessionsState(response.status >= 500 ? 'offline' : 'error'); return; }
      const parsed = sessionsSchema.safeParse(await response.json() as unknown);
      if (!parsed.success) { setSessionsError({ message: 'The backend returned a session list that does not match the verified contract.' }); setSessionsState('error'); return; }
      setSessions(parsed.data.items); setSessionsState('ready');
    } catch { setSessionsError({ message: 'The session service could not be reached. Try again when connectivity returns.' }); setSessionsState('offline'); }
  }, []);

  const refreshOperator = useCallback(async () => {
    try {
      const response = await authFetch('/api/auth/session');
      if (!response.ok) return;
      const parsed = z.object({ user: operatorSchema.nullable() }).safeParse(await response.json() as unknown);
      if (parsed.success && parsed.data.user) setOperator(parsed.data.user);
    } catch { /* the shell presents session connectivity status */ }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSessions(); void refreshOperator(); }, 0);
    const onSessionUpdated = () => { void refreshOperator(); void loadSessions(); };
    const onStepUpRequested = () => setNotice('Additional verification is required. Complete the verification, then submit your original action again.');
    const onStepUpVerified = () => setNotice('Verification succeeded. Review and submit the original action again to continue.');
    window.addEventListener('jw:session-updated', onSessionUpdated);
    window.addEventListener('jw:mfa-required', onStepUpRequested);
    window.addEventListener('jw:mfa-verified', onStepUpVerified);
    return () => { window.clearTimeout(timer); window.removeEventListener('jw:session-updated', onSessionUpdated); window.removeEventListener('jw:mfa-required', onStepUpRequested); window.removeEventListener('jw:mfa-verified', onStepUpVerified); };
  }, [loadSessions, refreshOperator]);

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const formData = new FormData(form); const currentPassword = String(formData.get('currentPassword') ?? ''); const newPassword = String(formData.get('newPassword') ?? ''); const confirmPassword = String(formData.get('confirmPassword') ?? ''); setPasswordError(null); setSecurityError(null); setNotice(null);
    if (newPassword !== confirmPassword) { setPasswordError('The new passwords do not match.'); return; }
    setPasswordPending(true);
    try {
      const response = await authFetch('/api/auth/password/change', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) });
      if (!response.ok) { const error = await readError(response); setPasswordError(`${error.message}${error.requestId ? ` Reference ${error.requestId}.` : ''}`); return; }
      form.reset(); setNotice('Password updated. Other operator sessions were signed out by the backend.');
      window.dispatchEvent(new Event('jw:session-updated'));
    } catch { setPasswordError('The password service could not be reached. Your password was not changed.'); }
    finally { setPasswordPending(false); }
  };

  const revokeSession = async () => {
    if (!confirmId) return;
    setPendingRevoke(true); setSecurityError(null); setNotice(null);
    try {
      const response = await authFetch(`/api/auth/sessions/${encodeURIComponent(confirmId)}`, { method: 'DELETE' });
      if (!response.ok) { const error = await readError(response); setSecurityError({ message: error.message, ...(error.requestId ? { requestId: error.requestId } : {}) }); return; }
      setConfirmId(null); setNotice('The selected session was revoked.'); await loadSessions();
    } catch { setSecurityError({ message: 'The session service could not be reached. No revocation was confirmed.' }); }
    finally { setPendingRevoke(false); }
  };

  const rotateRecoveryCodes = async () => {
    setPendingCodes(true); setSecurityError(null); setNotice(null); setCopyStatus(null);
    try {
      const response = await authFetch('/api/auth/mfa/recovery-codes', { method: 'POST' });
      if (!response.ok) { const error = await readError(response); setSecurityError({ message: error.message, ...(error.requestId ? { requestId: error.requestId } : {}) }); return; }
      const parsed = z.object({ codes: z.array(z.string().min(1)) }).safeParse(await response.json() as unknown);
      if (!parsed.success) { setSecurityError({ message: 'Recovery codes were not displayed because the response did not match the verified backend shape.' }); return; }
      setRecoveryCodes(parsed.data.codes); setCodesSaved(false);
    } catch { setSecurityError({ message: 'Recovery codes could not be loaded. Try again after checking your session.' }); }
    finally { setPendingCodes(false); }
  };

  const copyRecoveryCodes = async () => {
    if (!recoveryCodes) return;
    try { await navigator.clipboard.writeText(recoveryCodes.join('\n')); setCopyStatus('Copied to clipboard. Store these codes somewhere private.'); }
    catch { setCopyStatus('Clipboard access was blocked. You can download the codes instead.'); }
  };

  const downloadRecoveryCodes = () => {
    if (!recoveryCodes) return;
    const file = new Blob([`Jimmy & Wax operator recovery codes\nGenerated ${new Date().toISOString()}\n\n${recoveryCodes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(file); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'jimmy-wax-recovery-codes.txt'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000); setCopyStatus('Downloaded. Store the file somewhere private; it will not be available here again.');
  };

  const finishRecoveryCodes = () => { setRecoveryCodes(null); setCodesSaved(false); setCopyStatus(null); setNotice('Recovery codes were shown once. Keep them in a secure place; they cannot be retrieved again.'); };

  return <div className="security-workspace">
    <header className="security-heading"><p className="eyebrow">OPERATOR ACCOUNT</p><h1>Account security</h1><p>Manage your own sign-in, MFA and active operator sessions.</p></header>
    {notice ? <p className="security-notice" role="status">{notice}</p> : null}
    {securityError ? <p className="auth-error" role="alert">{securityError.message}{securityError.requestId ? ` · Request ${securityError.requestId}` : ''}</p> : null}

    <div className="security-grid">
      <Card title="Sign-in protection">
        <dl className="security-facts"><div><dt>Operator role</dt><dd>{operator.role}</dd></div><div><dt>Multi-factor authentication</dt><dd>{operator.mfa ? 'Enrolled' : 'Not enrolled'}</dd></div><div><dt>Current verification level</dt><dd>{operator.aal === 'aal2' ? 'Elevated · aal2' : 'Standard · aal1'}</dd></div></dl>
        {!operator.mfa ? <p className="security-help">MFA is not enrolled for this account yet. Enroll before using actions that require step-up verification.</p> : <p className="security-help">Recovery codes are one-use and replacing them invalidates every previously issued code.</p>}
        <div className="security-actions">{!operator.mfa ? <Link className="ui-button ui-button--primary" href="/login/enroll?next=%2Faccount%2Fsecurity">Enroll authenticator</Link> : <Button variant="secondary" loading={pendingCodes} onClick={() => void rotateRecoveryCodes()}>Rotate recovery codes</Button>}</div>
      </Card>

      <Card title="Change password">
        <p className="security-help">A successful password change signs out every other device. This browser session remains active.</p>
        <form className="security-form" onSubmit={(event) => void changePassword(event)}>
          <Input label="Current password" name="currentPassword" type="password" autoComplete="current-password" required />
          <Input label="New password" name="newPassword" type="password" autoComplete="new-password" minLength={10} maxLength={128} required description="Use at least 10 characters." />
          <Input label="Confirm new password" name="confirmPassword" type="password" autoComplete="new-password" minLength={10} maxLength={128} required />
          {passwordError ? <p className="auth-error" role="alert">{passwordError}</p> : null}
          <Button type="submit" loading={passwordPending}>Update password</Button>
        </form>
      </Card>
    </div>

    <Card title="Active operator sessions" action={<Button size="sm" variant="secondary" onClick={() => void loadSessions()}>Refresh list</Button>}>
      <p className="security-help">Revoking another session signs out that device. Your current session is marked and cannot be revoked from this list.</p>
      {sessionsState === 'loading' ? <p role="status">Loading active sessions…</p> : null}
      {sessionsState === 'error' && sessionsError ? <ErrorState title="Could not load sessions" {...(sessionsError.requestId ? { requestId: sessionsError.requestId } : {})}>{sessionsError.message}</ErrorState> : null}
      {sessionsState === 'offline' && sessionsError ? <OfflineState title="Session service unavailable" {...(sessionsError.requestId ? { requestId: sessionsError.requestId } : {})} actionLabel="Try again" onAction={() => void loadSessions()}>{sessionsError.message}</OfflineState> : null}
      {sessionsState === 'ready' && sessions.length === 0 ? <EmptyState title="No active sessions were returned">Sign in again if this looks unexpected.</EmptyState> : null}
      {sessionsState === 'ready' && sessions.length > 0 ? <div className="security-session-list">{sessions.map((session) => <article className="security-session" key={session.id}>
        <div><h3>{session.client === 'admin' ? 'Operator dashboard' : session.client}</h3><p>{session.current ? 'This device · current session' : 'Other signed-in device'} · {session.aal}</p><small>Started {formatIst(session.startedAt)} · Last seen {formatIst(session.lastSeenAt)}</small></div>
        {session.current ? <span className="security-current">Current session</span> : <Button size="sm" variant="danger" onClick={() => { setConfirmId(session.id); setSecurityError(null); }}>Revoke</Button>}
      </article>)}</div> : null}
    </Card>

    <Dialog open={recoveryCodes !== null} onOpenChange={() => undefined} dismissible={false} title="Save your recovery codes now." className="recovery-dialog" footer={recoveryCodes ? <><label className="ui-choice"><input type="checkbox" checked={codesSaved} onChange={(event) => setCodesSaved(event.target.checked)} /><span>I stored these codes somewhere private.</span></label><Button disabled={!codesSaved} onClick={finishRecoveryCodes}>I saved them — clear this list</Button></> : null}>{recoveryCodes ? <div className="recovery-panel"><p className="eyebrow">ONE-TIME DISPLAY</p><p>Each code works once. This list is held only in this page’s memory and will be cleared when you confirm you have saved it or leave.</p><ul className="recovery-code-list">{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul><div className="security-actions"><Button variant="secondary" onClick={() => void copyRecoveryCodes()}>Copy codes</Button><Button variant="secondary" onClick={downloadRecoveryCodes}>Download text file</Button></div>{copyStatus ? <p role="status" className="security-help">{copyStatus}</p> : null}</div> : null}</Dialog>

    <ConfirmDialog open={confirmId !== null} onOpenChange={(open) => { if (!open && !pendingRevoke) setConfirmId(null); }} phrase="REVOKE SESSION" title="Sign out another device" pending={pendingRevoke} onConfirm={() => void revokeSession()}>That device will lose access to this operator account. Any unsaved work on that device may be lost.</ConfirmDialog>
  </div>;
}

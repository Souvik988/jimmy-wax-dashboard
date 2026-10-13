'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { z } from 'zod';

import { Button, Input } from '@/components/ui/core';
import { authFetch, readError } from '@/lib/auth/client';

type Stage = 'intro' | 'setup' | 'verified' | 'codes' | 'complete';

export function MfaEnrollment({ nextPath }: { nextPath: string }): React.ReactNode {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('intro');
  const [otpauthUri, setOtpauthUri] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [codesSaved, setCodesSaved] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!otpauthUri) return;
    let mounted = true;
    void QRCode.toDataURL(otpauthUri, { width: 240, margin: 2, errorCorrectionLevel: 'M' }).then((value) => { if (mounted) setQrImage(value); }).catch(() => { if (mounted) setError('The local QR image could not be rendered. Use the manual setup key below.'); });
    return () => { mounted = false; };
  }, [otpauthUri]);

  const beginEnrollment = async () => {
    setPending(true); setError(null);
    try {
      const response = await authFetch('/api/auth/mfa/enroll', { method: 'POST' });
      if (!response.ok) { const result = await readError(response); setError(`${result.message}${result.requestId ? ` Reference ${result.requestId}.` : ''}`); return; }
      const parsed = z.object({ secret: z.string().min(1), otpauthUri: z.string().startsWith('otpauth://') }).safeParse(await response.json() as unknown);
      if (!parsed.success) { setError('The backend enrollment response did not match the verified setup format.'); return; }
      setSecret(parsed.data.secret); setOtpauthUri(parsed.data.otpauthUri); setStage('setup');
    } catch { setError('The MFA service could not be reached. No enrollment was started.'); }
    finally { setPending(false); }
  };

  const loadRecoveryCodes = async () => {
    setPending(true); setError(null);
    try {
      const response = await authFetch('/api/auth/mfa/recovery-codes', { method: 'POST' });
      if (!response.ok) { const result = await readError(response); setError(`${result.message}${result.requestId ? ` Reference ${result.requestId}.` : ''}`); return; }
      const parsed = z.object({ codes: z.array(z.string().min(1)) }).safeParse(await response.json() as unknown);
      if (!parsed.success) { setError('Recovery codes were not shown because the response did not match the verified format.'); return; }
      setCodes(parsed.data.codes); setCodesSaved(false); setStage('codes');
    } catch { setError('The recovery-code service could not be reached. Try again; codes have not been displayed.'); }
    finally { setPending(false); }
  };

  const verifyCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setPending(true); setError(null);
    try {
      const response = await authFetch('/api/auth/mfa/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
      if (!response.ok) { const result = await readError(response); setError(result.code === 'UNAUTHENTICATED' ? 'That code was not accepted. Check that your device clock is correct and try the current code.' : result.message); return; }
      setCode(''); setStage('verified'); window.dispatchEvent(new Event('jw:session-updated'));
      await loadRecoveryCodes();
    } catch { setError('Verification could not be completed. Check your device time and try again.'); }
    finally { setPending(false); }
  };

  const copySecret = async () => {
    if (!secret) return;
    try { await navigator.clipboard.writeText(secret); setCopyStatus('Setup key copied. Paste it only into your authenticator app.'); }
    catch { setCopyStatus('Clipboard access was blocked. You can enter the visible setup key manually.'); }
  };

  const copyCodes = async () => {
    if (!codes) return;
    try { await navigator.clipboard.writeText(codes.join('\n')); setCopyStatus('Recovery codes copied. Store them somewhere private.'); }
    catch { setCopyStatus('Clipboard access was blocked. Download the codes instead.'); }
  };

  const downloadCodes = () => {
    if (!codes) return;
    const file = new Blob([`Jimmy & Wax operator recovery codes\nGenerated ${new Date().toISOString()}\n\n${codes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(file); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'jimmy-wax-recovery-codes.txt'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000); setCopyStatus('Downloaded. Keep the file somewhere private.');
  };

  const finish = () => {
    setCodes(null); setCodesSaved(false); setSecret(null); setOtpauthUri(null); setQrImage(null); setStage('complete');
    window.dispatchEvent(new Event('jw:session-updated')); router.replace(nextPath);
  };

  return <section className="auth-card mfa-enrollment" aria-labelledby="enrollment-title">
    <p className="eyebrow">SECURE OPERATOR ACCESS</p>
    <h1 id="enrollment-title">Set up your authenticator.</h1>
    {stage === 'intro' ? <><p>Your operator policy requires multi-factor authentication. Set it up before continuing to the dashboard.</p><Button loading={pending} onClick={() => void beginEnrollment()}>Begin secure setup</Button><small className="auth-footnote">The setup key is shown only in this page and is never sent to a third party.</small></> : null}

    {stage === 'setup' ? <>
      <p>Scan this QR code with your authenticator app, or enter the manual key. Then confirm with a current six-digit code.</p>
      <div className="mfa-qr-frame">{qrImage ? <Image src={qrImage} alt="Authenticator setup QR code" width={240} height={240} unoptimized /> : <p role="status">Preparing local QR code…</p>}</div>
      <div className="mfa-secret"><p><strong>Manual setup key</strong><br />{secretVisible ? <code>{secret}</code> : <span>Hidden until you choose to reveal it.</span>}</p><div className="security-actions"><Button variant="secondary" size="sm" onClick={() => setSecretVisible(!secretVisible)}>{secretVisible ? 'Hide key' : 'Reveal key'}</Button><Button variant="secondary" size="sm" onClick={() => void copySecret()}>Copy key</Button></div></div>
      {copyStatus ? <p className="security-help" role="status">{copyStatus}</p> : null}
      <form onSubmit={(event) => void verifyCode(event)}><Input label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} required /><Button type="submit" loading={pending}>Verify and finish setup</Button></form>
    </> : null}

    {stage === 'verified' ? <><p>MFA is enabled. Recovery codes are required so you can regain access if your authenticator is unavailable.</p><Button loading={pending} onClick={() => void loadRecoveryCodes()}>Generate recovery codes</Button></> : null}

    {stage === 'codes' && codes ? <>
      <p>Each code works once. This list is held only in the current page’s memory; save it somewhere private before you continue.</p>
      <ul className="recovery-code-list">{codes.map((item) => <li key={item}><code>{item}</code></li>)}</ul>
      <div className="security-actions"><Button variant="secondary" onClick={() => void copyCodes()}>Copy codes</Button><Button variant="secondary" onClick={downloadCodes}>Download text file</Button></div>
      {copyStatus ? <p className="security-help" role="status">{copyStatus}</p> : null}
      <label className="ui-choice"><input type="checkbox" checked={codesSaved} onChange={(event) => setCodesSaved(event.target.checked)} /><span>I stored these codes somewhere private.</span></label>
      <Button disabled={!codesSaved} onClick={finish}>I saved them — continue</Button>
    </> : null}

    {error ? <p className="auth-error" role="alert">{error}</p> : null}
    {stage === 'intro' || stage === 'setup' ? <small className="auth-footnote">If the code is rejected, check your device time and try the next code. The backend applies sign-in limits.</small> : null}
  </section>;
}

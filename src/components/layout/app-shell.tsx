'use client';

import { Command, Menu, Search, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';

import { Avatar, Badge, Button, IconButton, Input, StatusPill } from '@/components/ui/core';
import { Dialog } from '@/components/ui/overlays';
import { QueryProvider } from '@/components/providers/query-provider';
import { StorePauseBanner } from '@/components/layout/store-pause-banner';
import {
  can,
  permissions,
  roles,
  type Permission,
  type SafeOperator,
} from '@/lib/auth/permissions';
import { authFetch, readError } from '@/lib/auth/client';
import { isSafeNextPath } from '@/lib/auth/navigation';

type NavItem = { label: string; permissions: Permission[]; phase: number; href?: string };
type NavGroup = { label: string; items: NavItem[] };
const safeOperatorSchema = z.object({
  userId: z.string(),
  role: z.enum(roles),
  permissions: z.array(z.enum(permissions)),
  mfa: z.boolean(),
  aal: z.enum(['aal1', 'aal2']),
});
type ReauthStage = 'password' | 'mfa' | 'enroll';

export const navigation: NavGroup[] = [
  { label: 'Overview', items: [{ label: 'Home', permissions: [], phase: 1, href: '/' }] },
  {
    label: 'Orders & Fulfilment',
    items: [
      { label: 'Orders', permissions: ['orders:read'], phase: 6, href: '/orders' },
      { label: 'Shipping centre', permissions: ['shipping:read'], phase: 7, href: '/shipping' },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { label: 'Products', permissions: ['catalog:read'], phase: 8, href: '/products' },
      { label: 'Categories & collections', permissions: ['catalog:read'], phase: 8, href: '/catalogue' },
      { label: 'Inventory', permissions: ['inventory:read'], phase: 8, href: '/inventory' },
      { label: 'Media library', permissions: ['media:read'], phase: 9, href: '/media' },
    ],
  },
  {
    label: 'Studio',
    items: [
      { label: 'Experience Studio', permissions: ['experience:read'], phase: 10, href: '/studio' },
      { label: 'Releases & publishing', permissions: ['experience:read'], phase: 15, href: '/studio/releases' },
      { label: 'Campaigns', permissions: ['experience:read'], phase: 15, href: '/studio/campaigns' },
      { label: 'Content library', permissions: ['experience:read'], phase: 14, href: '/studio/library/care-guides' },
    ],
  },
  {
    label: 'Customers',
    items: [
      { label: 'Customers', permissions: ['customers:read'], phase: 16, href: '/customers' },
      { label: 'Reviews', permissions: ['reviews:moderate'], phase: 16, href: '/reviews' },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { label: 'Coupons', permissions: ['coupons:read'], phase: 17, href: '/coupons' },
      { label: 'Message templates', permissions: ['settings:read'], phase: 17, href: '/messaging' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Analytics', permissions: ['analytics:read'], phase: 18, href: '/analytics' },
      { label: 'GST & finance', permissions: ['analytics:read', 'payments:read'], phase: 18, href: '/finance' },
      { label: 'Audit log', permissions: ['audit:read'], phase: 18, href: '/audit' },
      { label: 'Operations', permissions: ['ops:read'], phase: 18, href: '/ops' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'Store settings', permissions: ['settings:read'], phase: 19, href: '/settings' },
      { label: 'Policy documents', permissions: ['catalog:read'], phase: 19, href: '/settings/policies' },
      { label: 'Team', permissions: ['team:manage'], phase: 19, href: '/settings/team' },
      { label: 'Integrations', permissions: ['integrations:read'], phase: 19, href: '/settings/integrations' },
      { label: 'Feature flags & app versions', permissions: ['settings:read'], phase: 19, href: '/settings/platform' },
    ],
  },
];

function NavContent({
  user,
  onNavigate,
}: {
  user: SafeOperator | null;
  onNavigate?: (() => void) | undefined;
}): ReactNode {
  const groups = navigation
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !item.permissions.length ||
          Boolean(user && item.permissions.some((permission) => can(user, permission))),
      ),
    }))
    .filter((group) => group.items.length);
  const linkClick = onNavigate ?? (() => undefined);
  return (
    <>
      <Link className="shell-wordmark" href="/" onClick={linkClick}>
        <strong>
          JIMMY <em>&amp;</em> WAX
        </strong>
        <small>OPERATOR CONSOLE</small>
      </Link>
      <nav aria-label="Primary navigation">
        {groups.map((group) => (
          <section className="shell-nav-group" key={group.label}>
            <h2>{group.label}</h2>
            {group.items.map((item) =>
              item.href ? (
                <Link
                  data-nav-item={item.label}
                  key={item.label}
                  href={item.href}
                  onClick={linkClick}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  data-nav-item={item.label}
                  key={item.label}
                  title={`Available in Phase ${item.phase}`}
                >
                  <span>{item.label}</span>
                  <small>Phase {item.phase}</small>
                </span>
              ),
            )}
          </section>
        ))}
      </nav>
    </>
  );
}

export function AppShell({
  children,
  breadcrumbs = ['Foundations'],
}: {
  children: ReactNode;
  breadcrumbs?: string[];
}): ReactNode {
  const router = useRouter();
  const pathname = usePathname();
  const safeReturnPath = isSafeNextPath(pathname) ? pathname : '/';
  const [user, setUser] = useState<SafeOperator | null>(null);
  // Cached API data belongs to one operator. Signing out or switching operator starts a fresh cache, but the first
  // "Checking session" -> signed-in transition keeps it, so a form opened while the page was settling is not wiped.
  const [cacheOwner, setCacheOwner] = useState<{ id: string | null; epoch: number }>({ id: null, epoch: 0 });
  const currentOwnerId = user?.userId ?? null;
  if (cacheOwner.id !== currentOwnerId) {
    setCacheOwner({ id: currentOwnerId, epoch: cacheOwner.id === null && cacheOwner.epoch === 0 ? 0 : cacheOwner.epoch + 1 });
  }
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpRecovery, setStepUpRecovery] = useState(false);
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [stepUpPending, setStepUpPending] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [reauthStage, setReauthStage] = useState<ReauthStage>('password');
  const [reauthEmail, setReauthEmail] = useState('');
  const [reauthCode, setReauthCode] = useState('');
  const [reauthRecovery, setReauthRecovery] = useState(false);
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [reauthPending, setReauthPending] = useState(false);
  const [idleWarning, setIdleWarning] = useState(false);
  const [idleMinutesRemaining, setIdleMinutesRemaining] = useState(5);
  const queryRef = useRef<HTMLInputElement>(null);
  const paletteTriggerRef = useRef<HTMLElement | null>(null);
  const lastActivityRef = useRef(0);
  const hadSessionRef = useRef(false);
  const reauthStageRef = useRef<ReauthStage>('password');
  const reauthPasswordRef = useRef<HTMLInputElement>(null);

  const loadSession = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/session', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        setSessionUnavailable(true);
        return;
      }
      const parsed = z
        .object({
          user: safeOperatorSchema.nullable(),
          unavailable: z.boolean().optional(),
          mfaChallenge: z.enum(['verify', 'enroll']).optional(),
        })
        .safeParse((await response.json()) as unknown);
      if (!parsed.success) {
        setSessionUnavailable(true);
        return;
      }
      setSessionUnavailable(Boolean(parsed.data.unavailable));
      if (!parsed.data.user && parsed.data.mfaChallenge) {
        const next = isSafeNextPath(window.location.pathname) ? window.location.pathname : '/';
        router.replace(
          `/login/${parsed.data.mfaChallenge === 'verify' ? 'mfa' : 'enroll'}?next=${encodeURIComponent(next)}`,
        );
        return;
      }
      if (parsed.data.user && reauthStageRef.current === 'password') {
        hadSessionRef.current = true;
        setUser(parsed.data.user);
        setSessionEnded(false);
        if (parsed.data.user.mfa && parsed.data.user.aal === 'aal2') {
          const resumePendingAction = stepUpOpen;
          setStepUpOpen(false);
          setStepUpCode('');
          setStepUpError(null);
          if (resumePendingAction) window.dispatchEvent(new Event('jw:mfa-verified'));
        }
      } else if (!parsed.data.user && reauthStageRef.current === 'password') {
        setUser(null);
        if (hadSessionRef.current) {
          setReauthStage('password');
          setSessionEnded(true);
        }
      }
    } catch {
      setSessionUnavailable(true);
    } finally {
      setSessionLoading(false);
    }
  }, [router, stepUpOpen]);

  const logout = useCallback(async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* the local encrypted cookie is still cleared by the BFF on valid CSRF */
    }
    hadSessionRef.current = false;
    setUser(null);
    setSessionEnded(false);
    router.replace('/login');
    router.refresh();
  }, [router]);

  const expireForIdle = useCallback(async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* keep the page locked even if the gateway is temporarily unavailable */
    }
    hadSessionRef.current = true;
    reauthStageRef.current = 'password';
    setReauthStage('password');
    setReauthError(null);
    setUser(null);
    setSessionEnded(true);
  }, []);

  const setStage = (stage: ReauthStage) => {
    reauthStageRef.current = stage;
    setReauthStage(stage);
  };
  const completeReauthentication = (operator: SafeOperator) => {
    hadSessionRef.current = true;
    setUser(operator);
    setSessionEnded(false);
    setStage('password');
    setReauthCode('');
    setReauthRecovery(false);
    setReauthError(null);
    if (reauthPasswordRef.current) reauthPasswordRef.current.value = '';
    window.dispatchEvent(new Event('jw:session-updated'));
  };

  const resumeExistingPage = async () => {
    setReauthPending(true);
    setReauthError(null);
    try {
      const response = await fetch('/api/auth/session', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        setReauthError('The session is still unavailable. Complete sign-in or try again.');
        return;
      }
      const payload = z
        .object({ user: safeOperatorSchema.nullable() })
        .safeParse((await response.json()) as unknown);
      if (!payload.success || !payload.data.user) {
        setReauthError('The operator session is not ready yet. Finish MFA setup and try again.');
        return;
      }
      completeReauthentication(payload.data.user);
    } catch {
      setReauthError('The session could not be checked. Try again when connectivity returns.');
    } finally {
      setReauthPending(false);
    }
  };

  const reauthenticate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setReauthPending(true);
    setReauthError(null);
    try {
      if (reauthStage === 'password') {
        const password = reauthPasswordRef.current?.value ?? '';
        const response = await authFetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: reauthEmail, password }),
        });
        if (!response.ok) {
          const error = await readError(response);
          setReauthError(
            error.code === 'RATE_LIMITED'
              ? `Too many attempts. Wait about ${error.retryAfter ?? 60} seconds, then try again.`
              : 'We could not verify those sign-in details. Check them and try again.',
          );
          return;
        }
        const result = z
          .object({
            user: safeOperatorSchema,
            mfaRequired: z.boolean(),
            enrollmentRequired: z.boolean(),
          })
          .safeParse((await response.json()) as unknown);
        if (!result.success) {
          setReauthError('The sign-in response did not match the verified backend contract.');
          return;
        }
        if (reauthPasswordRef.current) reauthPasswordRef.current.value = '';
        if (result.data.enrollmentRequired) {
          setStage('enroll');
          return;
        }
        if (result.data.mfaRequired) {
          setStage('mfa');
          setReauthCode('');
          return;
        }
        completeReauthentication(result.data.user);
        return;
      }
      if (reauthStage === 'mfa') {
        const response = await authFetch('/api/auth/mfa/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            reauthRecovery ? { recoveryCode: reauthCode.trim() } : { code: reauthCode },
          ),
        });
        if (!response.ok) {
          setReauthError(
            'That verification code was not accepted. Check your device time or try an unused recovery code.',
          );
          return;
        }
        await resumeExistingPage();
        return;
      }
      await resumeExistingPage();
    } catch {
      setReauthError('Sign-in could not be completed. Your current page is still open; try again.');
    } finally {
      setReauthPending(false);
    }
  };

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadSession(), 0);
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') void loadSession();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadSession();
    }, 60_000);
    window.addEventListener('jw:session-updated', loadSession);
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
      window.removeEventListener('jw:session-updated', loadSession);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, [loadSession]);

  useEffect(() => {
    if (!user?.userId) return;
    lastActivityRef.current = Date.now();
    let expired = false;
    const markActive = () => {
      lastActivityRef.current = Date.now();
      setIdleWarning(false);
      setIdleMinutesRemaining(5);
    };
    const checkIdle = () => {
      const idleFor = Date.now() - lastActivityRef.current;
      if (idleFor >= 30 * 60_000) {
        if (!expired) {
          expired = true;
          void expireForIdle();
        }
        return;
      }
      if (idleFor >= 25 * 60_000) {
        setIdleWarning(true);
        setIdleMinutesRemaining(Math.max(1, Math.ceil((30 * 60_000 - idleFor) / 60_000)));
      }
    };
    const interval = window.setInterval(checkIdle, 5_000);
    for (const eventName of ['pointerdown', 'keydown', 'touchstart'])
      window.addEventListener(eventName, markActive, { passive: true });
    document.addEventListener('visibilitychange', checkIdle);
    return () => {
      window.clearInterval(interval);
      for (const eventName of ['pointerdown', 'keydown', 'touchstart'])
        window.removeEventListener(eventName, markActive);
      document.removeEventListener('visibilitychange', checkIdle);
    };
  }, [user?.userId, expireForIdle]);

  const openPalette = () => {
    paletteTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPaletteOpen(true);
  };
  const closePalette = () => {
    setPaletteOpen(false);
    window.setTimeout(() => paletteTriggerRef.current?.focus(), 0);
  };
  useEffect(() => {
    if (paletteOpen) window.setTimeout(() => queryRef.current?.focus(), 0);
  }, [paletteOpen]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !editable) {
        event.preventDefault();
        openPalette();
      }
      if (event.key === 'Escape' && paletteOpen) {
        event.preventDefault();
        closePalette();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen]);
  useEffect(() => {
    const onMfa = () => {
      setStepUpOpen(true);
      setStepUpError(null);
      setStepUpCode('');
    };
    window.addEventListener('jw:mfa-required', onMfa);
    return () => window.removeEventListener('jw:mfa-required', onMfa);
  }, []);
  useEffect(() => {
    const onSessionEnded = () => {
      if (!hadSessionRef.current) return;
      setUser(null);
      reauthStageRef.current = 'password';
      setReauthStage('password');
      setReauthCode('');
      setReauthError(null);
      setSessionEnded(true);
    };
    window.addEventListener('jw:session-ended', onSessionEnded);
    return () => window.removeEventListener('jw:session-ended', onSessionEnded);
  }, []);

  const groups = navigation
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !item.permissions.length ||
          Boolean(user && item.permissions.some((permission) => can(user, permission))),
      ),
    }))
    .filter((group) => group.items.length);
  const commands = groups
    .flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })))
    .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));

  const verifyStepUp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStepUpPending(true);
    setStepUpError(null);
    try {
      const response = await authFetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          stepUpRecovery ? { recoveryCode: stepUpCode.trim() } : { code: stepUpCode },
        ),
      });
      if (!response.ok) {
        setStepUpError((await readError(response)).message);
        return;
      }
      setStepUpOpen(false);
      setStepUpCode('');
      window.dispatchEvent(new Event('jw:session-updated'));
      window.dispatchEvent(new Event('jw:mfa-verified'));
    } catch {
      setStepUpError('Verification could not be completed. Try again.');
    } finally {
      setStepUpPending(false);
    }
  };

  const cancelStepUp = () => {
    setStepUpOpen(false);
    setStepUpCode('');
    window.dispatchEvent(new Event('jw:mfa-cancelled'));
  };

  const roleLabel = user ? user.role.replaceAll('_', ' ') : null;
  return (
    <QueryProvider key={cacheOwner.epoch}>
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <aside className="shell-sidebar">
        <NavContent user={user} />
      </aside>
      <header className="shell-topbar">
        <IconButton
          label="Open navigation"
          className="shell-menu"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu size={20} aria-hidden="true" />
        </IconButton>
        <div className="shell-breadcrumbs" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, index) => (
            <span key={crumb}>
              {index ? ' / ' : ''}
              {crumb}
            </span>
          ))}
        </div>
        <div className="shell-topbar__actions">
            <button
              type="button"
              className="shell-search"
              aria-label="Find a workspace (⌘ K)"
              onClick={openPalette}
            >
            <Search size={16} aria-hidden="true" />
            <span>Find a workspace</span>
            <kbd>⌘ K</kbd>
          </button>
          <StatusPill tone={sessionUnavailable ? 'negative' : user ? 'positive' : 'warning'}>
            {sessionUnavailable
              ? 'Session check unavailable'
              : sessionLoading
                ? 'Checking session'
                : user
                  ? `Signed in · ${roleLabel}`
                  : 'No operator session'}
          </StatusPill>
          <Badge>{process.env.NODE_ENV === 'development' ? 'LOCAL' : 'PRODUCTION'}</Badge>
          {user ? (
            <details className="shell-account">
              <summary aria-label={`Account menu, ${roleLabel}`}>
                <Avatar name={roleLabel ?? 'Operator'} />
                <span>{roleLabel}</span>
              </summary>
              <div className="shell-account__menu">
                <p>{user.mfa ? 'MFA enrolled' : 'MFA not enrolled'}</p>
                <Link href="/account/security">Account security</Link>
                <button type="button" onClick={() => void logout()}>
                  Sign out
                </button>
              </div>
            </details>
          ) : (
            <Link className="shell-sign-in" href="/login">
              Sign in
            </Link>
          )}
        </div>
      </header>
      {idleWarning ? (
        <div className="shell-idle-warning" role="status">
          <span>
            You’ll be signed out after inactivity in about {idleMinutesRemaining}{' '}
            {idleMinutesRemaining === 1 ? 'minute' : 'minutes'}. Unsent work will stay in this tab
            until you sign in again.
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              lastActivityRef.current = Date.now();
              setIdleWarning(false);
              setIdleMinutesRemaining(5);
            }}
          >
            Continue working
          </Button>
        </div>
      ) : null}
      <StorePauseBanner />
      <main id="main-content" className="shell-main" tabIndex={-1}>{children}</main>
      {drawerOpen ? (
        <div
          className="shell-drawer-backdrop"
          role="presentation"
          onMouseDown={() => setDrawerOpen(false)}
        >
          <aside
            className="shell-drawer"
            aria-label="Mobile navigation"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <IconButton label="Close navigation" onClick={() => setDrawerOpen(false)}>
              <X size={20} aria-hidden="true" />
            </IconButton>
            <NavContent user={user} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      ) : null}
      {paletteOpen ? (
        <div className="palette-backdrop" role="presentation" onMouseDown={closePalette}>
          <section
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div>
              <Command size={17} aria-hidden="true" />
              <input
                ref={queryRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a workspace"
                aria-label="Find a workspace"
              />
              <kbd>Esc</kbd>
            </div>
            <ul>
              {commands.length ? (
                commands.map((command) => (
                  <li key={command.label}>
                    <button type="button" disabled={!command.href} onClick={closePalette}>
                      <span>{command.label}</span>
                      <small>
                        {command.href ? command.group : `Available in Phase ${command.phase}`}
                      </small>
                    </button>
                  </li>
                ))
              ) : (
                <li className="command-palette__empty">No matching workspace</li>
              )}
            </ul>
          </section>
        </div>
      ) : null}
      <Dialog
        open={stepUpOpen}
        onOpenChange={(open) => { if (open) setStepUpOpen(true); else cancelStepUp(); }}
        title="Verify this action"
        footer={
          user?.mfa ? (
            <>
              <Button variant="secondary" onClick={cancelStepUp}>
                Cancel
              </Button>
              <Button form="step-up-form" type="submit" loading={stepUpPending}>
                Verify
              </Button>
            </>
          ) : (
            <Button onClick={cancelStepUp}>Close</Button>
          )
        }
      >
        {user?.mfa ? (
          <>
            <p>
              The backend refused the first attempt before making changes. Verify to retry that
              exact request once; cancel to return to the form without retrying.
            </p>
            <form id="step-up-form" onSubmit={(event) => void verifyStepUp(event)}>
              <Input
                label={stepUpRecovery ? 'Recovery code' : 'Authenticator code'}
                value={stepUpCode}
                onChange={(event) => setStepUpCode(event.target.value)}
                inputMode={stepUpRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                required
                maxLength={stepUpRecovery ? 20 : 6}
                pattern={stepUpRecovery ? undefined : '[0-9]{6}'}
                error={stepUpError ?? undefined}
              />
            </form>
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                setStepUpRecovery(!stepUpRecovery);
                setStepUpCode('');
                setStepUpError(null);
              }}
            >
              {stepUpRecovery ? 'Use authenticator code' : 'Use a recovery code'}
            </button>
          </>
        ) : (
          <>
            <p>
              No authenticator is enrolled for this account yet. Keep this page open, set up MFA in
              another tab, then check this session. The refused request will retry once after verification.
            </p>
            <Link href="/login/enroll?next=%2F" target="_blank" rel="noopener noreferrer">
              Set up an authenticator in a new tab
            </Link>
            <Button variant="secondary" onClick={() => void loadSession()}>
              I finished setup — check this session
            </Button>
          </>
        )}
      </Dialog>
      <Dialog
        open={sessionEnded}
        onOpenChange={() => undefined}
        dismissible={!sessionEnded}
        title="Your operator session ended"
      >
        <p>
          Your current access was revoked or expired. This page and its in-memory work remain open,
          but no changes can be sent until you sign in again.
        </p>
        {reauthStage === 'password' ? (
          <form onSubmit={(event) => void reauthenticate(event)}>
            <Input
              label="Work email"
              type="email"
              autoComplete="username"
              value={reauthEmail}
              onChange={(event) => setReauthEmail(event.target.value)}
              required
            />
            <Input
              ref={reauthPasswordRef}
              label="Password"
              type="password"
              autoComplete="current-password"
              required
            />
            <Button type="submit" loading={reauthPending}>
              Sign in and return to this page
            </Button>
          </form>
        ) : null}
        {reauthStage === 'mfa' ? (
          <form onSubmit={(event) => void reauthenticate(event)}>
            <Input
              label={reauthRecovery ? 'Recovery code' : 'Authenticator code'}
              value={reauthCode}
              onChange={(event) => setReauthCode(event.target.value)}
              inputMode={reauthRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              required
              maxLength={reauthRecovery ? 20 : 6}
              pattern={reauthRecovery ? undefined : '\\d{6}'}
            />
            <Button type="submit" loading={reauthPending}>
              Verify and return to this page
            </Button>
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                setReauthRecovery(!reauthRecovery);
                setReauthCode('');
              }}
            >
              {reauthRecovery ? 'Use authenticator code' : 'Use recovery code'}
            </button>
          </form>
        ) : null}
        {reauthStage === 'enroll' ? (
          <>
            <p>
              This account must finish MFA setup before it can continue. Open the secure setup in a
              new tab; this page will stay here with its unsent work.
            </p>
            <a
              className="ui-button ui-button--primary"
              href={`/login/enroll?next=${encodeURIComponent(safeReturnPath)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open MFA setup in a new tab
            </a>
            <Button
              variant="secondary"
              loading={reauthPending}
              onClick={() => void resumeExistingPage()}
            >
              I finished setup — check this session
            </Button>
          </>
        ) : null}
        {reauthError ? (
          <p className="auth-error" role="alert">
            {reauthError}
          </p>
        ) : null}
        <p className="auth-footnote">
          If you leave this page, unsaved changes will be discarded.{' '}
          <Link
            href={`/login?next=${encodeURIComponent(safeReturnPath)}`}
          >
            Leave and start sign in
          </Link>
        </p>
      </Dialog>
    </div>
    </QueryProvider>
  );
}

# Phase 03 thinking — authentication, encrypted BFF sessions, MFA and RBAC

Status: **COMPLETE** · 2026-10-07 IST

## 1. Re-grounding and users/jobs

### Authoritative verified operations

The live local gateway was probed against an isolated, disposable admin account. No browser token, password, TOTP secret or recovery code was printed or retained. The contract and live results agree on these operations:

| Operation | Contract / live result | Dashboard use |
| --- | --- | --- |
| `POST /v1/auth/login` | request `{email,password,client:'admin'}`; 200 keys `accessToken, refreshToken, expiresIn, tokenType, aal, user, mfa` | initial BFF session |
| `POST /v1/auth/refresh` | `{refreshToken}`; rotates pair, 200 token keys | server-only single-flight renewal |
| `POST /v1/auth/logout` | `{refreshToken}`; 204 | revoke then clear local session |
| `GET /v1/admin/me` | 200 `userId, role, permissions, mfa` | safe user/session response and permission truth |
| `POST /v1/auth/mfa/enroll` | bearer; 201 `secret, otpauthUri` | one-time browser enrollment screen |
| `POST /v1/auth/mfa/verify` | bearer + `{code}` or source-confirmed `{recoveryCode}`; 200 `accessToken, expiresIn, aal` | replace only server session access token with aal2 token |
| `POST /v1/auth/mfa/recovery-codes` | bearer aal2; live 201 `{codes}` with 8 codes | one-time recovery display |
| `GET /v1/admin/sessions` | bearer; live 200 `{items}` with `id,client,aal,current,startedAt,lastSeenAt` | account security session list |
| `DELETE /v1/admin/sessions/{id}` | bearer; 204 | revoke an individual session |
| `POST /v1/auth/password/change` | bearer, `{currentPassword,newPassword}`, 204 | current-device password change |
| `POST /v1/auth/invite/accept` | live handler: `{token,password,fullName}`; actual 201 success `{email,role}`; no session is issued | one-use invite form followed by explicit password sign-in |

The current OpenAPI has broad `object` responses for recovery, invitation and sessions. Exact live shapes are recorded above. Invitation accept succeeded through the BFF against a temporary hashed-token fixture; the real local sender redacted its email-outbox payload after delivery. The accept operation itself is real, not mocked.

### Roles: five jobs and fast/safe definition

| Role | Auth/RBAC jobs | Fast and safe |
| --- | --- | --- |
| Admin | sign in; enroll MFA; step up; inspect/revoke sessions; reach permitted platform areas | no secret leaves BFF, role is server-derived, dangerous action retries once |
| Support | sign in; recover from expired session; see only support navigation; open security info; sign out shared device | generic errors avoid account disclosure; no hidden finance/settings affordance |
| Catalog | sign in; confirm catalog/media scope; enter/read Studio; enroll MFA; handle deep link denial | navigation follows verified permissions, not client role guess |
| Fulfilment | sign in quickly on operational device; keep working through access expiry; complete MFA-gated stock/cancel flow; sign out; see session state | refresh is race-safe; expired/revoked session preserves in-memory draft locally but blocks send |
| Finance | sign in; see finance/audit scope; step up for refunds; review sessions; rotate recovery codes | recovery display is one-time and never cached/logged |
| Designer | sign in; use experience/media scope; enroll/verify MFA; recover from sign-out; understand denied deep link | Studio never receives access/refresh token in client JavaScript |

## 2. State machines and data flow

### Server-only encrypted session

```
signed out
  -> BFF login validates origin + payload -> backend login client=admin
  -> encrypted httpOnly cookie {access, refresh, accessExpiresAt, user-safe cache, csrfSecret}
  -> signed in aal1

signed in aal1 -> BFF MFA verify -> replace access token only with aal2 -> signed in aal2
aal2 expiry / refreshed access with aal1 -> signed in aal1
logout or definitive refresh 401 -> clear cookie -> signed out
network refresh failure -> session uncertain (retain cookie, return retryable unavailable; never clear)
protected call -> backend 403 MFA_REQUIRED -> keep request pending -> step-up dialog
verified aal2 (same or new tab) -> retry exact repeatable request once -> resolve form
cancel step-up -> return original 403 to form; do not retry
revocation elsewhere -> next protected request/refresh 401 -> clear cookie -> re-auth dialog; keep route/draft in memory
```

Cookie payload is AES-GCM encrypted and authenticated with a 32-byte server secret. It contains no value readable by browser JavaScript. Cookie settings are `httpOnly`, `Secure` outside local HTTP, `SameSite=Strict`, `Path=/`, minimal `Max-Age`; the CSRF proof is a separate non-secret same-site readable cookie/header pair or server-origin check. For this same-origin dashboard BFF, use both `Origin`/`Referer` validation on writes and a non-httpOnly CSRF token returned only from `/api/auth/session`; reject missing/mismatch tokens before touching backend.

### Refresh serialization

```
request -> session access valid -> backend call
request -> access expired / backend 401 -> session-keyed refresh lock
  leader: POST refresh once -> atomically write rotated pair -> retry original once
  followers: await leader -> read replacement pair -> retry once
refresh 401 -> atomically clear cookie; return signed-out
refresh timeout/5xx -> do not clear; return retryable unavailable
```

The lock is per Next server process, which prevents concurrent routes in one instance. Multiple server instances cannot share that lock; the local cookie envelope is not a distributed coordinator. A production multi-instance deployment requires a shared lock/session store before claiming cross-instance refresh safety.

### Access proxy and MFA retry

```
feature -> BFF proxy validates CSRF/write headers -> attach bearer
  -> 2xx: return sanitized response
  -> 401: refresh once, retry original once
  -> 403 MFA_REQUIRED: open global step-up; keep action pending
browser -> BFF MFA verify -> write aal2 session -> resolve step-up waiter
authFetch -> replay exact repeatable request once -> resolve form
cancel -> return original 403; no retry
```

An explicit backend MFA_REQUIRED is a definitive refusal before the permission-gated mutation runs. The owner-required behavior is to retry that exact request once only after successful MFA. Never retry on a network/timeout error, an ambiguous response or after cancel. JSON strings, FormData, Blob and byte buffers are replayable; one-shot ReadableStreams are not and require a feature upload helper with explicit retry semantics.

### UI/session states

```
route entry -> session loading -> signed out redirect (/login?next=<relative>)
                     | signed in -> permission allowed -> content
                                      -> permission denied -> NotAllowedState (403 preserved)
login -> password pending -> generic invalid | rate-limited countdown | MFA prompt | success
revoked elsewhere -> next BFF response -> re-login dialog; preserve unsent in-memory draft
idle 25m -> accessible warning; activity -> dismiss/reset; 30m -> POST logout then /login
```

The `next` path is accepted only if it starts with one slash and not two, contains no scheme, and is not an API/auth/dev route. Client has safe user `{userId, role, permissions, mfa}` only; it never receives access/refresh tokens, session id, MFA seed, recovery code, password, invite token beyond form submission, or raw authentication error internals.

## 3. Deep-think decisions

### BFF and cookie design

Use the backend’s own password identity instead of Clerk/Auth0/Descope because this single-store backend issues the required rotating access/refresh pair and owns MFA/audit semantics. The alternative of placing the refresh token in a browser cookie directly is rejected: the BFF must decrypt and submit it, and the browser must never post/receive it. The cookie is a compact encrypted session envelope, not a JWT; this permits rotation without exposing claims and allows future server-side invalidation.

Use `DASHBOARD_SESSION_SECRET`, a base64-encoded 32-byte key. Local development explicitly uses a per-terminal ephemeral key in the runbook; restarting loses that key and invalidates local sessions. Production injects a persistent secret from the host secret manager and keeps Secure cookies enabled. Rotation across current/previous keys is deferred until deployment has a key-management source.

### CSRF and headers

Write BFF operations require `Origin`/`Referer` same-origin validation **and** a custom `x-csrf-token` matching a non-secret `jw_csrf` cookie. Login/invite acceptance are also protected by Origin check and rate limits; they do not rely on a pre-existing token. GET/HEAD/OPTIONS never require CSRF. Cross-origin requests reject with a local 403 before backend call. The alternative of `SameSite=Strict` alone is rejected because browser behavior and future embedded surfaces can change.

### MFA and recovery

MFA enrollment returns secret/otpauth only once and is never written to React state beyond the current route lifecycle, local storage, telemetry, URL, or screenshots. The enrollment page shows the secret only after an explicit reveal/copy control; QR rendering must be local data URI/SVG without third-party script. Recovery codes render once after an aal2 backend response; a download is generated locally and no later route can retrieve plaintext codes. The current contract’s actual count is 8, not the phase prose’s 10; UI must display returned count, never hard-code either.

Step-up globally holds a request after an explicit backend MFA_REQUIRED refusal, then retries that exact repeatable request once after aal2 is confirmed. Cancellation preserves the original refusal and does not retry. Recovery-code fallback posts `{recoveryCode}` once; TOTP failures show a generic backend message and device-time guidance, without counting client guesses.

### Permission source

`GET /v1/admin/me` supplies the runtime role/effective permissions. A TypeScript role map mirrors the owner matrix for navigation declarations, code review and tests; it does not override backend effective permissions. `can()` uses the safe `permissions` array, `<Can>` hides an affordance, and server/layout guards redirect or render NotAllowedState. Deep links are still checked through BFF/backend: hiding navigation is never authorization.

### Idle handling and error language

After 25 minutes without input/pointer/visibility activity, show a non-modal accessible warning. At 30 minutes, call BFF logout best-effort, erase cookie and route to login. Server expiry is still authoritative; 15-minute access expiration can refresh a working session. Login uses the backend generic refusal verbatim/safe generic fallback; account locking shows Retry-After countdown with `aria-live=polite`, but never says whether the address exists. Network failure retains the session and offers retry.

### Security headers

Set CSP using per-request nonce (`script-src 'self' 'nonce-…'`; no `unsafe-inline`, no third-party scripts), `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'`, `form-action 'self'`, `referrer-policy: strict-origin-when-cross-origin`, restrictive Permissions-Policy, `X-Content-Type-Options: nosniff` and HSTS only in HTTPS deployment. Next’s inline framework script needs the nonce path tested; if a nonce architecture is incompatible with the current build, do not fall back to `unsafe-inline`—record the exact limitation.

## 4. Pre-mortem and controls

1. Refresh token reuse from two requests revokes session family — per-session single-flight, one retry, architecture risk documented for multi-instance deployment.
2. XSS reads tokens — token envelope httpOnly encrypted, never serialized, strict nonce CSP, no browser storage.
3. Cross-site POST or invite-code query leaks through request logs — Origin/Referer and CSRF proof precede BFF dispatch; invitation code is entered in a body field, never a URL; e2e hostile-Origin and URL checks.
4. Client says a user has permission backend denies — `/admin/me` runtime permissions plus backend 403/NotAllowed state; client is cosmetic only.
5. Step-up handler double-submits an order/refund mutation — only an explicit MFA_REQUIRED can enter the waiter, cancel never replays, and the exact request is sent no more than twice.
6. Recovery code or MFA secret persists — one-time state, no logs/storage, secret cleared on route unmount, scan responses/storage.
7. Login errors enumerate operators — same generic UI for bad email/password/disabled; backend remains authority.
8. Redirect after login becomes open redirect or an invite token leaks in a URL — validate relative paths; accept invite codes only in a labeled POST form field.
9. Revocation loses a customer-impacting form draft — retain unsent draft in memory, show re-login; never send after re-login without renewed confirm.
10. Security headers block Next runtime or external font, or screenshot captures loading state — production/e2e CSP test; self-hosted `next/font`; evidence waits for verified role and loaded sessions.

## 5. Security and privacy

Sensitive data: email, passwords, bearer/refresh tokens, session metadata, TOTP secret, recovery codes and invitation tokens. Passwords are posted only to same-origin BFF over HTTPS in production and never placed in React devtools state beyond controlled input DOM. Route handlers redact authorization, cookie, password, TOTP/recovery/invite fields from errors/logging. Responses return only safe identity. Cookies are cleared with matching path/options. Session fixation is mitigated by making a fresh encrypted BFF session only after backend login/accept; logout clears it. Clickjacking is denied by CSP; cache-control is `no-store` on auth/session routes. Rate limits originate at backend; UI never tries to bypass them.

## 6. Performance and accessibility budgets

- Session check target <250ms local p95 excluding backend cold start; never block initial keyboard focus indefinitely—announce loading after 500ms.
- Refresh lock wait target <5s then retryable error; never retry login/auth mutations automatically. A business request retries once only after explicit MFA_REQUIRED.
- Login/MFA submit has one pending state, first error focus, and no layout shift.
- Every form control has label/description/error relation; masked recovery display has copy/download buttons and a visible “saved” confirmation gate.
- Dialog focus traps/returns; idle warning is announced but non-modal; countdown updates no more than once/second and respects reduced motion.
- Zero axe serious/critical violations on login, MFA enrollment, account security and denied states; 375px login works without horizontal scrolling.

## 7. Test plan (named before coding)

### Unit

- `encryptSession round trips and rejects altered envelope`
- `csrf validator rejects absent, mismatched and cross-origin mutations`
- `safeNext accepts only relative application destinations`
- `permission helper mirrors all six role matrices`
- `refresh coordinator calls refresh once for concurrent requests`
- `definitive refresh 401 clears session while network failure preserves it`
- `auth error parser redacts sensitive fields`

### Route/component

- `login BFF sends client admin and stores only encrypted cookie`
- `session BFF returns safe user but never token keys`
- `login error is generic and rate-limit exposes Retry-After countdown`
- `MFA verify replaces server access token and never returns it`
- `recovery codes response is no-store and plaintext is not persisted`
- `logout clears BFF cookie even if backend logout is already complete`
- `Can hides forbidden action and server guard returns NotAllowedState`

### Real-backend/E2E

- `admin/support/catalog/fulfilment/finance/designer login returns exact allowed nav`
- `role-specific real backend calls deny missing permission`; operational page-level NotAllowed routes wait for their feature phase
- `MFA enrollment -> verify -> rotate recovery -> code single-use`
- `MFA-required test mutation waits at step-up then retries once after verification`
- `session list revokes another current-user session; revoked access forces re-login`
- `refresh rotation is used once; old refresh never replayed`
- `cross-origin BFF POST is rejected before backend dispatch`
- `cookies/storage/network body contain no access or refresh token`

## 8. Vertical slices

1. Typed safe-user/permissions, encrypted envelope, cookie/CSRF/Next header primitives with unit tests.
2. Server-only backend API client, error mapping and refresh coordinator; real login/me/refresh/logout traces.
3. Auth BFF routes and minimal `/login`; protect app shell and replace anonymous status from session endpoint.
4. MFA enrollment, verification, recovery display and global StepUpDialog connection.
5. Security account/sessions, invitation acceptance, idle/revocation UX and route guards.
6. All-role real-backend e2e, CSP/CSRF/token-leak checks, docs and handoff.

## Review findings and changes

1. A process-local refresh map does not solve multi-instance concurrency. Added an explicit deployment prerequisite/shared coordinator risk rather than overstating safety.
2. The phase prose says ten recovery codes, while live backend returned eight. UI will show the returned count and record the contract distinction.
3. Rejecting all automatic retry did not match the owner's phase contract. The final flow waits for an explicit MFA_REQUIRED refusal, retries a repeatable exact request once after aal2, and never retries on a network ambiguity or cancel.
4. OpenAPI's broad objects could invite invented invite/session fields. Live shapes are captured; accept-then-login is verified, while the invitation email's raw code cannot be recovered after the local sender redacts its outbox payload.
5. SameSite cookie alone was insufficient CSRF defense. Added Origin/Referer plus double-submit proof for mutating BFF routes.
6. A generated development encryption key would make local sessions disappear and train insecure behavior. Require explicit secret in local config too.
7. Hiding nav could be misread as authorization. Added server layout/BFF/backend negative checks.
8. Enrollment QR/recovery content could leak through analytics/screenshot tooling. Prohibited third-party scripts and persistent capture; exact output lives only in current interaction.
9. Dev request logs captured query-string invite codes before the old client cleanup ran. Replaced query parsing with explicit invitation-code input, matching the actual email instructions.
10. Early responsive screenshots captured signed-out/loading state. Evidence now waits for confirmed role and loaded session cards.

## Handoff

Phase 4 must use the BFF path only, never call the backend from browser code. It needs `authFetch`, safe user/permission data and mapped `ApiError`; it must not read or create tokens. Every mutation must declare idempotency/concurrency and use a replayable body when relying on automatic step-up retry.

## Implementation checkpoint

Implemented, live-tested and type/lint/unit verified: permission constants; AES-GCM server session envelope; CSRF primitives; typed backend auth client; BFF login, safe-session disclosure, logout, MFA enrollment/verification, recovery-code rotation, invite acceptance and session-list/revoke routes; client CSRF helper; `/login`, `/login/mfa`, `/login/enroll`, `/invite`, and `/account/security`.

Live evidence: all six disposable local operator roles authenticate with exact navigation; safe session responses/cookies are checked; MFA enrollment and recovery gate work; explicit MFA_REQUIRED retries the same request once; session revocation forces re-auth; logout clears the cookie; invitation accept is one-use and followed by separate sign-in.

Remaining for later phases: production multi-instance refresh coordinator and deployed TLS/Secure-cookie verification; password-change live E2E, 429 countdown E2E and operational page-level forbidden states when feature routes exist. Phase 03 acceptance is otherwise complete; backend documentation discrepancies DASH-BR-001/DASH-BR-002 remain open.

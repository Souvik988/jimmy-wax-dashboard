/** Pure helpers for the in-Studio preview. Kept separate so the rules are unit-tested. */

export const devices = [
  { id: 'phone', label: 'Phone', width: 375 },
  { id: 'tablet', label: 'Tablet', width: 768 },
  { id: 'desktop', label: 'Desktop', width: 1280 },
] as const;
export type DeviceId = (typeof devices)[number]['id'];

/** A path inside the storefront: starts with a single `/`, no protocol, no `//`, no backslashes, no query/fragment injection. */
export function safePreviewPath(input: string): string | null {
  const path = input.trim() || '/';
  if (!/^\/[A-Za-z0-9\-._~/%:]*$/u.test(path)) return null;
  if (path.startsWith('//') || path.includes('..')) return null;
  return path;
}

/** Storefront origin only (scheme + host[:port]); http is allowed solely for local development hosts. */
export function storefrontOriginOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.localhost');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch { return null; }
}

/** `https://shop.example/about?jw_preview=<token>`; null when the origin or path is not acceptable. */
export function buildStorefrontPreviewUrl(origin: string | undefined, token: string, path: string): string | null {
  const base = storefrontOriginOf(origin);
  const safe = safePreviewPath(path);
  if (!base || safe === null || token.length < 20 || token.length > 200) return null;
  const url = new URL(safe, base);
  url.searchParams.set('jw_preview', token);
  return url.toString();
}

/** The command an engineer runs to point a debug build of the Flutter app at the draft bundle. */
export function appPreviewCommand(token: string, apiOrigin: string | undefined): string {
  const api = ` --dart-define=API_ORIGIN=${apiOrigin ?? 'https://<your-api-origin>'}`;
  return `flutter run${api} --dart-define=EXPERIENCE_PREVIEW_TOKEN=${token}`;
}

/** Minutes left until an ISO expiry, never negative. */
export function minutesLeft(expiresAt: string, now: number = Date.now()): number {
  const ms = Date.parse(expiresAt) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 60_000)) : 0;
}

import { describe, expect, it } from 'vitest';

import { appPreviewCommand, buildStorefrontPreviewUrl, minutesLeft, safePreviewPath, storefrontOriginOf } from '@/features/studio/preview-model';

const token = 'tok_1234567890123456789012';

describe('preview URL safety', () => {
  it('accepts normal storefront paths and rejects anything that could leave the site', () => {
    for (const ok of ['/', '/about', '/custom/our-story', '/products/leather-polish', ' /about ', '']) expect(safePreviewPath(ok), ok).not.toBeNull();
    for (const bad of ['//evil.example', 'https://evil.example', '/a/../b', '/a b', '/a?x=1', '/a#f', '\\evil', 'javascript:alert(1)']) {
      expect(safePreviewPath(bad), bad).toBeNull();
    }
  });

  it('allows https storefronts, and http only for local development hosts', () => {
    expect(storefrontOriginOf('https://www.example.com/anything?x=1')).toBe('https://www.example.com');
    expect(storefrontOriginOf('http://localhost:5174')).toBe('http://localhost:5174');
    expect(storefrontOriginOf('http://127.0.0.1:5174')).toBe('http://127.0.0.1:5174');
    expect(storefrontOriginOf('http://www.example.com')).toBeNull();
    expect(storefrontOriginOf('https://user:pw@www.example.com')).toBeNull();
    expect(storefrontOriginOf('javascript:alert(1)')).toBeNull();
    expect(storefrontOriginOf(undefined)).toBeNull();
  });

  it('builds the preview URL with the token as the only query parameter', () => {
    const url = new URL(buildStorefrontPreviewUrl('https://www.example.com', token, '/about') as string);
    expect(url.origin).toBe('https://www.example.com');
    expect(url.pathname).toBe('/about');
    expect([...url.searchParams.keys()]).toEqual(['jw_preview']);
    expect(url.searchParams.get('jw_preview')).toBe(token);
  });

  it('refuses to build a URL for a bad origin, path or token', () => {
    expect(buildStorefrontPreviewUrl(undefined, token, '/')).toBeNull();
    expect(buildStorefrontPreviewUrl('http://www.example.com', token, '/')).toBeNull();
    expect(buildStorefrontPreviewUrl('https://www.example.com', token, '//evil.example')).toBeNull();
    expect(buildStorefrontPreviewUrl('https://www.example.com', 'short', '/')).toBeNull();
  });
});

describe('app preview helpers', () => {
  it('writes the exact dart-define command and never invents an API origin', () => {
    expect(appPreviewCommand(token, 'https://api.example.com')).toBe(`flutter run --dart-define=API_ORIGIN=https://api.example.com --dart-define=EXPERIENCE_PREVIEW_TOKEN=${token}`);
    expect(appPreviewCommand(token, undefined)).toContain('API_ORIGIN=https://<your-api-origin>');
  });

  it('counts minutes left and never goes negative', () => {
    const now = Date.parse('2026-10-10T10:00:00Z');
    expect(minutesLeft('2026-10-10T11:00:00Z', now)).toBe(60);
    expect(minutesLeft('2026-10-10T10:00:30Z', now)).toBe(1);
    expect(minutesLeft('2026-10-10T09:00:00Z', now)).toBe(0);
    expect(minutesLeft('not a date', now)).toBe(0);
  });
});

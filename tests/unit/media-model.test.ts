import { describe, expect, it } from 'vitest';

import { composeMediaLicenseEvidence, localMediaUrl, mediaContentLengthError, mediaFileError, sniffMediaKind } from '@/lib/api/resources/media-validation';

describe('media upload preflight', () => {
  it('recognizes only the magic-byte signatures supported by the backend', () => {
    expect(sniffMediaKind(Uint8Array.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image');
    expect(sniffMediaKind(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe('image');
    expect(sniffMediaKind(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image');
    expect(sniffMediaKind(Uint8Array.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]))).toBe('video');
    expect(sniffMediaKind(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('video');
    expect(sniffMediaKind(Uint8Array.from([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('font');
    expect(sniffMediaKind(Uint8Array.from([0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('font');
    expect(sniffMediaKind(Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('font');
    expect(sniffMediaKind(new TextEncoder().encode('<svg><script/>'))).toBeNull();
    expect(sniffMediaKind(new TextEncoder().encode('GIF89a........'))).toBeNull();
  });

  it('enforces the deliberately bounded dashboard caps before upload', () => {
    expect(mediaFileError('image', 15 * 1024 * 1024)).toBeNull();
    expect(mediaFileError('image', 15 * 1024 * 1024 + 1)).toContain('15 MiB');
    expect(mediaFileError('video', 15 * 1024 * 1024 + 1)).toContain('15 MiB');
    expect(mediaFileError('font', 2 * 1024 * 1024 + 1)).toContain('2 MiB');
    expect(mediaFileError('font', 0)).toContain('empty');
    expect(mediaContentLengthError('15728640')).toBeNull();
    expect(mediaContentLengthError('15728641')).toBe('too-large');
    expect(mediaContentLengthError(null)).toBe('missing-or-invalid');
    expect(mediaContentLengthError('chunked')).toBe('missing-or-invalid');
  });

  it('preserves rights holder, evidence and optional font license in the backend-supported license field', () => {
    expect(composeMediaLicenseEvidence({
      rightsHolder: 'JIMMY & WAX',
      evidence: 'Owner-approved brand asset record 2026-10',
      fontLicense: '',
    })).toBe('Rights holder: JIMMY & WAX | Evidence: Owner-approved brand asset record 2026-10');
    expect(composeMediaLicenseEvidence({ rightsHolder: 'A', evidence: 'B', fontLicense: 'C'.repeat(300) })).toBeNull();
    expect(composeMediaLicenseEvidence({ rightsHolder: '   ', evidence: 'Owner note', fontLicense: '' })).toBeNull();
  });

  it('maps only a verified content-addressed media path to the same-origin preview route', () => {
    const sha = 'a'.repeat(64);
    expect(localMediaUrl(`/v1/media/${sha}/w640.webp`)).toBe(`/api/media/${sha}/w640.webp`);
    expect(localMediaUrl(`/v1/media/${sha}/video.mp4`)).toBe(`/api/media/${sha}/video.mp4`);
    expect(localMediaUrl('https://attacker.example/image.svg')).toBeNull();
    expect(localMediaUrl(`/v1/media/${sha}/../../admin`)).toBeNull();
  });
});

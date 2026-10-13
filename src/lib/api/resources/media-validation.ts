export type MediaKind = 'image' | 'video' | 'font';

const MiB = 1024 * 1024;
export const dashboardMediaLimits: Readonly<Record<MediaKind, number>> = {
  image: 15 * MiB,
  // The gateway route buffers request bodies. Keep videos below the backend's 100 MiB cap until BFF streaming is verified.
  video: 15 * MiB,
  font: 2 * MiB,
};
export const dashboardMediaMaxUploadBytes = 15 * MiB;

export function mediaContentLengthError(value: string | null): 'missing-or-invalid' | 'too-large' | null {
  if (!value || !/^\d+$/u.test(value)) return 'missing-or-invalid';
  return Number(value) > dashboardMediaMaxUploadBytes ? 'too-large' : null;
}

export function sniffMediaKind(bytes: Uint8Array): MediaKind | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return 'image';
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image';
  if (String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp') return 'video';
  if ([0x1a, 0x45, 0xdf, 0xa3].every((byte, index) => bytes[index] === byte)) return 'video';
  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  if (tag === 'wOF2' || tag === 'OTTO' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) || tag === 'true') return 'font';
  return null;
}

export async function readMediaPrefix(file: File): Promise<Uint8Array> {
  const prefix = file.slice(0, 12);
  if (typeof prefix.arrayBuffer === 'function') return new Uint8Array(await prefix.arrayBuffer());
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The selected file could not be read.'));
    reader.onload = () => resolve(reader.result instanceof ArrayBuffer ? new Uint8Array(reader.result) : new Uint8Array());
    reader.readAsArrayBuffer(prefix);
  });
}

export function mediaFileError(kind: MediaKind | null, size: number): string | null {
  if (!Number.isSafeInteger(size) || size <= 0) return 'The file is empty or too large to handle safely.';
  if (!kind) return 'Unsupported file signature. Use JPEG, PNG, WebP, MP4, WebM, WOFF2, TTF or OTF; SVG and GIF are not supported.';
  const limit = dashboardMediaLimits[kind];
  if (size > limit) return `${kind === 'font' ? 'Font' : kind === 'video' ? 'Video' : 'Image'} files must be no larger than ${kind === 'font' ? '2' : '15'} MiB in this dashboard.`;
  return null;
}

export function localMediaUrl(value: string): string | null {
  const match = /^\/?v1\/media\/([0-9a-f]{64})\/(orig\.webp|w\d{3,4}\.webp|video\.(?:mp4|webm)|font\.(?:woff2|ttf|otf))$/u.exec(value);
  return match ? `/api/media/${match[1]}/${match[2]}` : null;
}

export function composeMediaLicenseEvidence(input: { rightsHolder: string; evidence: string; fontLicense: string }): string | null {
  const rightsHolder = input.rightsHolder.trim().replace(/\s+/gu, ' ');
  const evidence = input.evidence.trim().replace(/\s+/gu, ' ');
  const fontLicense = input.fontLicense.trim().replace(/\s+/gu, ' ');
  if (rightsHolder.length < 2 || evidence.length < 3) return null;
  const parts = [`Rights holder: ${rightsHolder}`, `Evidence: ${evidence}`];
  if (fontLicense) parts.push(`Font licence: ${fontLicense}`);
  const value = parts.join(' | ');
  return value.length <= 300 ? value : null;
}

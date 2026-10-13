/** WCAG 2.2 contrast helpers and the Design System guard-rails from spec §3.4. */

export function parseHex(hex: string): { r: number; g: number; b: number; a: number } | null {
  const match = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/u.exec(hex);
  if (!match) return null;
  const n = parseInt(match[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: match[2] ? parseInt(match[2], 16) / 255 : 1 };
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number | null {
  const rgb = parseHex(hex);
  return rgb ? 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b) : null;
}

/** Foreground is alpha-composited over the background before measuring, as a renderer would. */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (!fg || !bg) return null;
  const mix = (f: number, b: number): number => Math.round(f * fg.a + b * (1 - fg.a));
  const blended = `#${[mix(fg.r, bg.r), mix(fg.g, bg.g), mix(fg.b, bg.b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const l1 = luminance(blended);
  const l2 = luminance(`#${background.slice(1, 7)}`);
  if (l1 === null || l2 === null) return null;
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastRule = { id: string; label: string; foreground: string; background: string; minimum: number };

export const contrastRules: readonly ContrastRule[] = [
  ...(['bg.base', 'bg.raised', 'bg.elevated'] as const).flatMap((background) => (['text.primary', 'text.secondary'] as const).map((foreground) => (
    { id: `${foreground}/${background}`, label: `${foreground} on ${background}`, foreground, background, minimum: 4.5 }))),
  { id: 'text.onAccent/accent.primary', label: 'text.onAccent on accent.primary', foreground: 'text.onAccent', background: 'accent.primary', minimum: 4.5 },
  { id: 'focus.ring/bg.base', label: 'focus.ring against bg.base', foreground: 'focus.ring', background: 'bg.base', minimum: 3 },
  ...(['state.success', 'state.warning', 'state.error', 'state.info'] as const).map((foreground) => (
    { id: `${foreground}/bg.base`, label: `${foreground} as text on bg.base`, foreground, background: 'bg.base', minimum: 4.5 })),
];

export type ContrastResult = { rule: ContrastRule; ratio: number | null; pass: boolean };

export function checkContrast(roles: Readonly<Record<string, unknown>>): ContrastResult[] {
  return contrastRules.map((rule) => {
    const fg = roles[rule.foreground];
    const bg = roles[rule.background];
    const ratio = typeof fg === 'string' && typeof bg === 'string' ? contrastRatio(fg, bg) : null;
    return { rule, ratio, pass: ratio !== null && ratio >= rule.minimum };
  });
}

export type TypeIssue = { path: string; message: string };
export function checkTypeScale(channel: 'app' | 'web' | 'shared', scale: Readonly<Record<string, { size?: unknown }>> | undefined): TypeIssue[] {
  const issues: TypeIssue[] = [];
  if (!scale) return issues;
  const body = scale['body']?.size;
  if (typeof body === 'number' && channel !== 'app' && body < 16) issues.push({ path: 'type.scale.body.size', message: 'Website body text must be at least 16 px.' });
  if (typeof body === 'number' && channel === 'app' && body < 14) issues.push({ path: 'type.scale.body.size', message: 'App body text must be at least 14 sp.' });
  for (const [name, entry] of Object.entries(scale)) {
    if (typeof entry.size === 'number' && entry.size < 11) issues.push({ path: `type.scale.${name}.size`, message: 'No label may be smaller than 11.' });
  }
  return issues;
}

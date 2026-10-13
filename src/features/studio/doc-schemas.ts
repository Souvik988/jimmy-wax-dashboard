import blocksSchema from '../../../docs/backend-contract/blocks.schema.json';

import type { JsonSchema } from './engine/schema';
import type { Channel } from '@/lib/api/resources/studio';

/**
 * Hand-maintained mirrors of the backend document schemas that blocks.schema.json cannot represent
 * (packages/commerce-domain/src/experience/schemas.ts): design system, navigation, chrome.
 * `schemaVersion` is omitted (the editor adds it back). The backend stays the validator; drift shows up as field errors on save.
 */
const action = blocksSchema.action as unknown as JsonSchema;
const mediaRef = blocksSchema.mediaRef as unknown as JsonSchema;
const colorRoles = blocksSchema.colorRoles as string[];
const brandSlots = blocksSchema.brandSlots as string[];

const hex: JsonSchema = { type: 'string', pattern: '^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$' };
const id: JsonSchema = { type: 'string', pattern: '^[A-Za-z0-9_-]{4,40}$' };
const text = (maxLength: number, minLength = 1): JsonSchema => ({ type: 'string', minLength, maxLength });
const num = (minimum: number, maximum: number): JsonSchema => ({ type: 'number', minimum, maximum });
const int = (minimum: number, maximum: number): JsonSchema => ({ type: 'integer', minimum, maximum });
const obj = (properties: Record<string, JsonSchema>, required: string[] = Object.keys(properties)): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });
const role: JsonSchema = { type: 'string', enum: colorRoles };
const bool: JsonSchema = { type: 'boolean' };
const bezier: JsonSchema = { type: 'array', minItems: 4, maxItems: 4, items: num(-2, 2) };
const shadow = obj({ x: num(-40, 40), y: num(-40, 40), blur: num(0, 120), spread: num(-40, 40), color: hex });
const fontRef = obj({ family: text(60), fallback: text(120), mediaId: { type: 'string', format: 'uuid', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' } }, ['family', 'fallback']);
const typeStep = obj({ size: num(8, 200), lineHeight: num(0.8, 2.5), weight: int(100, 900), tracking: num(-0.2, 0.5) });
const buttonStyle = obj({ background: role, foreground: role, border: role }, ['background', 'foreground']);
const name = '^[a-z][a-z0-9_]{0,30}$';

export const designSystemSchema: JsonSchema = obj({
  color: obj({
    roles: obj(Object.fromEntries(colorRoles.map((r) => [r, hex]))),
    palette: { type: 'object', additionalProperties: hex, propertyPattern: name, maxProperties: 40 },
    gradients: { type: 'object', additionalProperties: obj({ angle: num(0, 360), stops: { type: 'array', minItems: 2, maxItems: 5, items: obj({ at: num(0, 1), color: hex }) } }), propertyPattern: name, maxProperties: 12 },
  }),
  type: obj({
    families: obj({ display: fontRef, body: fontRef, mono: fontRef }, ['display', 'body']),
    scale: obj({ hero: typeStep, h1: typeStep, h2: typeStep, h3: typeStep, body: typeStep, small: typeStep, label: typeStep }),
  }),
  space: obj({ unit: { type: 'number', enum: [4] }, steps: { type: 'array', minItems: 4, maxItems: 16, items: int(0, 400) } }),
  radius: obj({ frame: num(0, 40), card: num(0, 40), control: num(0, 40), large: num(0, 60), hero: num(0, 60), pill: { type: 'number', enum: [999] } }),
  elevation: obj({ raised: shadow, overlay: shadow }),
  motion: obj({
    durations: obj({ fast: int(100, 800), medium: int(100, 800), slow: int(100, 800) }),
    easings: obj({ standard: bezier, emphasis: bezier, curtain: bezier }),
    intensity: { type: 'string', enum: ['calm', 'standard', 'cinematic'] },
  }),
  components: obj({
    button: obj({ minHeight: num(24, 80), shape: { type: 'string', enum: ['pill', 'rounded'] }, variants: obj({ primary: buttonStyle, secondary: buttonStyle, ghost: buttonStyle }) }),
    card: obj({ radius: { type: 'string', enum: ['card', 'large'] }, border: bool, elevation: { type: 'string', enum: ['none', 'raised'] } }),
    input: obj({ minHeight: num(24, 80), radius: { type: 'string', enum: ['control'] } }),
    chip: obj({ radius: { type: 'string', enum: ['pill', 'control'] } }),
    bottomNav: obj({ style: { type: 'string', enum: ['plain', 'pill'] }, activeColor: role, background: role, backgroundOpacity: num(0, 1) }),
    header: obj({ background: { type: 'string', enum: [...colorRoles, 'transparent'] }, blurOnScroll: bool }),
    imageFrame: obj({ radius: { type: 'string', enum: ['frame', 'card'] } }),
  }),
  surfaces: obj({
    backdrop: obj({ kind: { type: 'string', enum: ['image', 'solid', 'gradient'] }, image: { type: 'string', format: 'uuid', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' }, tint: hex, tintOpacity: num(0, 1) }, ['kind', 'tint', 'tintOpacity']),
    grain: obj({ enabled: bool, opacity: num(0, 0.5) }),
  }),
});

const navIcon: JsonSchema = { type: 'string', enum: ['home', 'grid', 'bag', 'receipt', 'user', 'heart', 'search', 'gift', 'star', 'help', 'info', 'bell'] };
const navLink = obj({ id, label: text(30, 2), action });
const slots: JsonSchema = obj(Object.fromEntries(brandSlots.map((slot) => [slot, mediaRef])), []);

export const appNavigationSchema: JsonSchema = obj({
  bottomTabs: { type: 'array', minItems: 3, maxItems: 5, items: obj({ key: { type: 'string', enum: ['home', 'categories', 'cart', 'orders', 'profile', 'custom'] }, label: text(14, 2), icon: navIcon, visible: bool, action }, ['key', 'label', 'icon', 'visible']) },
  profileMenu: { type: 'array', maxItems: 20, items: obj({ id, label: text(40, 2), icon: navIcon, action, section: { type: 'string', enum: ['account', 'help', 'legal', 'custom'] } }) },
});
export const webNavigationSchema: JsonSchema = obj({
  links: { type: 'array', minItems: 2, maxItems: 8, items: navLink },
  footerColumns: { type: 'array', maxItems: 4, items: obj({ id, title: text(30, 2), links: { type: 'array', minItems: 1, maxItems: 8, items: navLink } }) },
  cart: obj({ label: text(20, 2) }),
});

export const appChromeSchema: JsonSchema = obj({
  header: obj({ showDeliverTo: bool, searchPlaceholder: text(40, 3) }),
  splash: obj({ wordmark: bool }),
  storePausedMessage: text(160),
  help: obj({ faqGroupId: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', minLength: 2, maxLength: 100 }, supportEmail: text(200), supportPhone: text(20), whatsapp: text(20) }, []),
  slots,
}, ['header', 'splash', 'help']);
export const webChromeSchema: JsonSchema = obj({
  brand: obj({ wordmark: text(40, 2), mark: text(2) }),
  veil: obj({ enabled: bool, mark: text(2), name: text(40, 2), subline: text(60), durationMs: int(500, 3000) }, ['enabled', 'mark', 'name', 'durationMs']),
  effects: obj({ grain: bool, cursor: bool, smoothScroll: obj({ enabled: bool, speedCap: num(0.2, 3) }) }),
  seoDefaults: obj({ titleTemplate: text(80, 3), description: text(160, 50) }),
  footer: obj({ tagline: text(200), bottomLeft: text(120), bottomRight: text(200) }, ['tagline']),
  slots,
}, ['brand', 'veil', 'effects', 'seoDefaults', 'footer']);

/** Schema for a non-page document, or null when none is known (e.g. a channel's token overrides). */
export function schemaForDoc(channel: Channel | 'shared', kind: string): JsonSchema | null {
  if (kind === 'tokens') return channel === 'shared' ? designSystemSchema : null;
  if (kind === 'navigation') return channel === 'app' ? appNavigationSchema : channel === 'web' ? webNavigationSchema : null;
  if (kind === 'chrome') return channel === 'app' ? appChromeSchema : channel === 'web' ? webChromeSchema : null;
  return null;
}

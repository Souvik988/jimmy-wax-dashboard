/**
 * Schema-driven editing core. Pure functions only: the renderer (form.tsx) and every test share this file.
 * Supported JSON Schema subset is exactly what blocks.schema.json uses (see docs/build/phase-10-thinking.md):
 * type, properties, required, additionalProperties:false, items, min/maxItems, enum, oneOf/anyOf, pattern,
 * format, minimum/maximum, min/maxLength, default.
 */

export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: unknown[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
  description?: string;
  /** Exact size the backend publishes for a media slot (`x-slot` in blocks.schema.json). */
  'x-slot'?: { minWidth?: number; minHeight?: number; aspect?: string; kind?: 'video' };
  /** Map objects (additionalProperties is a schema): key format and size limit. */
  propertyPattern?: string;
  maxProperties?: number;
};

export type ErrorMap = Readonly<Record<string, string>>;

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Stable block/item id matching ^[A-Za-z0-9_-]{4,40}$. Never regenerated for an existing item. */
export function generateId(prefix = 'i'): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length];
  return `${prefix.replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 10)}-${out}`;
}

export function variantsOf(schema: JsonSchema): JsonSchema[] | undefined {
  return schema.oneOf ?? schema.anyOf;
}

export function isObjectSchema(schema: JsonSchema): boolean {
  return schema.type === 'object' || Boolean(schema.properties);
}

/** Human label for a union variant: the discriminator constant, else the sole required key. */
export function variantLabel(variant: JsonSchema, index: number): string {
  const discriminator = variant.properties?.['type'];
  if (discriminator?.enum?.length === 1) return humanize(String(discriminator.enum[0]));
  const required = variant.required ?? [];
  if (required.length === 1 && required[0]) return humanize(required[0]);
  if (variant.type) return humanize(variant.type);
  return `Option ${index + 1}`;
}

export function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/gu, '$1 $2').replace(/[._-]+/gu, ' ').trim();
  return spaced ? `${spaced[0]?.toUpperCase()}${spaced.slice(1)}` : key;
}

/** Index of the union variant that the value validates against (first match), or -1. */
export function matchVariant(variants: JsonSchema[], value: unknown): number {
  const exact = variants.findIndex((variant) => Object.keys(validate(variant, value)).length === 0);
  if (exact >= 0) return exact;
  const discriminator = (value as { type?: unknown } | null)?.type;
  if (typeof discriminator === 'string') {
    const byType = variants.findIndex((variant) => variant.properties?.['type']?.enum?.[0] === discriminator);
    if (byType >= 0) return byType;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    const byKeys = variants.findIndex((variant) => keys.length > 0 && keys.every((key) => variant.properties && key in variant.properties));
    if (byKeys >= 0) return byKeys;
  }
  return -1;
}

const STRING_CANDIDATES = ['sample-id', 'sample', 'Sample text', 'a', '#000000', 'https://example.com', 'home', '/shop', '+911234567890', 'name@example.com'];

function stringMatching(schema: JsonSchema): string {
  const min = schema.minLength ?? 0;
  const max = schema.maxLength ?? 200;
  if (schema.format === 'uuid') return NIL_UUID;
  if (schema.format === 'date-time') return new Date().toISOString();
  const regex = schema.pattern ? new RegExp(schema.pattern, 'u') : undefined;
  const ok = (candidate: string): boolean => candidate.length >= min && candidate.length <= max && (!regex || regex.test(candidate));
  for (const base of STRING_CANDIDATES) {
    for (const pad of ['', '-x', '-xx', '-xxx', 'x'.repeat(Math.max(1, min))]) {
      const attempt = `${base}${pad}`.slice(0, max);
      if (ok(attempt)) return attempt;
    }
  }
  const padded = 'sample '.repeat(Math.ceil(Math.max(min, 1) / 7)).slice(0, Math.max(min, 1));
  if (ok(padded)) return padded;
  const dashed = 'a-'.repeat(Math.ceil(Math.max(min, 1) / 2)).slice(0, Math.max(min, 1)).replace(/-$/u, 'a');
  return ok(dashed) ? dashed : padded;
}

/** Smallest instance that satisfies the schema (used by "Add", by union switches and by the all-blocks round trip). */
export function minimalInstance(schema: JsonSchema, depth = 0): unknown {
  if (schema.default !== undefined && schema.type !== 'object') return structuredClone(schema.default);
  const variants = variantsOf(schema);
  if (variants?.length) return minimalInstance(variants[0]!, depth + 1);
  if (schema.enum?.length) return schema.enum[0];
  if (isObjectSchema(schema)) {
    const out: Record<string, unknown> = {};
    for (const key of schema.required ?? []) {
      const child = schema.properties?.[key];
      if (!child) continue;
      out[key] = key === 'id' && child.pattern ? generateId() : minimalInstance(child, depth + 1);
    }
    return out;
  }
  switch (schema.type) {
    case 'array': {
      const count = schema.minItems ?? 0;
      return Array.from({ length: count }, () => (schema.items ? minimalInstance(schema.items, depth + 1) : null));
    }
    case 'boolean': return schema.default ?? false;
    case 'number':
    case 'integer': {
      const min = schema.minimum ?? 0;
      const max = schema.maximum ?? Number.MAX_SAFE_INTEGER;
      return Math.min(Math.max(0, min), max);
    }
    case 'string': return stringMatching(schema);
    default: return null;
  }
}

function typeOk(schema: JsonSchema, value: unknown): boolean {
  switch (schema.type) {
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    default: return true;
  }
}

function join(path: string, key: string | number): string {
  return path ? `${path}.${key}` : String(key);
}

/** Client-side mirror of server validation, returning dotted paths like `slides.1.headline` (same shape as the backend's `fields`). */
export function validate(schema: JsonSchema, value: unknown, path = ''): Record<string, string> {
  const errors: Record<string, string> = {};
  const fail = (message: string, at = path): void => { errors[at || '_'] ??= message; };

  const variants = variantsOf(schema);
  if (variants?.length) {
    const results = variants.map((variant) => validate(variant, value, path));
    const matches = results.filter((result) => Object.keys(result).length === 0).length;
    if (matches === 0) {
      const index = matchVariant(variants, value);
      if (index >= 0) return results[index]!;
      fail('Choose one of the allowed options.');
    }
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) { fail(`Must be one of: ${schema.enum.map(String).join(', ')}.`); return errors; }
  if (!typeOk(schema, value)) { fail(`Expected ${schema.type ?? 'a different type'}.`); return errors; }

  if (schema.type === 'string') {
    const text = value as string;
    const length = [...text].length;
    if (schema.minLength !== undefined && length < schema.minLength) fail(`Use at least ${schema.minLength} character${schema.minLength === 1 ? '' : 's'}.`);
    if (schema.maxLength !== undefined && length > schema.maxLength) fail(`Use at most ${schema.maxLength} characters.`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(text)) fail(schema.format === 'uuid' ? 'Must be a valid media id.' : 'Does not match the required format.');
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    const number = value as number;
    if (schema.minimum !== undefined && number < schema.minimum) fail(`Must be at least ${schema.minimum}.`);
    if (schema.maximum !== undefined && number > schema.maximum) fail(`Must be at most ${schema.maximum}.`);
  }
  if (schema.type === 'array') {
    const list = value as unknown[];
    if (schema.minItems !== undefined && list.length < schema.minItems) fail(`Add at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}.`);
    if (schema.maxItems !== undefined && list.length > schema.maxItems) fail(`Use at most ${schema.maxItems} items.`);
    if (schema.items) list.forEach((item, index) => Object.assign(errors, validate(schema.items!, item, join(path, index))));
  }
  if (isObjectSchema(schema) && typeOk({ type: 'object' }, value)) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (record[key] === undefined) errors[join(path, key)] = 'Required.';
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (record[key] !== undefined) Object.assign(errors, validate(child, record[key], join(path, key)));
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      const extra = Object.keys(record).filter((key) => !schema.properties || !(key in schema.properties));
      if (schema.maxProperties !== undefined && extra.length > schema.maxProperties) errors[path || '_'] = `Use at most ${schema.maxProperties} entries.`;
      for (const key of extra) {
        if (schema.propertyPattern && !new RegExp(schema.propertyPattern, 'u').test(key)) errors[join(path, key)] = 'Invalid name: start with a lowercase letter; use lowercase letters, digits and underscores.';
        Object.assign(errors, validate(schema.additionalProperties, record[key], join(path, key)));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!schema.properties || !(key in schema.properties)) errors[join(path, key)] = 'This field is not recognised.';
      }
    }
  }
  return errors;
}

/** Maps backend `fields` (dotted paths relative to the document body) onto a sub-tree, e.g. prefix `blocks.2.props`. */
export function errorsUnder(errors: ErrorMap, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lead = prefix ? `${prefix}.` : '';
  for (const [path, message] of Object.entries(errors)) {
    if (!prefix) { out[path] = message; continue; }
    if (path === prefix) out['_'] = message;
    else if (path.startsWith(lead)) out[path.slice(lead.length)] = message;
  }
  return out;
}

/** Returns the block index in a server path like `blocks.12.props.slides.0.headline`, or null for non-block errors. */
export function blockIndexOf(path: string): number | null {
  const match = /^blocks\.(\d+)(?:\.|$)/u.exec(path);
  return match ? Number(match[1]) : null;
}

export function getAt(root: unknown, path: string): unknown {
  if (!path) return root;
  let node: unknown = root;
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Immutable set by dotted path; creates objects/arrays as needed and removes the key when value is undefined. */
export function setAt<T>(root: T, path: string, value: unknown): T {
  if (!path) return value as T;
  const [head, ...rest] = path.split('.') as [string, ...string[]];
  const isIndex = /^\d+$/u.test(head);
  const base: unknown = root ?? (isIndex ? [] : {});
  if (Array.isArray(base)) {
    const copy = [...base];
    copy[Number(head)] = setAt(copy[Number(head)], rest.join('.'), value);
    return copy as T;
  }
  const copy = { ...(base as Record<string, unknown>) };
  if (rest.length === 0 && value === undefined) delete copy[head];
  else copy[head] = setAt(copy[head], rest.join('.'), value);
  return copy as T;
}

/** Template-variable tokens ({{store.shippingFee}}) found in a string. */
export function variableTokens(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/gu)].map((match) => match[1]!);
}

export function substituteVariables(text: string, values: Record<string, string | null>): string {
  return text.replace(/\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/gu, (whole, name: string) => values[name] ?? whole);
}

/** Warns about currency literals that should be variables (spec §5.2). */
export function hasCurrencyLiteral(text: string): boolean {
  return /₹\s?\d|Rs\.?\s?\d/u.test(text);
}

/** Best-effort schema from an existing value, for documents the backend does not publish a JSON Schema for (navigation, chrome, tokens). */
export function inferSchema(value: unknown): JsonSchema {
  if (Array.isArray(value)) return { type: 'array', items: value.length ? inferSchema(value[0]) : { type: 'string' } };
  if (value === null) return { type: 'string' };
  switch (typeof value) {
    case 'boolean': return { type: 'boolean' };
    case 'number': return { type: 'number' };
    case 'object': {
      const properties: Record<string, JsonSchema> = {};
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) properties[key] = inferSchema(child);
      return { type: 'object', properties, required: Object.keys(properties) };
    }
    default: return typeof value === 'string' && /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/u.test(value) ? { type: 'string', pattern: '^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$' } : { type: 'string' };
  }
}

import { describe, expect, it } from 'vitest';

import generated from '../../../docs/backend-contract/doc-schemas.json';
import {
  appChromeSchema, appNavigationSchema, designSystemSchema, webChromeSchema, webNavigationSchema,
} from '@/features/studio/doc-schemas';
import { type JsonSchema, minimalInstance, validate } from '@/features/studio/engine/schema';

/**
 * DASH-BR-046 guard. `docs/backend-contract/doc-schemas.json` is generated from the backend validators
 * (backend: packages/commerce-domain/scripts/gen-doc-schemas.ts). The dashboard's form schemas are hand mirrors; this test fails when
 * the two stop accepting each other's minimal documents, so backend changes cannot silently break the Studio forms.
 */
type Raw = Record<string, unknown>;

/** Maps the generated draft-2020 output onto the engine's JSON Schema subset. `schemaVersion` is added back by the editor, so it is dropped. */
function normalise(node: unknown, root = true): JsonSchema {
  const copy = structuredClone(node) as Raw;
  delete copy.$schema;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== 'object') return value;
    const out: Raw = {};
    for (const [key, child] of Object.entries(value as Raw)) {
      if (key === 'propertyNames' && child && typeof child === 'object') { const pattern = (child as Raw).pattern; if (typeof pattern === 'string') out.propertyPattern = pattern; continue; }
      if (key === 'const') { out.enum = [child]; continue; }
      // Fixed-length tuples (easing curves) are written as prefixItems; the engine models them as an array of one item type with min=max length.
      if (key === 'prefixItems' && Array.isArray(child) && child.length > 0) {
        const positions = child.map((item) => walk(item) as JsonSchema);
        out.items = { ...positions[0], minimum: Math.min(...positions.map((item) => item.minimum ?? 0)), maximum: Math.max(...positions.map((item) => item.maximum ?? 0)) };
        out.minItems = child.length; out.maxItems = child.length;
        continue;
      }
      if (key === 'items' && typeof child === 'boolean') continue;
      out[key] = walk(child);
    }
    return out;
  };
  const result = walk(copy) as JsonSchema;
  if (root && result.properties) {
    delete result.properties.schemaVersion;
    result.required = (result.required ?? []).filter((key) => key !== 'schemaVersion');
  }
  return result;
}

const docs = generated.docs as Record<string, unknown>;
const pairs: Array<[string, JsonSchema]> = [
  ['shared/tokens/base', designSystemSchema],
  ['app/navigation/main', appNavigationSchema],
  ['web/navigation/main', webNavigationSchema],
  ['app/chrome/main', appChromeSchema],
  ['web/chrome/main', webChromeSchema],
];

describe('backend document schemas are published and match the Studio forms', () => {
  it('has a representable schema for every document kind (none are placeholders)', () => {
    for (const name of ['shared/tokens/base', 'app/tokens/override', 'web/tokens/override', 'app/navigation/main', 'web/navigation/main', 'app/chrome/main', 'web/chrome/main']) {
      const entry = docs[name] as Raw | undefined;
      expect(entry, name).toBeTruthy();
      expect(entry?.note, `${name} should not be "not representable"`).toBeUndefined();
      expect(entry?.type).toBe('object');
    }
  });

  for (const [name, mirror] of pairs) {
    it(`${name}: a minimal document from the form schema passes the backend schema`, () => {
      const backend = normalise(docs[name]);
      const instance = minimalInstance(mirror);
      expect(validate(backend, instance), `form → backend for ${name}`).toEqual({});
    });
    it(`${name}: a minimal document from the backend schema passes the form schema`, () => {
      const backend = normalise(docs[name]);
      const instance = minimalInstance(backend);
      expect(validate(mirror, instance), `backend → form for ${name}`).toEqual({});
    });
  }

  it('the token override document is the same free-form record the dashboard treats it as', () => {
    const override = normalise(docs['app/tokens/override']);
    expect(override.required).toEqual(['overrides']);
    expect(validate(override, { overrides: {} })).toEqual({});
  });
});

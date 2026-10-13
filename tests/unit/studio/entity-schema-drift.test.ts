import { describe, expect, it } from 'vitest';

import generated from '../../../docs/backend-contract/entity-schemas.json';
import { librarySchemas } from '@/features/studio/library-schemas';
import { type JsonSchema, minimalInstance, validate } from '@/features/studio/engine/schema';
import { libraryEntities } from '@/lib/api/resources/studio';

/**
 * Guard for the content-library forms. `docs/backend-contract/entity-schemas.json` is generated from the backend validators
 * (care guides, stories, journal, testimonials, FAQ groups, announcements). The form schemas in `library-schemas.ts` are hand mirrors; this
 * test fails when the two disagree about which fields exist or are required, or stop accepting each other's minimal records.
 */
type Raw = Record<string, unknown>;

/** Maps the generated draft-2020 output onto the engine's JSON Schema subset (nullable `anyOf` collapses to its non-null branch; defaults are dropped). */
function normalise(node: unknown): JsonSchema {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== 'object') return value;
    const source = value as Raw;
    if (Array.isArray(source['anyOf'])) {
      const branches = (source['anyOf'] as Raw[]).filter((branch) => branch['type'] !== 'null');
      if (branches.length === 1) return walk(branches[0]);
    }
    const out: Raw = {};
    for (const [key, child] of Object.entries(source)) {
      if (key === '$schema' || key === 'default') continue;
      if (key === 'const') { out['enum'] = [child]; continue; }
      if (key === 'items' && typeof child === 'boolean') continue;
      out[key] = walk(child);
    }
    return out;
  };
  return walk(node) as JsonSchema;
}

const entities = generated.entities as unknown as Record<string, { schema: unknown }>;

describe('backend content-library schemas match the library forms', () => {
  it('publishes a schema for every library entity the dashboard edits', () => {
    expect(Object.keys(entities).sort()).toEqual([...libraryEntities].sort());
  });

  for (const entity of libraryEntities) {
    describe(entity, () => {
      const backend = normalise(entities[entity]?.schema);
      const mirror = librarySchemas[entity];

      it('has the same fields (the server-generated id is the only allowed difference)', () => {
        const backendKeys = Object.keys(backend.properties ?? {}).sort();
        const mirrorKeys = Object.keys(mirror.properties ?? {}).filter((key) => key !== 'id').sort();
        expect(mirrorKeys).toEqual(backendKeys.filter((key) => key !== 'id'));
      });

      it('requires the same fields', () => {
        expect([...(mirror.required ?? [])].sort()).toEqual([...(backend.required ?? [])].sort());
      });

      it('a minimal record from the form schema passes the backend schema', () => {
        expect(validate(backend, minimalInstance(mirror))).toEqual({});
      });

      it('a minimal record from the backend schema passes the form schema', () => {
        expect(validate(mirror, minimalInstance(backend))).toEqual({});
      });
    });
  }
});

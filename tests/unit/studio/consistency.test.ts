import { describe, expect, it } from 'vitest';

import { groupIssues, leafPaths } from '@/features/studio/consistency-panel';
import { convertBlock, newBlock, startersFor, buildStarter, blockSpecs } from '@/features/studio/doc-model';
import { designSystemSchema, schemaForDoc } from '@/features/studio/doc-schemas';
import { minimalInstance, validate } from '@/features/studio/engine/schema';

describe('Studio helpers', () => {
  it('flattens override documents and groups validator issues', () => {
    expect(leafPaths({ color: { roles: { 'accent.primary': '#fff' } }, motion: { intensity: 'calm' } })).toEqual(['color.roles.accent.primary', 'motion.intensity']);
    expect(groupIssues([{ code: 'a', message: 'x' }, { code: 'b', message: 'y' }, { code: 'a', message: 'z' }])).toEqual([{ code: 'a', count: 2, example: 'x' }, { code: 'b', count: 1, example: 'y' }]);
  });
  it('builds valid starter layouts for every standard page', () => {
    for (const [channel, key] of [['app', 'home'], ['app', 'category'], ['web', 'home'], ['web', 'shop']] as const) {
      const layouts = startersFor(channel, key);
      expect(layouts.length, `${channel}/${key}`).toBeGreaterThan(0);
      for (const layout of layouts) for (const block of buildStarter(layout.id)) expect(Object.keys(validate(blockSpecs[block.type]!.props, block.props)), layout.id).toEqual([]);
    }
  });
  it('converts same-named blocks across channels and refuses lossy ones', () => {
    const faq = newBlock('app.faq');
    const converted = convertBlock(faq, 'web');
    expect('block' in converted || 'error' in converted).toBe(true);
    expect('error' in convertBlock(newBlock('app.hero_carousel'), 'web')).toBe(true);
  });
  it('document mirrors accept their own minimal instances and flag bad values', () => {
    expect(Object.keys(validate(designSystemSchema, minimalInstance(designSystemSchema)))).toEqual([]);
    const bad = minimalInstance(designSystemSchema) as { color: { roles: Record<string, string>; palette: Record<string, string> } };
    bad.color.roles['bg.base'] = 'red';
    bad.color.palette = { 'Bad Name': '#000000' };
    const errors = validate(designSystemSchema, bad);
    expect(errors['color.roles.bg.base']).toBeTruthy();
    expect(errors['color.palette.Bad Name']).toBeTruthy();
    expect(schemaForDoc('app', 'tokens')).toBeNull();
    expect(schemaForDoc('web', 'chrome')).not.toBeNull();
  });
});

import { getPath, leafEntries, parseLike, setPath, unsetPath } from '@/features/studio/token-overrides';

describe('token overrides', () => {
  it('sets and unsets nested values with array paths (role names contain dots) and prunes empties', () => {
    let o: Record<string, unknown> = {};
    o = setPath(o, ['color', 'roles', 'accent.primary'], '#112233');
    o = setPath(o, ['motion', 'intensity'], 'calm');
    expect(getPath(o, ['color', 'roles', 'accent.primary'])).toBe('#112233');
    expect(leafEntries(o).map((l) => l.path.join('›'))).toEqual(['color›roles›accent.primary', 'motion›intensity']);
    o = unsetPath(o, ['color', 'roles', 'accent.primary']);
    expect(o).toEqual({ motion: { intensity: 'calm' } });
  });
  it('parses edited text to the shared value type', () => {
    expect(parseLike(16, '18')).toBe(18);
    expect(parseLike(16, 'x')).toBeNull();
    expect(parseLike(true, 'false')).toBe(false);
    expect(parseLike([1, 2], '[3,4]')).toEqual([3, 4]);
    expect(parseLike([1, 2], 'nope')).toBeNull();
    expect(parseLike('#fff', '#000')).toBe('#000');
  });
});

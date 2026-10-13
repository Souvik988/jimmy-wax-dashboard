import { describe, expect, it } from 'vitest';

import blocksSchema from '../../../docs/backend-contract/blocks.schema.json';
import {
  type JsonSchema, errorsUnder, getAt, hasCurrencyLiteral, matchVariant, minimalInstance, setAt, substituteVariables, validate, variantLabel, variantsOf,
} from '@/features/studio/engine/schema';

const blocks = blocksSchema.blocks as unknown as Record<string, { channel: 'app' | 'web'; maxPerPage: number; props: JsonSchema }>;

describe('schema engine', () => {
  it('builds a valid minimal instance for every one of the 34 block types', () => {
    const types = Object.keys(blocks);
    expect(types).toHaveLength(34);
    for (const type of types) {
      const props = minimalInstance(blocks[type]!.props);
      const errors = validate(blocks[type]!.props, props);
      expect(errors, `${type}: ${JSON.stringify(errors)}`).toEqual({});
    }
  });

  it('rejects invalid values with dotted paths like the backend', () => {
    const schema = blocks['app.hero_carousel']!.props;
    const bad = { slides: [{ id: 'x', image: { mediaId: 'nope' }, headline: '' }] };
    const errors = validate(schema, bad);
    expect(Object.keys(errors)).toEqual(expect.arrayContaining(['slides.0.id', 'slides.0.image.mediaId', 'slides.0.headline']));
  });

  it('enforces array bounds, enums, numbers and unknown keys', () => {
    const schema = blocks['app.spacer']!.props;
    expect(validate(schema, { height: 'huge' })['height']).toBeTruthy();
    expect(validate(schema, { height: 12, extra: 1 })['extra']).toMatch(/not recognised/);
    const rail = blocks['app.product_rail']!.props;
    expect(validate(rail, { title: 't', source: { kind: 'nope' } })['source.kind']).toBeTruthy();
  });

  it('matches union variants and labels them', () => {
    const action = blocksSchema.action as unknown as JsonSchema;
    const variants = variantsOf(action)!;
    expect(variants.length).toBeGreaterThan(8);
    expect(variantLabel(variants[1]!, 1)).toBe('Product');
    expect(matchVariant(variants, { type: 'product', productId: 'abc-def' })).toBe(1);
    expect(matchVariant(variants, { type: 'screen', screen: 'nope' })).toBeGreaterThanOrEqual(0);
  });

  it('reads, writes and removes by dotted path immutably', () => {
    const root = { blocks: [{ props: { a: 1 } }] };
    const next = setAt(root, 'blocks.0.props.a', 2);
    expect(root.blocks[0]!.props.a).toBe(1);
    expect(getAt(next, 'blocks.0.props.a')).toBe(2);
    expect(getAt(setAt(next, 'blocks.0.props.a', undefined), 'blocks.0.props')).toEqual({});
  });

  it('scopes server errors to a sub-tree', () => {
    const scoped = errorsUnder({ 'blocks.1.props.height': 'bad', 'blocks.2.props.x': 'no', 'blocks.1.type': 't' }, 'blocks.1.props');
    expect(scoped).toEqual({ height: 'bad' });
  });

  it('substitutes variables and flags currency literals', () => {
    expect(substituteVariables('Ship {{store.shippingFee}} {{x.y}}', { 'store.shippingFee': '₹40' })).toBe('Ship ₹40 {{x.y}}');
    expect(hasCurrencyLiteral('Only ₹499 today')).toBe(true);
    expect(hasCurrencyLiteral('Free over {{store.freeShippingThreshold}}')).toBe(false);
  });
});

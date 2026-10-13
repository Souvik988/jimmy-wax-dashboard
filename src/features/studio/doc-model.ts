import blocksSchema from '../../../docs/backend-contract/blocks.schema.json';

import { type JsonSchema, generateId, minimalInstance, validate } from './engine/schema';
import type { Channel } from '@/lib/api/resources/studio';

export type BlockSpec = { channel: Channel; maxPerPage: number; props: JsonSchema };
export type Block = { id: string; type: string; visible: boolean; props: Record<string, unknown>; rules?: Record<string, unknown>; style?: Record<string, unknown> };
export type PageBody = { schemaVersion: 1; title?: string; seo?: Record<string, unknown>; blocks: Block[]; [key: string]: unknown };

export const blockSpecs = blocksSchema.blocks as unknown as Record<string, BlockSpec>;
export const visibilityRulesSchema = blocksSchema.visibilityRules as unknown as JsonSchema;
export const blockStyleSchema = blocksSchema.blockStyle as unknown as JsonSchema;
export const seoSchema = blocksSchema.seo as unknown as JsonSchema;
export const maxBlocks: Readonly<Record<Channel, number>> = blocksSchema.limits.maxBlocks;

export function typesFor(channel: Channel): string[] {
  return Object.keys(blockSpecs).filter((type) => blockSpecs[type]!.channel === channel);
}

export function blockTitle(type: string): string {
  const name = type.split('.').slice(1).join('.');
  return name.split('_').map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`).join(' ');
}

export function ensurePage(body: Record<string, unknown> | undefined): PageBody {
  const blocks = Array.isArray(body?.['blocks']) ? (body!['blocks'] as Block[]) : [];
  return { ...(body ?? {}), schemaVersion: 1, blocks } as PageBody;
}

export function countByType(blocks: readonly Block[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const block of blocks) counts[block.type] = (counts[block.type] ?? 0) + 1;
  return counts;
}

export type PaletteEntry = { type: string; title: string; disabledReason: string | null };
export function paletteFor(channel: Channel, blocks: readonly Block[]): PaletteEntry[] {
  const counts = countByType(blocks);
  const full = blocks.length >= maxBlocks[channel];
  return typesFor(channel).map((type) => {
    const max = blockSpecs[type]!.maxPerPage;
    const disabledReason = full ? `This page already has the maximum of ${maxBlocks[channel]} blocks.`
      : (counts[type] ?? 0) >= max ? `Only ${max} of this block ${max === 1 ? 'is' : 'are'} allowed per page.` : null;
    return { type, title: blockTitle(type), disabledReason };
  });
}

/** Cross-field rules the JSON Schema cannot express (mirrors the backend validators). */
export function refinementErrors(type: string, props: Record<string, unknown>): Record<string, string> {
  if (type === 'web.ritual_steps') {
    const hasGuide = props['guideId'] !== undefined; const hasSteps = props['steps'] !== undefined;
    if (hasGuide === hasSteps) return { '': 'Provide either a care guide id or inline steps — not both, not neither.' };
  }
  return {};
}

export function newBlock(type: string): Block {
  const spec = blockSpecs[type];
  if (!spec) throw new Error(`Unknown block type ${type}`);
  const props = minimalInstance(spec.props) as Record<string, unknown>;
  // Refinement the schema cannot express: ritual_steps needs guideId XOR steps. Start from inline steps.
  if (type === 'web.ritual_steps' && props['steps'] === undefined && props['guideId'] === undefined) props['steps'] = minimalInstance(spec.props.properties!['steps']!);
  return { id: generateId('blk'), type, visible: true, props };
}

export function moveBlock(blocks: Block[], from: number, to: number): Block[] {
  if (to < 0 || to >= blocks.length || from === to) return blocks;
  const next = [...blocks];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** Duplicate keeps the original id on the original and gives the copy a new stable id (ids are never reused). */
export function duplicateBlock(blocks: Block[], index: number): Block[] {
  const source = blocks[index];
  if (!source) return blocks;
  const copy = structuredClone(source);
  copy.id = generateId('blk');
  return [...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)];
}

export function removeBlock(blocks: Block[], index: number): { blocks: Block[]; removed: Block | undefined } {
  return { blocks: blocks.filter((_, position) => position !== index), removed: blocks[index] };
}

/** Parses pasted JSON into a block, rejecting unknown types and re-issuing the id so it never collides. */
export function parsePastedBlock(text: string): { block: Block } | { error: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { error: 'The clipboard does not contain valid JSON.' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'Paste a single block object.' };
  const candidate = parsed as Partial<Block>;
  if (typeof candidate.type !== 'string' || !blockSpecs[candidate.type]) return { error: `Unknown block type “${String(candidate.type)}”.` };
  return { block: { ...candidate, id: generateId('blk'), type: candidate.type, visible: candidate.visible !== false, props: (candidate.props ?? {}) as Record<string, unknown> } as Block };
}

/** Pages are written with schemaVersion 1 (the stored baseline omits it, but the validator requires it). */
export function toSaveBody(kind: string, body: Record<string, unknown>): Record<string, unknown> {
  return { ...body, schemaVersion: 1, ...(kind === 'page' ? { blocks: Array.isArray(body['blocks']) ? body['blocks'] : [] } : {}) };
}

/** Block indices that carry server errors, for the structure tree badges. */
export function errorCountsByBlock(errors: Readonly<Record<string, string>>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const path of Object.keys(errors)) {
    const match = /^blocks\.(\d+)(?:\.|$)/u.exec(path);
    if (match) out[Number(match[1])] = (out[Number(match[1])] ?? 0) + 1;
  }
  return out;
}

/** Starter layouts for empty pages (spec UI-11). Blocks are minimal valid instances; media and copy still need filling in. */
export const starterLayouts: ReadonlyArray<{ id: string; channel: Channel; pages: readonly string[]; title: string; description: string; types: readonly string[] }> = [
  { id: 'app-home-classic', channel: 'app', pages: ['home'], title: 'Classic storefront home', description: 'Hero carousel, category shortcuts, best sellers, benefits and testimonials.', types: ['app.hero_carousel', 'app.category_shortcuts', 'app.product_rail', 'app.benefits_row', 'app.testimonials'] },
  { id: 'app-template-simple', channel: 'app', pages: ['category', 'product', 'cart'], title: 'Banner + product rail', description: 'A banner above a product rail and a trust strip.', types: ['app.banner', 'app.product_rail', 'app.trust_strip'] },
  { id: 'web-home-story', channel: 'web', pages: ['home'], title: 'Cinematic story home', description: 'Hero film, marquee, collection grid, ritual, testimonials and a closing call to action.', types: ['web.hero_film', 'web.marquee', 'web.collection_grid', 'web.ritual_steps', 'web.testimonials', 'web.closing_cta'] },
  { id: 'web-page-simple', channel: 'web', pages: ['shop', 'product', 'ritual', 'story'], title: 'Heading + content', description: 'Chapter mark, rich text and FAQ.', types: ['web.chapter_mark', 'web.rich_text', 'web.faq'] },
];

export function startersFor(channel: Channel, pageKey: string): typeof starterLayouts {
  return starterLayouts.filter((layout) => layout.channel === channel && layout.pages.includes(pageKey));
}

export function buildStarter(layoutId: string): Block[] {
  const layout = starterLayouts.find((candidate) => candidate.id === layoutId);
  if (!layout) return [];
  return layout.types.map((type) => newBlock(type));
}

/** Copy-as-equivalent (spec §2): only same-named blocks convert losslessly; everything else is reported as needing manual rebuild. */
export function convertBlock(block: Block, target: Channel): { block: Block } | { error: string } {
  const bare = block.type.split('.').slice(1).join('.');
  const targetType = `${target}.${bare}`;
  if (block.type.startsWith(`${target}.`)) return { block: { ...structuredClone(block), id: generateId('blk') } };
  const spec = blockSpecs[targetType];
  if (!spec) return { error: `There is no lossless equivalent of ${blockTitle(block.type)} on the ${target === 'app' ? 'mobile app' : 'website'}. Rebuild it with the closest block (for example hero carousel → hero film, product rail → product grid).` };
  const props = structuredClone(block.props);
  const errors = validate(spec.props, props);
  if (Object.keys(errors).length) return { error: `${blockTitle(block.type)} exists on both channels but its settings differ (${Object.keys(errors).slice(0, 3).join(', ')}). Rebuild it on the other channel.` };
  return { block: { ...structuredClone(block), id: generateId('blk'), type: targetType, props } };
}

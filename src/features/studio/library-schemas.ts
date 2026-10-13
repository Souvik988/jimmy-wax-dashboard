import blocksSchema from '../../../docs/backend-contract/blocks.schema.json';

import type { JsonSchema } from './engine/schema';
import type { LibraryEntity } from '@/lib/api/resources/studio';

/**
 * Form schemas for the content library. The backend publishes the authoritative ones as docs/backend-contract/entity-schemas.json
 * (generated from packages/commerce-domain/src/experience/entities.ts); tests/unit/studio/entity-schema-drift.test.ts fails when
 * these forms and that file disagree about fields, required fields or what a minimal record looks like. The backend also validates
 * strictly on save, so a drift can never cause silent data loss.
 */
const slug = '^[a-z0-9]+(-[a-z0-9]+)*$';
const uuid: JsonSchema = { type: 'string', format: 'uuid', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' };
const status: JsonSchema = { type: 'string', enum: ['draft', 'active', 'archived'] };
const dateTime: JsonSchema = { type: 'string', format: 'date-time' };
const channels: JsonSchema = { type: 'array', items: { type: 'string', enum: ['app', 'web'] }, minItems: 1, maxItems: 2 };
const mediaRef = blocksSchema.mediaRef as unknown as JsonSchema;
const action = blocksSchema.action as unknown as JsonSchema;
const text = (maxLength: number, minLength = 1): JsonSchema => ({ type: 'string', minLength, maxLength });

export const librarySchemas: Record<LibraryEntity, JsonSchema> = {
  'care-guides': {
    type: 'object', additionalProperties: false, required: ['title', 'steps'],
    properties: {
      id: { type: 'string', pattern: slug, minLength: 2, maxLength: 80 },
      title: text(160, 2), intro: text(600, 0),
      steps: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['label', 'title', 'body', 'image'], properties: { label: text(20), title: text(80, 2), body: text(300, 3), image: mediaRef } } },
      cta: action, status,
    },
  },
  stories: {
    type: 'object', additionalProperties: false, required: ['title', 'videoMediaId', 'posterMediaId', 'alt'],
    properties: {
      title: text(120, 2), line: text(240, 0), videoMediaId: uuid, posterMediaId: uuid, alt: text(300, 3),
      productId: { type: 'string', pattern: slug, minLength: 2, maxLength: 80 },
      position: { type: 'integer', minimum: 0, maximum: 1000 }, status,
    },
  },
  journal: {
    type: 'object', additionalProperties: false, required: ['title'],
    properties: {
      id: { type: 'string', pattern: slug, minLength: 2, maxLength: 80 },
      kicker: text(60, 0), readMinutes: { type: 'integer', minimum: 1, maximum: 60 }, title: text(160, 2), excerpt: text(400, 0),
      imageMediaId: uuid, alt: text(300, 0), bodyMd: text(20000, 0),
      productId: { type: 'string', pattern: slug, minLength: 2, maxLength: 80 }, publishedAt: dateTime, status,
    },
  },
  testimonials: {
    type: 'object', additionalProperties: false, required: ['name', 'quote'],
    properties: {
      name: text(80, 2), city: text(80), avatarMediaId: uuid, quote: text(600, 10), rating: { type: 'integer', minimum: 1, maximum: 5 },
      source: { type: 'string', enum: ['verified_review', 'owner_supplied', 'placeholder'] },
      consent: { type: 'object', additionalProperties: false, required: ['recordedAt', 'note'], properties: { recordedAt: dateTime, note: text(300, 5) } },
      channels, videoMediaId: uuid, posterMediaId: uuid, position: { type: 'integer', minimum: 0, maximum: 1000 }, status,
    },
  },
  'faq-groups': {
    type: 'object', additionalProperties: false, required: ['title', 'items'],
    properties: {
      id: { type: 'string', pattern: slug, minLength: 2, maxLength: 80 }, title: text(120, 2),
      items: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'object', additionalProperties: false, required: ['q', 'aMd'], properties: { q: text(160, 3), aMd: text(1500, 3) } } },
      status,
    },
  },
  announcements: {
    type: 'object', additionalProperties: false, required: ['text'],
    properties: { text: text(200, 3), action, tone: { type: 'string', enum: ['info', 'promo', 'warning'] }, startsAt: dateTime, endsAt: dateTime, channels, status },
  },
};

export const libraryHelp: Record<LibraryEntity, string> = {
  'care-guides': 'Step-by-step care rituals referenced by id from the app “Care ritual” block and the website “Ritual steps” block.',
  stories: 'Short video stories (reels). Both the video and its poster must be approved media.',
  journal: 'Journal notes. Body supports the safe Markdown subset.',
  testimonials: 'Never invent reviews. “Owner supplied” entries require a recorded consent note; “placeholder” entries are for layout only and should not be published.',
  'faq-groups': 'FAQ groups referenced by the FAQ blocks.',
  announcements: 'Announcement bars with an optional window and action.',
};

export function titleOf(item: Record<string, unknown>): string {
  for (const key of ['title', 'name', 'text', 'id']) {
    const value = item[key];
    if (typeof value === 'string' && value) return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  }
  return String(item['id'] ?? 'Untitled');
}

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import blocksSchema from '../../../docs/backend-contract/blocks.schema.json';
import { SchemaForm } from '@/features/studio/engine/schema-form';
import type { JsonSchema } from '@/features/studio/engine/schema';

const resources = vi.hoisted(() => ({ getMedia: vi.fn(), getMediaPage: vi.fn() }));
vi.mock('@/lib/api/resources/media', () => resources);

afterEach(() => { cleanup(); vi.resetAllMocks(); });

const mediaId = '11111111-1111-4111-8111-111111111111';
const bannerImage = (blocksSchema.blocks as unknown as Record<string, { props: { properties: { image: JsonSchema } } }>)['app.banner']!.props.properties.image;
const form = (value: unknown, schema: JsonSchema = { type: 'object', properties: { image: bannerImage }, required: ['image'], additionalProperties: false }) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SchemaForm schema={schema} value={value} onChange={() => undefined} /></QueryClientProvider>);

describe('exact media slot guidance from the backend contract', () => {
  it('the contract publishes a size for the app banner image', () => {
    expect(bannerImage['x-slot']).toEqual({ minWidth: 1080, minHeight: 608, aspect: '16:9' });
  });

  it('tells the editor what the slot needs, next to the media id field', () => {
    resources.getMedia.mockResolvedValue({ kind: 'image', width: 1920, height: 1080 });
    form({ image: { mediaId } });
    expect(screen.getByText(/Needs at least 1080 × 608 px, 16:9 shape\./)).toBeInTheDocument();
  });

  it('warns when the chosen image is smaller than the slot, using the slot size rather than a generic threshold', async () => {
    resources.getMedia.mockResolvedValue({ kind: 'image', width: 900, height: 506 });
    form({ image: { mediaId } });
    expect(await screen.findByText(/900 × 506 px is smaller than this slot needs/)).toBeInTheDocument();
  });

  it('stays quiet for an image that fits the slot', async () => {
    resources.getMedia.mockResolvedValue({ kind: 'image', width: 1920, height: 1080 });
    form({ image: { mediaId } });
    await screen.findByText(/Needs at least/);
    expect(screen.queryByRole('list', { name: 'Image quality' })).not.toBeInTheDocument();
  });

  it('falls back to the generic checks for a media field with no published slot', async () => {
    resources.getMedia.mockResolvedValue({ kind: 'image', width: 480, height: 480 });
    form({ image: { mediaId } }, { type: 'object', properties: { image: (({ 'x-slot': _slot, ...rest }) => rest)(bannerImage) }, required: ['image'], additionalProperties: false });
    expect(await screen.findByText(/Only 480 px wide/)).toBeInTheDocument();
    expect(screen.queryByText(/Needs at least/)).not.toBeInTheDocument();
  });
});

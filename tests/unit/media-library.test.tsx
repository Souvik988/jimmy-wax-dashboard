// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MediaLibrary } from '@/features/media/media-library';
import { ApiError } from '@/lib/api/errors';
import type { Media } from '@/lib/api/resources/media';

const resources = vi.hoisted(() => ({ getMediaPage: vi.fn(), getMedia: vi.fn(), getMediaUsage: vi.fn(), updateMedia: vi.fn(), approveMedia: vi.fn(), rejectMedia: vi.fn(), uploadMediaFile: vi.fn(), archiveMedia: vi.fn(), restoreMedia: vi.fn() }));
vi.mock('@/lib/api/resources/media', () => resources);

const image: Media = {
  id: '11111111-1111-4111-8111-111111111111', kind: 'image', sha256: 'a'.repeat(64), mime: 'image/webp', bytes: 120,
  width: 400, height: 300, durationMs: null, filename: 'leather-care.jpg', status: 'ready', provenance: 'original_photo',
  approval: 'draft', approvalNote: null, packagingAttested: false, alt: 'Leather care kit', decorative: false,
  focal: { x: 0.5, y: 0.5 }, tags: ['product'], folder: 'catalogue', role: 'product_packshot', license: 'Rights holder: JIMMY & WAX | Evidence: owner approval 2026-10-07',
  rightsHolder: 'JIMMY & WAX', provenanceNote: 'Owner approval 2026-10-07', consentReference: null,
  posterMediaId: null, bundledKey: null, archived: false, updatedAt: '2026-10-07T10:05:00.000Z',
  urls: { original: `/v1/media/${'a'.repeat(64)}/orig.webp`, variants: [{ url: `/v1/media/${'a'.repeat(64)}/w320.webp`, width: 320 }] },
  createdAt: '2026-10-07T10:00:00.000Z',
};
const video: Media = {
  ...image, id: '22222222-2222-4222-8222-222222222222', kind: 'video', sha256: 'b'.repeat(64), mime: 'video/mp4', filename: 'care-demo.mp4',
  width: null, height: null, durationMs: null, role: 'campaign', alt: 'Leather care demonstration',
  urls: { original: `/v1/media/${'b'.repeat(64)}/video.mp4`, variants: [] },
};

function renderLibrary(canWrite = false, canReview = false) {
  resources.getMediaPage.mockResolvedValue({ items: [image, video], nextCursor: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MediaLibrary canWrite={canWrite} canReview={canReview} /></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.resetAllMocks(); });
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});

describe('MediaLibrary', () => {
  it('shows only backend assets and explains who can see drafts versus approved media', async () => {
    renderLibrary();
    expect(await screen.findByRole('heading', { name: 'leather-care.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Leather care kit' })).toHaveAttribute('src', `/api/media/${'a'.repeat(64)}/w320.webp`);
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'care-demo.mp4' })).toBeInTheDocument();
    expect(screen.getByText(/Duration and dimensions are not reported by the backend/i)).toBeInTheDocument();
    expect(screen.getByText(/Approved media becomes publicly retrievable/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter media by usage' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('sends only supported filters and the opaque cursor to the backend', async () => {
    resources.getMediaPage.mockReset()
      .mockResolvedValueOnce({ items: [image], nextCursor: null })
      .mockResolvedValueOnce({ items: [image], nextCursor: 'opaque-page-2' })
      .mockResolvedValueOnce({ items: [video], nextCursor: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MediaLibrary canWrite={false} canReview={false} /></QueryClientProvider>);
    await screen.findByRole('heading', { name: 'leather-care.jpg' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter media by approval' }), { target: { value: 'draft' } });
    await waitFor(() => expect(resources.getMediaPage).toHaveBeenLastCalledWith({ q: '', kind: undefined, approval: 'draft', provenance: undefined, archived: false, limit: 30 }, null, expect.any(AbortSignal)));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next media page' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Next media page' }));
    expect(await screen.findByRole('heading', { name: 'care-demo.mp4' })).toBeInTheDocument();
    expect(resources.getMediaPage).toHaveBeenLastCalledWith({ q: '', kind: undefined, approval: 'draft', provenance: undefined, archived: false, limit: 30 }, 'opaque-page-2', expect.any(AbortSignal));
  });

  it('shows a request-referenced forbidden state instead of a mock library', async () => {
    resources.getMediaPage.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Media read denied.', 'media-denied-4'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MediaLibrary canWrite={false} canReview={false} /></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Media access denied' })).toBeInTheDocument();
    expect(screen.getByText(/media-denied-4/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'leather-care.jpg' })).not.toBeInTheDocument();
  });

  it('keeps review controls Admin-only even for an operator with media:write, who can still archive', async () => {
    resources.getMediaPage.mockResolvedValue({ items: [image], nextCursor: null });
    resources.getMedia.mockResolvedValue(image);
    resources.getMediaUsage.mockResolvedValue({ items: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MediaLibrary canWrite canReview={false} /></QueryClientProvider>);
    await screen.findByRole('heading', { name: 'leather-care.jpg' });
    fireEvent.click(screen.getByRole('button', { name: 'Review leather-care.jpg' }));
    expect(await screen.findByRole('heading', { name: 'Metadata' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admin review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve for use' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive asset' })).toBeInTheDocument();
  });

  it('sends the usage filter to the server instead of filtering a page on the client', async () => {
    renderLibrary();
    await screen.findByRole('heading', { name: 'leather-care.jpg' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter media by usage' }), { target: { value: 'unused' } });
    await waitFor(() => expect(resources.getMediaPage).toHaveBeenLastCalledWith(expect.objectContaining({ inUse: false }), null, expect.any(AbortSignal)));
  });

  it('archives with the loaded version stamp and a reason, then reloads the asset', async () => {
    resources.getMediaPage.mockResolvedValue({ items: [image], nextCursor: null });
    resources.getMedia.mockResolvedValue(image);
    resources.getMediaUsage.mockResolvedValue({ items: [] });
    resources.archiveMedia.mockResolvedValue(undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MediaLibrary canWrite canReview={false} /></QueryClientProvider>);
    await screen.findByRole('heading', { name: 'leather-care.jpg' });
    fireEvent.click(screen.getByRole('button', { name: 'Review leather-care.jpg' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive asset' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive this media asset' });
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: 'Superseded by a new packshot' } });
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Continue')!);
    await waitFor(() => expect(resources.archiveMedia).toHaveBeenCalledWith(image.id, { expectedUpdatedAt: image.updatedAt, reason: 'Superseded by a new packshot' }));
  });

  it('lists the references that block archiving instead of claiming success', async () => {
    resources.getMediaPage.mockResolvedValue({ items: [image], nextCursor: null });
    resources.getMedia.mockResolvedValue(image);
    resources.getMediaUsage.mockResolvedValue({ items: [] });
    resources.archiveMedia.mockRejectedValue(new ApiError(409, 'ILLEGAL_STATE', 'Still referenced.', 'req-9', false, undefined, [{ type: 'studio_live', id: 'app', label: 'Live app release #7' }]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MediaLibrary canWrite canReview={false} /></QueryClientProvider>);
    await screen.findByRole('heading', { name: 'leather-care.jpg' });
    fireEvent.click(screen.getByRole('button', { name: 'Review leather-care.jpg' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive asset' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive this media asset' });
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: 'Retire this asset' } });
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Continue')!);
    expect(await screen.findByRole('list', { name: 'References that block archiving' })).toHaveTextContent('Live app release #7');
    expect(screen.getByText(/Not archived: it is still referenced/)).toBeInTheDocument();
  });

  it('requires an explicit confirmation phrase before the Admin review call', async () => {
    resources.getMediaPage.mockResolvedValue({ items: [image], nextCursor: null });
    resources.getMedia.mockResolvedValue(image);
    resources.getMediaUsage.mockResolvedValue({ items: [] });
    resources.approveMedia.mockResolvedValue({ ...image, approval: 'approved' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MediaLibrary canWrite canReview /></QueryClientProvider>);
    await screen.findByRole('heading', { name: 'leather-care.jpg' });
    fireEvent.click(screen.getByRole('button', { name: 'Review leather-care.jpg' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve for use' }));
    expect(screen.getByText(/does not make it public/i)).toBeInTheDocument();
    expect(resources.approveMedia).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Type APPROVE ASSET to continue/i), { target: { value: 'APPROVE ASSET' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(resources.approveMedia).toHaveBeenCalledWith(image.id, {}));
  });

  it('sends only the changed metadata field so an alt edit does not reset approval', async () => {
    const approved = { ...image, approval: 'approved' as const };
    resources.getMediaPage.mockResolvedValue({ items: [approved], nextCursor: null });
    resources.getMedia.mockResolvedValue(approved);
    resources.getMediaUsage.mockResolvedValue({ items: [] });
    resources.updateMedia.mockResolvedValue({ ...approved, alt: 'Updated leather care kit' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MediaLibrary canWrite canReview /></QueryClientProvider>);
    await screen.findByRole('heading', { name: 'leather-care.jpg' });
    fireEvent.click(screen.getByRole('button', { name: 'Review leather-care.jpg' }));
    const alt = await screen.findByRole('textbox', { name: 'Alternative text' });
    fireEvent.change(alt, { target: { value: 'Updated leather care kit' } });
    expect(screen.queryByText(/will reset its review to Draft/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save metadata' }));
    await waitFor(() => expect(resources.updateMedia).toHaveBeenCalledWith(approved.id, { alt: 'Updated leather care kit' }));
  });
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StudioPreview } from '@/features/studio/studio-preview';

const resources = vi.hoisted(() => ({ createPreviewToken: vi.fn() }));
vi.mock('@/lib/api/resources/studio', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/resources/studio')>()), createPreviewToken: resources.createPreviewToken }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const token = 'tok_1234567890123456789012';
const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
const renderPreview = (props: Partial<Parameters<typeof StudioPreview>[0]> = {}) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <StudioPreview channel="web" storefrontOrigin="https://www.example.com" unsaved={false} {...props} />
  </QueryClientProvider>,
);

describe('Studio preview', () => {
  it('frames the real website only after a token is issued, with the token in the URL', async () => {
    const user = userEvent.setup();
    resources.createPreviewToken.mockResolvedValue({ token, expiresAt, path: '/p' });
    renderPreview();
    expect(screen.queryByTitle(/Website draft preview/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load preview' }));
    const frame = await screen.findByTitle(/Website draft preview/);
    expect(frame).toHaveAttribute('src', `https://www.example.com/?jw_preview=${token}`);
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation');
    expect(resources.createPreviewToken).toHaveBeenCalledWith('web', 60);
  });

  it('switches device width through a data attribute and warns about unsaved edits', async () => {
    const user = userEvent.setup();
    resources.createPreviewToken.mockResolvedValue({ token, expiresAt, path: '/p' });
    renderPreview({ unsaved: true });
    expect(screen.getByRole('note')).toHaveTextContent(/last saved draft/i);
    await user.click(screen.getByRole('button', { name: 'Load preview' }));
    const frame = await screen.findByTitle(/Website draft preview/);
    expect(frame).toHaveAttribute('data-device', 'phone');
    await user.click(screen.getByRole('button', { name: /Desktop/ }));
    expect(screen.getByTitle(/Website draft preview/)).toHaveAttribute('data-device', 'desktop');
  });

  it('refuses an unsafe page path instead of framing it', async () => {
    const user = userEvent.setup();
    resources.createPreviewToken.mockResolvedValue({ token, expiresAt, path: '/p' });
    renderPreview();
    const input = screen.getByLabelText('Page path on the website');
    await user.clear(input);
    await user.type(input, '//evil.example');
    await user.click(screen.getByRole('button', { name: 'Load preview' }));
    expect(await screen.findByText(/cannot be previewed/)).toBeInTheDocument();
    expect(screen.queryByTitle(/Website draft preview/)).not.toBeInTheDocument();
  });

  it('says so when the storefront is not configured, and does not issue tokens', () => {
    renderPreview({ storefrontOrigin: undefined });
    expect(screen.getByRole('alert')).toHaveTextContent(/storefront address is not configured/);
    expect(screen.getByRole('button', { name: 'Load preview' })).toBeDisabled();
  });

  it('app channel: issues a 4-hour token and shows the exact device command, not a frame', async () => {
    const user = userEvent.setup();
    resources.createPreviewToken.mockResolvedValue({ token, expiresAt: new Date(Date.now() + 240 * 60_000).toISOString(), path: '/p' });
    renderPreview({ channel: 'app' });
    expect(screen.queryByTitle(/preview/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create app preview token' }));
    expect(await screen.findByLabelText('Command to run the app against the draft')).toHaveTextContent(`--dart-define=EXPERIENCE_PREVIEW_TOKEN=${token}`);
    expect(resources.createPreviewToken).toHaveBeenCalledWith('app', 240);
  });
});

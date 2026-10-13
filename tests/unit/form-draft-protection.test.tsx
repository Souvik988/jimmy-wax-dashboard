// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { FormDraftNotice, FormLeaveGuard, useFormDraft } from '@/components/forms/draft-protection';
import { draftStorageKey, invalidateDraftAvailabilityCache, saveDraft } from '@/lib/api/drafts';

function DraftProbe({ sensitive = false }: { sensitive?: boolean }) {
  const [value, setValue] = useState('original');
  const [dirty, setDirty] = useState(false);
  const parseDraft = (candidate: unknown): { content: string } | null => {
    if (typeof candidate !== 'object' || candidate === null || !('content' in candidate) || typeof candidate.content !== 'string') return null;
    return { content: candidate.content };
  };
  const draft = useFormDraft({
    resource: 'message-template',
    operatorId: 'operator-2',
    value: { content: value },
    dirty,
    sensitive,
    delayMs: 300,
    parseDraft,
    onRestore: (saved) => setValue(saved.content),
  });
  return <>
    <label>Message<input aria-label="Message" value={value} onChange={(event) => { setValue(event.target.value); setDirty(true); }} /></label>
    <FormDraftNotice dirty={dirty} draftAvailable={draft.draftAvailable} draftSaved={draft.draftSaved} canPersist={draft.canPersist} onRestore={() => { draft.restore(); }} onDiscard={draft.discard} />
  </>;
}

beforeEach(() => {
  push.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  invalidateDraftAvailabilityCache();
  vi.useRealTimers();
});

describe('form draft protection', () => {
  it('keeps full slug-scoped product drafts distinct for long backend identifiers', () => {
    const firstId = `product-${'a'.repeat(80)}`;
    const secondId = `product-${'b'.repeat(80)}`;

    expect(draftStorageKey(firstId, 'operator-2')).not.toBe(draftStorageKey(secondId, 'operator-2'));
  });

  it('autosaves an explicitly safe draft after a debounce and protects page unload', async () => {
    vi.useFakeTimers();
    render(<DraftProbe />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'A careful, safe draft' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(window.localStorage.getItem(draftStorageKey('message-template', 'operator-2'))).toContain('A careful, safe draft');
    expect(screen.getByRole('status').textContent).toContain('saved on this device');
    const leave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
  });

  it('does not persist sensitive drafts by default', async () => {
    vi.useFakeTimers();
    render(<DraftProbe sensitive />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'private content' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(window.localStorage.getItem(draftStorageKey('message-template', 'operator-2'))).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('not saved on this device');
  });

  it('restores and discards an operator-scoped saved draft with explicit controls', async () => {
    saveDraft(window.localStorage, 'message-template', 'operator-2', { content: 'Saved before navigation' }, { safeToPersist: true });
    render(<DraftProbe />);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore saved draft' }));
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement).value).toBe('Saved before navigation');
    fireEvent.click(screen.getByRole('button', { name: 'Discard saved draft' }));
    expect(window.localStorage.getItem(draftStorageKey('message-template', 'operator-2'))).toBeNull();
  });

  it('rejects and removes a malformed local draft instead of restoring it into the form', async () => {
    saveDraft(window.localStorage, 'message-template', 'operator-2', { content: 42 }, { safeToPersist: true });
    render(<DraftProbe />);

    fireEvent.click(await screen.findByRole('button', { name: 'Restore saved draft' }));

    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement).value).toBe('original');
    expect(window.localStorage.getItem(draftStorageKey('message-template', 'operator-2'))).toBeNull();
  });

  it('intercepts same-origin navigation and requires a clear leave decision', () => {
    // This deliberate raw anchor exercises the document-level click interception.
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    render(<FormLeaveGuard dirty><a href="/orders?status=placed">Orders</a></FormLeaveGuard>);
    fireEvent.click(screen.getByRole('link', { name: 'Orders' }));
    expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stay on this page' }));
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: 'Orders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));
    expect(push).toHaveBeenCalledWith('/orders?status=placed');
  });
});

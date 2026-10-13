// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Dialog } from '@/components/ui/overlays';

beforeAll(() => {
  // Browsers fire `close` after dialog.close(); jsdom does not, so reproduce the browser behaviour.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); } });
});
afterEach(cleanup);

function Nested({ onOuterChange }: { onOuterChange: (open: boolean) => void }): React.ReactNode {
  const [inner, setInner] = useState(false);
  return <Dialog open onOpenChange={onOuterChange} title="Outer">
    <button type="button" onClick={() => setInner(true)}>Open inner</button>
    <Dialog open={inner} onOpenChange={setInner} title="Inner"><button type="button" onClick={() => setInner(false)}>Finish inner</button></Dialog>
  </Dialog>;
}

describe('nested dialogs', () => {
  it('closing an inner dialog does not close the dialog that contains it', () => {
    const onOuterChange = vi.fn();
    const { container } = render(<Nested onOuterChange={onOuterChange} />);
    const inner = container.querySelectorAll('dialog')[1]!;
    fireEvent.click(screen.getByRole('button', { name: 'Open inner' }));
    expect(inner).toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'Finish inner', hidden: true }));
    expect(inner).not.toHaveAttribute('open');
    expect(onOuterChange).not.toHaveBeenCalled();
  });

  it('Escape on an inner dialog is handled by the inner dialog only', () => {
    const onOuterChange = vi.fn();
    render(<Nested onOuterChange={onOuterChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open inner' }));
    fireEvent(screen.getByRole('dialog', { name: 'Inner', hidden: true }), new Event('cancel', { cancelable: true }));
    expect(onOuterChange).not.toHaveBeenCalled();
  });

  it('still closes a dialog when its own close event fires', () => {
    const onChange = vi.fn();
    render(<Dialog open onOpenChange={onChange} title="Solo"><p>Body</p></Dialog>);
    screen.getByRole('dialog', { name: 'Solo', hidden: true }).dispatchEvent(new Event('close'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

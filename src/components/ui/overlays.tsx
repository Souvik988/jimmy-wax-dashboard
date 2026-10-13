'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { Button, CloseButton, cn } from './core';

// Native dialog supplies modal semantics and focus containment without a client-side overlay dependency.
type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode; footer?: ReactNode; className?: string; dismissible?: boolean };
export function Dialog({ open, onOpenChange, title, children, footer, className, dismissible = true }: DialogProps): ReactNode {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => { const dialog = ref.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); if (!open && dialog.open) dialog.close(); }, [open]);
  // React bubbles `cancel`/`close` through the component tree even though the native events do not, so a dialog opened
  // from inside another dialog (a reason prompt inside a drawer) would otherwise close its parent as well.
  return <dialog ref={ref} className={cn('ui-dialog', className)} aria-labelledby={titleId} onCancel={(event) => { event.stopPropagation(); event.preventDefault(); if (dismissible) onOpenChange(false); }} onClose={(event) => { event.stopPropagation(); if (dismissible) onOpenChange(false); }}><section><header><h2 id={titleId}>{title}</h2>{dismissible ? <CloseButton onClick={() => onOpenChange(false)} /> : null}</header><div className="ui-dialog__body">{children}</div>{footer ? <footer>{footer}</footer> : null}</section></dialog>;
}

export function Drawer({ open, onOpenChange, title, children, side = 'right' }: DialogProps & { side?: 'left' | 'right' }): ReactNode { return <Dialog open={open} onOpenChange={onOpenChange} title={title} className={cn('ui-dialog--drawer', `ui-dialog--${side}`)}>{children}</Dialog>; }

export function Popover({ label, children, content }: { label: string; children: ReactNode; content: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false); return <span className="ui-popover"><button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{children}</button>{open ? <span role="dialog" aria-label={label} className="ui-popover__content">{content}</span> : null}</span>;
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }): ReactNode { return <span className="ui-tooltip" data-tooltip={label}>{children}</span>; }

export function ConfirmDialog({ open, onOpenChange, phrase, onConfirm, pending = false, title = 'Confirm this action', children }: { open: boolean; onOpenChange: (open: boolean) => void; phrase: string; onConfirm: () => void; pending?: boolean; title?: string; children: ReactNode }): ReactNode {
  const [typed, setTyped] = useState('');
  return <Dialog open={open} onOpenChange={onOpenChange} title={title} footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="danger" loading={pending} disabled={typed !== phrase} onClick={onConfirm}>Confirm</Button></>}><p>{children}</p><label className="ui-field"><span className="ui-field__label">Type <code>{phrase}</code> to continue</span><input className="ui-input" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" /></label></Dialog>;
}

export function ReasonDialog({ open, onOpenChange, onConfirm, pending = false, title = 'Add a reason', children }: { open: boolean; onOpenChange: (open: boolean) => void; onConfirm: (reason: string) => void; pending?: boolean; title?: string; children: ReactNode }): ReactNode {
  const [reason, setReason] = useState(''); const valid = [...reason.trim()].length >= 3 && [...reason.trim()].length <= 300;
  return <Dialog open={open} onOpenChange={onOpenChange} title={title} footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={pending} disabled={!valid} onClick={() => onConfirm(reason.trim())}>Continue</Button></>}><p>{children}</p><label className="ui-field"><span className="ui-field__label">Reason</span><textarea className="ui-input ui-textarea" minLength={3} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} /><span className="ui-field__description">{[...reason].length}/300 characters · required by the backend for sensitive actions.</span></label></Dialog>;
}

export function StepUpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): ReactNode { return <Dialog open={open} onOpenChange={onOpenChange} title="Additional verification required" footer={<Button onClick={() => onOpenChange(false)}>Close</Button>}><p>This is an interface placeholder. Phase 3 connects it to the server-verified MFA step-up flow; this screen never grants access itself.</p></Dialog>; }

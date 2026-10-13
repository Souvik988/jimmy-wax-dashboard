'use client';
/* eslint-disable @next/next/no-img-element -- Avatar may render an authenticated backend asset; Next image optimization is not an auth boundary. */

import { Check, ChevronDown, Clipboard, LoaderCircle, X } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { forwardRef, useId, useState } from 'react';

import { formatMoney, parseRupeesToPaise } from '@/lib/format/money';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading = false, disabled, children, type = 'button', ...props }, ref,
) {
  return <button ref={ref} type={type} className={cn('ui-button', `ui-button--${variant}`, `ui-button--${size}`, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading ? <LoaderCircle className="ui-spin" size={16} aria-hidden="true" /> : null}{children}
  </button>;
});

export function IconButton({ label, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }): ReactNode {
  return <button type="button" className={cn('ui-icon-button', className)} aria-label={label} title={label} {...props}>{children}</button>;
}

type FieldProps = { label: string; description?: string | undefined; error?: string | undefined; required?: boolean | undefined; className?: string | undefined; hintId?: string | undefined; htmlFor?: string | undefined; children: ReactNode };

function Field({ label, description, error, required, className, hintId, htmlFor, children }: FieldProps): ReactNode {
  const caption = <span className="ui-field__label">{label}{required ? <span aria-hidden="true"> *</span> : null}</span>;
  const hints = <>
    {description ? <span id={hintId} className="ui-field__description">{description}</span> : null}
    {error ? <span id={hintId} className="ui-field__error" role="alert">{error}</span> : null}
  </>;
  // With an explicit control id the label wraps only its caption, so hints (counters, errors) are announced as descriptions, not as part of the name.
  if (htmlFor) return <div className={cn('ui-field', className)}><label htmlFor={htmlFor} className="ui-field__label-wrap">{caption}</label>{children}{hints}</div>;
  return <label className={cn('ui-field', className)}>{caption}{children}{hints}</label>;
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & Omit<FieldProps, 'children'>;
export const Input = forwardRef<HTMLInputElement, TextFieldProps>(function Input({ label, description, error, required, className, id, ...props }, ref) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = description || error ? `${inputId}-hint` : undefined;
  return <Field label={label} description={description} error={error} required={required} className={className} hintId={hintId} htmlFor={inputId}>
    <input ref={ref} id={inputId} className="ui-input" required={required} aria-invalid={Boolean(error) || undefined} aria-describedby={hintId} {...props} />
  </Field>;
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & Omit<FieldProps, 'children'>;
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, description, error, required, className, id, ...props }, ref) {
  const generated = useId(); const textareaId = id ?? generated; const hintId = description || error ? `${textareaId}-hint` : undefined;
  return <Field label={label} description={description} error={error} required={required} className={className} hintId={hintId} htmlFor={textareaId}>
    <textarea ref={ref} id={textareaId} className="ui-input ui-textarea" required={required} aria-invalid={Boolean(error) || undefined} aria-describedby={hintId} {...props} />
  </Field>;
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & Omit<FieldProps, 'children'> & { children: ReactNode };
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, description, error, required, className, id, children, ...props }, ref) {
  const generated = useId(); const selectId = id ?? generated; const hintId = description || error ? `${selectId}-hint` : undefined;
  return <Field label={label} description={description} error={error} required={required} className={className} hintId={hintId} htmlFor={selectId}>
    <span className="ui-select-wrap"><select ref={ref} id={selectId} className="ui-input ui-select" required={required} aria-invalid={Boolean(error) || undefined} aria-describedby={hintId} {...props}>{children}</select><ChevronDown size={16} aria-hidden="true" /></span>
  </Field>;
});

export function Combobox({ label, options, value, onChange, placeholder = 'Search options', disabled = false }: { label: string; options: string[]; value: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean }): ReactNode {
  const listId = useId();
  return <Field label={label} description="Type to filter the currently available options."><input className="ui-input" role="combobox" aria-controls={listId} aria-expanded="false" value={value} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></Field>;
}

export function MultiSelect({ label, options, values, onChange }: { label: string; options: string[]; values: string[]; onChange: (values: string[]) => void }): ReactNode {
  return <fieldset className="ui-field"><legend className="ui-field__label">{label}</legend><div className="ui-choice-list">{options.map((option) => <Checkbox key={option} label={option} checked={values.includes(option)} onChange={(checked) => onChange(checked ? [...values, option] : values.filter((value) => value !== option))} />)}</div></fieldset>;
}

export function Checkbox({ label, checked, onChange, disabled = false }: { label: ReactNode; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }): ReactNode {
  return <label className="ui-choice"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

export function Switch({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }): ReactNode {
  return <label className="ui-switch"><span>{label}</span><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

export function RadioGroup({ label, options, value, onChange }: { label: string; options: Array<{ value: string; label: string; disabled?: boolean }>; value: string; onChange: (value: string) => void }): ReactNode {
  const name = useId(); return <fieldset className="ui-field"><legend className="ui-field__label">{label}</legend><div className="ui-choice-list">{options.map((option) => <label className="ui-choice" key={option.value}><input type="radio" name={name} value={option.value} checked={value === option.value} disabled={option.disabled} onChange={() => onChange(option.value)} /><span>{option.label}</span></label>)}</div></fieldset>;
}

export function MoneyInput({ label, paise, onChange, error, disabled = false }: { label: string; paise: number | null; onChange: (paise: number | null) => void; error?: string | undefined; disabled?: boolean }): ReactNode {
  const [draft, setDraft] = useState(paise === null ? '' : formatMoney(paise, { showPaise: true }).replace('₹', '').trim());
  return <Input label={label} inputMode="decimal" value={draft} disabled={disabled} error={error} onChange={(event) => { const next = event.target.value; setDraft(next); onChange(next === '' ? null : parseRupeesToPaise(next)); }} onBlur={() => { if (paise !== null) setDraft(formatMoney(paise, { showPaise: true }).replace('₹', '').trim()); }} />;
}

export function DateInput({ label, value, onChange, disabled = false }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }): ReactNode { return <Input label={label} type="date" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />; }

export function DateRangeInput({ label, start, end, onChange }: { label: string; start: string; end: string; onChange: (range: { start: string; end: string }) => void }): ReactNode {
  return <fieldset className="ui-date-range"><legend>{label}</legend><DateInput label="Start date" value={start} onChange={(next) => onChange({ start: next, end })} /><DateInput label="End date" value={end} onChange={(next) => onChange({ start, end: next })} /></fieldset>;
}

export function Tabs({ tabs, value, onChange }: { tabs: Array<{ id: string; label: string; disabled?: boolean }>; value: string; onChange: (value: string) => void }): ReactNode {
  return <div className="ui-tabs" role="tablist">{tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={tab.id === value} disabled={tab.disabled} className={cn('ui-tab', tab.id === value && 'is-active')} onClick={() => onChange(tab.id)}>{tab.label}</button>)}</div>;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'info'; children: ReactNode }): ReactNode { return <span className={cn('ui-badge', `ui-badge--${tone}`)}>{children}</span>; }
export function StatusPill({ tone = 'info', children }: { tone?: 'positive' | 'negative' | 'warning' | 'info'; children: ReactNode }): ReactNode { return <span className={cn('ui-status', `ui-status--${tone}`)}><i aria-hidden="true" />{children}</span>; }

export function Avatar({ name, src }: { name: string; src?: string }): ReactNode { const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'; return <span className="ui-avatar" aria-label={name}>{src ? <img src={src} alt="" /> : initials}</span>; }

export function CopyableId({ value, label = 'Copy identifier' }: { value: string; label?: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); } };
  return <span className="ui-copy"><code>{value}</code><IconButton label={copied ? 'Copied' : label} onClick={() => void copy()}>{copied ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}</IconButton></span>;
}

export function CloseButton({ onClick }: { onClick: () => void }): ReactNode { return <IconButton label="Close" onClick={onClick}><X size={18} aria-hidden="true" /></IconButton>; }

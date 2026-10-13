'use client';

import { ArrowDown, ArrowUp, Copy, ImageIcon, Plus, Trash2 } from 'lucide-react';
import { createContext, useContext, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button, IconButton, Input, Select, Switch, Textarea } from '@/components/ui/core';
import { Dialog } from '@/components/ui/overlays';
import { getMedia, getMediaPage, type Media } from '@/lib/api/resources/media';
import { localMediaUrl } from '@/lib/api/resources/media-validation';
import { listCategoryLookups, listCollectionLookups, getProductLookup, searchProducts, type StudioVariable } from '@/lib/api/resources/studio';

import {
  type ErrorMap, type JsonSchema, generateId, hasCurrencyLiteral, humanize, isObjectSchema, matchVariant, minimalInstance,
  substituteVariables, variableTokens, variantLabel, variantsOf,
} from './schema';
import { imageQualityHints, slotRequirement, type ImageSlot } from './image-quality';
import styles from './schema-form.module.css';

/** Plugin registry: first matching widget wins; fall through to the generic renderer. */
export type FieldInfo = { schema: JsonSchema; path: string; name: string; label: string };
export type WidgetProps = FieldInfo & { value: unknown; onChange: (next: unknown) => void; error: string | undefined; disabled: boolean };
export type Widget = { name: string; match: (info: FieldInfo) => boolean; render: (props: WidgetProps) => ReactNode };

const widgets: Widget[] = [];
export function registerWidget(widget: Widget): void {
  const existing = widgets.findIndex((candidate) => candidate.name === widget.name);
  if (existing >= 0) widgets.splice(existing, 1);
  widgets.push(widget);
}
export function registeredWidgets(): readonly string[] { return widgets.map((widget) => widget.name); }

type EngineContextValue = { variables: StudioVariable[]; disabled: boolean };
const EngineContext = createContext<EngineContextValue>({ variables: [], disabled: false });
/** The exact size of the media slot a field sits in (the nearest `x-slot` ancestor), if the backend published one. */
const SlotContext = createContext<ImageSlot | null>(null);

const LONG_TEXT_KEYS = new Set(['body', 'markdown', 'text', 'description', 'excerpt', 'caption', 'subhead', 'note', 'intro']);

export function MediaBrowser({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (media: Media) => void }): ReactNode {
  const [q, setQ] = useState('');
  const query = useQuery({
    queryKey: ['studio', 'media-picker', q],
    enabled: open,
    queryFn: ({ signal }) => getMediaPage({ approval: 'approved', archived: false, kind: 'image', limit: 24, ...(q.trim() ? { q: q.trim() } : {}) }, null, signal),
  });
  return <Dialog open={open} onOpenChange={onOpenChange} title="Choose approved media">
    <Input label="Search media" value={q} maxLength={100} onChange={(event) => setQ(event.target.value)} />
    {query.isLoading ? <p role="status">Loading approved media…</p> : null}
    {query.error ? <p role="alert">Approved media could not be loaded. You can still paste a media id.</p> : null}
    {query.data && query.data.items.length === 0 ? <p>No approved, non-archived images match. Approve media in the Media library first.</p> : null}
    <ul className={styles.mediaGrid}>
      {query.data?.items.map((media) => {
        const src = localMediaUrl(media.urls.variants.find((variant) => (variant.width ?? 0) >= 320)?.url ?? media.urls.original);
        return <li key={media.id}>
          <button type="button" className={styles.mediaChoice} onClick={() => { onPick(media); onOpenChange(false); }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- content-addressed local media proxy */}
            {src ? <img src={src} alt="" loading="lazy" /> : <ImageIcon aria-hidden="true" />}
            <span>{media.filename}</span>
            {media.alt ? <small>{media.alt}</small> : <small>No alt text</small>}
          </button>
        </li>;
      })}
    </ul>
  </Dialog>;
}

const uuidLike = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

function ImageHints({ mediaId, slot }: { mediaId: string; slot: ImageSlot | null }): ReactNode {
  const media = useQuery({ queryKey: ['studio', 'media-facts', mediaId], queryFn: ({ signal }) => getMedia(mediaId, signal), staleTime: 5 * 60_000, retry: false });
  if (!media.data || media.data.kind !== 'image') return null;
  const hints = imageQualityHints({ width: media.data.width, height: media.data.height }, slot ?? undefined);
  if (hints.length === 0) return null;
  return <ul className={styles.imageHints} aria-label="Image quality">{hints.map((hint) => <li key={hint.message} data-level={hint.level}>{hint.level === 'warn' ? 'Warning: ' : ''}{hint.message}</li>)}</ul>;
}

function MediaIdField({ value, onChange, error, label, disabled }: WidgetProps): ReactNode {
  const [open, setOpen] = useState(false);
  const slot = useContext(SlotContext);
  return <div className={styles.mediaField}>
    <Input label={label} value={typeof value === 'string' ? value : ''} disabled={disabled} error={error} spellCheck={false} description={slot ? `Approved media id (UUID). ${slotRequirement(slot)}` : 'Approved media id (UUID)'} onChange={(event) => onChange(event.target.value)} />
    <Button variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>Browse media</Button>
    {typeof value === 'string' && uuidLike.test(value) ? <ImageHints mediaId={value} slot={slot} /> : null}
    {open ? <MediaBrowser open={open} onOpenChange={setOpen} onPick={(media) => onChange(media.id)} /> : null}
  </div>;
}

function ColourField({ value, onChange, error, label, disabled }: WidgetProps): ReactNode {
  const text = typeof value === 'string' ? value : '#000000';
  return <div className={styles.colour}>
    <Input label={label} value={text} disabled={disabled} error={error} maxLength={9} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    <input type="color" aria-label={`${label} colour picker`} disabled={disabled} value={/^#[0-9a-fA-F]{6}/u.test(text) ? text.slice(0, 7) : '#000000'} onChange={(event) => onChange(event.target.value)} />
  </div>;
}

registerWidget({ name: 'media-id', match: ({ name, schema }) => schema.type === 'string' && (name === 'mediaId' || schema.format === 'uuid'), render: (props) => <MediaIdField {...props} /> });
registerWidget({ name: 'colour-hex', match: ({ schema }) => schema.type === 'string' && Boolean(schema.pattern?.startsWith('^#(')), render: (props) => <ColourField {...props} /> });

function StringField(props: WidgetProps): ReactNode {
  const { schema, value, onChange, error, label, disabled, name } = props;
  const { variables } = useContext(EngineContext);
  const text = typeof value === 'string' ? value : '';
  const id = useId();
  if (schema.enum) {
    return <Select label={label} value={text} disabled={disabled} error={error} onChange={(event) => onChange(event.target.value)}>
      {schema.enum.map((option) => <option key={String(option)} value={String(option)}>{humanize(String(option))}</option>)}
    </Select>;
  }
  if (name === 'id' && schema.pattern) {
    return <div className={styles.stableId}><span>{label}</span><code>{text}</code><small>Stable id — kept when you reorder or duplicate.</small>{error ? <em role="alert">{error}</em> : null}</div>;
  }
  if (schema.format === 'date-time') {
    const local = text ? new Date(text) : null;
    const display = local && !Number.isNaN(local.getTime()) ? new Date(local.getTime() - local.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '';
    return <Input label={label} type="datetime-local" value={display} disabled={disabled} error={error} description="Shown in your local time; saved as UTC." onChange={(event) => onChange(event.target.value ? new Date(event.target.value).toISOString() : undefined)} />;
  }
  // Headlines keep deliberate line breaks (a "line one" + "line two" pair), which a single-line input would silently strip.
  const long = (schema.maxLength ?? 0) > 160 || LONG_TEXT_KEYS.has(name) || name === 'headline' || text.includes('\n');
  const tokens = variableTokens(text);
  const preview = tokens.length ? substituteVariables(text, Object.fromEntries(variables.map((variable) => [variable.name, variable.value]))) : null;
  const remaining = schema.maxLength !== undefined ? `${[...text].length}/${schema.maxLength}` : undefined;
  const description = [remaining, hasCurrencyLiteral(text) ? 'Warning: use a {{store.*}} variable instead of typing a price.' : ''].filter(Boolean).join(' · ') || undefined;
  const field = long
    ? <Textarea id={id} label={label} value={text} disabled={disabled} error={error} description={description} onChange={(event) => onChange(event.target.value)} />
    : <Input id={id} label={label} value={text} disabled={disabled} error={error} description={description} onChange={(event) => onChange(event.target.value)} />;
  return <div className={styles.textField}>
    {field}
    {variables.length > 0 && (schema.maxLength ?? 999) >= 20 ? <label className={styles.variablePick}>
      <span className={styles.srOnly}>Insert variable into {label}</span>
      <select aria-label={`Insert variable into ${label}`} disabled={disabled} value="" onChange={(event) => { if (event.target.value) onChange(`${text}${event.target.value}`); }}>
        <option value="">Insert variable…</option>
        {variables.map((variable) => <option key={variable.name} value={variable.token}>{variable.name}{variable.value ? ` → ${variable.value}` : ' (not set)'}</option>)}
      </select>
    </label> : null}
    {preview ? <small className={styles.preview}>Preview: {preview}</small> : null}
  </div>;
}

function NumberField({ schema, value, onChange, error, label, disabled }: WidgetProps): ReactNode {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (typeof value === 'number' ? String(value) : '');
  return <Input label={label} type="number" inputMode={schema.type === 'integer' ? 'numeric' : 'decimal'} value={shown} disabled={disabled} error={error}
    {...(schema.minimum !== undefined ? { min: schema.minimum } : {})} {...(schema.maximum !== undefined ? { max: schema.maximum } : {})}
    step={schema.type === 'integer' ? 1 : 'any'}
    onChange={(event) => { setDraft(event.target.value); const next = event.target.value === '' ? undefined : Number(event.target.value); if (next === undefined || Number.isFinite(next)) onChange(next); }}
    onBlur={() => setDraft(null)} />;
}


/** Live catalogue picker for Action targets: warns when the target is inactive, archived or out of stock (spec §5.1). */
function EntityPicker({ kind, value, onChange, disabled, error }: { kind: 'product' | 'collection' | 'category'; value: string; onChange: (id: string) => void; disabled: boolean; error: string | undefined }): ReactNode {
  const [search, setSearch] = useState('');
  const term = search.trim();
  const products = useQuery({ queryKey: ['studio', 'lookup', 'products', term], enabled: kind === 'product' && (term.length >= 2 || value.length > 0), queryFn: ({ signal }) => searchProducts(term || value, signal), staleTime: 30_000 });
  const exact = useQuery({ queryKey: ['studio', 'lookup', 'product', value], enabled: kind === 'product' && value.length >= 2, queryFn: ({ signal }) => getProductLookup(value, signal), staleTime: 30_000 });
  const named = useQuery({ queryKey: ['studio', 'lookup', kind], enabled: kind !== 'product', queryFn: ({ signal }) => (kind === 'collection' ? listCollectionLookups(signal) : listCategoryLookups(signal)), staleTime: 60_000 });
  const label = kind === 'product' ? 'Product' : kind === 'collection' ? 'Collection' : 'Category';
  const selected = kind === 'product' ? exact.data ?? undefined : undefined;
  const stock = selected?.variants?.reduce((sum, variant) => sum + Math.max(0, (variant.onHand ?? 0) - (variant.reserved ?? 0)), 0);
  const warning = !value ? null : kind === 'product'
    ? (exact.data === null ? 'No product with this id was found in the catalogue.' : selected?.archived ? 'This product is archived.' : selected && !selected.active ? 'This product is inactive; customers cannot buy it.' : stock === 0 ? 'This product is out of stock.' : null)
    : (named.data && !named.data.some((item) => item.id === value) ? `No ${kind} with this id exists.` : named.data?.find((item) => item.id === value)?.active === false ? `This ${kind} is inactive.` : null);
  return <div className={styles.picker}>
    {kind === 'product' ? <Input label={`Search ${label.toLowerCase()} (2+ characters)`} value={search} disabled={disabled} onChange={(event) => setSearch(event.target.value)} /> : null}
    {kind === 'product' && term.length >= 2 && products.data ? <ul className={styles.pickerList} aria-label="Matching products">
      {products.data.length === 0 ? <li>No matches.</li> : products.data.map((item) => <li key={item.id}><button type="button" disabled={disabled} onClick={() => { onChange(item.id); setSearch(''); }}>{item.name} <small>{item.id}{item.archived ? ' · archived' : item.active ? '' : ' · inactive'}</small></button></li>)}
    </ul> : null}
    {kind !== 'product' ? <Select label={label} value={value} disabled={disabled} error={error} onChange={(event) => onChange(event.target.value)}>
      <option value="">Choose…</option>
      {value && !named.data?.some((item) => item.id === value) ? <option value={value}>{value}</option> : null}
      {named.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </Select> : <Input label={`${label} id`} value={value} disabled={disabled} error={error} spellCheck={false} onChange={(event) => onChange(event.target.value)} />}
    {warning ? <small className={styles.pickerWarning} role="status">{warning}</small> : null}
  </div>;
}

function UnionField({ info, value, onChange, error, disabled }: { info: FieldInfo; value: unknown; onChange: (next: unknown) => void; error: string | undefined; disabled: boolean }): ReactNode {
  const variants = variantsOf(info.schema)!;
  const matched = matchVariant(variants, value);
  const index = matched >= 0 ? matched : 0;
  const labels = variants.map((variant, position) => variantLabel(variant, position));
  return <fieldset className={styles.union}>
    <legend>{info.label}</legend>
    <Select label={`${info.label} type`} value={String(index)} disabled={disabled} error={error}
      onChange={(event) => onChange(minimalInstance(variants[Number(event.target.value)]!))}>
      {labels.map((label, position) => <option key={label + position} value={String(position)}>{label}</option>)}
    </Select>
    {(() => {
      const kindOf = variants[index]!.properties?.['type']?.enum?.[0];
      const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
      if (kindOf === 'product') return <EntityPicker kind="product" value={String(record['productId'] ?? '')} disabled={disabled} error={undefined} onChange={(productId) => onChange({ type: 'product', productId })} />;
      if (kindOf === 'collection') return <EntityPicker kind="collection" value={String(record['slug'] ?? '')} disabled={disabled} error={undefined} onChange={(slug) => onChange({ type: 'collection', slug })} />;
      if (kindOf === 'category') return <EntityPicker kind="category" value={String(record['categoryId'] ?? '')} disabled={disabled} error={undefined} onChange={(categoryId) => onChange({ type: 'category', categoryId })} />;
      return <FieldNode {...info} label="" schema={variants[index]!} value={value} onChange={onChange} hideHeader />;
    })()}
  </fieldset>;
}


/** Object whose keys are chosen by the editor (colour palette, gradients): list entries, add by name, remove. */
function MapField({ info, value, onChange, error, disabled }: { info: FieldInfo; value: unknown; onChange: (next: unknown) => void; error: string | undefined; disabled: boolean }): ReactNode {
  const [newKey, setNewKey] = useState('');
  const schema = info.schema;
  const valueSchema = schema.additionalProperties as JsonSchema;
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const keys = Object.keys(record);
  const pattern = schema.propertyPattern ? new RegExp(schema.propertyPattern, 'u') : null;
  const keyError = newKey && (pattern && !pattern.test(newKey) ? 'Lowercase letters, digits and underscores; start with a letter.' : record[newKey] !== undefined ? 'That name already exists.' : undefined);
  const full = schema.maxProperties !== undefined && keys.length >= schema.maxProperties;
  return <fieldset className={styles.array}>
    <legend>{info.label} <small>{keys.length}{schema.maxProperties !== undefined ? `/${schema.maxProperties}` : ''}</small></legend>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <ul className={styles.mapList}>
      {keys.map((key) => <li key={key} className={styles.arrayItem}>
        <div className={styles.itemTools}><strong><code>{key}</code></strong>
          <IconButton label={`Remove ${info.label} entry ${key}`} disabled={disabled} onClick={() => { const { [key]: _gone, ...rest } = record; onChange(rest); }}><Trash2 size={16} aria-hidden="true" /></IconButton></div>
        <FieldNode schema={valueSchema} path={info.path ? `${info.path}.${key}` : key} name={key} label={key} value={record[key]} onChange={(next) => onChange({ ...record, [key]: next })} hideHeader />
      </li>)}
    </ul>
    <div className={styles.mapAdd}>
      <Input label={`New ${info.label.toLowerCase()} entry name`} value={newKey} disabled={disabled || full} error={keyError || undefined} onChange={(event) => setNewKey(event.target.value)} />
      <Button variant="secondary" disabled={disabled || full || !newKey || Boolean(keyError)} onClick={() => { onChange({ ...record, [newKey]: minimalInstance(valueSchema) }); setNewKey(''); }}><Plus size={16} aria-hidden="true" />Add entry</Button>
    </div>
  </fieldset>;
}

type NodeProps = FieldInfo & { value: unknown; onChange: (next: unknown) => void; hideHeader?: boolean };
const ErrorsContext = createContext<ErrorMap>({});

export function FieldNode(props: NodeProps): ReactNode {
  const { schema, path, name, label, value, onChange, hideHeader } = props;
  const { disabled } = useContext(EngineContext);
  const errors = useContext(ErrorsContext);
  const error = errors[path || '_'];
  const info: FieldInfo = { schema, path, name, label };
  const widget = widgets.find((candidate) => candidate.match(info));
  if (widget) return widget.render({ ...info, value, onChange, error, disabled });

  if (variantsOf(schema)?.length) return <UnionField info={info} value={value} onChange={onChange} error={error} disabled={disabled} />;
  if (schema.type === 'boolean') return <Switch label={label} checked={value === true} disabled={disabled} onChange={onChange} />;
  if (schema.type === 'number' || schema.type === 'integer') return <NumberField {...info} value={value} onChange={onChange} error={error} disabled={disabled} />;
  if (schema.type === 'string') return <StringField {...info} value={value} onChange={onChange} error={error} disabled={disabled} />;

  if (schema.type === 'array') {
    const list = Array.isArray(value) ? value : [];
    const canAdd = schema.maxItems === undefined || list.length < schema.maxItems;
    const canRemove = schema.minItems === undefined || list.length > schema.minItems;
    const update = (next: unknown[]): void => onChange(next);
    return <fieldset className={styles.array}>
      <legend>{label} <small>{list.length}{schema.maxItems !== undefined ? `/${schema.maxItems}` : ''}</small></legend>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <ol>
        {list.map((item, index) => <li key={itemKey(item, index)} className={styles.arrayItem}>
          <div className={styles.itemTools} role="group" aria-label={`${label} item ${index + 1} actions`}>
            <strong>{index + 1}</strong>
            <IconButton label={`Move ${label} item ${index + 1} up`} disabled={disabled || index === 0} onClick={() => { const next = [...list]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; update(next); }}><ArrowUp size={16} aria-hidden="true" /></IconButton>
            <IconButton label={`Move ${label} item ${index + 1} down`} disabled={disabled || index === list.length - 1} onClick={() => { const next = [...list]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; update(next); }}><ArrowDown size={16} aria-hidden="true" /></IconButton>
            <IconButton label={`Duplicate ${label} item ${index + 1}`} disabled={disabled || !canAdd} onClick={() => update([...list.slice(0, index + 1), freshCopy(item), ...list.slice(index + 1)])}><Copy size={16} aria-hidden="true" /></IconButton>
            <IconButton label={`Remove ${label} item ${index + 1}`} disabled={disabled || !canRemove} onClick={() => update(list.filter((_, position) => position !== index))}><Trash2 size={16} aria-hidden="true" /></IconButton>
          </div>
          <FieldNode schema={schema.items ?? {}} path={path ? `${path}.${index}` : String(index)} name={String(index)} label={`${singular(label)} ${index + 1}`} value={item} onChange={(next) => update(list.map((current, position) => position === index ? next : current))} hideHeader />
        </li>)}
      </ol>
      <Button variant="secondary" disabled={disabled || !canAdd} onClick={() => update([...list, minimalInstance(schema.items ?? {})])}><Plus size={16} aria-hidden="true" />Add {singular(label).toLowerCase()}</Button>
    </fieldset>;
  }

  if (isObjectSchema(schema) && !schema.properties && schema.additionalProperties && typeof schema.additionalProperties === 'object') return <MapField info={info} value={value} onChange={onChange} error={error} disabled={disabled} />;

  if (isObjectSchema(schema)) {
    const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const required = new Set(schema.required ?? []);
    const objectSlot = schema['x-slot'];
    const fieldset = <fieldset className={hideHeader ? styles.objectFlat : styles.object}>
      {!hideHeader && label ? <legend>{label}</legend> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {Object.entries(schema.properties ?? {}).map(([name, child]) => {
        const childPath = path ? `${path}.${name}` : name;
        const present = record[name] !== undefined;
        const childLabel = humanize(name);
        if (!present && !required.has(name)) {
          return <div key={name} className={styles.optional}>
            <span>{childLabel}</span>
            <Button variant="quiet" disabled={disabled} onClick={() => onChange({ ...record, [name]: minimalInstance(child) })}><Plus size={14} aria-hidden="true" />Add {childLabel.toLowerCase()}</Button>
          </div>;
        }
        return <div key={name} className={styles.property}>
          <FieldNode schema={child} path={childPath} name={name} label={childLabel} value={record[name]} onChange={(next) => onChange({ ...record, [name]: next })} />
          {!required.has(name) ? <Button variant="quiet" disabled={disabled} onClick={() => { const { [name]: _removed, ...rest } = record; onChange(rest); }}>Remove {childLabel.toLowerCase()}</Button> : null}
        </div>;
      })}
    </fieldset>;
    return objectSlot ? <SlotContext.Provider value={objectSlot}>{fieldset}</SlotContext.Provider> : fieldset;
  }
  return <p className={styles.error}>Unsupported field type for “{label}”. Use the JSON tab.</p>;
}

function itemKey(item: unknown, index: number): string {
  if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') return (item as { id: string }).id;
  return `idx-${index}`;
}
function singular(label: string): string { return label.replace(/ies$/u, 'y').replace(/s$/u, '') || label; }
/** Duplicating gives nested ids fresh values — ids are stable identity, so two items must never share one. */
function freshCopy(item: unknown): unknown {
  const clone = structuredClone(item);
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (typeof record['id'] === 'string' && /^[A-Za-z0-9_-]{4,40}$/u.test(record['id'])) record['id'] = generateId();
      Object.values(record).forEach(walk);
    }
  };
  walk(clone);
  return clone;
}

/**
 * Renders a form for any supported JSON Schema. `errors` are dotted paths relative to `value`
 * (identical to the backend's `fields` map once scoped with errorsUnder).
 */
export function SchemaForm({ schema, value, onChange, errors = {}, variables = [], disabled = false, rootLabel = '' }: {
  schema: JsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  errors?: ErrorMap;
  variables?: StudioVariable[];
  disabled?: boolean;
  rootLabel?: string;
}): ReactNode {
  const context = useMemo(() => ({ variables, disabled }), [variables, disabled]);
  return <EngineContext.Provider value={context}>
    <ErrorsContext.Provider value={errors}>
      <div className={styles.form}>
        <FieldNode schema={schema} path="" name="" label={rootLabel} value={value} onChange={onChange} hideHeader />
      </div>
    </ErrorsContext.Provider>
  </EngineContext.Provider>;
}

import type { ShippingSettings } from '@/lib/api/resources/shipping';

/** Limits mirror the backend `ShippingSettingsPatch` / PIN route validation. */
export const courierRules = ['cheapest', 'fastest', 'balanced', 'preferred'] as const;
export const maxPinChangeBatch = 2000;

export type SettingsDraft = {
  pickupLocation: string;
  pickupPin: string;
  defaultWeightGrams: string;
  defaultLengthMm: string;
  defaultWidthMm: string;
  defaultHeightMm: string;
  courierRule: ShippingSettings['courierRule'];
  preferredCouriers: string;
  autoShip: boolean;
  bulkConfirmThreshold: string;
  requireProviderCheck: boolean;
  stuckAfterHours: string;
};

export type SettingsPatch = Partial<{
  pickupLocation: string | null;
  pickupPin: string | null;
  defaultWeightGrams: number;
  defaultLengthMm: number;
  defaultWidthMm: number;
  defaultHeightMm: number;
  courierRule: ShippingSettings['courierRule'];
  preferredCouriers: string[];
  autoShip: boolean;
  bulkConfirmThreshold: number;
  requireProviderCheck: boolean;
  stuckAfterHours: number;
}>;

export type SettingsChange = { field: keyof SettingsPatch; label: string; from: string; to: string };
export type SettingsBuild =
  | { ok: true; patch: SettingsPatch; changes: SettingsChange[] }
  | { ok: false; errors: Record<string, string> };

export function settingsDraftFrom(settings: ShippingSettings): SettingsDraft {
  return {
    pickupLocation: settings.pickupLocation ?? '',
    pickupPin: settings.pickupPin ?? '',
    defaultWeightGrams: String(settings.defaultWeightGrams),
    defaultLengthMm: String(settings.defaultLengthMm),
    defaultWidthMm: String(settings.defaultWidthMm),
    defaultHeightMm: String(settings.defaultHeightMm),
    courierRule: settings.courierRule,
    preferredCouriers: settings.preferredCouriers.join(', '),
    autoShip: settings.autoShip,
    bulkConfirmThreshold: String(settings.bulkConfirmThreshold),
    requireProviderCheck: settings.requireProviderCheck,
    stuckAfterHours: String(settings.stuckAfterHours),
  };
}

export function splitCouriers(text: string): string[] {
  return [...new Set(text.split(/[,\n]/u).map((part) => part.trim()).filter(Boolean))];
}

type IntField = { key: 'defaultWeightGrams' | 'defaultLengthMm' | 'defaultWidthMm' | 'defaultHeightMm' | 'bulkConfirmThreshold' | 'stuckAfterHours'; label: string; min: number; max: number };
const intFields: readonly IntField[] = [
  { key: 'defaultWeightGrams', label: 'Default weight (g)', min: 1, max: 50_000 },
  { key: 'defaultLengthMm', label: 'Default length (mm)', min: 1, max: 2000 },
  { key: 'defaultWidthMm', label: 'Default width (mm)', min: 1, max: 2000 },
  { key: 'defaultHeightMm', label: 'Default height (mm)', min: 1, max: 2000 },
  { key: 'bulkConfirmThreshold', label: 'Bulk confirmation threshold', min: 1, max: 200 },
  { key: 'stuckAfterHours', label: 'Stuck shipment threshold (hours)', min: 6, max: 720 },
];

const show = (value: unknown): string => (value === null || value === '' ? 'Not set' : Array.isArray(value) ? (value.length ? value.join(', ') : 'None') : typeof value === 'boolean' ? (value ? 'On' : 'Off') : String(value));

/** Builds a minimal PATCH body (changed fields only) and a before/after review list, or per-field errors. */
export function buildSettingsPatch(current: ShippingSettings, draft: SettingsDraft): SettingsBuild {
  const errors: Record<string, string> = {};
  const patch: SettingsPatch = {};
  const changes: SettingsChange[] = [];
  const record = <K extends keyof SettingsPatch>(field: K, label: string, from: unknown, to: unknown, value: SettingsPatch[K]): void => {
    patch[field] = value;
    changes.push({ field, label, from: show(from), to: show(to) });
  };

  const location = draft.pickupLocation.trim();
  if (location && (location.length < 2 || location.length > 120)) errors.pickupLocation = 'Use 2–120 characters, or leave empty to clear.';
  else if (location !== (current.pickupLocation ?? '')) record('pickupLocation', 'Pickup location', current.pickupLocation, location, location || null);

  const pin = draft.pickupPin.trim();
  if (pin && !/^[0-9]{6}$/u.test(pin)) errors.pickupPin = 'A pickup PIN is exactly 6 digits, or leave empty to clear.';
  else if (pin !== (current.pickupPin ?? '')) record('pickupPin', 'Pickup PIN', current.pickupPin, pin, pin || null);

  for (const field of intFields) {
    const text = draft[field.key].trim();
    const value = Number(text);
    if (!/^[0-9]+$/u.test(text) || !Number.isSafeInteger(value) || value < field.min || value > field.max) errors[field.key] = `Enter a whole number from ${field.min} to ${field.max}.`;
    else if (value !== current[field.key]) record(field.key, field.label, current[field.key], value, value);
  }

  if (draft.courierRule !== current.courierRule) record('courierRule', 'Courier selection', current.courierRule, draft.courierRule, draft.courierRule);

  const couriers = splitCouriers(draft.preferredCouriers);
  if (couriers.length > 10) errors.preferredCouriers = 'At most 10 preferred couriers.';
  else if (couriers.some((name) => name.length < 2 || name.length > 60)) errors.preferredCouriers = 'Each courier name is 2–60 characters.';
  else if (JSON.stringify(couriers) !== JSON.stringify(current.preferredCouriers)) record('preferredCouriers', 'Preferred couriers', current.preferredCouriers, couriers, couriers);
  if (draft.courierRule === 'preferred' && couriers.length === 0 && !errors.preferredCouriers) errors.preferredCouriers = 'Name at least one courier when the rule is “preferred”.';

  if (draft.autoShip !== current.autoShip) record('autoShip', 'Automatic provider dispatch', current.autoShip, draft.autoShip, draft.autoShip);
  if (draft.autoShip && !location && !errors.pickupLocation) errors.pickupLocation = 'Set a pickup location before automatic dispatch can be on.';
  if (draft.requireProviderCheck !== current.requireProviderCheck) record('requireProviderCheck', 'Provider serviceability check', current.requireProviderCheck, draft.requireProviderCheck, draft.requireProviderCheck);

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, patch, changes };
}

/** Does this change turn on provider dispatch or loosen the safety check? Such edits get an extra warning. */
export function isRiskySettingsChange(changes: readonly SettingsChange[]): boolean {
  return changes.some((change) => (change.field === 'autoShip' && change.to === 'On') || (change.field === 'requireProviderCheck' && change.to === 'Off'));
}

export type PinBuild =
  | { ok: true; add: string[]; remove: string[] }
  | { ok: false; error: string };

/** Parses free text into unique 3–6 digit prefixes. Anything else is reported, never silently dropped. */
export function parsePinPrefixes(text: string): { prefixes: string[]; invalid: string[] } {
  const parts = text.split(/[\s,;]+/u).map((part) => part.trim()).filter(Boolean);
  const invalid = parts.filter((part) => !/^[0-9]{3,6}$/u.test(part));
  const prefixes = [...new Set(parts.filter((part) => /^[0-9]{3,6}$/u.test(part)))];
  return { prefixes, invalid };
}

export function buildPinChange(existing: readonly string[], addText: string, removals: ReadonlySet<string>): PinBuild {
  const { prefixes, invalid } = parsePinPrefixes(addText);
  if (invalid.length) return { ok: false, error: `Not valid PIN prefixes (use 3–6 digits): ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? '…' : ''}` };
  const known = new Set(existing);
  const remove = [...removals].filter((prefix) => known.has(prefix));
  const add = prefixes.filter((prefix) => !known.has(prefix) || removals.has(prefix));
  const overlap = add.filter((prefix) => removals.has(prefix));
  if (overlap.length) return { ok: false, error: `${overlap[0]} is both added and removed; pick one.` };
  if (add.length === 0 && remove.length === 0) return { ok: false, error: 'Nothing to change: add new prefixes or mark existing ones for removal.' };
  if (add.length > maxPinChangeBatch || remove.length > maxPinChangeBatch) return { ok: false, error: `At most ${maxPinChangeBatch} prefixes per change.` };
  return { ok: true, add, remove };
}

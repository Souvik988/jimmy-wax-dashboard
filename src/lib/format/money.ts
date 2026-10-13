export function formatMoney(paise: number, options: { showPaise?: boolean } = {}): string {
  if (!Number.isSafeInteger(paise)) throw new TypeError('Money must be a safe integer number of paise.');
  const showPaise = options.showPaise ?? paise % 100 !== 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showPaise ? 2 : 0,
    maximumFractionDigits: showPaise ? 2 : 0,
  }).format(paise / 100);
}

export function parseRupeesToPaise(value: string): number | null {
  const normalized = value.trim().replaceAll(',', '').replace(/^₹\s?/, '');
  if (!/^-?(?:\d+)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [rupees, fraction = ''] = unsigned.split('.');
  const whole = Number(rupees);
  if (!Number.isSafeInteger(whole)) return null;
  const paise = whole * 100 + Number(fraction.padEnd(2, '0'));
  return negative ? -paise : paise;
}

const IST_TIME_ZONE = 'Asia/Kolkata';

export function formatIst(value: string | Date, options: Intl.DateTimeFormatOptions = {}): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  const hasComponentOptions = Object.keys(options).some((key) => key !== 'dateStyle' && key !== 'timeStyle');
  return new Intl.DateTimeFormat('en-IN', {
    ...(hasComponentOptions ? {} : { dateStyle: 'medium', timeStyle: 'short' }),
    ...options,
    timeZone: IST_TIME_ZONE,
  }).format(date);
}

export function formatRelativeIst(value: string | Date, now: Date = new Date()): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [['year', 31_536_000], ['month', 2_592_000], ['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1]];
  const formatter = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size || unit === 'second') return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(0, 'second');
}

export { IST_TIME_ZONE };

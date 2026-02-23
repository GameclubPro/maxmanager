const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getDateFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  formatterCache.set(timezone, formatter);
  return formatter;
}

export function toDayKey(timestampMs: number, timezone: string): string {
  const formatter = getDateFormatter(timezone);
  const parts = formatter.formatToParts(new Date(timestampMs));

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Failed to build day key');
  }

  return `${year}-${month}-${day}`;
}

export function hoursToMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}

export function secondsToMs(seconds: number): number {
  return seconds * 1000;
}

/**
 * Timezone helpers. Societies store an IANA timezone (default Asia/Kolkata).
 * All timestamps are persisted as timestamptz (UTC); local dates/times are derived per society.
 */

function partsInTz(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return p;
}

/** YYYY-MM-DD for the given instant in tz. */
export function localDate(date: Date, tz: string): string {
  const p = partsInTz(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** HH:MM for the given instant in tz. */
export function localTime(date: Date, tz: string): string {
  const p = partsInTz(date, tz);
  return `${p.hour}:${p.minute}`;
}

/** Offset (minutes) of tz from UTC at the given instant. */
function tzOffsetMinutes(date: Date, tz: string): number {
  const p = partsInTz(date, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Convert a wall-clock date + time in tz to a UTC Date. */
export function zonedToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offset = tzOffsetMinutes(guess, tz);
  const result = new Date(guess.getTime() - offset * 60000);
  // Re-check for DST transitions (not relevant for IST, but keeps the helper correct elsewhere)
  const offset2 = tzOffsetMinutes(result, tz);
  return offset2 === offset ? result : new Date(guess.getTime() - offset2 * 60000);
}

/** Day of week (0=Sun) for a YYYY-MM-DD date string. */
export function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const fromMinutes = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

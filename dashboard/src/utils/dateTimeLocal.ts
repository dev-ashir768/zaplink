// The value format of <input type="datetime-local">, which DateTimePicker keeps: local 'YYYY-MM-DDTHH:mm'.

export interface DateTimeParts {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  mi: number;
}

export const pad = (n: number, width = 2) => String(n).padStart(width, '0');

const VALUE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function parseDateTimeLocal(value: string): DateTimeParts | null {
  const m = VALUE_RE.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || h > 23 || mi > 59) return null;
  return { y, m: mo, d, h, mi };
}

export function formatDateTimeLocal(p: DateTimeParts): string {
  return `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

export function daysIn(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

import { addDays, differenceInHours, startOfWeek, addWeeks, format } from "date-fns";

export const FY_START = new Date(2026, 3, 1, 0, 0, 0); // Apr 1 2026
export const FY_END = new Date(2027, 2, 31, 23, 59, 59); // Mar 31 2027
export const SCHEDULE_HORIZON_START = new Date(2026, 3, 1, 8, 0, 0);

export const WEEKS_IN_FY = 52;

export const FY_WEEKS: { index: number; start: Date; end: Date; label: string; quarter: 1 | 2 | 3 | 4 }[] = (() => {
  const out: { index: number; start: Date; end: Date; label: string; quarter: 1 | 2 | 3 | 4 }[] = [];
  let cursor = startOfWeek(FY_START, { weekStartsOn: 1 });
  // Align to FY start
  while (cursor < FY_START) cursor = addDays(cursor, 1);
  cursor = startOfWeek(FY_START, { weekStartsOn: 1 });
  for (let i = 0; i < WEEKS_IN_FY; i++) {
    const start = addWeeks(cursor, i);
    const end = addDays(start, 6);
    const month = start.getMonth(); // 0..11
    let quarter: 1 | 2 | 3 | 4 = 1;
    if (month >= 3 && month <= 5) quarter = 1; // Apr-Jun
    else if (month >= 6 && month <= 8) quarter = 2; // Jul-Sep
    else if (month >= 9 && month <= 11) quarter = 3; // Oct-Dec
    else quarter = 4; // Jan-Mar
    out.push({
      index: i,
      start,
      end,
      label: format(start, "dd MMM"),
      quarter,
    });
  }
  return out;
})();

export function isInFY(ms: number): boolean {
  return ms >= FY_START.getTime() && ms <= FY_END.getTime();
}

export function weekIndexOf(ms: number): number {
  const d = new Date(ms);
  const diffMs = d.getTime() - FY_WEEKS[0].start.getTime();
  if (diffMs < 0) return -1;
  const idx = Math.floor(diffMs / (7 * 24 * 3600 * 1000));
  if (idx >= WEEKS_IN_FY) return -1;
  return idx;
}

export function quarterOf(ms: number): 1 | 2 | 3 | 4 | null {
  const idx = weekIndexOf(ms);
  if (idx < 0) return null;
  return FY_WEEKS[idx].quarter;
}

export function fmtDate(ms: number): string {
  return format(new Date(ms), "dd MMM yyyy");
}

export function fmtDateTime(ms: number): string {
  return format(new Date(ms), "dd MMM yyyy HH:mm");
}

export function hoursToMs(h: number): number {
  return Math.round(h * 3600 * 1000);
}

export function diffHours(aMs: number, bMs: number): number {
  return differenceInHours(new Date(bMs), new Date(aMs));
}

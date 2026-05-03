import { addDays, differenceInHours, startOfWeek, addWeeks, format } from "date-fns";

// Default fiscal year, used as a fallback for legacy data and as the seed
// default for new APIs. There is no longer a single global FY — each API
// defines its own [startMs, endMs] window.
export const FY_START = new Date(2026, 3, 1, 0, 0, 0); // Apr 1 2026
export const FY_END = new Date(2027, 2, 31, 23, 59, 59); // Mar 31 2027
export const FY_START_MS = FY_START.getTime();
export const FY_END_MS = FY_END.getTime();

// Default scheduling horizon (used when an API has no window set yet)
export const SCHEDULE_HORIZON_START = new Date(2026, 3, 1, 8, 0, 0);

const MS_PER_WEEK = 7 * 24 * 3600 * 1000;

export interface WeekBucket {
  index: number;
  start: Date;
  end: Date;
  startMs: number;
  endMs: number;
  label: string;
  quarter: 1 | 2 | 3 | 4;
}

/**
 * Compute weekly buckets between two timestamps. The first bucket is aligned
 * to the Monday on/before `startMs`; subsequent buckets are 7 days each. The
 * range is divided evenly into 4 quarters (Q1..Q4) regardless of calendar
 * months — this matches user expectations of "first quarter / second
 * quarter / ..." within whatever range they configured.
 */
export function computeWeeks(startMs: number, endMs: number): WeekBucket[] {
  if (endMs <= startMs) return [];
  const out: WeekBucket[] = [];
  const anchor = startOfWeek(new Date(startMs), { weekStartsOn: 1 });
  const totalWeeks = Math.max(
    1,
    Math.ceil((endMs - anchor.getTime()) / MS_PER_WEEK)
  );

  for (let i = 0; i < totalWeeks; i++) {
    const start = addWeeks(anchor, i);
    const end = addDays(start, 6);
    // Quarter = which 25%-bucket this week falls in
    const ratio = (i + 0.5) / totalWeeks;
    const q = (ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4) as
      | 1
      | 2
      | 3
      | 4;
    out.push({
      index: i,
      start,
      end,
      startMs: start.getTime(),
      endMs: start.getTime() + MS_PER_WEEK,
      label: format(start, "dd MMM"),
      quarter: q,
    });
  }
  return out;
}

/** Pre-built default 52-week FY bucket array (kept for legacy callers). */
export const FY_WEEKS: WeekBucket[] = computeWeeks(FY_START_MS, FY_END_MS);
export const WEEKS_IN_FY = FY_WEEKS.length;

/** Default fiscal-year window check (used by legacy callers). */
export function isInFY(ms: number): boolean {
  return ms >= FY_START_MS && ms <= FY_END_MS;
}

/** Find the week index of a timestamp within an arbitrary weeks array. */
export function weekIndexIn(weeks: WeekBucket[], ms: number): number {
  if (weeks.length === 0) return -1;
  const diff = ms - weeks[0].startMs;
  if (diff < 0) return -1;
  const idx = Math.floor(diff / MS_PER_WEEK);
  if (idx >= weeks.length) return -1;
  return idx;
}

/** Quarter (1..4) of a timestamp within the given weeks array. */
export function quarterIn(
  weeks: WeekBucket[],
  ms: number
): 1 | 2 | 3 | 4 | null {
  const idx = weekIndexIn(weeks, ms);
  if (idx < 0) return null;
  return weeks[idx].quarter;
}

/** Legacy: weekIndex against the default 52-week FY array. */
export function weekIndexOf(ms: number): number {
  return weekIndexIn(FY_WEEKS, ms);
}

/** Legacy: quarter against the default 52-week FY array. */
export function quarterOf(ms: number): 1 | 2 | 3 | 4 | null {
  return quarterIn(FY_WEEKS, ms);
}

export function fmtDate(ms: number): string {
  return format(new Date(ms), "dd MMM yyyy");
}

export function fmtDateTime(ms: number): string {
  return format(new Date(ms), "dd MMM yyyy HH:mm");
}

export function fmtIsoDate(ms: number): string {
  return format(new Date(ms), "yyyy-MM-dd");
}

/** Parse a "yyyy-MM-dd" ISO date string at local midnight. */
export function parseIsoDate(iso: string): number {
  // new Date("2026-04-01") -> UTC midnight, which can shift by tz. Use local.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return Number.NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d, 0, 0, 0).getTime();
}

export function hoursToMs(h: number): number {
  return Math.round(h * 3600 * 1000);
}

export function diffHours(aMs: number, bMs: number): number {
  return differenceInHours(new Date(bMs), new Date(aMs));
}

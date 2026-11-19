/**
 * Calendar time buckets shared by the Dashboard charts and panels.
 */
export type Granularity = "monthly" | "quarterly" | "yearly";

export interface Bucket {
  /** Stable string key — used as a React key + Recharts dataKey. */
  key: string;
  /** Short user-facing label, e.g. "Jun 26", "Q2", "2026". */
  label: string;
  /** Optional secondary label (rendered under the main one in the chart). */
  sub?: string;
  startMs: number;
  endMs: number;
}

/**
 * Buckets covering [startMs, endMs]. Monthly / yearly follow calendar
 * boundaries; quarterly = the four equal quarters of the window.
 */
export function buildBuckets(
  gran: Granularity,
  startMs: number,
  endMs: number
): Bucket[] {
  if (endMs <= startMs) return [];
  const start = new Date(startMs);
  const end = new Date(endMs);
  const out: Bucket[] = [];

  if (gran === "monthly") {
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur.getTime() <= end.getTime()) {
      const y = cur.getFullYear();
      const m = cur.getMonth();
      const next = new Date(y, m + 1, 1);
      out.push({
        key: `${y}-${String(m + 1).padStart(2, "0")}`,
        label: cur.toLocaleString("en-US", {
          month: "short",
          year: "2-digit",
        }),
        startMs: cur.getTime(),
        endMs: next.getTime() - 1,
      });
      cur.setMonth(m + 1);
    }
    return out;
  }

  if (gran === "yearly") {
    const ys = start.getFullYear();
    const ye = end.getFullYear();
    for (let y = ys; y <= ye; y++) {
      out.push({
        key: String(y),
        label: String(y),
        startMs: new Date(y, 0, 1).getTime(),
        endMs: new Date(y + 1, 0, 1).getTime() - 1,
      });
    }
    return out;
  }

  // gran === "quarterly" — buckets are derived from the plan-window
  // slicer (see quarterIn). We still create 4 buckets here so the chart
  // renders with the correct labels; the actual index lookup uses
  // quarterIn().
  const qSpan = (endMs - startMs) / 4;
  for (let i = 0; i < 4; i++) {
    const s = startMs + i * qSpan;
    const e = i === 3 ? endMs : startMs + (i + 1) * qSpan - 1;
    out.push({
      key: `Q${i + 1}`,
      label: `Q${i + 1}`,
      sub: `${new Date(s).toLocaleString("en-US", { month: "short" })}–${new Date(e).toLocaleString("en-US", { month: "short" })}`,
      startMs: s,
      endMs: e,
    });
  }
  return out;
}

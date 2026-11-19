import { Fragment, useMemo, useState } from "react";
import { clsx } from "clsx";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "./Primitives";
import type { PlanWindow, Reactor, ScheduleResult } from "../types";
import { buildBuckets, type Granularity } from "../utils/timeBuckets";

const NO_BLOCK = "(no block)";
const H = 3600 * 1000;
/** Sequential single hue (blue 450) — cell opacity encodes occupancy. */
const SEQ_RGB = "42, 120, 214";

interface OccRow {
  id: string;
  label: string;
  reactorCount: number;
  clCount: number;
  apiNames: string[];
  /** Busy hours per bucket (reactor-hours; reactors merged individually). */
  busy: number[];
  /** Capacity per bucket = reactors × bucket hours inside the plan window. */
  cap: number[];
  busyTotal: number;
  capTotal: number;
}

/** Merge [a,b) intervals, then sum their overlap with [s,e). */
function busyIn(spans: [number, number][], s: number, e: number): number {
  let total = 0;
  let curS = -Infinity;
  let curE = -Infinity;
  for (const [a0, b0] of spans) {
    const a = Math.max(a0, s);
    const b = Math.min(b0, e);
    if (b <= a) continue;
    if (a > curE) {
      if (curE > curS) total += curE - curS;
      curS = a;
      curE = b;
    } else if (b > curE) curE = b;
  }
  if (curE > curS) total += curE - curS;
  return total;
}

/**
 * Block-wise occupancy: for each production block, the share of its reactor
 * time that is booked (batch start → cycle end) in every time bucket.
 * Overlapping batches on one reactor (BCF < BCT) are merged, so a reactor
 * is never more than 100 % occupied. Rows expand to the block's reactors.
 */
export default function BlockOccupancyPanel({
  reactors,
  schedule,
  planWindow,
}: {
  reactors: Reactor[];
  schedule: ScheduleResult;
  planWindow: PlanWindow;
}) {
  const [gran, setGran] = useState<Granularity>("monthly");
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Drop buckets with no time inside the plan window (e.g. the month that
  // starts exactly at the window end).
  const buckets = useMemo(
    () =>
      buildBuckets(gran, planWindow.startMs, planWindow.endMs).filter(
        (b) =>
          Math.min(b.endMs + 1, planWindow.endMs) > Math.max(b.startMs, planWindow.startMs)
      ),
    [gran, planWindow]
  );

  const { blocks, reactorRows } = useMemo(() => {
    const ws = planWindow.startMs;
    const we = planWindow.endMs;
    // Bucket ranges clipped to the plan window, as half-open [s, e).
    const ranges = buckets.map((b) => [
      Math.max(b.startMs, ws),
      Math.min(b.endMs + 1, we),
    ]);
    const spansByReactor = new Map<string, [number, number][]>();
    const apisByReactor = new Map<string, Set<string>>();
    for (const b of schedule.batches)
      for (const rid of b.reactorIds) {
        const arr = spansByReactor.get(rid) ?? [];
        arr.push([b.startMs, b.endMs]);
        spansByReactor.set(rid, arr);
        const set = apisByReactor.get(rid) ?? new Set<string>();
        set.add(b.apiName);
        apisByReactor.set(rid, set);
      }
    spansByReactor.forEach((arr) => arr.sort((x, y) => x[0] - y[0]));

    const reactorRows = new Map<string, OccRow>();
    for (const r of reactors) {
      const spans = spansByReactor.get(r.id) ?? [];
      const busy = ranges.map(([s, e]) => (e > s ? busyIn(spans, s, e) / H : 0));
      const cap = ranges.map(([s, e]) => Math.max(0, e - s) / H);
      reactorRows.set(r.id, {
        id: r.id,
        label: r.id,
        reactorCount: 1,
        clCount: r.reactorClass === "CL" ? 1 : 0,
        apiNames: Array.from(apisByReactor.get(r.id) ?? []).sort(),
        busy,
        cap,
        busyTotal: we > ws ? busyIn(spans, ws, we) / H : 0,
        capTotal: Math.max(0, we - ws) / H,
      });
    }

    const byBlock = new Map<string, Reactor[]>();
    reactors.forEach((r) => {
      const n = r.productionBlock?.trim() || NO_BLOCK;
      byBlock.set(n, [...(byBlock.get(n) ?? []), r]);
    });
    const coll = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    const blocks: (OccRow & { reactorIds: string[] })[] = Array.from(byBlock.entries())
      .sort(([a], [b]) => (a === NO_BLOCK ? 1 : b === NO_BLOCK ? -1 : coll(a, b)))
      .map(([name, rs]) => {
        const rows = rs.map((r) => reactorRows.get(r.id)!);
        const sum = (f: (o: OccRow) => number[]) =>
          buckets.map((_, i) => rows.reduce((a, o) => a + f(o)[i], 0));
        return {
          id: name,
          label: name,
          reactorCount: rs.length,
          clCount: rs.filter((r) => r.reactorClass === "CL").length,
          apiNames: Array.from(new Set(rows.flatMap((o) => o.apiNames))).sort(),
          busy: sum((o) => o.busy),
          cap: sum((o) => o.cap),
          busyTotal: rows.reduce((a, o) => a + o.busyTotal, 0),
          capTotal: rows.reduce((a, o) => a + o.capTotal, 0),
          reactorIds: [...rs].sort((a, b) => coll(a.id, b.id)).map((r) => r.id),
        };
      });
    return { blocks, reactorRows };
  }, [reactors, schedule, planWindow, buckets]);

  const toggle = (id: string) => {
    const n = new Set(open);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setOpen(n);
  };

  const peak = blocks.reduce<{ name: string; pct: number; bucket: string } | null>(
    (best, b) => {
      b.busy.forEach((h, i) => {
        const pct = b.cap[i] > 0 ? h / b.cap[i] : 0;
        if (!best || pct > best.pct) best = { name: b.label, pct, bucket: buckets[i].label };
      });
      return best;
    },
    null
  );

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">
            Block-wise occupancy
          </h3>
          <p className="text-[11px] text-ink-400">
            Share of each production block's reactor time booked by batches (start →
            cycle end) · click a block to see its reactors
            {peak && peak.pct > 0 && (
              <>
                {" "}· peak <b className="text-ink-100">{Math.round(peak.pct * 100)}%</b> in{" "}
                {peak.name}, {peak.bucket}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ScaleLegend />
          <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-1 text-xs">
            {(
              [
                ["monthly", "Monthly"],
                ["quarterly", "Quarterly"],
                ["yearly", "Yearly"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setGran(v)}
                className={clsx(
                  "rounded-md px-3 py-1 font-semibold transition",
                  gran === v ? "bg-cyan-300/20 text-cyan-200" : "text-ink-300 hover:text-white"
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {blocks.length === 0 ? (
        <p className="px-4 py-4 text-xs text-ink-400">No reactors defined.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate text-xs" style={{ borderSpacing: 2 }}>
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-ink-400">
                <th className="sticky left-0 z-10 bg-ink-900 px-3 py-1.5 text-left">Block</th>
                <th className="px-2 py-1.5 text-right">Reactors</th>
                {buckets.map((b) => (
                  <th key={b.key} className="px-1 py-1.5 text-center font-semibold" title={b.sub}>
                    {b.label}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-right">Overall</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((blk) => {
                const isOpen = open.has(blk.id);
                return (
                  <Fragment key={blk.id}>
                    <tr className="cursor-pointer" onClick={() => toggle(blk.id)}>
                      <td
                        className="sticky left-0 z-10 bg-ink-900 px-3 py-1.5 font-semibold text-white"
                        title={`APIs: ${blk.apiNames.join(", ") || "none"}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {isOpen ? (
                            <ChevronDown size={12} className="text-ink-400" />
                          ) : (
                            <ChevronRight size={12} className="text-ink-400" />
                          )}
                          {blk.label}
                          {blk.clCount > 0 && (
                            <span className="ml-1 rounded border border-white/15 px-1 text-[9px] font-bold text-ink-300">
                              CL
                            </span>
                          )}
                        </span>
                        <div className="pl-4 text-[10px] font-normal text-ink-400">
                          {blk.apiNames.length} API{blk.apiNames.length === 1 ? "" : "s"}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-ink-200">
                        {blk.reactorCount}
                      </td>
                      {buckets.map((b, i) => (
                        <OccCell
                          key={b.key}
                          busy={blk.busy[i]}
                          cap={blk.cap[i]}
                          title={`${blk.label} · ${b.label}${b.sub ? ` (${b.sub})` : ""}`}
                        />
                      ))}
                      <td className="px-2 py-1.5 text-right font-mono font-semibold text-white">
                        {pct(blk.busyTotal, blk.capTotal)}
                      </td>
                    </tr>
                    {isOpen &&
                      blk.reactorIds.map((rid) => {
                        const r = reactorRows.get(rid)!;
                        return (
                          <tr key={rid}>
                            <td
                              className="sticky left-0 z-10 bg-ink-900 py-1 pl-8 pr-3 font-mono text-ink-200"
                              title={`APIs: ${r.apiNames.join(", ") || "none"}`}
                            >
                              {r.label}
                              {r.clCount > 0 && (
                                <span className="ml-1 text-[9px] text-ink-400">CL</span>
                              )}
                            </td>
                            <td className="px-2 py-1 text-right font-mono text-ink-400">1</td>
                            {buckets.map((b, i) => (
                              <OccCell
                                key={b.key}
                                busy={r.busy[i]}
                                cap={r.cap[i]}
                                small
                                title={`${r.label} · ${b.label}${b.sub ? ` (${b.sub})` : ""}`}
                              />
                            ))}
                            <td className="px-2 py-1 text-right font-mono text-ink-200">
                              {pct(r.busyTotal, r.capTotal)}
                            </td>
                          </tr>
                        );
                      })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function pct(busy: number, cap: number): string {
  return cap > 0 ? `${Math.round((busy / cap) * 100)}%` : "—";
}

function OccCell({
  busy,
  cap,
  title,
  small,
}: {
  busy: number;
  cap: number;
  title: string;
  small?: boolean;
}) {
  if (cap <= 0)
    return <td className="rounded px-1 text-center text-[10px] text-ink-500">—</td>;
  const frac = Math.max(0, Math.min(1, busy / cap));
  return (
    <td
      className={clsx(
        "rounded text-center font-mono tabular-nums",
        small ? "py-1 text-[10px]" : "py-1.5 text-[11px]",
        frac >= 0.5 ? "font-semibold text-white" : frac > 0 ? "text-ink-100" : "text-ink-500"
      )}
      style={{
        minWidth: 44,
        background: `rgba(${SEQ_RGB}, ${frac === 0 ? 0.04 : 0.12 + frac * 0.78})`,
      }}
      title={`${title}: ${Math.round(frac * 100)}% occupied · ${Math.round(busy)} of ${Math.round(cap)} reactor-hours booked`}
    >
      {Math.round(frac * 100)}%
    </td>
  );
}

function ScaleLegend() {
  return (
    <span className="hidden items-center gap-1.5 text-[10px] text-ink-400 sm:inline-flex">
      0%
      <span
        className="inline-block h-2.5 w-20 rounded-sm"
        style={{
          background: `linear-gradient(90deg, rgba(${SEQ_RGB},0.12), rgba(${SEQ_RGB},0.9))`,
        }}
      />
      100%
    </span>
  );
}

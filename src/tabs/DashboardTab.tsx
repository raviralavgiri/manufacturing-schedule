import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Gauge,
  Package,
  Sparkles,
} from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader } from "../components/Primitives";
import { computeWeeks, quarterIn } from "../utils/dates";
import { useChartTheme } from "../utils/chartTheme";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  LabelList,
} from "recharts";

/**
 * Dashboard
 * --------
 * The "command center" tab. Three sections worth of insight:
 *
 *   1. KPI strip — the top-level "is the plan healthy?" numbers.
 *   2. Time-series chart — output (kg) or batches stacked per API,
 *      bucketed Monthly / Quarterly / Yearly.
 *   3. Per-API performance table — Target vs. Achieved vs. Gap with a
 *      Met / Partial / Behind status pill.
 *   4. Detail pivot — API × Stage × Q1-Q4 (+ FY total). Same data as
 *      the legacy "Quarterly Summary"; kept for deep-dives.
 */

type Granularity = "monthly" | "quarterly" | "yearly";

// Categorical palette for stage-number stacking. Cycles after 8 stages
// (which is more than any realistic API has). Tuned to match the rest
// of the app's accent palette.
const STAGE_COLORS = [
  "#22d3ee", // S1 — cyan
  "#a78bfa", // S2 — violet
  "#f472b6", // S3 — pink
  "#a3e635", // S4 — lime
  "#fbbf24", // S5 — amber
  "#fb7185", // S6 — rose
  "#38bdf8", // S7 — sky
  "#fdba74", // S8 — orange
];

interface Bucket {
  /** Stable string key — used as a React key + Recharts dataKey. */
  key: string;
  /** Short user-facing label, e.g. "Jun 26", "Q2", "2026". */
  label: string;
  /** Optional secondary label (rendered under the main one in the chart). */
  sub?: string;
  startMs: number;
  endMs: number;
}

interface PivotRow {
  apiId: string;
  apiName: string;
  apiColor: string;
  stageNo: number;
  stageName: string;
  /** True when this stage is NOT the immediate `prev stageNo` linear successor —
   *  i.e. multi-predecessor or side-stream. Drives the ↳ prefix in the UI. */
  branched: boolean;
  q1: { batches: number; kg: number };
  q2: { batches: number; kg: number };
  q3: { batches: number; kg: number };
  q4: { batches: number; kg: number };
  total: { batches: number; kg: number };
}

/**
 * True when the stage's `inputStageIds` doesn't match the legacy linear
 * default — i.e. multi-predecessor (convergence) OR a sole predecessor
 * that isn't the immediate `prev stageNo` (sub-stream). Used to prefix
 * the label with ↳ so DAG branches stand out from the main chain.
 */
function isStageBranched(
  stage: { id: string; stageNo: number; inputStageIds?: string[] },
  apiStagesSorted: { id: string; stageNo: number }[]
): boolean {
  const inputs = stage.inputStageIds ?? [];
  // A first stage is never "branched" — it has no inputs by definition.
  if (apiStagesSorted[0]?.id === stage.id) return false;
  if (inputs.length !== 1) return inputs.length > 1; // 0 = orphan, >1 = branched
  // Single-predecessor: is it the immediate prev-by-stageNo?
  const idx = apiStagesSorted.findIndex((s) => s.id === stage.id);
  const prev = idx > 0 ? apiStagesSorted[idx - 1] : null;
  return !prev || inputs[0] !== prev.id;
}

export default function DashboardTab() {
  const apisRaw = useStore((s) => s.apis);
  const schedule = useStore((s) => s.schedule);
  const reactors = useStore((s) => s.reactors);
  const planWindow = useStore((s) => s.window);
  const chartTheme = useChartTheme();

  const apis = useMemo(
    () => [...apisRaw].sort((a, b) => a.id.localeCompare(b.id)),
    [apisRaw]
  );
  const apiOrder = useMemo(() => {
    const m = new Map<string, number>();
    apis.forEach((a, i) => m.set(a.id, i));
    return m;
  }, [apis]);

  // ─── User toggles ──────────────────────────────────────────────────
  // Single shared slicer. Drives both the "Output (kg) by API" chart
  // and the "Batches by stage" chart below.
  const [gran, setGran] = useState<Granularity>("monthly");

  // ─── Buckets for the time axis ─────────────────────────────────────
  // Quarterly buckets are derived from the existing plan-window quarter
  // helper so labels stay consistent with the rest of the app. Monthly
  // and Yearly buckets walk calendar boundaries.
  const weeks = useMemo(
    () => computeWeeks(planWindow.startMs, planWindow.endMs),
    [planWindow]
  );
  const buckets = useMemo<Bucket[]>(
    () => buildBuckets(gran, planWindow.startMs, planWindow.endMs),
    [gran, planWindow]
  );

  // For a given batch start time, which bucket does it land in? We
  // special-case quarterly so it uses the same plan-window slicer the
  // pivot table uses.
  const bucketIndexFor = (ms: number): number => {
    if (gran === "quarterly") {
      const q = quarterIn(weeks, ms);
      return q ? q - 1 : -1;
    }
    for (let i = 0; i < buckets.length; i++) {
      if (ms >= buckets[i].startMs && ms <= buckets[i].endMs) return i;
    }
    return -1;
  };

  // ─── Aggregated chart data ────────────────────────────────────────
  // Two independent datasets fed off the same buckets. The split lets
  // the user see "what was produced (kg)" and "where the work landed
  // (stages)" side by side without switching modes.
  //
  //   chartDataByApi  : output kg, one Bar per API
  //   chartDataByStage: batch count, one Bar per stage number (S1, S2, …)
  const chartDataByApi = useMemo(() => {
    const rows: Record<string, number | string>[] = buckets.map((b) => ({
      name: b.label,
    }));
    apis.forEach((a) => rows.forEach((r) => (r[a.id] = 0)));
    schedule.batches.forEach((b) => {
      const i = bucketIndexFor(b.startMs);
      if (i < 0 || i >= rows.length) return;
      rows[i][b.apiId] = ((rows[i][b.apiId] as number) ?? 0) + b.outputKg;
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, apis, schedule, gran, weeks]);

  // Distinct stage NAMES across all APIs (e.g., "DT1", "DT3", "Final
  // API"). Two APIs that happen to use the same stage name are
  // combined into one segment in the chart — this is usually the
  // intended behavior for a cross-API view. To split them, we'd need
  // to key by `${apiId}·${stageName}`.
  //
  // Order: by FIRST appearance in the apis list (which is sorted by
  // apiId). This keeps DT1 left of DT2 left of DT3 left of Final API
  // for the typical 4-stage chemistry path.
  const stageNames = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    apis.forEach((a) =>
      a.stages
        .slice()
        .sort((x, y) => x.stageNo - y.stageNo)
        .forEach((st) => {
          const n = (st.stageName || "").trim() || `S${st.stageNo}`;
          if (!seen.has(n)) {
            seen.add(n);
            ordered.push(n);
          }
        })
    );
    // Catch any stage names that exist on batches but not on apis
    // (e.g., legacy data or after a delete).
    schedule.batches.forEach((b) => {
      const n = (b.stageName || "").trim() || `S${b.stageNo}`;
      if (!seen.has(n)) {
        seen.add(n);
        ordered.push(n);
      }
    });
    return ordered;
  }, [apis, schedule]);

  const chartDataByStage = useMemo(() => {
    const rows: Record<string, number | string>[] = buckets.map((b) => ({
      name: b.label,
    }));
    stageNames.forEach((n) => rows.forEach((r) => (r[n] = 0)));
    schedule.batches.forEach((b) => {
      const i = bucketIndexFor(b.startMs);
      if (i < 0 || i >= rows.length) return;
      const k = (b.stageName || "").trim() || `S${b.stageNo}`;
      rows[i][k] = ((rows[i][k] as number) ?? 0) + 1;
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, stageNames, schedule, gran, weeks]);

  // ─── KPI numbers ───────────────────────────────────────────────────
  const totalBatches = schedule.totalBatches;
  const totalKg = schedule.batches.reduce((a, b) => a + b.outputKg, 0);
  const totalOutputT = totalKg / 1000;
  const planSpanDays = Math.max(
    0,
    Math.round((planWindow.endMs - planWindow.startMs) / 86400000)
  );
  const planSpanMonths = (planSpanDays / 30.44).toFixed(1);
  const clashes = schedule.clashCount;

  // ─── Per-API target-vs-achieved ───────────────────────────────────
  const perApi = useMemo(() => {
    return apis.map((a) => {
      const sorted = [...a.stages].sort((x, y) => x.stageNo - y.stageNo);
      const finalStage = sorted[sorted.length - 1];
      const apiBatches = schedule.batches.filter((b) => b.apiId === a.id);
      const finalBatches = finalStage
        ? apiBatches.filter((b) => b.stageId === finalStage.id)
        : [];
      const achievedKg = finalBatches.reduce((s, b) => s + b.outputKg, 0);
      const targetKg = a.targetKg ?? 0;
      const pct = targetKg > 0 ? (achievedKg / targetKg) * 100 : 0;
      const finalBranched = finalStage
        ? isStageBranched(finalStage, sorted)
        : false;
      return {
        api: a,
        finalStage,
        finalBranched,
        targetKg,
        achievedKg,
        gapKg: targetKg - achievedKg,
        pct,
        totalBatches: apiBatches.length,
        finalBatchCount: finalBatches.length,
      };
    });
  }, [apis, schedule]);

  // ─── Detail pivot (existing logic, kept for deep-dive) ────────────
  const pivot: PivotRow[] = useMemo(() => {
    const map = new Map<string, PivotRow>();
    apis.forEach((a) => {
      const sorted = [...a.stages].sort((x, y) => x.stageNo - y.stageNo);
      sorted.forEach((s) => {
        map.set(`${a.id}__${s.stageNo}`, {
          apiId: a.id,
          apiName: a.name,
          apiColor: a.color,
          stageNo: s.stageNo,
          stageName: s.stageName,
          branched: isStageBranched(s, sorted),
          q1: { batches: 0, kg: 0 },
          q2: { batches: 0, kg: 0 },
          q3: { batches: 0, kg: 0 },
          q4: { batches: 0, kg: 0 },
          total: { batches: 0, kg: 0 },
        });
      });
    });
    schedule.batches.forEach((b) => {
      const q = quarterIn(weeks, b.startMs);
      if (!q) return;
      const row = map.get(`${b.apiId}__${b.stageNo}`);
      if (!row) return;
      const bucket = q === 1 ? "q1" : q === 2 ? "q2" : q === 3 ? "q3" : "q4";
      row[bucket].batches += 1;
      row[bucket].kg += b.outputKg;
      row.total.batches += 1;
      row.total.kg += b.outputKg;
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.apiId !== b.apiId) {
        return (apiOrder.get(a.apiId) ?? 0) - (apiOrder.get(b.apiId) ?? 0);
      }
      return a.stageNo - b.stageNo;
    });
  }, [apis, schedule, apiOrder, weeks]);

  const fyTotalKg = pivot.reduce((a, r) => a + r.total.kg, 0);
  const fyTotalBatches = pivot.reduce((a, r) => a + r.total.batches, 0);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Dashboard"
        subtitle={`${apis.length} APIs · ${totalBatches.toLocaleString()} batches · ${totalOutputT.toFixed(1)} t output planned over ${planSpanMonths} months`}
      />

      {/* ─── KPI strip ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi
          icon={<Activity size={16} />}
          label="Batches Planned"
          value={totalBatches.toLocaleString()}
          tone="cyan"
        />
        <Kpi
          icon={<Package size={16} />}
          label="Output"
          value={`${totalOutputT.toFixed(1)} t`}
          sub={`${totalKg.toLocaleString()} kg`}
          tone="violet"
        />
        <Kpi
          icon={<Sparkles size={16} />}
          label="Active APIs"
          value={apis.length}
          tone="amber"
        />
        <Kpi
          icon={<Calendar size={16} />}
          label="Plan Span"
          value={`${planSpanMonths} mo`}
          sub={`${planSpanDays} days`}
          tone="default"
        />
        <Kpi
          icon={<Gauge size={16} />}
          label="Reactors"
          value={reactors.length}
          tone="default"
        />
        <Kpi
          icon={
            clashes === 0 ? (
              <CheckCircle2 size={16} />
            ) : (
              <AlertTriangle size={16} />
            )
          }
          label="Clashes"
          value={clashes}
          sub={clashes === 0 ? "All clear" : "Resolve in Clash tab"}
          tone={clashes === 0 ? "lime" : "pink"}
        />
      </div>

      {/* ─── Production-over-time: two charts driven by one slicer ── */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">
              Production over time
            </h3>
            <p className="text-[11px] text-ink-400">
              Same time bucket on both charts — output (kg) split by API
              on the left, batch count split by stage on the right.
            </p>
          </div>
          <Toggle
            value={gran}
            onChange={setGran}
            options={[
              { v: "monthly", l: "Monthly" },
              { v: "quarterly", l: "Quarterly" },
              { v: "yearly", l: "Yearly" },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* ── Chart 1: Output (kg) stacked by API ──────────────── */}
          <div>
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <span className="font-bold uppercase tracking-wider text-cyan-300">
                Output (kg) — by API
              </span>
              <span className="font-mono text-ink-400">
                {totalOutputT.toFixed(1)} t total
              </span>
            </div>
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={chartDataByApi}>
                  <CartesianGrid
                    stroke={chartTheme.grid}
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="name"
                    stroke={chartTheme.axis}
                    fontSize={11}
                    interval={0}
                    angle={gran === "monthly" ? -25 : 0}
                    textAnchor={gran === "monthly" ? "end" : "middle"}
                    height={gran === "monthly" ? 50 : 30}
                  />
                  <YAxis stroke={chartTheme.axis} fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      background: chartTheme.tooltipBg,
                      border: `1px solid ${chartTheme.tooltipBorder}`,
                      borderRadius: 8,
                      fontSize: 12,
                      color: chartTheme.tooltipText,
                    }}
                    labelStyle={{ color: chartTheme.tooltipText }}
                    formatter={(v: number) =>
                      `${Math.round(v).toLocaleString()} kg`
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {apis.map((a) => (
                    <Bar
                      key={a.id}
                      dataKey={a.id}
                      name={a.name}
                      stackId="api"
                      fill={a.color}
                      radius={[0, 0, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Chart 2: Batches stacked by stage number ────────── */}
          <div>
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <span className="font-bold uppercase tracking-wider text-violet-300">
                Batches — by stage
              </span>
              <span className="font-mono text-ink-400">
                {totalBatches.toLocaleString()} batches total
              </span>
            </div>
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={chartDataByStage}>
                  <CartesianGrid
                    stroke={chartTheme.grid}
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="name"
                    stroke={chartTheme.axis}
                    fontSize={11}
                    interval={0}
                    angle={gran === "monthly" ? -25 : 0}
                    textAnchor={gran === "monthly" ? "end" : "middle"}
                    height={gran === "monthly" ? 50 : 30}
                  />
                  <YAxis stroke={chartTheme.axis} fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      background: chartTheme.tooltipBg,
                      border: `1px solid ${chartTheme.tooltipBorder}`,
                      borderRadius: 8,
                      fontSize: 12,
                      color: chartTheme.tooltipText,
                    }}
                    labelStyle={{ color: chartTheme.tooltipText }}
                    formatter={(v: number) =>
                      `${v} batch${v === 1 ? "" : "es"}`
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {stageNames.map((n, i) => (
                    <Bar
                      key={n}
                      dataKey={n}
                      name={n}
                      fill={STAGE_COLORS[i % STAGE_COLORS.length]}
                      radius={[2, 2, 0, 0]}
                    >
                      {/* Show batch count above each bar; hide zeros */}
                      <LabelList
                        dataKey={n}
                        position="top"
                        fill={chartTheme.axis}
                        fontSize={10}
                        formatter={(val: unknown) =>
                          typeof val === "number" && val > 0 ? val : ""
                        }
                      />
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="mt-2 text-[10px] text-ink-400">
          {gran === "monthly" &&
            `${buckets.length} months in plan window.`}
          {gran === "quarterly" &&
            `Plan window split into 4 equal quarters. See the pivot table below for API × Stage × Quarter detail.`}
          {gran === "yearly" &&
            `${buckets.length} calendar year${buckets.length === 1 ? "" : "s"} touched by plan window.`}
        </div>
      </Card>

      {/* ─── Per-API performance ─────────────────────────────────── */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-white/10 px-4 py-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">
            Per-API target vs. achieved
          </h3>
          <p className="text-[11px] text-ink-400">
            "Achieved" = sum of <span className="font-mono">output kg</span>{" "}
            for the FINAL stage's batches in this plan. Target is set on
            the APIs tab.
          </p>
        </div>
        <div className="max-h-[40vh] overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-10 bg-ink-900/95 backdrop-blur-md">
              <tr className="text-[10px] uppercase tracking-wider text-ink-300">
                <th className="border-b border-white/10 px-3 py-2 text-left">
                  API
                </th>
                <th className="border-b border-white/10 px-3 py-2 text-right">
                  Target (kg)
                </th>
                <th className="border-b border-white/10 px-3 py-2 text-right">
                  Achieved (kg)
                </th>
                <th className="border-b border-white/10 px-3 py-2 text-right">
                  Gap (kg)
                </th>
                <th className="border-b border-white/10 px-3 py-2 text-left">
                  Status
                </th>
                <th className="border-b border-white/10 px-3 py-2 text-right">
                  Batches
                </th>
                <th className="border-b border-white/10 px-3 py-2 text-left">
                  Final Stage
                </th>
              </tr>
            </thead>
            <tbody>
              {perApi.map((r) => {
                const hit = r.targetKg > 0 && r.achievedKg >= r.targetKg;
                const partial =
                  r.achievedKg > 0 && r.achievedKg < r.targetKg;
                const behind = !hit && !partial;
                const tone = hit
                  ? "bg-lime-300/15 text-lime-300"
                  : partial
                    ? "bg-amber-300/15 text-amber-300"
                    : "bg-rose-300/15 text-rose-300";
                const statusLabel = hit
                  ? `Met ${r.pct.toFixed(0)}%`
                  : partial
                    ? `${r.pct.toFixed(0)}%`
                    : r.targetKg === 0
                      ? "No target"
                      : "Behind";
                const gapColor =
                  r.gapKg > 0
                    ? "text-amber-300"
                    : r.gapKg < 0
                      ? "text-violet-300"
                      : "text-lime-300";
                const gapText =
                  r.gapKg > 0
                    ? `−${Math.round(r.gapKg).toLocaleString()}`
                    : r.gapKg < 0
                      ? `+${Math.round(-r.gapKg).toLocaleString()}`
                      : "0";
                return (
                  <tr
                    key={r.api.id}
                    className="border-b border-white/5 hover:bg-white/[0.04]"
                  >
                    <td className="px-3 py-1.5">
                      <span
                        className="inline-flex items-center gap-1.5 font-semibold text-white"
                        title={r.api.name}
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{
                            background: r.api.color,
                            boxShadow: `0 0 6px ${r.api.color}80`,
                          }}
                        />
                        {r.api.name}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-200">
                      {r.targetKg
                        ? Math.round(r.targetKg).toLocaleString()
                        : "—"}
                    </td>
                    <td
                      className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-cyan-300"
                      title={`Exact: ${r.achievedKg.toFixed(2)} kg`}
                    >
                      {Math.round(r.achievedKg).toLocaleString()}
                    </td>
                    <td
                      className={clsx(
                        "px-3 py-1.5 text-right font-mono tabular-nums",
                        gapColor
                      )}
                    >
                      {r.targetKg ? gapText : "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={clsx(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                          behind && r.targetKg === 0
                            ? "bg-white/5 text-ink-300"
                            : tone
                        )}
                      >
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-violet-200">
                      {r.totalBatches.toLocaleString()}
                    </td>
                    <td
                      className="px-3 py-1.5 text-ink-300"
                      title={
                        r.finalBranched
                          ? "DAG branch — multi-predecessor or sub-stream stage"
                          : undefined
                      }
                    >
                      {r.finalStage
                        ? `${r.finalBranched ? "↳ " : ""}S${
                            r.finalStage.stageNo
                          } · ${r.finalStage.stageName}`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ─── Detail pivot (the legacy quarterly view) ────────────── */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-white/10 px-4 py-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">
            Detail pivot · API × Stage × Quarter
          </h3>
          <p className="text-[11px] text-ink-400">
            {fyTotalBatches.toLocaleString()} batches · {(fyTotalKg / 1000).toFixed(1)}{" "}
            t total output planned
          </p>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-10 bg-ink-900/95 backdrop-blur-md">
              <tr className="text-[10px] uppercase tracking-wider text-ink-300">
                <th className="border-b border-white/10 px-3 py-2 text-left">
                  API
                </th>
                <th className="border-b border-white/10 px-3 py-2 text-left">
                  Stage
                </th>
                <PivotHead label="Q1" tone="cyan" />
                <PivotHead label="Q2" tone="violet" />
                <PivotHead label="Q3" tone="pink" />
                <PivotHead label="Q4" tone="lime" />
                <PivotHead label="Total" tone="amber" bold />
              </tr>
              <tr className="text-[9px] text-ink-400">
                <th className="border-b border-white/10 px-3 py-1" />
                <th className="border-b border-white/10 px-3 py-1" />
                <SubHead />
                <SubHead />
                <SubHead />
                <SubHead />
                <SubHead bold />
              </tr>
            </thead>
            <tbody>
              {pivot.map((r) => (
                <tr
                  key={`${r.apiId}-${r.stageNo}`}
                  className="border-b border-white/5 hover:bg-white/[0.04]"
                >
                  <td className="px-3 py-1.5">
                    <span
                      className="inline-flex items-center gap-1.5 font-semibold text-white"
                      title={r.apiName}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          background: r.apiColor,
                          boxShadow: `0 0 6px ${r.apiColor}80`,
                        }}
                      />
                      {r.apiName}
                    </span>
                  </td>
                  <td
                    className="px-3 py-1.5 text-ink-200"
                    title={
                      r.branched
                        ? "DAG branch — multi-predecessor or sub-stream stage"
                        : undefined
                    }
                  >
                    {r.branched ? "↳ " : ""}S{r.stageNo} · {r.stageName}
                  </td>
                  <PivotCell v={r.q1} />
                  <PivotCell v={r.q2} />
                  <PivotCell v={r.q3} />
                  <PivotCell v={r.q4} />
                  <PivotCell v={r.total} bold />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-white/15 bg-ink-900/90 text-xs font-bold text-white">
                <td className="px-3 py-2" colSpan={2}>
                  TOTALS
                </td>
                <PivotCell
                  v={{
                    batches: pivot.reduce((a, r) => a + r.q1.batches, 0),
                    kg: pivot.reduce((a, r) => a + r.q1.kg, 0),
                  }}
                  bold
                />
                <PivotCell
                  v={{
                    batches: pivot.reduce((a, r) => a + r.q2.batches, 0),
                    kg: pivot.reduce((a, r) => a + r.q2.kg, 0),
                  }}
                  bold
                />
                <PivotCell
                  v={{
                    batches: pivot.reduce((a, r) => a + r.q3.batches, 0),
                    kg: pivot.reduce((a, r) => a + r.q3.kg, 0),
                  }}
                  bold
                />
                <PivotCell
                  v={{
                    batches: pivot.reduce((a, r) => a + r.q4.batches, 0),
                    kg: pivot.reduce((a, r) => a + r.q4.kg, 0),
                  }}
                  bold
                />
                <PivotCell
                  v={{ batches: fyTotalBatches, kg: fyTotalKg }}
                  bold
                />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function buildBuckets(
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

// ─── Sub-components ──────────────────────────────────────────────────

function Kpi({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
  tone: "cyan" | "violet" | "amber" | "lime" | "pink" | "default";
}) {
  const tones: Record<string, string> = {
    cyan: "border-cyan-300/30 bg-cyan-300/5 text-cyan-300",
    violet: "border-violet-300/30 bg-violet-300/5 text-violet-300",
    amber: "border-amber-300/30 bg-amber-300/5 text-amber-300",
    lime: "border-lime-300/30 bg-lime-300/5 text-lime-300",
    pink: "border-pink-300/30 bg-pink-300/5 text-pink-300",
    default: "border-white/10 bg-white/5 text-ink-200",
  };
  return (
    <div
      className={clsx(
        "rounded-2xl border px-4 py-3 transition hover:bg-white/[0.04]",
        tones[tone]
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em]">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums text-white">
        {value}
      </div>
      {sub && (
        <div className="text-[10px] font-medium text-ink-400">{sub}</div>
      )}
    </div>
  );
}

function Toggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { v: T; l: string }[];
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={clsx(
            "rounded-md px-2.5 py-1 text-[11px] font-bold transition",
            o.v === value
              ? "bg-cyan-300/15 text-cyan-200 shadow-glow"
              : "text-ink-300 hover:bg-white/5 hover:text-white"
          )}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function PivotHead({
  label,
  tone,
  bold,
}: {
  label: string;
  tone: "cyan" | "violet" | "pink" | "lime" | "amber";
  bold?: boolean;
}) {
  const tones = {
    cyan: "text-cyan-300 bg-cyan-300/5",
    violet: "text-violet-300 bg-violet-300/5",
    pink: "text-pink-300 bg-pink-300/5",
    lime: "text-lime-300 bg-lime-300/5",
    amber: "text-amber-300 bg-amber-300/10",
  };
  return (
    <th
      colSpan={2}
      className={clsx(
        "border-b border-white/10 px-3 py-2 text-center",
        tones[tone],
        bold && "font-extrabold"
      )}
    >
      {label}
    </th>
  );
}

function SubHead({ bold }: { bold?: boolean }) {
  return (
    <>
      <th
        className={clsx(
          "border-b border-white/10 px-2 py-0.5 text-right",
          bold ? "text-white" : "text-ink-400"
        )}
      >
        Btch
      </th>
      <th
        className={clsx(
          "border-b border-white/10 px-2 py-0.5 text-right",
          bold ? "text-white" : "text-ink-400"
        )}
      >
        kg
      </th>
    </>
  );
}

function PivotCell({
  v,
  bold,
}: {
  v: { batches: number; kg: number };
  bold?: boolean;
}) {
  return (
    <>
      <td
        className={clsx(
          "px-2 py-1 text-right font-mono tabular-nums",
          bold ? "font-extrabold text-amber-300" : "text-cyan-200"
        )}
      >
        {v.batches || ""}
      </td>
      <td
        className={clsx(
          "px-2 py-1 text-right font-mono tabular-nums",
          bold ? "font-extrabold text-amber-300" : "text-violet-200"
        )}
        title={v.kg ? `Exact: ${v.kg.toFixed(2)} kg` : undefined}
      >
        {v.kg ? Math.round(v.kg).toLocaleString() : ""}
      </td>
    </>
  );
}

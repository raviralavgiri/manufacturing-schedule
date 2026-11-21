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
import CampaignPlanPanel from "../components/CampaignPlanPanel";
import BlockOccupancyPanel from "../components/BlockOccupancyPanel";
import MultiStageEquipmentPanel from "../components/MultiStageEquipmentPanel";
import { computeWeeks, quarterIn } from "../utils/dates";

/**
 * Dashboard
 * --------
 * The "command center" tab. Three sections worth of insight:
 *
 *   1. KPI strip — the top-level "is the plan healthy?" numbers.
 *   2. Block-wise occupancy (cleanroom / intermediate) and campaign plan.
 *   3. Per-API performance table — Target vs. Achieved vs. Gap with a
 *      Met / Partial / Behind status pill.
 *   4. Detail pivot — API × Stage × Q1-Q4 (+ FY total). Same data as
 *      the legacy "Quarterly Summary"; kept for deep-dives.
 */




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

  const apis = useMemo(
    () => [...apisRaw].sort((a, b) => a.id.localeCompare(b.id)),
    [apisRaw]
  );
  const apiOrder = useMemo(() => {
    const m = new Map<string, number>();
    apis.forEach((a, i) => m.set(a.id, i));
    return m;
  }, [apis]);

  const weeks = useMemo(
    () => computeWeeks(planWindow.startMs, planWindow.endMs),
    [planWindow]
  );
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

  // ─── Intermediate (n-1) shortfall flags ──────────────────────────
  // Two risk checks per API:
  //   A) Mass balance — does each stage's upstream produce enough kg to feed
  //      this stage's planned input demand? A deficit means n-1 inventory is
  //      structurally insufficient (rounding or a manual edit broke the
  //      cascade) and the planned API batch count can't be supported.
  //   B) Quarter timing — for the final (product) stage, did each quarter
  //      actually receive its planned ≈ share of batches? A quarter that is
  //      short while a LATER one is overloaded means the intermediate wasn't
  //      released in time for that quarter (a bottleneck slipped batches).
  const shortfalls = useMemo(() => {
    type Flag = {
      key: string;
      apiName: string;
      apiColor: string;
      stageLabel: string;
      severity: "critical" | "warning";
      message: string;
    };
    const out: Flag[] = [];
    const inputPerBatchOf = (s: {
      inputKgPerBatch?: number;
      batchSizeKg: number;
    }) =>
      typeof s.inputKgPerBatch === "number" && s.inputKgPerBatch > 0
        ? s.inputKgPerBatch
        : s.batchSizeKg;

    apis.forEach((a) => {
      const stages = [...a.stages].sort((x, y) => x.stageNo - y.stageNo);
      const byId = new Map(stages.map((s) => [s.id, s]));

      // A) Mass-balance check per consuming stage.
      stages.forEach((s) => {
        const preds = (s.inputStageIds ?? [])
          .map((id) => byId.get(id))
          .filter((p): p is (typeof stages)[number] => !!p);
        if (preds.length === 0) return; // source stage — nothing upstream
        const required = s.plannedBatches * inputPerBatchOf(s);
        if (required <= 0) return;
        const supplied = preds.reduce(
          (acc, p) => acc + p.plannedBatches * p.batchSizeKg,
          0
        );
        // 1% tolerance for floating rounding.
        if (supplied < required * 0.99) {
          const shortKg = required - supplied;
          out.push({
            key: `mb-${a.id}-${s.id}`,
            apiName: a.name,
            apiColor: a.color,
            stageLabel: `S${s.stageNo} · ${s.stageName}`,
            severity: "critical",
            message: `Needs ${Math.round(required).toLocaleString()} kg of intermediate but upstream only makes ${Math.round(
              supplied
            ).toLocaleString()} kg — short ${Math.round(
              shortKg
            ).toLocaleString()} kg. Increase upstream planned batches.`,
          });
        }
      });

      // B) Quarter-timing check on the final stage.
      const finalStage = stages[stages.length - 1];
      if (!finalStage || finalStage.plannedBatches <= 0) return;
      const planned = finalStage.plannedBatches;
      const perQ = Math.ceil(planned / 4);
      const expected = [0, 1, 2, 3].map((q) =>
        Math.max(0, Math.min(perQ, planned - q * perQ))
      );
      const scheduled = [0, 0, 0, 0];
      schedule.batches.forEach((b) => {
        if (b.stageId !== finalStage.id) return;
        const q = quarterIn(weeks, b.startMs);
        if (q) scheduled[q - 1] += 1;
      });
      for (let q = 0; q < 4; q++) {
        const laterOverloaded = scheduled
          .slice(q + 1)
          .some((n, i) => n > expected[q + 1 + i]);
        if (scheduled[q] < expected[q] && laterOverloaded) {
          out.push({
            key: `q-${a.id}-${q}`,
            apiName: a.name,
            apiColor: a.color,
            stageLabel: `S${finalStage.stageNo} · ${finalStage.stageName}`,
            severity: "warning",
            message: `Q${q + 1} produced only ${scheduled[q]} of ${expected[q]} planned final batches — n-1 intermediate likely not released in time; batches slipped to a later quarter.`,
          });
        }
      }
    });
    return out;
  }, [apis, schedule, weeks]);

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

      {/* ─── Block-wise occupancy ───────────────────────────────── */}
      <BlockOccupancyPanel
        reactors={reactors}
        schedule={schedule}
        planWindow={planWindow}
      />

      {/* ─── Campaign plan (campaign-wise quarterly scheduling) ─────── */}
      <CampaignPlanPanel
        apis={apisRaw}
        reactors={reactors}
        schedule={schedule}
        planWindow={planWindow}
      />

      {/* ─── Top 50 multi-stage equipment ────────────────────────── */}
      <MultiStageEquipmentPanel
        apis={apisRaw}
        reactors={reactors}
        schedule={schedule}
      />

      {/* ─── Intermediate (n-1) shortfall flags ──────────────────── */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">
              Intermediate (n-1) shortfall flags
            </h3>
            <p className="text-[11px] text-ink-400">
              Risks where upstream intermediate may not support the planned API
              batch count — by mass balance and by quarter timing.
            </p>
          </div>
          <span
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold",
              shortfalls.length === 0
                ? "border-lime-300/30 bg-lime-300/10 text-lime-300"
                : "border-amber-300/30 bg-amber-300/10 text-amber-300"
            )}
          >
            {shortfalls.length === 0 ? (
              <CheckCircle2 size={12} />
            ) : (
              <AlertTriangle size={12} />
            )}
            {shortfalls.length === 0
              ? "All supplies sufficient"
              : `${shortfalls.length} risk${shortfalls.length === 1 ? "" : "s"}`}
          </span>
        </div>
        {shortfalls.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-ink-400">
            No intermediate shortfalls detected. Every stage's upstream supplies
            enough material, and final-stage batches are spread across quarters
            as planned.
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {shortfalls.map((f) => (
              <li
                key={f.key}
                className="flex items-start gap-3 px-4 py-2.5 hover:bg-white/[0.02]"
              >
                <span
                  className={clsx(
                    "mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                    f.severity === "critical"
                      ? "border-rose-300/40 bg-rose-300/10 text-rose-300"
                      : "border-amber-300/40 bg-amber-300/10 text-amber-300"
                  )}
                >
                  {f.severity}
                </span>
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: f.apiColor }}
                />
                <div className="min-w-0 flex-1">
                  <span className="text-[12px] font-semibold text-white">
                    {f.apiName}
                  </span>
                  <span className="ml-2 text-[11px] text-ink-400">
                    {f.stageLabel}
                  </span>
                  <p className="mt-0.5 text-[11px] text-ink-300">{f.message}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
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

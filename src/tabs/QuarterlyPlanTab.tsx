/**
 * Quarterly Production Plan
 * ─────────────────────────
 * Breaks the scheduled batches into the four Indian-pharma FY calendar
 * quarters (Q1 Apr–Jun · Q2 Jul–Sep · Q3 Oct–Dec · Q4 Jan–Mar) and shows:
 *
 *   1. Quarter overview cards — total batches + avg reactor utilisation ring.
 *   2. API × Quarter grid    — actual vs theoretical-max heatmap per API.
 *   3. Reactor load table    — per-reactor utilisation bars across Q1–Q4.
 *   4. Suggestions panel     — ranked, actionable optimisation recommendations.
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Lightbulb,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import {
  analyzeQuarterly,
  QLABELS,
  type QLabel,
  type QuarterlySuggestion,
} from "../scheduler/quarterlyOptimizer";
import { FY_START_MS } from "../utils/dates";

// ─── Colour helpers ───────────────────────────────────────────────────────────

/** Colour a utilisation fraction for reactor-load displays. */
function utilColour(u: number): string {
  if (u === 0)   return "text-ink-500";
  if (u < 0.40)  return "text-emerald-400";
  if (u < 0.70)  return "text-amber-400";
  if (u < 0.90)  return "text-orange-400";
  return "text-rose-400";
}
function utilBarCls(u: number): string {
  if (u === 0)   return "bg-white/10";
  if (u < 0.40)  return "bg-emerald-400/70";
  if (u < 0.70)  return "bg-amber-400/70";
  if (u < 0.90)  return "bg-orange-400/70";
  return "bg-rose-400/80";
}

/** Background chip for scheduled/max cell. */
function cellBg(scheduled: number, max: number): string {
  if (max === 0) return "bg-white/[0.02] text-ink-600";
  if (scheduled === 0) return "bg-amber-400/10 text-amber-300 border-amber-400/20";
  const ratio = scheduled / Math.max(max, scheduled);
  if (ratio < 0.35) return "bg-cyan-400/10 text-cyan-300 border-cyan-400/20";
  if (ratio < 0.70) return "bg-emerald-400/10 text-emerald-300 border-emerald-400/20";
  return "bg-violet-400/10 text-violet-300 border-violet-400/20";
}

/** Severity icon + colour for suggestion cards. */
function severityProps(s: QuarterlySuggestion["severity"]) {
  if (s === "critical") return { Icon: AlertTriangle, cls: "text-rose-400", border: "border-rose-400/25", bg: "bg-rose-400/8" };
  if (s === "warning")  return { Icon: Lightbulb,     cls: "text-amber-400", border: "border-amber-400/25", bg: "bg-amber-400/8" };
  return                       { Icon: Info,           cls: "text-cyan-400",  border: "border-cyan-400/20",  bg: "bg-cyan-400/6"  };
}

/** Circular SVG arc used for the utilisation rings on quarter cards. */
function UtilRing({ value, size = 48 }: { value: number; size?: number }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const stroke = value < 0.40 ? "#34d399" : value < 0.70 ? "#fbbf24" : value < 0.90 ? "#fb923c" : "#f87171";
  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={stroke} strokeWidth={5}
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - Math.min(1, value))}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Quarter overview card ────────────────────────────────────────────────────

function QuarterCard({
  quarter,
  totalBatches,
  avgUtil,
  apiContributions,
}: {
  quarter: { label: QLabel; name: string; months: string };
  totalBatches: number;
  avgUtil: number;
  apiContributions: { apiId: string; apiColor: string; apiName: string; batches: number }[];
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-widest text-ink-400">
            {quarter.label}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-500">{quarter.months}</p>
        </div>
        <div className="relative flex items-center justify-center">
          <UtilRing value={avgUtil} size={52} />
          <span className="absolute text-[10px] font-bold text-ink-200">
            {Math.round(avgUtil * 100)}%
          </span>
        </div>
      </div>

      <div className="border-t border-white/6 pt-2">
        <p className="text-2xl font-extrabold tabular-nums text-white">{totalBatches}</p>
        <p className="text-[10px] text-ink-500">batches total</p>
      </div>

      {/* API breakdown dots */}
      <div className="flex flex-wrap gap-1.5">
        {apiContributions.filter(c => c.batches > 0).map(c => (
          <span
            key={c.apiId}
            className="inline-flex items-center gap-1 rounded-full border border-white/8 px-1.5 py-0.5 text-[10px] text-ink-300"
            title={c.apiName}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.apiColor }} />
            {c.batches}
          </span>
        ))}
        {apiContributions.filter(c => c.batches > 0).length === 0 && (
          <span className="text-[10px] italic text-ink-600">No batches</span>
        )}
      </div>
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export default function QuarterlyPlanTab() {
  const apis        = useStore(s => s.apis);
  const reactors    = useStore(s => s.reactors);
  const schedule    = useStore(s => s.schedule);
  const setApiWindow = useStore(s => s.setApiWindow);
  const setStageSchedulePriorities = useStore(s => s.setStageSchedulePriorities);

  const [expandedSug, setExpandedSug] = useState<string | null>(null);
  const [appliedSugs, setAppliedSugs] = useState<Set<string>>(new Set());

  // ── Cleanroom-stage priority ordering ─────────────────────────────────
  // A stage counts as "cleanroom" if any reactor in its pool is CL-class.
  // The list is sorted by the user-set schedulePriority (lowest first), then
  // by API id + stage no for unset ones. Up/down rewrites the whole order.
  const clReactorIds = useMemo(
    () => new Set(reactors.filter(r => r.reactorClass === "CL").map(r => r.id)),
    [reactors]
  );
  const cleanroomStages = useMemo(() => {
    const list = apis.flatMap(a =>
      a.stages
        .filter(s => s.reactorPool.some(rid => clReactorIds.has(rid)))
        .map(s => ({
          id: s.id,
          apiName: a.name,
          apiId: a.id,
          apiColor: a.color,
          stageNo: s.stageNo,
          stageName: s.stageName,
          priority: s.schedulePriority,
        }))
    );
    list.sort((x, y) => {
      const px = x.priority ?? Number.MAX_SAFE_INTEGER;
      const py = y.priority ?? Number.MAX_SAFE_INTEGER;
      if (px !== py) return px - py;
      if (x.apiId !== y.apiId) return x.apiId.localeCompare(y.apiId);
      return x.stageNo - y.stageNo;
    });
    return list;
  }, [apis, clReactorIds]);

  function moveCleanroomStage(index: number, dir: -1 | 1) {
    const ids = cleanroomStages.map(s => s.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setStageSchedulePriorities(ids);
  }

  const analysis = useMemo(
    () => analyzeQuarterly(apis, reactors, schedule.batches, FY_START_MS),
    [apis, reactors, schedule.batches]
  );

  const { quarters, apiSummaries, reactorLoads, totalBatchesPerQ, reactorAvgUtilPerQ, suggestions } = analysis;

  function applySuggestion(sug: QuarterlySuggestion) {
    if (!sug.action) return;
    const { apiId, newStartMs, newEndMs } = sug.action;
    const api = apis.find(a => a.id === apiId);
    if (!api) return;
    setApiWindow(
      apiId,
      newStartMs ?? api.window.startMs,
      newEndMs   ?? api.window.endMs
    );
    setAppliedSugs(prev => new Set([...prev, sug.id]));
  }

  const criticalCount = suggestions.filter(s => s.severity === "critical").length;
  const warningCount  = suggestions.filter(s => s.severity === "warning").length;

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-white">
            Quarterly Production Plan
          </h2>
          <p className="mt-1 text-[12px] text-ink-400">
            Indian pharma FY Apr 2026 – Mar 2027 · Calendar quarters ·
            Final-stage output batches per API per quarter
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px]">
          {criticalCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 font-semibold text-rose-300">
              <AlertTriangle size={10} />
              {criticalCount} critical
            </span>
          )}
          {warningCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 font-semibold text-amber-300">
              <Lightbulb size={10} />
              {warningCount} warning
            </span>
          )}
        </div>
      </div>

      {/* ── Quarter overview cards ──────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {quarters.map(q => (
          <QuarterCard
            key={q.label}
            quarter={q}
            totalBatches={totalBatchesPerQ[q.label]}
            avgUtil={reactorAvgUtilPerQ[q.label]}
            apiContributions={apiSummaries.map(s => ({
              apiId:    s.apiId,
              apiColor: s.apiColor,
              apiName:  s.apiName,
              batches:  s.scheduledPerQ[q.label],
            }))}
          />
        ))}
      </div>

      {/* ── API × Quarter grid ──────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-white/8">
        <div className="border-b border-white/6 px-4 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
            API Production Heatmap — Scheduled / Capacity
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-white/6 text-[10px] uppercase tracking-wider text-ink-500">
                <th className="px-4 py-2.5 text-left font-semibold">API</th>
                {quarters.map(q => (
                  <th key={q.label} className="px-3 py-2.5 text-center font-semibold">
                    <div>{q.label}</div>
                    <div className="font-normal normal-case tracking-normal text-ink-600">
                      {q.months}
                    </div>
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center font-semibold">FY Total</th>
                <th className="px-3 py-2.5 text-center font-semibold">Target</th>
                <th className="px-3 py-2.5 text-center font-semibold">Spread</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/4">
              {apiSummaries.map(summary => {
                const totalScheduled = QLABELS.reduce((acc, q) => acc + summary.scheduledPerQ[q], 0);
                const spreadPct = Math.round(summary.evenness * 100);
                return (
                  <tr key={summary.apiId} className="hover:bg-white/[0.015]">
                    {/* API name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: summary.apiColor }}
                        />
                        <span className="font-semibold text-ink-100">{summary.apiName}</span>
                      </div>
                      <div className="ml-[18px] text-[10px] text-ink-500">
                        {summary.plannedBatches} planned · {summary.targetKg} kg target
                      </div>
                    </td>

                    {/* Per-quarter cells */}
                    {quarters.map(q => {
                      const sched = summary.scheduledPerQ[q.label];
                      const max   = summary.maxPerQ[q.label];
                      const bg    = cellBg(sched, max);
                      return (
                        <td key={q.label} className="px-3 py-3 text-center">
                          {max === 0 ? (
                            <span className="rounded px-2 py-0.5 text-[11px] text-ink-700">—</span>
                          ) : (
                            <span className={clsx("rounded border px-2 py-0.5 font-mono text-[11px] font-bold", bg)}>
                              {sched}
                              <span className="ml-0.5 font-normal opacity-60">/{max}</span>
                            </span>
                          )}
                        </td>
                      );
                    })}

                    {/* FY Total */}
                    <td className="px-3 py-3 text-center">
                      <span className={clsx(
                        "rounded border px-2 py-0.5 font-mono text-[11px] font-bold",
                        totalScheduled >= summary.plannedBatches
                          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                          : "border-amber-400/25 bg-amber-400/10 text-amber-300"
                      )}>
                        {totalScheduled}
                        {summary.overflowCount > 0 && (
                          <span className="ml-1 text-rose-400" title={`${summary.overflowCount} overflow`}>
                            +{summary.overflowCount}↑
                          </span>
                        )}
                      </span>
                    </td>

                    {/* Target */}
                    <td className="px-3 py-3 text-center font-mono text-[11px] text-ink-400">
                      {summary.plannedBatches}
                    </td>

                    {/* Evenness */}
                    <td className="px-3 py-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <div className="h-1 w-16 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={clsx(
                              "h-full rounded-full",
                              spreadPct >= 70 ? "bg-emerald-400" :
                              spreadPct >= 40 ? "bg-amber-400" : "bg-rose-400"
                            )}
                            style={{ width: `${spreadPct}%` }}
                          />
                        </div>
                        <span className="text-[10px] tabular-nums text-ink-500">
                          {spreadPct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-white/6 px-4 py-2 text-[10px] text-ink-600">
          Cell format: <strong className="text-ink-400">scheduled</strong> / theoretical capacity ·
          Spread = how evenly batches are distributed across quarters in the window.
          Amber cell = window covers this quarter but no batches scheduled.
        </div>
      </div>

      {/* ── Reactor load per quarter ─────────────────────────────────── */}
      {reactorLoads.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/8">
          <div className="border-b border-white/6 px-4 py-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
              Reactor Utilisation by Quarter
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-white/6 text-[10px] uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-2 text-left font-semibold">Reactor</th>
                  {quarters.map(q => (
                    <th key={q.label} className="px-3 py-2 text-center font-semibold">{q.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/4">
                {reactorLoads
                  .filter(r => QLABELS.some(q => r.bookedHoursPerQ[q] > 0))
                  .map(r => (
                    <tr key={r.reactorId} className="hover:bg-white/[0.01]">
                      <td className="px-4 py-2.5 font-mono text-[11px] text-ink-200">
                        {r.reactorId}
                      </td>
                      {quarters.map(q => {
                        const u    = r.utilizationPerQ[q.label];
                        const hrs  = r.bookedHoursPerQ[q.label];
                        return (
                          <td key={q.label} className="px-3 py-2.5">
                            <div className="flex flex-col gap-1">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                                <div
                                  className={clsx("h-full rounded-full transition-all", utilBarCls(u))}
                                  style={{ width: `${Math.min(100, u * 100).toFixed(1)}%` }}
                                />
                              </div>
                              <span className={clsx("text-center text-[10px] tabular-nums font-semibold", utilColour(u))}>
                                {Math.round(u * 100)}%
                                <span className="ml-1 font-normal text-ink-600">
                                  ({Math.round(hrs)}h)
                                </span>
                              </span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                {/* Average row */}
                <tr className="border-t border-white/10 bg-white/[0.02]">
                  <td className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-500">
                    Fleet avg
                  </td>
                  {quarters.map(q => {
                    const u = reactorAvgUtilPerQ[q.label];
                    return (
                      <td key={q.label} className="px-3 py-2 text-center">
                        <span className={clsx("text-[11px] font-bold tabular-nums", utilColour(u))}>
                          {Math.round(u * 100)}%
                        </span>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="border-t border-white/6 px-4 py-2 text-[10px] text-ink-600">
            <span className="text-emerald-400">■</span> &lt;40% healthy ·
            <span className="ml-1 text-amber-400">■</span> 40–70% moderate ·
            <span className="ml-1 text-orange-400">■</span> 70–90% busy ·
            <span className="ml-1 text-rose-400">■</span> &gt;90% overloaded
          </div>
        </div>
      )}

      {/* ── Cleanroom stage priority ─────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-white/8">
        <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Sparkles size={13} className="text-cyan-300" />
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
              Cleanroom Stage Priority
            </p>
          </div>
          <span className="text-[10px] text-ink-600">
            {cleanroomStages.length} cleanroom stage{cleanroomStages.length !== 1 ? "s" : ""}
          </span>
        </div>

        {cleanroomStages.length === 0 ? (
          <div className="px-4 py-6 text-center text-[11px] text-ink-500">
            No cleanroom stages found. A stage is treated as cleanroom when its
            reactor pool includes a CL-class reactor (set the class on the
            Master Equipment tab).
          </div>
        ) : (
          <>
            <ol className="divide-y divide-white/5">
              {cleanroomStages.map((s, i) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.015]"
                >
                  <span className="w-6 shrink-0 text-center font-mono text-[12px] font-bold tabular-nums text-cyan-300">
                    {i + 1}
                  </span>
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: s.apiColor }}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-[12px] font-semibold text-ink-100">
                      {s.apiName}
                    </span>
                    <span className="ml-2 text-[11px] text-ink-400">
                      S{s.stageNo} · {s.stageName}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveCleanroomStage(i, -1)}
                      disabled={i === 0}
                      title="Move up — schedule earlier"
                      className={clsx(
                        "rounded-md border p-1.5 transition",
                        i === 0
                          ? "border-white/5 text-ink-700"
                          : "border-white/10 text-ink-300 hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-200"
                      )}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveCleanroomStage(i, 1)}
                      disabled={i === cleanroomStages.length - 1}
                      title="Move down — schedule later"
                      className={clsx(
                        "rounded-md border p-1.5 transition",
                        i === cleanroomStages.length - 1
                          ? "border-white/5 text-ink-700"
                          : "border-white/10 text-ink-300 hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-200"
                      )}
                    >
                      <ArrowDown size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <div className="border-t border-white/6 px-4 py-2 text-[10px] text-ink-600">
              Higher in the list = scheduled first, so it claims contended
              cleanroom reactors earlier each round. Stage dependencies always
              win — a stage never starts before its predecessors. Reordering
              recomputes the schedule immediately.
            </div>
          </>
        )}
      </div>

      {/* ── Suggestions ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/8">
        <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Zap size={13} className="text-amber-400" />
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
              Optimisation Suggestions
            </p>
          </div>
          <span className="text-[10px] text-ink-600">
            {suggestions.length} recommendation{suggestions.length !== 1 ? "s" : ""}
          </span>
        </div>

        {suggestions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <CheckCircle2 size={24} className="text-emerald-400" />
            <p className="text-[12px] font-semibold text-emerald-300">
              Schedule looks well-optimised across all quarters
            </p>
            <p className="text-[11px] text-ink-500">
              No overflow, balanced reactor load, good quarterly distribution.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {suggestions.map(sug => {
              const { Icon, cls, border, bg } = severityProps(sug.severity);
              const isOpen    = expandedSug === sug.id;
              const applied   = appliedSugs.has(sug.id);
              return (
                <div key={sug.id} className={clsx("border-l-2", border)}>
                  <button
                    type="button"
                    onClick={() => setExpandedSug(isOpen ? null : sug.id)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.02]"
                  >
                    <Icon size={14} className={clsx("mt-0.5 shrink-0", cls)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-semibold text-ink-100 truncate">
                          {sug.title}
                        </span>
                        <span className={clsx(
                          "shrink-0 rounded-full border px-1.5 py-0 text-[10px] font-semibold",
                          sug.severity === "critical" ? "border-rose-400/30 text-rose-300" :
                          sug.severity === "warning"  ? "border-amber-400/30 text-amber-300" :
                                                        "border-cyan-400/30 text-cyan-300"
                        )}>
                          {sug.gain}
                        </span>
                        {applied && (
                          <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 text-[10px] font-semibold text-emerald-300">
                            <CheckCircle2 size={9} /> Applied
                          </span>
                        )}
                      </div>
                    </div>
                    {isOpen ? <ChevronUp size={13} className="shrink-0 text-ink-500" /> : <ChevronDown size={13} className="shrink-0 text-ink-500" />}
                  </button>

                  {isOpen && (
                    <div className={clsx("mx-4 mb-3 rounded-lg border px-4 py-3", border, bg)}>
                      <p className="text-[12px] leading-relaxed text-ink-300">
                        {sug.description}
                      </p>
                      {sug.action && !applied && (
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => applySuggestion(sug)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300/40 bg-gradient-to-r from-emerald-400/20 to-cyan-400/20 px-3 py-1.5 text-[11px] font-bold text-white hover:from-emerald-400/35 hover:to-cyan-400/35"
                          >
                            <TrendingUp size={12} />
                            Apply — adjust {apis.find(a => a.id === sug.action!.apiId)?.name ?? ""} window
                          </button>
                          <span className="text-[10px] text-ink-600">
                            Schedule will recompute automatically.
                          </span>
                        </div>
                      )}
                      {sug.action && applied && (
                        <p className="mt-2 text-[11px] text-emerald-400">
                          ✓ Window adjusted — schedule is recomputing.
                        </p>
                      )}
                      {!sug.action && (
                        <p className="mt-2 text-[10px] italic text-ink-600">
                          This suggestion requires a manual change in the APIs or Stages tab.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── How to read this ─────────────────────────────────────────── */}
      <details className="group rounded-xl border border-white/6 text-[11px]">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-ink-400 hover:text-ink-200">
          <Info size={12} />
          <span className="font-semibold">How to read this tab</span>
          <ArrowRight size={11} className="ml-auto transition group-open:rotate-90" />
        </summary>
        <div className="space-y-2 px-4 pb-4 text-ink-500 leading-relaxed">
          <p><strong className="text-ink-300">Scheduled / Capacity</strong> — the numerator is how many final-stage batches are actually booked in that quarter; the denominator is the theoretical maximum given the window overlap, BCT, and reactor pool size.</p>
          <p><strong className="text-ink-300">Spread</strong> — how evenly the batches are distributed across the quarters covered by the plan window. 100% = perfectly uniform; low values mean production is front-loaded or clustered.</p>
          <p><strong className="text-ink-300">Overflow (+N↑)</strong> — batches scheduled beyond the plan window end date. They will be produced but are flagged as "out of plan".</p>
          <p><strong className="text-ink-300">Reactor utilisation</strong> — fraction of the quarter's hours (24×7) actually booked on each reactor. 40–70% is considered healthy; above 85% leaves little room for maintenance or unexpected delays.</p>
          <p><strong className="text-ink-300">Apply button</strong> — adjusts the selected API's plan window so the scheduler can redistribute batches. The schedule recomputes automatically.</p>
        </div>
      </details>
    </div>
  );
}

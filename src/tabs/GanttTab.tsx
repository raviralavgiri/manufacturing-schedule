import { Fragment, useMemo, useRef, useState } from "react";
import {
  ZoomIn,
  ZoomOut,
  Layers,
  ChevronDown,
  ChevronRight,
  Beaker,
  FlaskConical,
  Filter,
  Activity,
} from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader } from "../components/Primitives";
import PriorityPill from "../components/PriorityPill";
import MultiSelectPopover, {
  ClearFiltersButton,
  type Option as MsOption,
} from "../components/MultiSelectPopover";
import ExportMenu from "../components/ExportMenu";
import { computeWeeks, fmtDateTime } from "../utils/dates";
import {
  downloadCsv,
  downloadElementAsPng,
  fileStamp,
  printPage,
} from "../utils/exporters";
import type { BatchScheduleEntry, Reactor } from "../types";

type Mode = "by-api" | "by-stage" | "by-reactor";

export default function GanttTab() {
  const apisRaw = useStore((s) => s.apis);
  const reactors = useStore((s) => s.reactors);
  const schedule = useStore((s) => s.schedule);

  // Sort by priority (1 = highest) for stable, priority-aware row ordering
  const apis = useMemo(
    () =>
      [...apisRaw].sort(
        (a, b) => a.priority - b.priority || a.id.localeCompare(b.id)
      ),
    [apisRaw]
  );

  // Live lookup: apiId → current color. Bars consult this instead of the
  // possibly-stale apiColor baked into the schedule when it was last computed.
  // Guarantees bar color always reflects the current api state.
  const apiColorById = useMemo(() => {
    const m = new Map<string, string>();
    apisRaw.forEach((a) => m.set(a.id, a.color));
    return m;
  }, [apisRaw]);
  const [pxPerWeek, setPxPerWeek] = useState(64); // default = "Quarter view": ~13 weeks visible per ~830px
  const [mode, setMode] = useState<Mode>("by-stage");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Ref to the Gantt card so we can snapshot it as PNG
  const chartCardRef = useRef<HTMLDivElement>(null);

  // Filter state - empty Set means "all" (no filter)
  const [apiFilter, setApiFilter] = useState<Set<string>>(new Set());
  const [stageFilter, setStageFilter] = useState<Set<string>>(new Set());
  const [reactorFilter, setReactorFilter] = useState<Set<string>>(new Set());
  const anyFilterActive =
    apiFilter.size > 0 || stageFilter.size > 0 || reactorFilter.size > 0;

  // Apply filters to the source batch list once
  const filteredBatches = useMemo(() => {
    if (!anyFilterActive) return schedule.batches;
    return schedule.batches.filter((b) => {
      if (apiFilter.size > 0 && !apiFilter.has(b.apiId)) return false;
      if (stageFilter.size > 0 && !stageFilter.has(b.stageName)) return false;
      if (
        reactorFilter.size > 0 &&
        !b.reactorIds.some((rid) => reactorFilter.has(rid))
      )
        return false;
      return true;
    });
  }, [schedule.batches, apiFilter, stageFilter, reactorFilter, anyFilterActive]);

  // Build filter option lists
  const apiOptions: MsOption[] = useMemo(
    () =>
      apis.map((a) => ({
        value: a.id,
        label: a.name === a.id ? a.id : a.name,
        color: a.color,
        secondary: a.name === a.id ? undefined : `id: ${a.id}`,
        group: `Priority P${a.priority}`,
      })),
    [apis]
  );

  const stageOptions: MsOption[] = useMemo(() => {
    const seen = new Map<string, number>();
    apis.forEach((a) =>
      a.stages.forEach((s) =>
        seen.set(s.stageName, (seen.get(s.stageName) ?? 0) + 1)
      )
    );
    return Array.from(seen.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({
        value: name,
        label: name,
        secondary: `${count} use${count === 1 ? "" : "s"}`,
      }));
  }, [apis]);

  const reactorOptions: MsOption[] = useMemo(
    () =>
      reactors.map((r) => ({
        value: r.id,
        label: r.name,
        group: r.reactorClass,
        secondary: r.name === r.id ? undefined : `id: ${r.id}`,
      })),
    [reactors]
  );

  // Group batches by the active mode. In by-reactor mode each batch appears
  // in EVERY reactor row in its train (since trains lock all reactors together).
  // Uses filteredBatches so the user's filter selections affect what's drawn.
  const grouped = useMemo(() => {
    const map = new Map<string, BatchScheduleEntry[]>();
    filteredBatches.forEach((b) => {
      if (mode === "by-reactor") {
        b.reactorIds.forEach((rid) => {
          // If reactor filter is active, only fan-out into selected reactors
          if (reactorFilter.size > 0 && !reactorFilter.has(rid)) return;
          if (!map.has(rid)) map.set(rid, []);
          map.get(rid)!.push(b);
        });
        return;
      }
      const key =
        mode === "by-api" ? b.apiId : `${b.apiId}__S${b.stageNo}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    });
    return map;
  }, [filteredBatches, mode, reactorFilter]);

  // Build row list
  const rows = useMemo(() => {
    const out: {
      key: string;
      apiId?: string;
      reactorId?: string;
      label: string;
      stageNo?: number;
      color: string;
      reactorClass?: Reactor["reactorClass"];
    }[] = [];

    if (mode === "by-reactor") {
      reactors.forEach((r) => {
        out.push({
          key: r.id,
          reactorId: r.id,
          label: r.name,
          color: classColor(r.reactorClass),
          reactorClass: r.reactorClass,
        });
      });
      return out;
    }

    apis.forEach((a) => {
      if (mode === "by-api") {
        out.push({ key: a.id, apiId: a.id, label: a.id, color: a.color });
      } else {
        a.stages.forEach((s) => {
          out.push({
            key: `${a.id}__S${s.stageNo}`,
            apiId: a.id,
            label: `${a.id} · S${s.stageNo}`,
            stageNo: s.stageNo,
            color: a.color,
          });
        });
      }
    });
    return out;
  }, [apis, reactors, mode]);

  // Timeline range = global plan window from the store
  const planWindow = useStore((s) => s.window);
  const weeks = useMemo(
    () => computeWeeks(planWindow.startMs, planWindow.endMs),
    [planWindow]
  );
  const fyStartMs = weeks.length > 0 ? weeks[0].startMs : Date.now();
  const totalWeeks = weeks.length;
  const rowH = mode === "by-api" ? 40 : mode === "by-reactor" ? 30 : 28;

  // For collapse: by API
  const apiCollapsed = (apiId: string) => collapsed.has(apiId);
  const toggleApi = (apiId: string) => {
    const c = new Set(collapsed);
    if (c.has(apiId)) c.delete(apiId);
    else c.add(apiId);
    setCollapsed(c);
  };

  // Filter rows according to:
  //   1. Collapsed APIs (only in by-stage mode)
  //   2. Active filters - hide any row that has no batches after filtering
  const visibleRows = useMemo(() => {
    let result = rows;
    if (mode === "by-stage") {
      result = result.filter((r) => !r.apiId || !apiCollapsed(r.apiId));
    }
    if (anyFilterActive) {
      // Hide empty rows when filters are active so the Gantt is dense
      result = result.filter((r) => (grouped.get(r.key)?.length ?? 0) > 0);
    }
    return result;
  }, [rows, mode, collapsed, anyFilterActive, grouped]);

  // Determine quarter band positions
  const quarterBands = useMemo(() => {
    const bands: { qStart: number; qEnd: number; label: string }[] = [];
    let lastQ = -1;
    let bandStart = 0;
    weeks.forEach((w, i) => {
      if (w.quarter !== lastQ) {
        if (lastQ !== -1) {
          bands.push({
            qStart: bandStart,
            qEnd: i,
            label: `Q${lastQ}`,
          });
        }
        bandStart = i;
        lastQ = w.quarter;
      }
      if (i === weeks.length - 1) {
        bands.push({ qStart: bandStart, qEnd: weeks.length, label: `Q${lastQ}` });
      }
    });
    return bands;
  }, [weeks]);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Gantt Chart · FY 2026 – 2027"
        subtitle={
          anyFilterActive
            ? `Showing ${filteredBatches.length} of ${schedule.batches.length} batches (filters active)`
            : "Solid bar = reactor cycle, faded tail = analysis window. Color encodes the API."
        }
        right={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-1 text-xs">
              <button
                onClick={() => setMode("by-stage")}
                className={clsx(
                  "rounded-md px-3 py-1 font-semibold transition",
                  mode === "by-stage"
                    ? "bg-cyan-300/20 text-cyan-200 shadow-glow"
                    : "text-ink-300 hover:text-white"
                )}
              >
                <Layers size={11} className="mr-1 inline" /> By Stage
              </button>
              <button
                onClick={() => setMode("by-api")}
                className={clsx(
                  "rounded-md px-3 py-1 font-semibold transition",
                  mode === "by-api"
                    ? "bg-cyan-300/20 text-cyan-200 shadow-glow"
                    : "text-ink-300 hover:text-white"
                )}
              >
                <FlaskConical size={11} className="mr-1 inline" /> By API
              </button>
              <button
                onClick={() => setMode("by-reactor")}
                className={clsx(
                  "rounded-md px-3 py-1 font-semibold transition",
                  mode === "by-reactor"
                    ? "bg-cyan-300/20 text-cyan-200 shadow-glow"
                    : "text-ink-300 hover:text-white"
                )}
              >
                <Beaker size={11} className="mr-1 inline" /> By Reactor
              </button>
            </div>
            {/* Quick-zoom presets */}
            <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-1 text-[10px]">
              {(
                [
                  { label: "Year", px: 24, hint: "Whole FY at once" },
                  { label: "Quarter", px: 64, hint: "About 13 weeks at once" },
                  { label: "Month", px: 160, hint: "About 4 weeks at once" },
                  { label: "Week", px: 240, hint: "Single week zoom" },
                ] as const
              ).map((p) => {
                const isActive = pxPerWeek === p.px;
                return (
                  <button
                    key={p.label}
                    onClick={() => setPxPerWeek(p.px)}
                    title={p.hint}
                    className={clsx(
                      "rounded-md px-2 py-1 font-bold uppercase tracking-wider transition",
                      isActive
                        ? "bg-cyan-300/20 text-cyan-200"
                        : "text-ink-300 hover:text-white"
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* Fine-grained +/- */}
            <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
              <button
                onClick={() => setPxPerWeek((v) => Math.max(24, v - 8))}
                className="rounded-md p-1.5 text-ink-300 hover:bg-white/10 hover:text-white"
                title="Zoom out"
              >
                <ZoomOut size={13} />
              </button>
              <span className="px-1.5 font-mono text-[11px] text-ink-300">
                {pxPerWeek}px/wk
              </span>
              <button
                onClick={() => setPxPerWeek((v) => Math.min(240, v + 8))}
                className="rounded-md p-1.5 text-ink-300 hover:bg-white/10 hover:text-white"
                title="Zoom in"
              >
                <ZoomIn size={13} />
              </button>
            </div>

            {/* Export menu */}
            <ExportMenu
              onCsv={() => {
                const headers = [
                  "Batch ID",
                  "API ID",
                  "API Name",
                  "Stage No",
                  "Stage Name",
                  "Batch #",
                  "Reactor Train (IDs)",
                  "Reactor Train (Names)",
                  "Start",
                  "End (Cycle)",
                  "Analysis End",
                  "FY",
                  "Input kg",
                  "Output kg",
                ];
                const rows = filteredBatches.map((b) => [
                  b.batchId,
                  b.apiId,
                  b.apiName,
                  b.stageNo,
                  b.stageName,
                  b.batchNo,
                  b.reactorIds.join(" + "),
                  b.reactorIds
                    .map((id) => reactors.find((x) => x.id === id)?.name ?? id)
                    .join(" + "),
                  fmtDateTime(b.startMs),
                  fmtDateTime(b.endMs),
                  fmtDateTime(b.analysisEndMs),
                  b.inFY ? "FY" : "Ovr",
                  b.inputKg,
                  b.outputKg,
                ]);
                const filterTag = anyFilterActive ? "_filtered" : "";
                downloadCsv(
                  `gantt_${mode}${filterTag}_${fileStamp()}.csv`,
                  headers,
                  rows
                );
              }}
              onPng={async () => {
                const filterTag = anyFilterActive ? "_filtered" : "";
                await downloadElementAsPng(
                  chartCardRef.current,
                  `gantt_${mode}${filterTag}_${fileStamp()}.png`,
                  { backgroundColor: "#04081a", pixelRatio: 2 }
                );
              }}
              onPrint={() => printPage()}
            />
          </div>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-2">
        <span className="ml-1 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400">
          <Filter size={12} /> Filter
        </span>
        <MultiSelectPopover
          label="APIs"
          icon={<FlaskConical size={12} />}
          options={apiOptions}
          selected={apiFilter}
          onChange={setApiFilter}
          width={300}
        />
        <MultiSelectPopover
          label="Stages"
          icon={<Layers size={12} />}
          options={stageOptions}
          selected={stageFilter}
          onChange={setStageFilter}
          width={240}
        />
        <MultiSelectPopover
          label="Reactors"
          icon={<Beaker size={12} />}
          options={reactorOptions}
          selected={reactorFilter}
          onChange={setReactorFilter}
          width={260}
        />
        <ClearFiltersButton
          active={anyFilterActive}
          onClear={() => {
            setApiFilter(new Set());
            setStageFilter(new Set());
            setReactorFilter(new Set());
          }}
        />
        {anyFilterActive && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-cyan-300/30 bg-cyan-300/8 px-2 py-1 text-[11px] font-semibold text-cyan-200">
            <Activity size={10} />
            {filteredBatches.length.toLocaleString()} of{" "}
            {schedule.batches.length.toLocaleString()} batches
          </span>
        )}
      </div>

      <div ref={chartCardRef} className="gantt-chart-card">
      <Card className="overflow-hidden p-0">
        <div className="flex">
          {/* Left labels column */}
          <div className="w-[200px] shrink-0 border-r border-white/10 bg-ink-900/40">
            {/* Header spacer */}
            <div className="h-[60px] border-b border-white/10" />
            {/* Rows */}
            {mode === "by-stage" &&
              apis.map((a) => {
                if (anyFilterActive) {
                  // Skip the whole API header if none of its stages have visible bars
                  const hasAny = a.stages.some(
                    (s) =>
                      (grouped.get(`${a.id}__S${s.stageNo}`)?.length ?? 0) > 0
                  );
                  if (!hasAny) return null;
                }
                const isCollapsed = apiCollapsed(a.id);
                const visibleStages = anyFilterActive
                  ? a.stages.filter(
                      (s) =>
                        (grouped.get(`${a.id}__S${s.stageNo}`)?.length ?? 0) >
                        0
                    )
                  : a.stages;
                return (
                  <div key={a.id}>
                    <button
                      onClick={() => toggleApi(a.id)}
                      className="flex w-full items-center gap-1.5 border-b border-white/5 bg-white/[0.02] px-3 py-1.5 text-left text-xs font-bold text-white hover:bg-white/[0.05]"
                      title={`${a.name} (id: ${a.id})`}
                    >
                      {isCollapsed ? (
                        <ChevronRight size={12} className="shrink-0 text-ink-400" />
                      ) : (
                        <ChevronDown size={12} className="shrink-0 text-ink-400" />
                      )}
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          background: a.color,
                          boxShadow: `0 0 8px ${a.color}80`,
                        }}
                      />
                      <span className="truncate">{a.name}</span>
                      <span className="ml-auto font-mono text-[10px] text-ink-400">
                        {visibleStages.length}st
                      </span>
                    </button>
                    {!isCollapsed &&
                      visibleStages.map((s) => (
                        <div
                          key={s.id}
                          style={{ height: rowH }}
                          className="flex items-center border-b border-white/5 px-4 text-[11px] text-ink-200"
                        >
                          <span className="text-ink-400">S{s.stageNo}</span>
                          <span className="ml-2 truncate">{s.stageName}</span>
                        </div>
                      ))}
                  </div>
                );
              })}

            {mode === "by-api" &&
              apis.map((a) => {
                if (
                  anyFilterActive &&
                  (grouped.get(a.id)?.length ?? 0) === 0
                )
                  return null;
                return (
                  <div
                    key={a.id}
                    style={{ height: rowH }}
                    className="flex items-center gap-2 border-b border-white/5 px-3 text-xs font-bold text-white"
                    title={`${a.name} (id: ${a.id})`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        background: a.color,
                        boxShadow: `0 0 8px ${a.color}80`,
                      }}
                    />
                    <span className="truncate">{a.name}</span>
                    <span className="ml-auto shrink-0">
                      <PriorityPill value={a.priority} readOnly />
                    </span>
                  </div>
                );
              })}

            {mode === "by-reactor" &&
              reactors.map((r) => {
                const batchCount = grouped.get(r.id)?.length ?? 0;
                if (anyFilterActive && batchCount === 0) return null;
                const cls = classColor(r.reactorClass);
                return (
                  <div
                    key={r.id}
                    style={{ height: rowH }}
                    className="flex items-center gap-2 border-b border-white/5 px-3 text-[11px] font-bold text-white"
                    title={r.name === r.id ? r.id : `${r.name} (id: ${r.id})`}
                  >
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-sm"
                      style={{
                        background: cls,
                        boxShadow: `0 0 6px ${cls}80`,
                      }}
                    />
                    <span className="truncate">{r.name}</span>
                    <span
                      className="shrink-0 text-[9px] uppercase text-ink-400"
                      title={r.reactorClass}
                    >
                      {r.reactorClass === "Cleanroom" ? "CR" : "INT"}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-ink-400 tabular-nums">
                      {batchCount}
                    </span>
                  </div>
                );
              })}
          </div>

          {/* Right scrollable timeline */}
          <div className="relative flex-1 overflow-auto">
            <div
              style={{
                width: totalWeeks * pxPerWeek,
                position: "relative",
              }}
            >
              {/* Header: quarters + week labels */}
              <div className="sticky top-0 z-10 bg-ink-900/90 backdrop-blur-md">
                {/* Quarter band */}
                <div className="flex h-8 border-b border-white/10">
                  {quarterBands.map((q) => (
                    <div
                      key={q.label + q.qStart}
                      style={{ width: (q.qEnd - q.qStart) * pxPerWeek }}
                      className="flex items-center justify-center border-r border-white/10 bg-gradient-to-b from-violet-500/10 to-transparent text-[11px] font-bold uppercase tracking-widest text-violet-200"
                    >
                      {q.label} · {monthForBand(weeks, q.qStart, q.qEnd)}
                    </div>
                  ))}
                </div>
                {/* Week ticks - label density scales with zoom */}
                {(() => {
                  const labelEvery =
                    pxPerWeek >= 64 ? 1 : pxPerWeek >= 36 ? 2 : 4;
                  return (
                    <div
                      className="relative flex h-7 border-b border-white/10"
                      style={{ width: totalWeeks * pxPerWeek }}
                    >
                      {weeks.map((w, i) => {
                        const showLabel = i % labelEvery === 0;
                        return (
                          <div
                            key={i}
                            style={{ width: pxPerWeek }}
                            className={clsx(
                              "shrink-0 border-r text-[10px]",
                              showLabel
                                ? "border-white/15 text-ink-300"
                                : "border-white/5 text-transparent"
                            )}
                          >
                            <span className="block px-1 leading-7">
                              {w.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {/* Day-of-week ticks - only at zooms where they're readable.
                    Labels rotate based on the actual start day-of-week so a
                    plan starting on a Wednesday shows W T F S S M T, etc. */}
                {pxPerWeek >= 100 &&
                  (() => {
                    const useShortNames = pxPerWeek >= 180;
                    // Standard week starting Sunday
                    const allShort = [
                      "Sun",
                      "Mon",
                      "Tue",
                      "Wed",
                      "Thu",
                      "Fri",
                      "Sat",
                    ];
                    const allLetter = ["S", "M", "T", "W", "T", "F", "S"];
                    const startDow = new Date(planWindow.startMs).getDay();
                    return (
                      <div
                        className="relative flex h-5 border-b border-white/10 bg-white/[0.015]"
                        style={{ width: totalWeeks * pxPerWeek }}
                      >
                        {weeks.map((_, weekIdx) => (
                          <div
                            key={weekIdx}
                            className="flex shrink-0 border-r border-white/10"
                            style={{ width: pxPerWeek }}
                          >
                            {Array.from({ length: 7 }).map((_, dayIdx) => {
                              const dow = (startDow + dayIdx) % 7;
                              const isWeekend = dow === 0 || dow === 6;
                              const label = useShortNames
                                ? allShort[dow]
                                : allLetter[dow];
                              return (
                                <div
                                  key={dayIdx}
                                  style={{ width: pxPerWeek / 7 }}
                                  className={clsx(
                                    "text-center font-mono text-[9px] leading-5",
                                    isWeekend
                                      ? "text-ink-500/70"
                                      : "text-ink-400",
                                    // subtle vertical day separators
                                    dayIdx < 6 &&
                                      "border-r border-white/[0.04]"
                                  )}
                                >
                                  {label}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
              </div>

              {/* Body grid + bars */}
              <div className="relative">
                {/* Row backgrounds with vertical week guides */}
                {visibleRows.map((row, idx) => {
                  const batches = grouped.get(row.key) || [];
                  // In by-stage mode the rail renders an API-header button
                  // before each API's first stage row. The body must emit a
                  // matching empty row of the same height so the rail and
                  // body stay vertically aligned. Without this, every bar
                  // visually appears one row ABOVE its labeled position.
                  const prevRow = idx > 0 ? visibleRows[idx - 1] : null;
                  const isFirstStageOfApi =
                    mode === "by-stage" &&
                    !!row.apiId &&
                    (!prevRow || prevRow.apiId !== row.apiId);
                  return (
                    <Fragment key={row.key}>
                      {isFirstStageOfApi && (
                        <div
                          aria-hidden
                          style={{ height: 28 }}
                          className="border-b border-white/5 bg-white/[0.02]"
                        />
                      )}
                    <div
                      style={{ height: rowH }}
                      className={clsx(
                        "relative border-b border-white/5",
                        idx % 2 === 0 ? "bg-white/[0.005]" : "bg-white/[0.015]"
                      )}
                    >
                      {/* Week vertical guides - thicker every 4 weeks */}
                      {weeks.map((_, i) => (
                        <div
                          key={i}
                          style={{ left: i * pxPerWeek, width: pxPerWeek }}
                          className={clsx(
                            "absolute top-0 h-full border-r",
                            i % 4 === 0
                              ? "border-white/10"
                              : "border-white/[0.04]"
                          )}
                        />
                      ))}
                      {/* Bars */}
                      {batches.map((b) => {
                        const startWk = (b.startMs - fyStartMs) / (7 * 24 * 3600 * 1000);
                        const cycleEndWk = (b.endMs - fyStartMs) / (7 * 24 * 3600 * 1000);
                        const analysisEndWk =
                          (b.analysisEndMs - fyStartMs) / (7 * 24 * 3600 * 1000);
                        const left = Math.max(0, startWk * pxPerWeek);
                        const cycleWidth = Math.max(
                          2,
                          (cycleEndWk - startWk) * pxPerWeek
                        );
                        const tailWidth = Math.max(
                          0,
                          (analysisEndWk - cycleEndWk) * pxPerWeek
                        );
                        if (startWk >= totalWeeks) return null;
                        const barH = rowH - 6;

                        // Live color lookup - guarantees the bar uses the
                        // CURRENT api.color, never a stale snapshot from when
                        // the schedule was last computed.
                        const barColor =
                          apiColorById.get(b.apiId) ?? b.apiColor;
                        return (
                          <div
                            key={b.batchId}
                            className="group absolute top-1/2 -translate-y-1/2"
                            style={{ left }}
                            title={`${b.batchId} · ${b.reactorId}\n${new Date(
                              b.startMs
                            ).toDateString()} → ${new Date(
                              b.analysisEndMs
                            ).toDateString()}`}
                          >
                            <div className="flex items-center">
                              <div
                                style={{
                                  width: cycleWidth,
                                  height: barH,
                                  background: barColor,
                                  boxShadow: `0 0 6px ${barColor}99, inset 0 1px 0 rgba(255,255,255,0.25)`,
                                }}
                                className="rounded-l-sm border border-white/20 transition-all group-hover:brightness-125 group-hover:saturate-150"
                              />
                              {tailWidth > 1 && (
                                <div
                                  style={{
                                    width: tailWidth,
                                    height: barH,
                                    background: `linear-gradient(90deg, ${barColor}88, ${barColor}22)`,
                                    border: `1px dashed ${barColor}80`,
                                    borderLeft: "none",
                                  }}
                                  className="rounded-r-sm opacity-80"
                                />
                              )}
                            </div>
                            {/* Tooltip on hover */}
                            <div className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 hidden whitespace-nowrap rounded-md border border-white/15 bg-ink-950/95 px-2 py-1.5 text-[10px] text-white shadow-xl group-hover:block">
                              <div className="font-bold">{b.apiName}</div>
                              <div className="text-ink-300">
                                {b.batchId} · S{b.stageNo} · #{b.batchNo}
                              </div>
                              <div className="text-ink-300">
                                Train:{" "}
                                {b.reactorIds
                                  .map(
                                    (id) =>
                                      reactors.find((x) => x.id === id)?.name ??
                                      id
                                  )
                                  .join(" + ")}
                              </div>
                              <div className="text-ink-300">
                                Start: {new Date(b.startMs).toLocaleString()}
                              </div>
                              <div className="text-ink-300">
                                Cycle End: {new Date(b.endMs).toLocaleString()}
                              </div>
                              <div className="text-ink-300">
                                Analysis End:{" "}
                                {new Date(b.analysisEndMs).toLocaleString()}
                              </div>
                              <div
                                className={clsx(
                                  "mt-0.5 font-bold",
                                  b.inFY ? "text-lime-300" : "text-amber-300"
                                )}
                              >
                                {b.inFY ? "Within FY" : "Overflow"}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    </Fragment>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </Card>
      </div>

      {/* Legend */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="text-ink-300">Legend:</span>
          <Legend
            swatch={
              <span className="inline-block h-3 w-6 rounded-sm bg-cyan-400 shadow-[0_0_6px_#00f0ff80]" />
            }
            label="Reactor cycle (busy)"
          />
          <Legend
            swatch={
              <span
                className="inline-block h-3 w-6 rounded-sm border border-dashed border-cyan-300"
                style={{
                  background:
                    "linear-gradient(90deg, rgba(0,240,255,0.5), rgba(0,240,255,0.1))",
                }}
              />
            }
            label="Analysis window (faded tail)"
          />
          {mode === "by-reactor" && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-300/30 bg-violet-300/8 px-2 py-1 font-semibold text-violet-200">
              <Beaker size={11} /> Bar color = API · Row = Reactor · spot
              over-allocation at a glance
            </span>
          )}
          <span className="ml-auto text-ink-400">
            {schedule.totalBatches.toLocaleString()} bars rendered ·{" "}
            {schedule.fyBatches.toLocaleString()} in FY
          </span>
        </div>
      </Card>
    </div>
  );
}

function Legend({
  swatch,
  label,
}: {
  swatch: React.ReactNode;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-200">
      {swatch} {label}
    </span>
  );
}

function monthForBand(
  weeks: { start: Date }[],
  qStart: number,
  qEnd: number
): string {
  if (weeks.length === 0) return "";
  const a = weeks[qStart].start;
  const b = weeks[Math.min(qEnd - 1, weeks.length - 1)].start;
  return `${a.toLocaleString("en", { month: "short" })}–${b.toLocaleString("en", { month: "short" })}`;
}

function classColor(cls: Reactor["reactorClass"]): string {
  return cls === "Cleanroom" ? "#f472b6" : "#00f0ff";
}

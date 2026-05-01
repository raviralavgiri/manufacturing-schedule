import { useMemo, useState } from "react";
import { ZoomIn, ZoomOut, Layers, ChevronDown, ChevronRight, Beaker, FlaskConical } from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader, Tag } from "../components/Primitives";
import PriorityPill from "../components/PriorityPill";
import { FY_WEEKS } from "../utils/dates";
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
  const [pxPerWeek, setPxPerWeek] = useState(28);
  const [mode, setMode] = useState<Mode>("by-stage");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Group batches by the active mode. In by-reactor mode each batch appears
  // in EVERY reactor row in its train (since trains lock all reactors together).
  const grouped = useMemo(() => {
    const map = new Map<string, BatchScheduleEntry[]>();
    schedule.batches.forEach((b) => {
      if (mode === "by-reactor") {
        b.reactorIds.forEach((rid) => {
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
  }, [schedule.batches, mode]);

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
      shared?: boolean;
    }[] = [];

    if (mode === "by-reactor") {
      reactors.forEach((r) => {
        out.push({
          key: r.id,
          reactorId: r.id,
          label: r.id,
          color: classColor(r.reactorClass),
          reactorClass: r.reactorClass,
          shared: r.shared,
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

  const fyStartMs = FY_WEEKS[0].start.getTime();
  const totalWeeks = FY_WEEKS.length;
  const rowH = mode === "by-api" ? 36 : mode === "by-reactor" ? 26 : 22;

  // For collapse: by API
  const apiCollapsed = (apiId: string) => collapsed.has(apiId);
  const toggleApi = (apiId: string) => {
    const c = new Set(collapsed);
    if (c.has(apiId)) c.delete(apiId);
    else c.add(apiId);
    setCollapsed(c);
  };

  // Filter rows according to collapsed APIs (only relevant for by-stage mode)
  const visibleRows = useMemo(() => {
    if (mode !== "by-stage") return rows;
    return rows.filter((r) => !r.apiId || !apiCollapsed(r.apiId));
  }, [rows, mode, collapsed]);

  // Determine quarter band positions
  const quarterBands = useMemo(() => {
    const bands: { qStart: number; qEnd: number; label: string }[] = [];
    let lastQ = -1;
    let bandStart = 0;
    FY_WEEKS.forEach((w, i) => {
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
      if (i === FY_WEEKS.length - 1) {
        bands.push({ qStart: bandStart, qEnd: FY_WEEKS.length, label: `Q${lastQ}` });
      }
    });
    return bands;
  }, []);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Gantt Chart · FY 2026 – 2027"
        subtitle="Solid bar = reactor cycle, faded tail = analysis window. Color encodes the API."
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
            <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
              <button
                onClick={() => setPxPerWeek((v) => Math.max(14, v - 6))}
                className="rounded-md p-1.5 text-ink-300 hover:bg-white/10 hover:text-white"
                title="Zoom out"
              >
                <ZoomOut size={13} />
              </button>
              <span className="px-1.5 font-mono text-[11px] text-ink-300">
                {pxPerWeek}px/wk
              </span>
              <button
                onClick={() => setPxPerWeek((v) => Math.min(72, v + 6))}
                className="rounded-md p-1.5 text-ink-300 hover:bg-white/10 hover:text-white"
                title="Zoom in"
              >
                <ZoomIn size={13} />
              </button>
            </div>
          </div>
        }
      />

      <Card className="overflow-hidden p-0">
        <div className="flex">
          {/* Left labels column */}
          <div className="w-[200px] shrink-0 border-r border-white/10 bg-ink-900/40">
            {/* Header spacer */}
            <div className="h-[60px] border-b border-white/10" />
            {/* Rows */}
            {mode === "by-stage" &&
              apis.map((a) => {
                const isCollapsed = apiCollapsed(a.id);
                return (
                  <div key={a.id}>
                    <button
                      onClick={() => toggleApi(a.id)}
                      className="flex w-full items-center gap-1.5 border-b border-white/5 bg-white/[0.02] px-3 py-1.5 text-left text-xs font-bold text-white hover:bg-white/[0.05]"
                    >
                      {isCollapsed ? (
                        <ChevronRight size={12} className="text-ink-400" />
                      ) : (
                        <ChevronDown size={12} className="text-ink-400" />
                      )}
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{
                          background: a.color,
                          boxShadow: `0 0 8px ${a.color}80`,
                        }}
                      />
                      {a.id}
                      <span className="ml-auto font-mono text-[10px] text-ink-400">
                        {a.stages.length}st
                      </span>
                    </button>
                    {!isCollapsed &&
                      a.stages.map((s) => (
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
              apis.map((a) => (
                <div
                  key={a.id}
                  style={{ height: rowH }}
                  className="flex items-center gap-2 border-b border-white/5 px-3 text-xs font-bold text-white"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      background: a.color,
                      boxShadow: `0 0 8px ${a.color}80`,
                    }}
                  />
                  <span>{a.id}</span>
                  <span className="ml-auto">
                    <PriorityPill value={a.priority} readOnly />
                  </span>
                </div>
              ))}

            {mode === "by-reactor" &&
              reactors.map((r) => {
                const batchCount = grouped.get(r.id)?.length ?? 0;
                const cls = classColor(r.reactorClass);
                return (
                  <div
                    key={r.id}
                    style={{ height: rowH }}
                    className="flex items-center gap-2 border-b border-white/5 px-3 text-[11px] font-bold text-white"
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{
                        background: cls,
                        boxShadow: `0 0 6px ${cls}80`,
                      }}
                    />
                    <span className="font-mono">{r.id}</span>
                    <span className="text-[9px] uppercase text-ink-400">
                      {r.reactorClass.charAt(0)}
                    </span>
                    {r.shared && (
                      <Tag tone="violet" className="!px-1 !py-0 !text-[8px]">
                        ★
                      </Tag>
                    )}
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
                      {q.label} · {monthForBand(q.qStart, q.qEnd)}
                    </div>
                  ))}
                </div>
                {/* Week ticks */}
                <div
                  className="relative flex h-7 border-b border-white/10"
                  style={{ width: totalWeeks * pxPerWeek }}
                >
                  {FY_WEEKS.map((w, i) => (
                    <div
                      key={i}
                      style={{ width: pxPerWeek }}
                      className={clsx(
                        "shrink-0 border-r text-[9px]",
                        i % 4 === 0
                          ? "border-white/15 text-ink-300"
                          : "border-white/5 text-transparent"
                      )}
                    >
                      <span className="block px-1 leading-7">{w.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Body grid + bars */}
              <div className="relative">
                {/* Row backgrounds with vertical week guides */}
                {visibleRows.map((row, idx) => {
                  const batches = grouped.get(row.key) || [];
                  return (
                    <div
                      key={row.key}
                      style={{ height: rowH }}
                      className={clsx(
                        "relative border-b border-white/5",
                        idx % 2 === 0 ? "bg-white/[0.005]" : "bg-white/[0.015]"
                      )}
                    >
                      {/* Week vertical guides */}
                      {FY_WEEKS.map((_, i) => (
                        <div
                          key={i}
                          style={{ left: i * pxPerWeek, width: pxPerWeek }}
                          className={clsx(
                            "absolute top-0 h-full border-r",
                            i % 4 === 0 ? "border-white/8" : "border-white/3"
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
                                  background: b.apiColor,
                                  boxShadow: `0 0 6px ${b.apiColor}99, inset 0 1px 0 rgba(255,255,255,0.25)`,
                                }}
                                className="rounded-l-sm border border-white/20 transition-all group-hover:brightness-125 group-hover:saturate-150"
                              />
                              {tailWidth > 1 && (
                                <div
                                  style={{
                                    width: tailWidth,
                                    height: barH,
                                    background: `linear-gradient(90deg, ${b.apiColor}88, ${b.apiColor}22)`,
                                    border: `1px dashed ${b.apiColor}80`,
                                    borderLeft: "none",
                                  }}
                                  className="rounded-r-sm opacity-80"
                                />
                              )}
                            </div>
                            {/* Tooltip on hover */}
                            <div className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 hidden whitespace-nowrap rounded-md border border-white/15 bg-ink-950/95 px-2 py-1.5 text-[10px] text-white shadow-xl group-hover:block">
                              <div className="font-bold">
                                {b.batchId} · {b.reactorId}
                              </div>
                              <div className="text-ink-300">
                                {b.apiName} · S{b.stageNo} · #{b.batchNo}
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
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </Card>

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

function monthForBand(qStart: number, qEnd: number): string {
  const a = FY_WEEKS[qStart].start;
  const b = FY_WEEKS[Math.min(qEnd - 1, FY_WEEKS.length - 1)].start;
  return `${a.toLocaleString("en", { month: "short" })}–${b.toLocaleString("en", { month: "short" })}`;
}

function classColor(cls: Reactor["reactorClass"]): string {
  if (cls === "Small") return "#00f0ff";
  if (cls === "Medium") return "#a78bfa";
  return "#f472b6";
}

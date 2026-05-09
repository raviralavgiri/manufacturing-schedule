import { useMemo, useState, useRef, useLayoutEffect } from "react";
import { Search, Filter, AlertTriangle, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader, Tag } from "../components/Primitives";
import ExportMenu from "../components/ExportMenu";
import { fmtDate, fmtDateTime } from "../utils/dates";
import {
  downloadCsv,
  downloadElementAsPng,
  fileStamp,
  printPage,
} from "../utils/exporters";

const ROW_H = 40;

// Grid template for the Schedule table.
//   Batch ID | API | Stage | # | Reactor Pool | Start | End | Analysis End | Clash | Out
// Batch ID is shown for traceability — useful when cross-referencing
// CSV/Excel exports or discussing a specific batch with a colleague.
const GRID_TEMPLATE = "130px 72px 120px 70px 240px 180px 180px 180px 60px 72px";

export default function ScheduleTab() {
  const schedule = useStore((s) => s.schedule);
  const apisRaw = useStore((s) => s.apis);
  const reactors = useStore((s) => s.reactors);
  const planWindow = useStore((s) => s.window);
  const forceRecompute = useStore((s) => s.forceRecompute);
  const isRecomputing = useStore((s) => s.isRecomputing);
  const apis = useMemo(
    () =>
      [...apisRaw].sort(
        (a, b) => a.id.localeCompare(b.id)
      ),
    [apisRaw]
  );

  // Stage-id → reactor pool list (= the "loop" of eligible reactors). Lets
  // each batch row show the pool that was configured on the Stage tab,
  // alongside the actually-assigned reactor.
  const stagePoolById = useMemo(() => {
    const m = new Map<string, string[]>();
    apisRaw.forEach((a) =>
      a.stages.forEach((s) => m.set(s.id, s.reactorPool))
    );
    return m;
  }, [apisRaw]);
  const [q, setQ] = useState("");
  const [apiFilter, setApiFilter] = useState<string>("ALL");
  const [reactorFilter, setReactorFilter] = useState<string>("ALL");
  // Stage filter: matches a batch's stageId. We provide one option per
  // distinct stageId across all APIs (e.g. "API-01-S2", "API-02-S1"…).
  const [stageFilter, setStageFilter] = useState<string>("ALL");

  const filtered = useMemo(() => {
    return schedule.batches.filter((b) => {
      if (apiFilter !== "ALL" && b.apiId !== apiFilter) return false;
      if (reactorFilter !== "ALL" && !b.reactorIds.includes(reactorFilter))
        return false;
      if (stageFilter !== "ALL" && b.stageId !== stageFilter) return false;
      if (q) {
        const lower = q.toLowerCase();
        if (
          !b.batchId.toLowerCase().includes(lower) &&
          !b.apiName.toLowerCase().includes(lower) &&
          !b.stageName.toLowerCase().includes(lower) &&
          !b.reactorId.toLowerCase().includes(lower)
        )
          return false;
      }
      return true;
    });
  }, [schedule.batches, q, apiFilter, reactorFilter, stageFilter]);

  // Distinct stage options for the filter dropdown — sorted by api id then
  // stage no for predictability. Label combines the api id and stage label
  // so "API-01 · S2 · Intermediate-2" is unambiguous.
  const stageOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    apisRaw
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((a) => {
        a.stages
          .slice()
          .sort((x, y) => x.stageNo - y.stageNo)
          .forEach((s) => {
            out.push({
              value: s.id,
              label: `${a.id} · S${s.stageNo} · ${s.stageName}`,
            });
          });
      });
    return out;
  }, [apisRaw]);

  // Simple windowed virtualization
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(640);

  useLayoutEffect(() => {
    if (scrollRef.current) {
      setViewportH(scrollRef.current.clientHeight);
    }
  }, []);

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - 8);
  const endIdx = Math.min(
    filtered.length,
    Math.ceil((scrollTop + viewportH) / ROW_H) + 8
  );
  const visible = filtered.slice(startIdx, endIdx);

  const tableCardRef = useRef<HTMLDivElement>(null);

  function exportCsv() {
    downloadCsv(
      `schedule_${filtered.length}rows_${fileStamp()}.csv`,
      [
        "Batch ID",
        "API ID",
        "API Name",
        "Stage",
        "Stage Name",
        "Batch #",
        "Reactor ID",
        "Reactor Name",
        "Reactor Pool",
        "Start",
        "End (cycle)",
        "Analysis End",
        "FY",
        "Clash",
        "Input kg",
        "Output kg",
      ],
      filtered.map((b) => [
        b.batchId,
        b.apiId,
        b.apiName,
        `Stage ${b.stageNo}`,
        b.stageName,
        b.batchNo,
        b.reactorIds.join(" + "),
        b.reactorIds
          .map((id) => reactors.find((x) => x.id === id)?.name ?? id)
          .join(" + "),
        (stagePoolById.get(b.stageId) ?? [])
          .map((id) => reactors.find((x) => x.id === id)?.name ?? id)
          .join(" | "),
        fmtDateTime(b.startMs),
        fmtDateTime(b.endMs),
        fmtDateTime(b.analysisEndMs),
        b.inFY ? "FY" : "Ovr",
        b.clash ? "CLASH" : "OK",
        b.inputKg,
        b.outputKg,
      ])
    );
  }

  // Detect batches whose start is BEFORE the global plan window OR whose
  // cycle ends AFTER it. If any exist, the schedule is stale relative to
  // the current window and the user should recompute.
  const outOfRange = useMemo(() => {
    const before: number[] = [];
    const after: number[] = [];
    for (const b of schedule.batches) {
      if (b.startMs < planWindow.startMs) before.push(b.startMs);
      if (b.endMs > planWindow.endMs) after.push(b.endMs);
    }
    return {
      beforeCount: before.length,
      afterCount: after.length,
      earliestBefore: before.length > 0 ? Math.min(...before) : null,
      latestAfter: after.length > 0 ? Math.max(...after) : null,
    };
  }, [schedule.batches, planWindow]);

  const hasStaleData =
    outOfRange.beforeCount > 0 || outOfRange.afterCount > 0;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Schedule"
        subtitle={`${filtered.length.toLocaleString()} batches · Plan window: ${fmtDate(planWindow.startMs)} → ${fmtDate(planWindow.endMs)}`}
        right={
          <ExportMenu
            onCsv={exportCsv}
            onPng={async () => {
              await downloadElementAsPng(
                tableCardRef.current,
                `schedule_${filtered.length}rows_${fileStamp()}.png`,
                { backgroundColor: "#04081a", pixelRatio: 2 }
              );
            }}
            onPrint={() => printPage()}
          />
        }
      />

      {hasStaleData && (
        <div
          data-export-skip="true"
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/40 bg-amber-300/10 px-4 py-3 text-xs"
        >
          <AlertTriangle size={16} className="text-amber-300" />
          <div className="flex-1 text-amber-200">
            <span className="font-bold">Schedule is out of plan window.</span>{" "}
            {outOfRange.beforeCount > 0 && (
              <span>
                {outOfRange.beforeCount.toLocaleString()} batches start{" "}
                <span className="font-mono">
                  before {fmtDate(planWindow.startMs)}
                </span>
                {outOfRange.earliestBefore !== null && (
                  <>
                    {" "}(earliest:{" "}
                    <span className="font-mono">
                      {fmtDate(outOfRange.earliestBefore)}
                    </span>
                    )
                  </>
                )}
                .
              </span>
            )}
            {outOfRange.afterCount > 0 && (
              <span>
                {" "}
                {outOfRange.afterCount.toLocaleString()} batches finish{" "}
                <span className="font-mono">
                  after {fmtDate(planWindow.endMs)}
                </span>
                {outOfRange.latestAfter !== null && (
                  <>
                    {" "}(latest:{" "}
                    <span className="font-mono">
                      {fmtDate(outOfRange.latestAfter)}
                    </span>
                    )
                  </>
                )}
                .
              </span>
            )}{" "}
            Click <span className="font-bold">Recompute</span> to rebuild
            the schedule with the current plan window.
          </div>
          <button
            onClick={() => forceRecompute()}
            disabled={isRecomputing}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition",
              isRecomputing
                ? "border-white/10 bg-white/5 text-ink-300"
                : "border-amber-300/40 bg-amber-300/15 text-amber-200 hover:bg-amber-300/25"
            )}
          >
            <RefreshCw
              size={13}
              className={isRecomputing ? "animate-spin" : ""}
            />
            {isRecomputing ? "Recomputing…" : "Recompute"}
          </button>
        </div>
      )}

      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search batch / API / reactor"
              className="w-72 rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder-ink-400 outline-none focus:border-cyan-300/50"
            />
          </div>
          <FilterDropdown
            label="API"
            value={apiFilter}
            onChange={setApiFilter}
            options={[
              { v: "ALL", l: "All APIs" },
              ...apis.map((a) => ({
                v: a.id,
                l: a.name === a.id ? a.id : `${a.name} (${a.id})`,
              })),
            ]}
          />
          <FilterDropdown
            label="Reactor"
            value={reactorFilter}
            onChange={setReactorFilter}
            options={[
              { v: "ALL", l: "All Reactors" },
              ...reactors.map((r) => ({
                v: r.id,
                l: r.name === r.id ? r.id : `${r.name} (${r.id})`,
              })),
            ]}
          />
          <FilterDropdown
            label="Stage"
            value={stageFilter}
            onChange={setStageFilter}
            options={[
              { v: "ALL", l: "All Stages" },
              ...stageOptions.map((s) => ({ v: s.value, l: s.label })),
            ]}
          />
          <span className="ml-auto text-xs text-ink-300">
            Showing {filtered.length.toLocaleString()} /{" "}
            {schedule.batches.length.toLocaleString()}
          </span>
        </div>
      </Card>

      <div ref={tableCardRef} className="schedule-table-card">
      <Card className="overflow-hidden p-0">
        <div
          className="grid gap-0 border-b border-white/10 bg-ink-900/80 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-300"
          style={{ gridTemplateColumns: GRID_TEMPLATE }}
        >
          <span title="Stable internal identifier for this specific batch — used in CSV/Excel exports and for cross-referencing.">
            Batch ID
          </span>
          <span>API</span>
          <span>Stage</span>
          <span>#</span>
          <span title="Reactors this batch is booked on (first one is the primary reactor).">
            Reactor Pool
          </span>
          <span>Start</span>
          <span>End (Cycle)</span>
          <span>Analysis End</span>
          <span className="text-center">Clash</span>
          <span className="text-right">Out kg</span>
        </div>
        <div
          ref={scrollRef}
          className="relative max-h-[62vh] overflow-auto"
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        >
          <div
            style={{ height: filtered.length * ROW_H, position: "relative" }}
          >
            <div style={{ position: "absolute", top: startIdx * ROW_H, left: 0, right: 0 }}>
              {visible.map((b) => {
                const pool = stagePoolById.get(b.stageId) ?? [];
                const poolLabel = pool
                  .map((id) => reactors.find((x) => x.id === id)?.name ?? id)
                  .join(", ");
                return (
                <div
                  key={b.batchId}
                  style={{
                    height: ROW_H,
                    gridTemplateColumns: GRID_TEMPLATE,
                  }}
                  className="grid items-center gap-0 border-b border-white/5 px-3 text-xs hover:bg-white/[0.04]"
                >
                  <span
                    className="font-mono text-[11px] text-ink-200 truncate"
                    title={b.batchId}
                  >
                    {b.batchId}
                  </span>
                  <span
                    className="flex items-center gap-1.5 font-semibold text-white truncate"
                    title={b.apiName}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background: b.apiColor,
                        boxShadow: `0 0 6px ${b.apiColor}80`,
                      }}
                    />
                    {b.apiName}
                  </span>
                  <span className="text-ink-200 truncate">
                    S{b.stageNo} · {b.stageName}
                  </span>
                  <span className="font-mono text-ink-300">{b.batchNo}</span>
                  {(() => {
                    // Resolve booked vs configured pool, plus detect
                    // SUBSTITUTION = when a booked reactor wasn't in the
                    // stage's configured pool (the scheduler grabbed a
                    // like-for-like spare). We surface that explicitly so
                    // users don't wonder why some rows show 2 reactors and
                    // others show 3 in the same stage.
                    const poolSet = new Set(pool);
                    const nameOf = (id: string) =>
                      reactors.find((x) => x.id === id)?.name ?? id;
                    const bookedNames = b.reactorIds.map(nameOf);
                    const poolNames = pool.map(nameOf);
                    const isSubstituted = b.reactorIds.some(
                      (id) => !poolSet.has(id)
                    );
                    const tooltip = isSubstituted
                      ? `Booked: ${bookedNames.join(" + ") || "—"} (substituted — not in configured pool) · Configured pool: ${poolLabel || "(empty)"}`
                      : `Booked: ${bookedNames.join(" + ") || "—"} · Configured pool: ${poolLabel || "(empty)"}`;
                    if (bookedNames.length === 0 && poolNames.length === 0) {
                      return (
                        <span
                          className="font-mono text-[11px] text-ink-500 truncate"
                          title={tooltip}
                        >
                          —
                        </span>
                      );
                    }
                    return (
                      <span
                        className="flex items-center gap-1.5 truncate font-mono text-[11px] text-violet-200"
                        title={tooltip}
                      >
                        <span className="shrink-0 font-semibold text-cyan-300">
                          {bookedNames.join(" + ") || "—"}
                        </span>
                        {isSubstituted && (
                          <span
                            className="shrink-0 rounded-full border border-amber-300/40 bg-amber-300/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-amber-300"
                            title="Substituted: this reactor is not in the stage's configured pool — the scheduler picked a like-for-like spare because the configured reactors were all busy."
                          >
                            sub
                          </span>
                        )}
                        {poolNames.length > 0 && (
                          <>
                            <span className="shrink-0 text-ink-500">·</span>
                            <span className="truncate">
                              {poolNames.join(", ")}
                            </span>
                          </>
                        )}
                      </span>
                    );
                  })()}
                  <span className="font-mono text-ink-200 truncate">
                    {fmtDateTime(b.startMs)}
                  </span>
                  <span className="font-mono text-ink-200 truncate">
                    {fmtDateTime(b.endMs)}
                  </span>
                  <span className="font-mono text-ink-300 truncate">
                    {fmtDateTime(b.analysisEndMs)}
                  </span>
                  <span className="text-center">
                    {b.clash ? (
                      <Tag tone="rose">CLASH</Tag>
                    ) : (
                      <Tag tone="default">OK</Tag>
                    )}
                  </span>
                  <span
                    className="text-right font-mono font-semibold tabular-nums text-white"
                    title={`Exact: ${b.outputKg.toFixed(2)} kg`}
                  >
                    {Math.round(b.outputKg).toLocaleString()}
                  </span>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      </Card>
      </div>
    </div>
  );
}

function FilterDropdown({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs">
      <span className="text-ink-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent font-semibold text-white outline-none"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v} className="bg-ink-900">
            {o.l}
          </option>
        ))}
      </select>
    </label>
  );
}

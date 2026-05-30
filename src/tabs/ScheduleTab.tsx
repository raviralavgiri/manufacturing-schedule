import { useMemo, useState, useRef, useLayoutEffect } from "react";
import {
  Search,
  AlertTriangle,
  RefreshCw,
  Filter,
  FlaskConical,
  Layers,
  Beaker,
  Tags,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader, Tag } from "../components/Primitives";
import MultiSelectPopover, {
  ClearFiltersButton,
  type Option as MsOption,
} from "../components/MultiSelectPopover";
import { buildStageKindMap } from "../utils/stageKind";
import { fmtDate, fmtDateTime } from "../utils/dates";

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
  // stageId → IM/API classification (smart-defaulted).
  const stageKindById = useMemo(() => buildStageKindMap(apisRaw), [apisRaw]);
  const [q, setQ] = useState("");
  // Multi-select filters — empty Set means "all" (no filter), matching the
  // Gantt tab's MultiSelectPopover convention.
  const [apiFilter, setApiFilter] = useState<Set<string>>(new Set());
  const [reactorFilter, setReactorFilter] = useState<Set<string>>(new Set());
  const [stageFilter, setStageFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const anyFilterActive =
    apiFilter.size > 0 ||
    reactorFilter.size > 0 ||
    stageFilter.size > 0 ||
    typeFilter.size > 0 ||
    q.trim() !== "";

  const filtered = useMemo(() => {
    return schedule.batches.filter((b) => {
      if (apiFilter.size > 0 && !apiFilter.has(b.apiId)) return false;
      if (
        reactorFilter.size > 0 &&
        !b.reactorIds.some((rid) => reactorFilter.has(rid))
      )
        return false;
      if (stageFilter.size > 0 && !stageFilter.has(b.stageId)) return false;
      if (
        typeFilter.size > 0 &&
        !typeFilter.has(stageKindById.get(b.stageId) ?? "")
      )
        return false;
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
  }, [
    schedule.batches,
    q,
    apiFilter,
    reactorFilter,
    stageFilter,
    typeFilter,
    stageKindById,
  ]);

  const typeOptions: MsOption[] = useMemo(
    () => [
      { value: "IM", label: "IM · Intermediate" },
      { value: "API", label: "API · Final product" },
    ],
    []
  );

  // Filter option lists (multi-select popovers).
  const apiOptions: MsOption[] = useMemo(
    () =>
      apis.map((a) => ({
        value: a.id,
        label: a.name === a.id ? a.id : a.name,
        color: a.color,
      })),
    [apis]
  );

  // One option per distinct stageId, grouped + coloured by API.
  const stageOptions: MsOption[] = useMemo(() => {
    const out: MsOption[] = [];
    apis.forEach((a) =>
      a.stages
        .slice()
        .sort((x, y) => x.stageNo - y.stageNo)
        .forEach((s) =>
          out.push({
            value: s.id,
            label: `S${s.stageNo} · ${s.stageName}`,
            secondary: a.name,
            group: a.name,
            color: a.color,
          })
        )
    );
    return out;
  }, [apis]);

  const reactorOptions: MsOption[] = useMemo(
    () =>
      reactors.map((r) => ({
        value: r.id,
        label: r.name,
        group: r.moc,
      })),
    [reactors]
  );

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

      <Card className="!p-3 relative z-20">
        <div className="flex flex-wrap items-center gap-2">
          <span className="ml-1 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400">
            <Filter size={12} /> Filter
          </span>
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search batch / API / reactor"
              className="w-60 rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-8 text-sm text-white placeholder-ink-400 outline-none focus:border-cyan-300/50"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>
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
            width={300}
          />
          <MultiSelectPopover
            label="Reactors"
            icon={<Beaker size={12} />}
            options={reactorOptions}
            selected={reactorFilter}
            onChange={setReactorFilter}
            width={260}
          />
          <MultiSelectPopover
            label="Type"
            icon={<Tags size={12} />}
            options={typeOptions}
            selected={typeFilter}
            onChange={setTypeFilter}
            width={220}
            searchable={false}
          />
          <ClearFiltersButton
            active={anyFilterActive}
            onClear={() => {
              setApiFilter(new Set());
              setStageFilter(new Set());
              setReactorFilter(new Set());
              setTypeFilter(new Set());
              setQ("");
            }}
          />
          <span className="ml-auto text-xs text-ink-300">
            Showing {filtered.length.toLocaleString()} /{" "}
            {schedule.batches.length.toLocaleString()}
          </span>
        </div>
      </Card>

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
                  <span className="flex items-center gap-1.5 text-ink-200 truncate">
                    {(() => {
                      const kind = stageKindById.get(b.stageId);
                      if (!kind) return null;
                      return (
                        <span
                          className={clsx(
                            "shrink-0 rounded px-1 py-px text-[9px] font-bold",
                            kind === "API"
                              ? "bg-lime-300/15 text-lime-300"
                              : "bg-cyan-300/15 text-cyan-300"
                          )}
                          title={
                            kind === "API"
                              ? "Final API / product stage"
                              : "Intermediate stage"
                          }
                        >
                          {kind}
                        </span>
                      );
                    })()}
                    <span className="truncate">
                      S{b.stageNo} · {b.stageName}
                    </span>
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
                        className="flex items-center gap-1.5 truncate font-mono text-[11px] text-cyan-300"
                        title={tooltip}
                      >
                        {/* Train model: the booked reactors ARE the whole pool,
                            so we show just the booked train (no redundant pool
                            list). The configured pool stays in the tooltip. */}
                        <span className="truncate font-semibold">
                          {bookedNames.join(" + ") || "—"}
                        </span>
                        {isSubstituted && (
                          <span
                            className="shrink-0 rounded-full border border-amber-300/40 bg-amber-300/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-amber-300"
                            title="Substituted: one or more reactors are not in the stage's configured pool — the scheduler picked a like-for-like spare because a configured reactor was busy."
                          >
                            sub
                          </span>
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
  );
}

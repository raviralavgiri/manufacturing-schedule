import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  RotateCcw,
  Plus,
  Trash2,
  Pencil,
  Search,
  Lock,
  ChevronDown,
  ChevronRight,
  GitMerge,
  Workflow,
  GitBranch,
} from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader } from "../components/Primitives";
import { fmtIsoDate, parseIsoDate } from "../utils/dates";
import type { ApiTopology } from "../types";
import ParallelTopologyEditor from "../components/ParallelTopologyEditor";
import SideChainsTopologyEditor from "../components/SideChainsTopologyEditor";

/**
 * APIs tab — high-level "what we want to make" view.
 * One row per API, with the few inputs that drive the schedule:
 *   - API Name        (editable display label)
 *   - Plan Window     (per-API start/end date inputs)
 *   - Stages          (1–24)
 *   - Target Output   (kg; edits the FINAL stage's plannedBatches)
 *
 * For per-stage details (reactor pool, BCF/BCT/Process, etc.) use the
 * Stages tab.
 */
export default function ApisTab() {
  const apis = useStore((s) => s.apis);
  const setApiName = useStore((s) => s.setApiName);
  const setApiTargetOutput = useStore((s) => s.setApiTargetOutput);
  const setApiWindow = useStore((s) => s.setApiWindow);
  const setApiStageCount = useStore((s) => s.setApiStageCount);
  const applyTopologyPreset = useStore((s) => s.applyTopologyPreset);
  const addAPI = useStore((s) => s.addAPI);
  const removeAPI = useStore((s) => s.removeAPI);
  const resetToSeed = useStore((s) => s.resetToSeed);
  const hasPersistedChanges = useStore((s) => s.hasPersistedChanges);

  const [q, setQ] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [recentlyAddedApiId, setRecentlyAddedApiId] = useState<string | null>(
    null
  );
  const newRowRef = useRef<HTMLTableRowElement>(null);

  // Per-API state for the inline topology spec panel:
  //   - `expandedApiId` is the API whose panel is currently OPEN (only one
  //     at a time to keep the UI focused).
  //   - `pendingKindByApi` is the dropdown's selection, which can drift
  //     from `api.topology` until the user clicks "Apply" on the panel.
  const [expandedApiId, setExpandedApiId] = useState<string | null>(null);
  const [pendingKindByApi, setPendingKindByApi] = useState<
    Record<string, ApiTopology>
  >({});

  const sortedApis = useMemo(
    () => [...apis].sort((a, b) => a.id.localeCompare(b.id)),
    [apis]
  );

  const filteredApis = useMemo(() => {
    if (!q) return sortedApis;
    const lower = q.toLowerCase();
    return sortedApis.filter(
      (a) =>
        a.id.toLowerCase().includes(lower) ||
        a.name.toLowerCase().includes(lower)
    );
  }, [sortedApis, q]);

  // Per-API derived numbers
  const enriched = useMemo(
    () =>
      filteredApis.map((api) => {
        const finalStage =
          api.stages.length > 0
            ? api.stages.reduce((acc, s) =>
                s.stageNo > acc.stageNo ? s : acc
              )
            : null;
        const actualOutputKg = finalStage
          ? finalStage.batchSizeKg * finalStage.plannedBatches
          : 0;
        return {
          api,
          finalStage,
          actualOutputKg,
          plannedBatchesAcrossStages: api.stages.reduce(
            (acc, s) => acc + s.plannedBatches,
            0
          ),
        };
      }),
    [filteredApis]
  );

  // Auto-scroll to + flash newly-added row
  useEffect(() => {
    if (!recentlyAddedApiId) return;
    const t1 = window.setTimeout(() => {
      newRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    const t2 = window.setTimeout(() => setRecentlyAddedApiId(null), 3500);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [recentlyAddedApiId]);

  const totalKg = apis.reduce(
    (acc, a) =>
      acc +
      (a.stages.length > 0
        ? a.stages.reduce((s, st) => s + st.plannedBatches * st.batchSizeKg, 0)
        : 0),
    0
  );

  return (
    <div className="space-y-4">
      <SectionHeader
        title="APIs"
        subtitle={`${apis.length} APIs · ${(totalKg / 1000).toFixed(1)}t total projected output. Edit name, plan window, stages, and target qty here. Stage-level details live in the Stages tab.`}
        right={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search APIs…"
                className="w-56 rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder-ink-400 outline-none focus:border-cyan-300/50"
              />
            </div>
            <button
              onClick={() => {
                const id = addAPI(true);
                setRecentlyAddedApiId(id);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/30 bg-gradient-to-r from-cyan-400/20 to-violet-400/20 px-3 py-2 text-xs font-bold text-white transition hover:from-cyan-400/30 hover:to-violet-400/30 hover:shadow-glow"
            >
              <Plus size={13} /> Add API
            </button>
            {confirmReset ? (
              <div className="inline-flex items-center gap-1 rounded-lg border border-rose-300/40 bg-rose-400/10 px-2 py-1.5">
                <span className="text-[10px] font-semibold text-rose-300">
                  Discard local changes?
                </span>
                <button
                  onClick={() => {
                    resetToSeed();
                    setConfirmReset(false);
                  }}
                  className="rounded-md bg-rose-400/20 px-2 py-0.5 text-[10px] font-bold text-rose-200 hover:bg-rose-400/40"
                >
                  Yes
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-ink-200 hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() =>
                  hasPersistedChanges ? setConfirmReset(true) : resetToSeed()
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-ink-200 transition hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-cyan-300"
              >
                <RotateCcw size={13} /> Reset
              </button>
            )}
          </div>
        }
      />

      <Card className="overflow-hidden p-0">
        <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-ink-900/90 backdrop-blur-md">
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-300">
                <Th yellow>API Name</Th>
                <Th yellow>Plan Window</Th>
                <Th align="right" yellow>
                  Stages
                </Th>
                <Th align="right" yellow>
                  Target (kg)
                </Th>
                <Th yellow title="Topology preset that scaffolds this API's stages. Linear chains stages 1→N. Parallel converges multiple sub-chains into a merge stage. Side chains add factor-driven sub-streams to a main backbone.">
                  Topology
                </Th>
                <Th align="right" locked>
                  Actual (kg)
                </Th>
                <Th align="right" locked>
                  Final Btc
                </Th>
                <Th align="right" locked>
                  Total Btc
                </Th>
                <Th align="right">&nbsp;</Th>
              </tr>
            </thead>
            <tbody>
              {enriched.map(
                ({ api, finalStage, actualOutputKg, plannedBatchesAcrossStages }, i) => {
                  const isNew = api.id === recentlyAddedApiId;
                  const isConfirming = api.id === confirmDeleteId;
                  const isParked = api.targetKg === 0;
                  const currentTopology: ApiTopology =
                    pendingKindByApi[api.id] ?? api.topology ?? "linear";
                  const isExpanded = expandedApiId === api.id;
                  return (
                    <Fragment key={api.id}>
                      <tr
                        ref={isNew ? newRowRef : undefined}
                        className={clsx(
                          "group border-t border-white/5 transition hover:bg-white/[0.04]",
                          i % 2 === 0 ? "bg-white/[0.01]" : "",
                          isNew && "row-flash",
                          isParked && "opacity-50"
                        )}
                        title={isParked ? "Target = 0 · this API is parked, no batches scheduled" : undefined}
                      >
                      <td className="px-3 py-2.5 font-semibold text-white">
                        <div className="flex items-start gap-2">
                          <span
                            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{
                              background: api.color,
                              boxShadow: `0 0 8px 0 ${api.color}80`,
                            }}
                          />
                          <div className="flex flex-1 flex-col gap-0.5">
                            <EditableTextCell
                              value={api.name}
                              onCommit={(v) => setApiName(api.id, v)}
                              placeholder={api.id}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <ApiWindowCell
                          startMs={api.window.startMs}
                          endMs={api.window.endMs}
                          onChange={(s, e) =>
                            setApiWindow(api.id, s, e)
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <EditableNumCell
                          value={api.stages.length}
                          min={1}
                          max={24}
                          width="w-20"
                          onChange={(v) => setApiStageCount(api.id, v)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {finalStage ? (
                          <EditableNumCell
                            value={api.targetKg}
                            min={0}
                            onChange={(v) => setApiTargetOutput(api.id, v)}
                          />
                        ) : (
                          <span className="text-[10px] text-ink-400">
                            — add a stage first —
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <TopologyCell
                          value={currentTopology}
                          appliedTopology={api.topology ?? "linear"}
                          isExpanded={isExpanded}
                          onSelect={(kind) => {
                            if (kind === "linear") {
                              applyTopologyPreset(api.id, { kind: "linear" });
                              setPendingKindByApi((p) => {
                                const c = { ...p };
                                delete c[api.id];
                                return c;
                              });
                              if (isExpanded) setExpandedApiId(null);
                            } else {
                              setPendingKindByApi((p) => ({
                                ...p,
                                [api.id]: kind,
                              }));
                              setExpandedApiId(api.id);
                            }
                          }}
                          onToggleExpand={() => {
                            setExpandedApiId(isExpanded ? null : api.id);
                          }}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-cyan-300">
                        {actualOutputKg.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink-200">
                        <span className="inline-flex items-center gap-1">
                          <Lock size={10} className="text-ink-500" />
                          {finalStage?.plannedBatches ?? 0}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink-200">
                        <span className="inline-flex items-center gap-1">
                          <Lock size={10} className="text-ink-500" />
                          {plannedBatchesAcrossStages}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        {isConfirming ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => {
                                removeAPI(api.id);
                                setConfirmDeleteId(null);
                              }}
                              className="rounded-md border border-rose-300/40 bg-rose-400/15 px-2 py-1 text-[10px] font-bold text-rose-300 hover:bg-rose-400/30"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-ink-200 hover:bg-white/10"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(api.id)}
                            className="rounded-md p-1.5 text-ink-400 opacity-0 transition group-hover:opacity-100 hover:bg-rose-400/15 hover:text-rose-300"
                            title="Delete API and all its stages"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                      </tr>
                      {isExpanded && currentTopology !== "linear" && (
                        <tr className="border-t border-white/5">
                          <td
                            colSpan={9}
                            className="bg-ink-900/40 px-3 py-3"
                          >
                            {currentTopology === "parallel" && (
                              <ParallelTopologyEditor
                                onApply={(spec) => {
                                  applyTopologyPreset(api.id, spec);
                                  setExpandedApiId(null);
                                  setPendingKindByApi((p) => {
                                    const c = { ...p };
                                    delete c[api.id];
                                    return c;
                                  });
                                }}
                                onCancel={() => {
                                  setExpandedApiId(null);
                                  setPendingKindByApi((p) => {
                                    const c = { ...p };
                                    delete c[api.id];
                                    return c;
                                  });
                                }}
                              />
                            )}
                            {currentTopology === "side_chains" && (
                              <SideChainsTopologyEditor
                                onApply={(spec) => {
                                  applyTopologyPreset(api.id, spec);
                                  setExpandedApiId(null);
                                  setPendingKindByApi((p) => {
                                    const c = { ...p };
                                    delete c[api.id];
                                    return c;
                                  });
                                }}
                                onCancel={() => {
                                  setExpandedApiId(null);
                                  setPendingKindByApi((p) => {
                                    const c = { ...p };
                                    delete c[api.id];
                                    return c;
                                  });
                                }}
                              />
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                }
              )}
              {filteredApis.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="py-12 text-center text-sm text-ink-300"
                  >
                    No APIs match. Click{" "}
                    <span className="font-bold text-cyan-300">+ Add API</span>{" "}
                    above to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-200">
          <span className="mr-1 font-bold">
            <Pencil size={12} className="inline" /> Editable here:
          </span>
          API Name, Plan Window (per-API start/end), Stages (1–24), Target
          Output. Each API's plan window is independent — batches cannot start
          before that API's Start Date; any batch finishing after its End
          Date is flagged "Ovr".
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-ink-300">
          <span className="mr-1 font-bold text-ink-100">
            <Lock size={11} className="inline" /> Cascade derives all batches:
          </span>
          <span className="font-mono text-cyan-300">
            final = ⌈ target ÷ batch ⌉
          </span>
          ; for each upstream stage,{" "}
          <span className="font-mono text-cyan-300">
            ⌈ next-stage actual output ÷ this stage's batch ⌉
          </span>
          .
        </div>
      </div>
    </div>
  );
}

function ApiWindowCell({
  startMs,
  endMs,
  onChange,
}: {
  startMs: number;
  endMs: number;
  onChange: (startMs: number, endMs: number) => void;
}) {
  const startIso = fmtIsoDate(startMs);
  const endIso = fmtIsoDate(endMs);
  return (
    <div className="flex items-center gap-1">
      <input
        type="date"
        value={startIso}
        max={endIso}
        onChange={(e) => {
          const next = parseIsoDate(e.target.value);
          if (Number.isFinite(next) && next < endMs) onChange(next, endMs);
        }}
        className="cell-yellow w-[130px] rounded-md px-2 py-1 font-mono text-[11px] tabular-nums transition"
        title="Plan window start (per-API)"
      />
      <span className="text-ink-400">→</span>
      <input
        type="date"
        value={endIso}
        min={startIso}
        onChange={(e) => {
          const next = parseIsoDate(e.target.value);
          if (Number.isFinite(next) && next > startMs) onChange(startMs, next);
        }}
        className="cell-yellow w-[130px] rounded-md px-2 py-1 font-mono text-[11px] tabular-nums transition"
        title="Plan window end (per-API)"
      />
    </div>
  );
}

function Th({
  children,
  align = "left",
  yellow,
  locked,
  title,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  yellow?: boolean;
  locked?: boolean;
  title?: string;
}) {
  return (
    <th
      title={title}
      className={clsx(
        "border-b border-white/10 px-3 py-2 font-semibold",
        align === "right" ? "text-right" : "text-left",
        yellow && "text-amber-300",
        locked && "text-ink-300"
      )}
    >
      <span className="inline-flex items-center gap-1">
        {yellow && (
          <span className="inline-block h-2 w-2 rounded-sm bg-amber-300/80" />
        )}
        {locked && <Lock size={10} className="opacity-60" />}
        {children}
      </span>
    </th>
  );
}

function EditableNumCell({
  value,
  onChange,
  min = 1,
  max,
  width = "w-28",
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  width?: string;
}) {
  // Local string state so the user can transit through empty / partial values
  // without our handler instantly clamping back. Commit on blur / Enter.
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);

  const commit = () => {
    const parsed = Number(local);
    if (!Number.isFinite(parsed)) {
      setLocal(String(value));
      return;
    }
    let v = Math.max(min, parsed);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onChange(v);
    setLocal(String(v));
  };

  return (
    <input
      type="number"
      value={local}
      min={min}
      max={max}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setLocal(String(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`cell-yellow ${width} rounded-md px-2 py-1 text-right font-mono text-sm tabular-nums transition`}
    />
  );
}

function TopologyCell({
  value,
  appliedTopology,
  isExpanded,
  onSelect,
  onToggleExpand,
}: {
  /** Current dropdown selection — may be a pending kind that hasn't yet
   *  been applied. When it differs from `appliedTopology` we show a
   *  small "draft" hint so the user knows to click "Apply" in the panel. */
  value: ApiTopology;
  /** What's actually persisted on the API row right now. */
  appliedTopology: ApiTopology;
  isExpanded: boolean;
  onSelect: (kind: ApiTopology) => void;
  onToggleExpand: () => void;
}) {
  const isDraft = value !== appliedTopology;
  // Which icon represents which topology — purely cosmetic, but consistent
  // with the editors and the StagesTab section header.
  const icon =
    value === "parallel" ? (
      <GitMerge size={12} className="text-violet-300" />
    ) : value === "side_chains" ? (
      <Workflow size={12} className="text-cyan-300" />
    ) : (
      <GitBranch size={12} className="text-ink-300" />
    );
  return (
    <div className="flex items-center gap-1.5">
      <span className="shrink-0">{icon}</span>
      <select
        value={value}
        onChange={(e) => onSelect(e.target.value as ApiTopology)}
        className={clsx(
          "rounded-md border bg-ink-900 px-2 py-1 font-mono text-[11px] text-white outline-none",
          isDraft
            ? "border-amber-300/50 focus:border-amber-300/80"
            : "border-white/10 focus:border-cyan-300/50"
        )}
        title={
          isDraft
            ? `Draft: "${value}". Click the chevron to open the spec panel and Apply.`
            : `Topology preset for this API. Linear is the default; Parallel converges sub-chains; Side chains add factor-driven sub-streams.`
        }
      >
        <option value="linear" className="bg-ink-900">
          Linear
        </option>
        <option value="parallel" className="bg-ink-900">
          Parallel
        </option>
        <option value="side_chains" className="bg-ink-900">
          Side chains
        </option>
      </select>
      {value !== "linear" && (
        <button
          type="button"
          onClick={onToggleExpand}
          title={isExpanded ? "Collapse spec panel" : "Open spec panel"}
          className="rounded-md border border-white/10 bg-white/5 p-1 text-ink-200 hover:bg-white/10"
        >
          {isExpanded ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
        </button>
      )}
      {isDraft && (
        <span
          className="rounded-md border border-amber-300/40 bg-amber-300/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-amber-300"
          title="The dropdown selection differs from what's applied. Open the panel and click Apply to commit."
        >
          Draft
        </span>
      )}
    </div>
  );
}

function EditableTextCell({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      type="text"
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local.trim() && local !== value) onCommit(local);
        else setLocal(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setLocal(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="cell-yellow w-full max-w-[200px] rounded-md px-2 py-1 text-left font-mono text-xs transition"
    />
  );
}

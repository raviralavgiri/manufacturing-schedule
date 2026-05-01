import { useEffect, useMemo, useRef, useState } from "react";
import { Search, RotateCcw, Pencil, Plus, Trash2, Save, Lock } from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader, Tag } from "../components/Primitives";
import AddStageForm from "../components/AddStageForm";
import PriorityPill from "../components/PriorityPill";
import ReactorPoolEditor from "../components/ReactorPoolEditor";
import type { Priority, StageMaster } from "../types";

export default function MasterDataTab() {
  const apis = useStore((s) => s.apis);
  const reactors = useStore((s) => s.reactors);
  const updateStageField = useStore((s) => s.updateStageField);
  const setStageOutput = useStore((s) => s.setStageOutput);
  const setStageName = useStore((s) => s.setStageName);
  const setStageReactorPool = useStore((s) => s.setStageReactorPool);
  const setApiPriority = useStore((s) => s.setApiPriority);
  const removeStage = useStore((s) => s.removeStage);
  const resetToSeed = useStore((s) => s.resetToSeed);
  const recentlyAddedStageId = useStore((s) => s.recentlyAddedStageId);
  const clearRecentlyAdded = useStore((s) => s.clearRecentlyAdded);
  const hasPersistedChanges = useStore((s) => s.hasPersistedChanges);

  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const newRowRef = useRef<HTMLTableRowElement>(null);

  const sortedApis = useMemo(
    () =>
      [...apis].sort(
        (a, b) => a.priority - b.priority || a.id.localeCompare(b.id)
      ),
    [apis]
  );

  const rows = useMemo(() => {
    const all: (StageMaster & { color: string; priority: Priority })[] = [];
    sortedApis.forEach((a) =>
      a.stages.forEach((s) =>
        all.push({ ...s, color: a.color, priority: a.priority })
      )
    );
    if (!q) return all;
    const lower = q.toLowerCase();
    return all.filter(
      (r) =>
        r.apiId.toLowerCase().includes(lower) ||
        r.stageName.toLowerCase().includes(lower) ||
        r.id.toLowerCase().includes(lower)
    );
  }, [sortedApis, q]);

  const totalProjection = apis.reduce((acc, a) => acc + a.projectionKg, 0);
  const totalBatches = apis.reduce(
    (acc, a) => acc + a.stages.reduce((b, s) => b + s.plannedBatches, 0),
    0
  );

  useEffect(() => {
    if (!recentlyAddedStageId) return;
    const t1 = window.setTimeout(() => {
      newRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    const t2 = window.setTimeout(() => {
      clearRecentlyAdded();
    }, 3500);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [recentlyAddedStageId, clearRecentlyAdded]);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Master Data"
        subtitle={`Editable template — ${apis.length} APIs across ${rows.length} stages. Yellow cells are inputs.`}
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
                placeholder="Search API / stage…"
                className="w-64 rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder-ink-400 outline-none focus:border-cyan-300/50 focus:bg-white/8"
              />
            </div>
            <button
              onClick={() => setShowForm((v) => !v)}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition",
                showForm
                  ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-200"
                  : "border-cyan-300/30 bg-gradient-to-r from-cyan-400/20 to-violet-400/20 text-white hover:from-cyan-400/30 hover:to-violet-400/30 hover:shadow-glow"
              )}
            >
              <Plus size={13} /> {showForm ? "Close" : "Add Stage"}
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
                title={
                  hasPersistedChanges
                    ? "Reset to seed - clears localStorage"
                    : "Already at seed values"
                }
              >
                <RotateCcw size={13} /> Reset
              </button>
            )}
          </div>
        }
      />

      {showForm && (
        <AddStageForm
          onCancel={() => setShowForm(false)}
          onAdded={() => setShowForm(false)}
        />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPI label="APIs" value={apis.length} />
        <KPI label="Stages" value={rows.length} />
        <KPI label="Planned Batches" value={totalBatches} />
        <KPI
          label="Projected Output"
          value={`${(totalProjection / 1000).toFixed(1)}t`}
        />
      </div>

      {hasPersistedChanges && (
        <div className="flex items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/5 px-3 py-2 text-xs text-cyan-200">
          <Save size={12} className="text-cyan-300" />
          <span>
            <span className="font-bold">Saved locally.</span> Edits persist in
            this browser; cloud sync runs if Supabase is configured. Click{" "}
            <span className="font-bold">Reset</span> to discard and return to
            the seed.
          </span>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-ink-900/90 backdrop-blur-md">
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-300">
                <Th>API</Th>
                <Th>Stage</Th>
                <Th yellow>Stage Name</Th>
                <Th yellow>Reactor Pool</Th>
                <Th align="right" yellow>
                  Batch Size (kg)
                </Th>
                <Th align="right" yellow>
                  Cycle (h)
                </Th>
                <Th align="right" yellow>
                  Analysis (h)
                </Th>
                <Th align="right" yellow>
                  Output Target (kg)
                </Th>
                <Th align="right" locked>
                  Planned Batches
                </Th>
                <Th align="right" locked>
                  Actual Output (kg)
                </Th>
                <Th align="right">&nbsp;</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const actualOutput = r.batchSizeKg * r.plannedBatches;
                const isNew = r.id === recentlyAddedStageId;
                const isConfirming = r.id === confirmDeleteId;
                const targetOutput = actualOutput;
                return (
                  <tr
                    key={r.id}
                    ref={isNew ? newRowRef : undefined}
                    className={clsx(
                      "group border-t border-white/5 transition hover:bg-white/[0.04]",
                      i % 2 === 0 ? "bg-white/[0.01]" : "",
                      isNew && "row-flash"
                    )}
                  >
                    <td className="px-3 py-2.5 font-semibold text-white">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{
                            background: r.color,
                            boxShadow: `0 0 8px 0 ${r.color}80`,
                          }}
                        />
                        <span>{r.apiId}</span>
                        <PriorityPill
                          value={r.priority}
                          onChange={(p) => setApiPriority(r.apiId, p)}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-ink-100">S{r.stageNo}</td>
                    <td className="px-3 py-2 text-left">
                      <EditableTextCell
                        value={r.stageName}
                        onCommit={(v) => setStageName(r.id, v)}
                      />
                    </td>
                    <td className="px-3 py-2 text-left">
                      <ReactorPoolEditor
                        value={r.reactorPool}
                        reactors={reactors}
                        onChange={(pool) => setStageReactorPool(r.id, pool)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <EditableNumCell
                        value={r.batchSizeKg}
                        onChange={(v) =>
                          updateStageField(r.id, "batchSizeKg", v)
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <EditableNumCell
                        value={r.cycleHours}
                        onChange={(v) =>
                          updateStageField(r.id, "cycleHours", v)
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <EditableNumCell
                        value={r.analysisHours}
                        onChange={(v) =>
                          updateStageField(r.id, "analysisHours", v)
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <EditableNumCell
                        value={targetOutput}
                        onChange={(v) => setStageOutput(r.id, v)}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-ink-200">
                      <span className="inline-flex items-center gap-1">
                        <Lock size={10} className="text-ink-500" />
                        {r.plannedBatches}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-cyan-300">
                      {actualOutput.toLocaleString()}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {isConfirming ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => {
                              removeStage(r.id);
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
                          onClick={() => setConfirmDeleteId(r.id)}
                          className="rounded-md p-1.5 text-ink-400 opacity-0 transition group-hover:opacity-100 hover:bg-rose-400/15 hover:text-rose-300"
                          title="Delete stage"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={11}
                    className="py-12 text-center text-sm text-ink-300"
                  >
                    No stages match. Click{" "}
                    <span className="font-bold text-cyan-300">+ Add Stage</span>{" "}
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
            <Pencil size={12} className="inline" /> Editable:
          </span>
          Stage Name, Reactor Pool, Batch Size, Cycle, Analysis, Output Target.
          Type a new value (or click Reactor Pool to open the chip editor).
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-ink-300">
          <span className="mr-1 font-bold text-ink-100">
            <Lock size={11} className="inline" /> Derived:
          </span>
          <span className="font-mono text-cyan-300">
            Planned Batches = ⌈ Output Target ÷ Batch Size ⌉
          </span>
          . Actual Output = Planned × Batch Size (rounded up to whole batches).
        </div>
      </div>
    </div>
  );
}

function Th({
  children,
  align = "left",
  yellow,
  locked,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  yellow?: boolean;
  locked?: boolean;
}) {
  return (
    <th
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
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={1}
      onChange={(e) => onChange(Number(e.target.value) || 1)}
      className="cell-yellow w-24 rounded-md px-2 py-1 text-right font-mono text-sm tabular-nums transition"
    />
  );
}

function EditableTextCell({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      type="text"
      value={local}
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
      className="cell-yellow w-full max-w-[180px] rounded-md px-2 py-1 text-left font-mono text-xs transition"
    />
  );
}

function KPI({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="!p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-ink-400">
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-white">
        {value}
      </div>
    </Card>
  );
}

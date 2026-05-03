import { useEffect, useMemo, useRef, useState } from "react";
import {
  RotateCcw,
  Plus,
  Trash2,
  Pencil,
  Save,
  Search,
  Lock,
  CalendarRange,
} from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader, Tag } from "../components/Primitives";
import PriorityPill from "../components/PriorityPill";
import { fmtIsoDate, parseIsoDate } from "../utils/dates";
import type { API, Priority } from "../types";

/**
 * APIs tab — high-level "what we want to make" view.
 * One row per API, with the few inputs that drive the schedule:
 *   - API Name        (editable display label)
 *   - Priority        (P1..P5 dropdown)
 *   - Target Output   (kg; edits the FINAL stage's plannedBatches)
 *
 * For per-stage details (reactor pool, cycle/analysis hours, batch size, ...)
 * use the Stages tab.
 */
export default function ApisTab() {
  const apis = useStore((s) => s.apis);
  const setApiName = useStore((s) => s.setApiName);
  const setApiPriority = useStore((s) => s.setApiPriority);
  const setApiTargetOutput = useStore((s) => s.setApiTargetOutput);
  const planWindow = useStore((s) => s.window);
  const setWindow = useStore((s) => s.setWindow);
  const setApiStageCount = useStore((s) => s.setApiStageCount);
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

  const sortedApis = useMemo(
    () =>
      [...apis].sort(
        (a, b) => a.priority - b.priority || a.id.localeCompare(b.id)
      ),
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
        subtitle={`${apis.length} APIs · ${(totalKg / 1000).toFixed(1)}t total projected output. Edit name, target qty, and priority here. Stage-level details live in the Stages tab.`}
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

      {hasPersistedChanges && (
        <div className="flex items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/5 px-3 py-2 text-xs text-cyan-200">
          <Save size={12} className="text-cyan-300" />
          <span>
            <span className="font-bold">Saved locally.</span> Edits persist in
            this browser; cloud sync runs if Supabase is configured.
          </span>
        </div>
      )}

      {/* Global plan window — applies to every API */}
      <PlanWindowStrip
        startMs={planWindow.startMs}
        endMs={planWindow.endMs}
        onChange={(s, e) => setWindow(s, e)}
      />

      <Card className="overflow-hidden p-0">
        <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-ink-900/90 backdrop-blur-md">
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-300">
                <Th yellow>API Name</Th>
                <Th yellow>Priority</Th>
                <Th align="right" yellow>
                  Stages
                </Th>
                <Th align="right" yellow>
                  Target (kg)
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
                  return (
                    <tr
                      key={api.id}
                      ref={isNew ? newRowRef : undefined}
                      className={clsx(
                        "group border-t border-white/5 transition hover:bg-white/[0.04]",
                        i % 2 === 0 ? "bg-white/[0.01]" : "",
                        isNew && "row-flash"
                      )}
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
                            <span
                              className="font-mono text-[9px] uppercase tracking-wider text-ink-500"
                              title="Stable internal id (cannot be changed)"
                            >
                              id: {api.id}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <PriorityPill
                          value={api.priority}
                          onChange={(p) => setApiPriority(api.id, p)}
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
                            onChange={(v) => setApiTargetOutput(api.id, v)}
                          />
                        ) : (
                          <span className="text-[10px] text-ink-400">
                            — add a stage first —
                          </span>
                        )}
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
                  );
                }
              )}
              {filteredApis.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
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
          API Name, Priority, Stages (1–24), Target Output. The{" "}
          <span className="font-bold">Plan Window</span> above the table sets
          the production span for every API — batches cannot start before its
          Start Date; any batch finishing after the End Date is flagged "Ovr".
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

function PlanWindowStrip({
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
  const days = Math.max(1, Math.round((endMs - startMs) / (24 * 3600 * 1000)));
  const weeks = Math.max(1, Math.round(days / 7));
  const months = Math.max(1, Math.round(days / 30));

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-cyan-300/30 px-4 py-3 shadow-glow ring-1 ring-cyan-300/20"
      style={{
        background:
          "linear-gradient(90deg, rgba(0,240,255,0.10) 0%, rgba(167,139,250,0.06) 50%, rgba(244,114,182,0.06) 100%)",
      }}
    >
      <div className="flex items-center gap-2">
        <CalendarRange size={16} className="text-cyan-300" />
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-200">
          Plan Window
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={startIso}
          max={endIso}
          onChange={(e) => {
            const next = parseIsoDate(e.target.value);
            if (Number.isFinite(next) && next < endMs) onChange(next, endMs);
          }}
          className="cell-yellow rounded-lg px-3 py-1.5 font-mono text-sm tabular-nums transition"
        />
        <span className="text-cyan-300/70">→</span>
        <input
          type="date"
          value={endIso}
          min={startIso}
          onChange={(e) => {
            const next = parseIsoDate(e.target.value);
            if (Number.isFinite(next) && next > startMs) onChange(startMs, next);
          }}
          className="cell-yellow rounded-lg px-3 py-1.5 font-mono text-sm tabular-nums transition"
        />
      </div>
      <div className="ml-auto flex items-center gap-3 text-[11px] font-semibold text-ink-300">
        <span className="font-mono tabular-nums text-cyan-200">
          {weeks} weeks
        </span>
        <span className="text-ink-400">·</span>
        <span className="font-mono tabular-nums text-violet-200">
          ~{months} months
        </span>
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

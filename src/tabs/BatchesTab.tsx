import { useMemo, useRef, useState } from "react";
import {
  Filter,
  FlaskConical,
  GitBranch,
  GitMerge,
  Layers,
  Lock,
  Search,
  Share2,
  Workflow,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader } from "../components/Primitives";
import MultiSelectPopover, {
  ClearFiltersButton,
  type Option as MsOption,
} from "../components/MultiSelectPopover";
import type { ApiTopology, StageMaster } from "../types";

/**
 * No. of Batches tab — cascade-computed material balance per stage.
 * All values are read-only (derived by the backward cascade from api.targetKg).
 *
 *   Required (kg) — how much output this stage must deliver to satisfy downstream
 *   Planned        — ⌈ Required ÷ Output/Batch ⌉
 *   Actual Output  — Planned × Output/Batch (kg)
 *   Input Consumed — Planned × Input/Batch (kg)  →  becomes upstream Required
 */
export default function BatchesTab() {
  const apis = useStore((s) => s.apis);

  // ── Search + filter state ─────────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [apiFilter, setApiFilter] = useState<Set<string>>(new Set());
  const [stageFilter, setStageFilter] = useState<Set<string>>(new Set());

  const anyFilterActive =
    apiFilter.size > 0 || stageFilter.size > 0 || q.trim() !== "";

  const sortedApis = useMemo(
    () => [...apis].sort((a, b) => a.id.localeCompare(b.id)),
    [apis]
  );

  // ── Filter option lists ───────────────────────────────────────────────────
  const apiOptions: MsOption[] = useMemo(
    () =>
      sortedApis.map((a) => ({
        value: a.id,
        label: a.name === a.id ? a.id : a.name,
        color: a.color,
      })),
    [sortedApis]
  );

  const stageOptions: MsOption[] = useMemo(() => {
    const seen = new Map<string, number>();
    sortedApis.forEach((a) =>
      a.stages.forEach((s) =>
        seen.set(s.stageName, (seen.get(s.stageName) ?? 0) + 1)
      )
    );
    return Array.from(seen.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({
        value: name,
        label: name,
        secondary: `${count} API${count === 1 ? "" : "s"}`,
      }));
  }, [sortedApis]);

  // ── Row building + filtering ──────────────────────────────────────────────
  const rows = useMemo(() => {
    type Row = StageMaster & {
      color: string;
      apiDisplayName: string;
      apiTopology: ApiTopology;
      demandKg: number;
      isSideChainStage: boolean;
      isSideChainAnchor: boolean;
      sideChainFactor: number | null;
      isSink: boolean;
    };

    const all: Row[] = [];

    sortedApis.forEach((a) => {
      const sortedStages = [...a.stages].sort((x, y) => x.stageNo - y.stageNo);

      // Build successor map for sink detection
      const successors = new Map<string, StageMaster[]>();
      sortedStages.forEach((s) => successors.set(s.id, []));
      sortedStages.forEach((s) =>
        (s.inputStageIds ?? []).forEach((pid) => {
          const list = successors.get(pid);
          if (list) list.push(s);
        })
      );

      const sinks = sortedStages.filter(
        (s) => (successors.get(s.id)?.length ?? 0) === 0
      );
      const perSinkTarget = sinks.length === 0 ? 0 : a.targetKg / sinks.length;
      const sinkIds = new Set(sinks.map((s) => s.id));

      // Demand per stage
      const demandByStageId = new Map<string, number>();
      sortedStages.forEach((s) => {
        if (sinkIds.has(s.id)) {
          demandByStageId.set(s.id, perSinkTarget);
        } else {
          const succs = successors.get(s.id) ?? [];
          const demand = succs.reduce((acc, succ) => {
            const ipb =
              typeof succ.inputKgPerBatch === "number" && succ.inputKgPerBatch > 0
                ? succ.inputKgPerBatch
                : succ.batchSizeKg;
            return acc + ipb * succ.plannedBatches;
          }, 0);
          demandByStageId.set(s.id, demand);
        }
      });

      // Side-chain identification
      const sideChainIds = new Set<string>();
      sortedStages.forEach((s) => {
        if (s.cascadePolicy && s.cascadePolicy.kind === "side-chain") {
          sideChainIds.add(s.id);
        }
      });
      let changed = true;
      while (changed) {
        changed = false;
        for (const s of sortedStages) {
          if (sideChainIds.has(s.id)) continue;
          const inputs = Array.isArray(s.inputStageIds) ? s.inputStageIds : [];
          if (inputs.length === 0) continue;
          if (inputs.every((id) => sideChainIds.has(id))) {
            sideChainIds.add(s.id);
            changed = true;
          }
        }
      }

      sortedStages.forEach((s) =>
        all.push({
          ...s,
          color: a.color,
          apiDisplayName: a.name,
          apiTopology: a.topology ?? "linear",
          demandKg: demandByStageId.get(s.id) ?? 0,
          isSideChainStage: sideChainIds.has(s.id),
          isSideChainAnchor:
            !!s.cascadePolicy && s.cascadePolicy.kind === "side-chain",
          sideChainFactor:
            s.cascadePolicy && s.cascadePolicy.kind === "side-chain"
              ? s.cascadePolicy.factor
              : null,
          isSink: sinkIds.has(s.id),
        })
      );
    });

    // Apply API filter
    let result = all;
    if (apiFilter.size > 0) {
      result = result.filter((r) => apiFilter.has(r.apiId));
    }

    // Apply Stage name filter
    if (stageFilter.size > 0) {
      result = result.filter((r) => stageFilter.has(r.stageName));
    }

    // Apply text search
    if (q.trim()) {
      const lower = q.toLowerCase().trim();
      result = result.filter(
        (r) =>
          r.apiId.toLowerCase().includes(lower) ||
          r.apiDisplayName.toLowerCase().includes(lower) ||
          r.stageName.toLowerCase().includes(lower) ||
          r.id.toLowerCase().includes(lower)
      );
    }

    return result;
  }, [sortedApis, q, apiFilter, stageFilter]);

  const newRowRef = useRef<HTMLTableRowElement>(null);
  const recentlyAddedStageId = useStore((s) => s.recentlyAddedStageId);

  const totalStages = apis.reduce((n, a) => n + a.stages.length, 0);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="No. of Batches"
        subtitle={`${apis.length} APIs · ${totalStages} stages · cascade-computed material balance. All values are read-only — edit stage parameters in the Stages tab to recompute.`}
        right={
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search stage / API…"
              className="w-56 rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder-ink-400 outline-none focus:border-cyan-300/50"
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
          width={260}
        />

        <ClearFiltersButton
          active={anyFilterActive}
          onClear={() => {
            setApiFilter(new Set());
            setStageFilter(new Set());
            setQ("");
          }}
        />

        {anyFilterActive && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-cyan-300/30 bg-cyan-300/8 px-2 py-1 text-[11px] font-semibold text-cyan-200">
            {rows.length.toLocaleString()} of {totalStages.toLocaleString()} stages
          </span>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-ink-900/90 backdrop-blur-md">
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-300">
                <Th>API</Th>
                <Th>Stage</Th>
                <Th>Stage Name</Th>
                <Th
                  align="right"
                  locked
                  title="Cascade-computed demand — kg this stage must deliver to satisfy all downstream stages."
                >
                  Required (kg)
                </Th>
                <Th
                  align="right"
                  locked
                  title="Planned batches = ⌈ Required ÷ Output/Batch ⌉."
                >
                  Planned
                </Th>
                <Th
                  align="right"
                  locked
                  title="Actual output = Planned × Output/Batch (kg)."
                >
                  Actual Output (kg)
                </Th>
                <Th
                  align="right"
                  locked
                  title="Total input consumed = Planned × Input/Batch (kg). This becomes the upstream stage's Required."
                >
                  Input Consumed (kg)
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const actualOutput = r.batchSizeKg * r.plannedBatches;
                const inputPerBatch =
                  typeof r.inputKgPerBatch === "number" && r.inputKgPerBatch > 0
                    ? r.inputKgPerBatch
                    : r.batchSizeKg;
                const inputConsumed = inputPerBatch * r.plannedBatches;
                const isNew = r.id === recentlyAddedStageId;
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
                    {/* API */}
                    <td className="px-3 py-2 font-semibold text-white">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            background: r.color,
                            boxShadow: `0 0 8px 0 ${r.color}80`,
                          }}
                        />
                        <span
                          className="truncate"
                          title={`${r.apiDisplayName} (id: ${r.apiId})`}
                        >
                          {r.apiDisplayName}
                        </span>
                        <TopologyBadge topology={r.apiTopology} />
                      </div>
                    </td>

                    {/* Stage No */}
                    <td className="px-3 py-2.5 text-ink-100">S{r.stageNo}</td>

                    {/* Stage Name + badges */}
                    <td className="px-3 py-2 text-left">
                      <div
                        className="flex items-center gap-2"
                        style={r.isSideChainStage ? { paddingLeft: 16 } : undefined}
                      >
                        <span className="font-mono text-xs text-ink-100">
                          {r.stageName}
                        </span>
                        {r.isSideChainAnchor && r.sideChainFactor !== null && (
                          <span
                            className="inline-flex items-center gap-1 rounded-md border border-cyan-300/40 bg-cyan-300/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-cyan-300"
                            title={`Side-chain anchor — factor = ${r.sideChainFactor}`}
                          >
                            <Workflow size={9} /> side × {formatFactor(r.sideChainFactor)}
                          </span>
                        )}
                        {r.isSideChainStage && !r.isSideChainAnchor && (
                          <span
                            className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 bg-cyan-300/5 px-1.5 py-0.5 font-mono text-[9px] font-bold text-cyan-300/80"
                            title="Side-chain continuation."
                          >
                            <Workflow size={9} /> side
                          </span>
                        )}
                        {r.isSink && r.apiTopology === "fork" && (
                          <span
                            className="inline-flex items-center gap-1 rounded-md border border-lime-300/50 bg-lime-300/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-lime-300"
                            title="Fork branch sink — final product output stage for this branch."
                          >
                            <Share2 size={9} /> Final API
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Required (kg) */}
                    <td
                      className="px-3 py-2.5 text-right font-mono tabular-nums text-ink-200"
                      title={`Required: ${r.demandKg.toFixed(2)} kg`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <Lock size={10} className="text-ink-500" />
                        {Math.round(r.demandKg).toLocaleString()}
                      </span>
                    </td>

                    {/* Planned */}
                    <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-ink-200">
                      <span className="inline-flex items-center gap-1">
                        <Lock size={10} className="text-ink-500" />
                        {r.plannedBatches}
                      </span>
                    </td>

                    {/* Actual Output */}
                    <td
                      className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-cyan-300"
                      title={`Actual output = planned batches × output/batch. Exact: ${actualOutput.toFixed(2)} kg`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <Lock size={10} className="text-ink-500" />
                        {Math.round(actualOutput).toLocaleString()}
                      </span>
                    </td>

                    {/* Input Consumed */}
                    <td
                      className="px-3 py-2.5 text-right font-mono tabular-nums text-ink-200"
                      title={`Total input consumed. Exact: ${inputConsumed.toFixed(2)} kg`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <Lock size={10} className="text-ink-500" />
                        {Math.round(inputConsumed).toLocaleString()}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-12 text-center text-sm text-ink-300"
                  >
                    {anyFilterActive
                      ? "No stages match the active filters."
                      : "No stages found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-ink-300">
          <span className="mr-1 font-bold text-ink-100">
            <Lock size={11} className="inline" /> All values cascade-derived (read-only):
          </span>
          <span className="font-mono text-cyan-300">
            Planned = ⌈ Required ÷ Output/Batch ⌉
          </span>
          ; Input Consumed = Planned × Input/Batch ⇒ becomes the upstream stage's
          Required. Edit stage parameters in the{" "}
          <span className="font-bold text-ink-200">Stages</span> tab to recompute.
        </div>
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-200">
          <span className="mr-1 font-bold">Side chains:</span>
          Sized forward from their anchor's actual output × factor. Their output
          feeds the stage they input to but is not counted in the API's projected
          total (projectionKg). <span className="font-bold">Fork</span> sinks are
          marked{" "}
          <span className="font-mono text-lime-300">Final API</span> — cascade
          seeds equal demand at each sink.
        </div>
      </div>
    </div>
  );
}

// ─── Local helpers ────────────────────────────────────────────────────────────

function Th({
  children,
  align = "left",
  locked,
  title,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  locked?: boolean;
  title?: string;
}) {
  return (
    <th
      title={title}
      className={clsx(
        "border-b border-white/10 px-3 py-2 font-semibold",
        align === "right" ? "text-right" : "text-left",
        locked ? "text-ink-300" : "text-ink-200"
      )}
    >
      <span className="inline-flex items-center gap-1">
        {locked && <Lock size={10} className="opacity-60" />}
        {children}
      </span>
    </th>
  );
}

function TopologyBadge({ topology }: { topology: ApiTopology }) {
  if (topology === "parallel") {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded border border-violet-300/30 bg-violet-300/10 px-1 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-violet-300"
        title="Stage Flow: parallel"
      >
        <GitMerge size={9} /> parallel
      </span>
    );
  }
  if (topology === "side_chains") {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded border border-cyan-300/30 bg-cyan-300/10 px-1 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-cyan-300"
        title="Stage Flow: side chains"
      >
        <Workflow size={9} /> side
      </span>
    );
  }
  if (topology === "fork") {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded border border-lime-300/30 bg-lime-300/10 px-1 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-lime-300"
        title="Stage Flow: fork (divergence)"
      >
        <Share2 size={9} /> fork
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-ink-300"
      title="Stage Flow: linear"
    >
      <GitBranch size={9} /> linear
    </span>
  );
}

function formatFactor(f: number): string {
  if (!Number.isFinite(f)) return "?";
  return Number.isInteger(f)
    ? `${f}`
    : f.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

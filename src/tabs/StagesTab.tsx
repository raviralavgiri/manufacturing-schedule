import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Pencil,
  Plus,
  Trash2,
  Lock,
  Beaker,
  GitBranch,
  GitMerge,
  Workflow,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader } from "../components/Primitives";
import AddStageForm from "../components/AddStageForm";
import ReactorPoolEditor from "../components/ReactorPoolEditor";
import ReactorSubstitutesEditor from "../components/ReactorSubstitutesEditor";
import StageInputsEditor from "../components/StageInputsEditor";
import type { ApiTopology, StageMaster } from "../types";
import { fmtIsoDate, parseIsoDate } from "../utils/dates";
import { effectiveStageKind } from "../utils/stageKind";
import { Share2 } from "lucide-react";

type SubTab = "parameters" | "equipment";

export default function StagesTab() {
  const apis = useStore((s) => s.apis);
  const reactors = useStore((s) => s.reactors);
  const updateStageField = useStore((s) => s.updateStageField);
  const setStageName = useStore((s) => s.setStageName);
  const setStageReactorPool = useStore((s) => s.setStageReactorPool);
  const setStageReactorSubstitutes = useStore((s) => s.setStageReactorSubstitutes);
  const setStageInputs = useStore((s) => s.setStageInputs);
  const setStageFirstBatchStart = useStore((s) => s.setStageFirstBatchStart);
  const setStageExistingStock = useStore((s) => s.setStageExistingStock);
  const setStageKind = useStore((s) => s.setStageKind);
  const removeStage = useStore((s) => s.removeStage);
  const recentlyAddedStageId = useStore((s) => s.recentlyAddedStageId);
  const clearRecentlyAdded = useStore((s) => s.clearRecentlyAdded);

  const [subTab, setSubTab] = useState<SubTab>("parameters");
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const newRowRef = useRef<HTMLTableRowElement>(null);

  const sortedApis = useMemo(
    () => [...apis].sort((a, b) => a.id.localeCompare(b.id)),
    [apis]
  );

  const rows = useMemo(() => {
    const all: (StageMaster & {
      color: string;
      apiDisplayName: string;
      apiTopology: ApiTopology;
      demandKg: number;
      siblings: StageMaster[];
      isFirstStage: boolean;
      isSideChainStage: boolean;
      isSideChainAnchor: boolean;
      sideChainFactor: number | null;
      isSink: boolean;
    })[] = [];
    sortedApis.forEach((a) => {
      const sortedStages = [...a.stages].sort((x, y) => x.stageNo - y.stageNo);
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
      const firstId = sortedStages[0]?.id;
      sortedStages.forEach((s) =>
        all.push({
          ...s,
          color: a.color,
          apiDisplayName: a.name,
          apiTopology: a.topology ?? "linear",
          demandKg: demandByStageId.get(s.id) ?? 0,
          siblings: sortedStages.filter((x) => x.id !== s.id),
          isFirstStage: s.id === firstId,
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
    if (!q) return all;
    const lower = q.toLowerCase();
    return all.filter(
      (r) =>
        r.apiId.toLowerCase().includes(lower) ||
        r.apiDisplayName.toLowerCase().includes(lower) ||
        r.stageName.toLowerCase().includes(lower) ||
        r.id.toLowerCase().includes(lower)
    );
  }, [sortedApis, q]);

  useEffect(() => {
    if (!recentlyAddedStageId) return;
    const t1 = window.setTimeout(() => {
      newRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    const t2 = window.setTimeout(() => clearRecentlyAdded(), 3500);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [recentlyAddedStageId, clearRecentlyAdded]);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Stages"
        subtitle={`${apis.length} APIs · ${rows.length} stages · ${reactors.length} reactors · ${topologyBreakdown(apis)}. Edit any yellow cell to recompute the schedule.`}
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
                placeholder="Search stage / API…"
                className="w-64 rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder-ink-400 outline-none focus:border-cyan-300/50"
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
          </div>
        }
      />

      {showForm && (
        <AddStageForm
          onCancel={() => setShowForm(false)}
          onAdded={() => setShowForm(false)}
        />
      )}

      {/* Pill sub-tab nav */}
      <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1 w-fit">
        <SubTabBtn active={subTab === "parameters"} onClick={() => setSubTab("parameters")}>
          Stage Parameters
        </SubTabBtn>
        <SubTabBtn active={subTab === "equipment"} onClick={() => setSubTab("equipment")}>
          Equipment &amp; Flow
        </SubTabBtn>
      </div>

      {subTab === "parameters" && (
        <ParametersTab
          rows={rows}
          reactors={reactors}
          recentlyAddedStageId={recentlyAddedStageId}
          confirmDeleteId={confirmDeleteId}
          setConfirmDeleteId={setConfirmDeleteId}
          newRowRef={newRowRef}
          updateStageField={updateStageField}
          setStageName={setStageName}
          removeStage={removeStage}
        />
      )}

      {subTab === "equipment" && (
        <EquipmentFlowTab
          rows={rows}
          reactors={reactors}
          recentlyAddedStageId={recentlyAddedStageId}
          newRowRef={newRowRef}
          setStageReactorPool={setStageReactorPool}
          setStageReactorSubstitutes={setStageReactorSubstitutes}
          setStageInputs={setStageInputs}
          setStageFirstBatchStart={setStageFirstBatchStart}
          setStageExistingStock={setStageExistingStock}
          setStageKind={setStageKind}
        />
      )}
    </div>
  );
}

// ─── Sub-tab button ──────────────────────────────────────────────────────────

function SubTabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-lg px-3 py-1.5 text-xs font-bold transition",
        active
          ? "bg-cyan-300/20 text-cyan-200 shadow-sm"
          : "text-ink-400 hover:bg-white/5 hover:text-ink-200"
      )}
    >
      {children}
    </button>
  );
}

// ─── Tab 1: Stage Parameters ─────────────────────────────────────────────────

type RowType = ReturnType<typeof useStore> extends never
  ? never
  : StageMaster & {
      color: string;
      apiDisplayName: string;
      apiTopology: ApiTopology;
      demandKg: number;
      siblings: StageMaster[];
      isFirstStage: boolean;
      isSideChainStage: boolean;
      isSideChainAnchor: boolean;
      sideChainFactor: number | null;
      isSink: boolean;
    };

function ParametersTab({
  rows,
  recentlyAddedStageId,
  confirmDeleteId,
  setConfirmDeleteId,
  newRowRef,
  updateStageField,
  setStageName,
  removeStage,
}: {
  rows: RowType[];
  reactors: ReturnType<typeof useStore<any>>;
  recentlyAddedStageId: string | null;
  confirmDeleteId: string | null;
  setConfirmDeleteId: (id: string | null) => void;
  newRowRef: React.RefObject<HTMLTableRowElement>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateStageField: (id: string, field: any, value: number) => void;
  setStageName: (id: string, name: string) => void;
  removeStage: (id: string) => void;
}) {
  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-ink-900/90 backdrop-blur-md">
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-300">
                <Th>API</Th>
                <Th>Stage</Th>
                <Th yellow>Stage Name</Th>
                <Th align="right" yellow>Input/Batch (kg)</Th>
                <Th align="right" yellow>Output/Batch (kg)</Th>
                <Th align="right" yellow title="Batch Charging Frequency — interval between consecutive same-stage batch STARTS. start_n − start_(n−1) = BCF.">
                  BCF (h)
                </Th>
                <Th align="right" yellow title="Batch Cycle Time — slot duration on the reactor. The reactor is occupied for BCT hours per batch.">
                  BCT (h)
                </Th>
                <Th align="right" yellow>Analysis (h)</Th>
                <Th align="right" yellow>PCO (h)</Th>
                <Th align="right">&nbsp;</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const inputPerBatch =
                  typeof r.inputKgPerBatch === "number" && r.inputKgPerBatch > 0
                    ? r.inputKgPerBatch
                    : r.batchSizeKg;
                const isNew = r.id === recentlyAddedStageId;
                const isConfirming = r.id === confirmDeleteId;
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
                    <td className="px-3 py-2 font-semibold text-white">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: r.color, boxShadow: `0 0 8px 0 ${r.color}80` }}
                        />
                        <span className="truncate" title={`${r.apiDisplayName} (id: ${r.apiId})`}>
                          {r.apiDisplayName}
                        </span>
                        <TopologyIndicator topology={r.apiTopology} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-ink-100">S{r.stageNo}</td>
                    <td className="px-3 py-2 text-left">
                      <div
                        className="flex items-center gap-2"
                        style={r.isSideChainStage ? { paddingLeft: 16 } : undefined}
                      >
                        <EditableTextCell
                          value={r.stageName}
                          onCommit={(v) => setStageName(r.id, v)}
                        />
                        {r.isSideChainAnchor && r.sideChainFactor !== null && (
                          <span
                            className="inline-flex items-center gap-1 rounded-md border border-cyan-300/40 bg-cyan-300/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-cyan-300"
                            title={`Side-chain anchor — factor × baseStage.actualOutput sizes the demand. factor = ${r.sideChainFactor}`}
                          >
                            <Workflow size={9} /> side × {formatFactor(r.sideChainFactor)}
                          </span>
                        )}
                        {r.isSideChainStage && !r.isSideChainAnchor && (
                          <span
                            className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 bg-cyan-300/5 px-1.5 py-0.5 font-mono text-[9px] font-bold text-cyan-300/80"
                            title="Side-chain continuation — forward-cascaded from the anchor's actualOutput."
                          >
                            <Workflow size={9} /> side
                          </span>
                        )}
                        {r.isSink && r.apiTopology === "fork" && (
                          <span
                            className="inline-flex items-center gap-1 rounded-md border border-lime-300/50 bg-lime-300/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-lime-300"
                            title="Fork branch sink — this is the final product output stage for this branch. The cascade seeds demand here."
                          >
                            <Share2 size={9} /> Final API
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <EditableNumCell
                        value={inputPerBatch}
                        onChange={(v) => updateStageField(r.id, "inputKgPerBatch", v)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <EditableNumCell
                        value={r.batchSizeKg}
                        onChange={(v) => updateStageField(r.id, "batchSizeKg", v)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right" title="BCF (Batch Charging Frequency) — interval between consecutive same-stage batch STARTS.">
                      <EditableNumCell
                        value={r.bcfHours}
                        onChange={(v) => updateStageField(r.id, "bcfHours", v)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right" title="Batch Cycle Time — slot duration on the reactor. start + BCT = reactor free.">
                      <EditableNumCell
                        value={r.bctHours}
                        onChange={(v) => updateStageField(r.id, "bctHours", v)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <EditableNumCell
                        value={r.analysisHours}
                        onChange={(v) => updateStageField(r.id, "analysisHours", v)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right" title="PCO (Product Change Over) cleaning time — applied between consecutive different-campaign batches on the same reactor.">
                      <EditableNumCell
                        value={r.pcoHours}
                        onChange={(v) => updateStageField(r.id, "pcoHours", v)}
                        allowZero
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      {isConfirming ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => { removeStage(r.id); setConfirmDeleteId(null); }}
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
                  <td colSpan={10} className="py-12 text-center text-sm text-ink-300">
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
            <Pencil size={12} className="inline" /> Editable here:
          </span>
          Stage Name, Input/Batch (kg), Output/Batch (kg), BCF, BCT, Analysis, PCO.
          Reactor Pool &amp; Inputs on the <span className="font-bold">Equipment &amp; Flow</span> tab.
          Equipment on the <span className="font-bold">Master Equipment</span> tab; API target on the{" "}
          <span className="font-bold">APIs</span> tab.
          <span className="mt-1 block text-amber-300/80">
            <span className="font-mono">BCF</span> = interval between same-stage batch STARTs:{" "}
            <span className="font-mono">start_n − start_(n−1) = BCF</span>.{" "}
            <span className="font-mono">BCT</span> = slot duration on the reactor.{" "}
            <span className="font-mono">PCO</span> = cleaning on campaign switch; campaigns auto-clean every{" "}
            <span className="font-mono">30 days</span>.
          </span>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-ink-300">
          <span className="mr-1 font-bold text-ink-100">
            <Lock size={11} className="inline" /> Cascade with yields:
          </span>
          <span className="font-mono text-cyan-300">
            Planned = ⌈ Required ÷ Output/Batch ⌉
          </span>
          ; Input Consumed = Planned × Input/Batch ⇒ becomes upstream Required.
          Set Input/Batch &lt; Output/Batch for yield gain (rare); &gt; for yield loss (common).
          Cascade results (Required, Planned, Actual Output, Input Consumed) are in the{" "}
          <span className="font-bold text-ink-200">No. of Batches</span> main tab.
        </div>
      </div>
    </>
  );
}

// ─── Tab 2: Equipment & Flow ─────────────────────────────────────────────────

function EquipmentFlowTab({
  rows,
  reactors,
  recentlyAddedStageId,
  newRowRef,
  setStageReactorPool,
  setStageReactorSubstitutes,
  setStageInputs,
  setStageFirstBatchStart,
  setStageExistingStock,
  setStageKind,
}: {
  rows: RowType[];
  reactors: ReturnType<typeof useStore<any>>;
  recentlyAddedStageId: string | null;
  newRowRef: React.RefObject<HTMLTableRowElement>;
  setStageReactorPool: (id: string, pool: string[]) => void;
  setStageReactorSubstitutes: (id: string, subs: Record<string, string[]>) => void;
  setStageInputs: (id: string, ids: string[]) => void;
  setStageFirstBatchStart: (id: string, ms: number | undefined) => void;
  setStageExistingStock: (id: string, kg: number) => void;
  setStageKind: (id: string, kind: "IM" | "API") => void;
}) {
  return (
    <>
      {/* Pointer to Master Equipment tab */}
      <div className="flex items-center justify-between rounded-xl border border-cyan-300/20 bg-cyan-300/5 px-4 py-2.5 text-xs text-ink-200">
        <span className="inline-flex items-center gap-2">
          <Beaker size={12} className="text-cyan-300" />
          To rename, reclassify, add, or delete equipment, head to the{" "}
          <span className="font-bold text-cyan-300">Master Equipment</span> tab.
        </span>
        <span className="text-[10px] uppercase tracking-wider text-ink-400">
          {reactors.length} reactors available
        </span>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-ink-900/90 backdrop-blur-md">
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-300">
                <Th>API</Th>
                <Th>Stage</Th>
                <Th yellow>Stage Name</Th>
                <Th
                  yellow
                  title="Classify this stage as an Intermediate (IM) or the final API/product stage (API). Used for filtering the Schedule and Gantt. Defaults smartly: the final stage = API, the rest = IM."
                >
                  Type
                </Th>
                <Th
                  yellow
                  title="Reactors in the pool for this stage. The scheduler picks any free reactor from this list."
                >
                  Reactor Pool
                </Th>
                <Th
                  yellow
                  title="Optional substitute reactors per primary reactor (BMR-defined, user-authorised, tried in listed order)."
                >
                  Optional Substitutes
                </Th>
                <Th
                  yellow
                  title="DAG predecessors — stages whose output feeds this stage's input. Default = the immediate previous stage. Multi-select to model convergence (S3+S7→S8) or sub-streams."
                >
                  Inputs From
                </Th>
                <Th
                  yellow
                  title="Optional date for this stage's FIRST batch. Blank = scheduler default (API window start). The material gate still applies — a stage never runs before its inputs are released."
                >
                  First Batch Start
                </Th>
                <Th
                  align="right"
                  yellow
                  title="Existing on-hand stock (kg) of this stage's output. Subtracted from demand before sizing batches: required = demand − existing stock."
                >
                  Existing Stock (kg)
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
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
                    <td className="px-3 py-2 font-semibold text-white">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: r.color, boxShadow: `0 0 8px 0 ${r.color}80` }}
                        />
                        <span className="truncate" title={`${r.apiDisplayName} (id: ${r.apiId})`}>
                          {r.apiDisplayName}
                        </span>
                        <TopologyIndicator topology={r.apiTopology} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-ink-100">S{r.stageNo}</td>
                    <td className="px-3 py-2 text-left">
                      <div
                        className="flex items-center gap-2"
                        style={r.isSideChainStage ? { paddingLeft: 16 } : undefined}
                      >
                        <span className="font-mono text-xs text-ink-100">{r.stageName}</span>
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
                    <td className="px-3 py-2 text-left">
                      <StageKindToggle
                        value={effectiveStageKind(r, r.isSink)}
                        explicit={r.stageKind === "IM" || r.stageKind === "API"}
                        onChange={(k) => setStageKind(r.id, k)}
                      />
                    </td>
                    <td className="px-3 py-2 text-left">
                      <ReactorPoolEditor
                        value={r.reactorPool}
                        reactors={reactors}
                        onChange={(pool) => setStageReactorPool(r.id, pool)}
                      />
                    </td>
                    <td className="px-3 py-2 text-left">
                      <ReactorSubstitutesEditor
                        pool={r.reactorPool}
                        value={r.reactorSubstitutes ?? {}}
                        reactors={reactors}
                        onChange={(subs) => setStageReactorSubstitutes(r.id, subs)}
                      />
                    </td>
                    <td className="px-3 py-2 text-left">
                      {r.isFirstStage ? (
                        <span
                          className="inline-flex items-center gap-1 font-mono text-xs text-ink-500"
                          title="The first stage of an API has no predecessors."
                        >
                          <Lock size={10} /> —
                        </span>
                      ) : (
                        <StageInputsEditor
                          value={r.inputStageIds ?? []}
                          siblings={r.siblings}
                          stageId={r.id}
                          onChange={(ids) => setStageInputs(r.id, ids)}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-left">
                      <StageDateCell
                        value={r.firstBatchStartMs}
                        onChange={(ms) => setStageFirstBatchStart(r.id, ms)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <EditableNumCell
                        value={r.existingStockKg ?? 0}
                        allowZero
                        onChange={(v) => setStageExistingStock(r.id, v)}
                      />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-sm text-ink-300">
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

      <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-200">
        <span className="mr-1 font-bold">
          <Pencil size={12} className="inline" /> Editable here:
        </span>
        Reactor Pool, Optional Substitutes, Inputs From.{" "}
        <span className="mt-1 block text-amber-300/80">
          <GitBranch size={11} className="mr-0.5 inline" />{" "}
          <span className="font-mono">Inputs from</span> = DAG predecessor stages whose output feeds this stage.
          Default is the immediate previous stage. Pick multiple for convergence (S3+S7→S8)
          or a sub-stream (S2 ← {"{"}S1, S2i{"}"}).
        </span>
      </div>
    </>
  );
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

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
        {yellow && <span className="inline-block h-2 w-2 rounded-sm bg-amber-300/80" />}
        {locked && <Lock size={10} className="opacity-60" />}
        {children}
      </span>
    </th>
  );
}

function EditableNumCell({
  value,
  onChange,
  allowZero,
}: {
  value: number;
  onChange: (v: number) => void;
  allowZero?: boolean;
}) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);

  const min = allowZero ? 0 : 1;
  const commit = () => {
    const parsed = Number(local);
    if (!Number.isFinite(parsed)) { setLocal(String(value)); return; }
    const v = Math.max(min, parsed);
    if (v !== value) onChange(v);
    setLocal(String(v));
  };

  return (
    <input
      type="number"
      value={local}
      min={min}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setLocal(String(value)); (e.target as HTMLInputElement).blur(); }
      }}
      className="cell-yellow w-24 rounded-md px-2 py-1 text-right font-mono text-sm tabular-nums transition"
    />
  );
}

/** Optional per-stage date picker. Empty value clears the override (= default).
 *  A small "×" appears when a date is set so the user can revert to default. */
function StageDateCell({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (ms: number | undefined) => void;
}) {
  const iso =
    typeof value === "number" && Number.isFinite(value) ? fmtIsoDate(value) : "";
  return (
    <div className="flex items-center gap-1">
      <input
        type="date"
        value={iso}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) {
            onChange(undefined);
            return;
          }
          const ms = parseIsoDate(v);
          onChange(Number.isFinite(ms) ? ms : undefined);
        }}
        className="cell-yellow w-[140px] rounded-md px-2 py-1 font-mono text-xs transition"
        title={iso ? `First batch: ${iso}` : "Default (API window start)"}
      />
      {iso && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="rounded p-0.5 text-ink-400 hover:text-rose-300"
          title="Clear — use default start"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

/** IM / API segmented toggle. `explicit` dims the control slightly when the
 *  value is the smart default (not yet user-set) — purely cosmetic. */
function StageKindToggle({
  value,
  explicit,
  onChange,
}: {
  value: "IM" | "API";
  explicit: boolean;
  onChange: (kind: "IM" | "API") => void;
}) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border border-white/10 bg-white/5 text-[10px] font-bold"
      title={
        explicit
          ? "Stage type (set manually)"
          : "Stage type (smart default — click to override)"
      }
    >
      {(["IM", "API"] as const).map((k) => {
        const active = value === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={clsx(
              "px-2 py-1 transition",
              active
                ? k === "API"
                  ? "bg-lime-300/20 text-lime-200"
                  : "bg-cyan-300/20 text-cyan-200"
                : "text-ink-400 hover:text-white",
              active && !explicit && "italic opacity-90"
            )}
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}

function TopologyIndicator({ topology }: { topology: ApiTopology }) {
  if (topology === "parallel") {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded border border-violet-300/30 bg-violet-300/10 px-1 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-violet-300"
        title="Stage Flow: parallel (convergence)"
      >
        <GitMerge size={9} /> parallel
      </span>
    );
  }
  if (topology === "side_chains") {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded border border-cyan-300/30 bg-cyan-300/10 px-1 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-cyan-300"
        title="Stage Flow: side chains (sub-streams)"
      >
        <Workflow size={9} /> side
      </span>
    );
  }
  if (topology === "fork") {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded border border-lime-300/30 bg-lime-300/10 px-1 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-lime-300"
        title="Stage Flow: fork (divergence — shared preamble → independent branches)"
      >
        <Share2 size={9} /> fork
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-ink-300"
      title="Stage Flow: linear (default)"
    >
      <GitBranch size={9} /> linear
    </span>
  );
}

function formatFactor(f: number): string {
  if (!Number.isFinite(f)) return "?";
  return Number.isInteger(f) ? `${f}` : f.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function topologyBreakdown(apis: { topology?: ApiTopology }[]): string {
  let linear = 0, parallel = 0, side = 0, fork = 0;
  for (const a of apis) {
    const t = a.topology ?? "linear";
    if (t === "parallel") parallel++;
    else if (t === "side_chains") side++;
    else if (t === "fork") fork++;
    else linear++;
  }
  const parts: string[] = [];
  if (linear > 0) parts.push(`${linear} linear`);
  if (parallel > 0) parts.push(`${parallel} parallel`);
  if (side > 0) parts.push(`${side} side-chains`);
  if (fork > 0) parts.push(`${fork} fork`);
  return parts.length === 0 ? "no stage flow data" : parts.join(" · ");
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
        if (e.key === "Escape") { setLocal(value); (e.target as HTMLInputElement).blur(); }
      }}
      className="cell-yellow w-full max-w-[180px] rounded-md px-2 py-1 text-left font-mono text-xs transition"
    />
  );
}

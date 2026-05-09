import { useEffect, useMemo, useState } from "react";
import { Plus, X, Sparkles, Beaker, AlertCircle, GitBranch } from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";

interface Props {
  onCancel: () => void;
  onAdded: (stageId: string) => void;
}

export default function AddStageForm({ onCancel, onAdded }: Props) {
  const apisRaw = useStore((s) => s.apis);
  const reactors = useStore((s) => s.reactors);
  const addStage = useStore((s) => s.addStage);
  const addAPI = useStore((s) => s.addAPI);

  const apis = useMemo(
    () => [...apisRaw].sort((a, b) => a.id.localeCompare(b.id)),
    [apisRaw]
  );
  const [apiId, setApiId] = useState<string>(apis[0]?.id ?? "");
  const [stageName, setStageName] = useState("");
  const [batchSizeKg, setBatchSizeKg] = useState(100);
  const [inputKgPerBatch, setInputKgPerBatch] = useState(100);
  const [bcfHours, setBcfHours] = useState(120);
  const [bctHours, setBctHours] = useState(120);
  const [analysisHours, setAnalysisHours] = useState(48);
  const [pcoHours, setPcoHours] = useState(8);
  const [plannedBatches, setPlannedBatches] = useState(10);
  const [reactorPool, setReactorPool] = useState<string[]>([]);
  // DAG predecessors for the new stage. Defaults to the API's last existing
  // stage (linear chain) when the user picks an API; emptied when the API
  // has no stages yet (so the new one becomes that API's first stage).
  const [inputStageIds, setInputStageIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Auto-suggest stage name based on chosen API's current stage count
  const suggestedStageName = useMemo(() => {
    const api = apis.find((a) => a.id === apiId);
    if (!api) return "Intermediate-1";
    const next = api.stages.length + 1;
    return `Intermediate-${next}`;
  }, [apis, apiId]);

  useEffect(() => {
    setStageName(suggestedStageName);
  }, [suggestedStageName]);

  // Default reactor pool suggestion: intermediates for early stages,
  // cleanroom for the (later, typically final) stages.
  useEffect(() => {
    const api = apis.find((a) => a.id === apiId);
    if (!api) return;
    if (reactorPool.length === 0) {
      const isFirst = api.stages.length === 0;
      const suggested = isFirst
        ? reactors
            .filter((r) => r.moc === "SS")
            .slice(0, 4)
            .map((r) => r.id)
        : reactors
            .filter((r) => r.moc === "SS")
            .slice(0, 3)
            .map((r) => r.id);
      setReactorPool(suggested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiId]);

  // Default DAG-predecessor selection. First stage of an API → []; otherwise
  // → [last existing stage by stageNo]. Re-runs whenever the user picks a
  // different API so the suggestion is always sensible. The user can still
  // override before submit.
  useEffect(() => {
    const api = apis.find((a) => a.id === apiId);
    if (!api) {
      setInputStageIds([]);
      return;
    }
    if (api.stages.length === 0) {
      setInputStageIds([]);
      return;
    }
    const last = [...api.stages].sort(
      (a, b) => a.stageNo - b.stageNo
    )[api.stages.length - 1];
    setInputStageIds(last ? [last.id] : []);
  }, [apiId, apis]);

  const apiStagesSorted = useMemo(() => {
    const api = apis.find((a) => a.id === apiId);
    if (!api) return [];
    return [...api.stages].sort((a, b) => a.stageNo - b.stageNo);
  }, [apis, apiId]);
  const willBeFirstStage = apiStagesSorted.length === 0;
  const toggleInput = (id: string) => {
    setInputStageIds((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : [...p, id]
    );
  };

  const togglePool = (rid: string) => {
    setReactorPool((p) =>
      p.includes(rid) ? p.filter((x) => x !== rid) : [...p, rid]
    );
  };

  const handleAddNewAPI = () => {
    const newId = addAPI();
    setApiId(newId);
    setReactorPool([]); // re-trigger default suggestion
    setStageName("Intermediate-1");
  };

  const handleSubmit = () => {
    setError(null);
    if (!apiId) {
      setError("Pick an API");
      return;
    }
    if (reactorPool.length === 0) {
      setError("Select at least one reactor");
      return;
    }
    if (!stageName.trim()) {
      setError("Stage name cannot be empty");
      return;
    }
    if (
      batchSizeKg < 1 ||
      bcfHours < 1 ||
      bctHours < 1 ||
      analysisHours < 1 ||
      plannedBatches < 1
    ) {
      setError("All numbers must be ≥ 1");
      return;
    }
    if (pcoHours < 0) {
      setError("PCO must be ≥ 0");
      return;
    }
    // DAG predecessor checks. The first stage of an API is allowed an
    // empty list; every other stage must have at least one predecessor.
    // Self-reference is impossible here (stage doesn't exist yet) but we
    // still guard against bogus ids and a (paranoid) cycle: a new stage
    // can't reference one whose `inputStageIds` would ever transitively
    // reach back — practically impossible at creation time, but we let
    // the submit-time cascade redo the check if anything weird sneaks in.
    if (!willBeFirstStage) {
      if (inputStageIds.length === 0) {
        setError(
          "Pick at least one predecessor stage (Inputs from). The first stage of an API is the only stage allowed an empty list."
        );
        return;
      }
      const validIds = new Set(apiStagesSorted.map((s) => s.id));
      const invalid = inputStageIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        setError(`Unknown predecessor stage id(s): ${invalid.join(", ")}`);
        return;
      }
    }
    const newId = addStage({
      apiId,
      stageName,
      batchSizeKg,
      inputKgPerBatch,
      bcfHours,
      bctHours,
      analysisHours,
      pcoHours,
      plannedBatches,
      reactorPool,
      inputStageIds: willBeFirstStage ? [] : inputStageIds.slice(),
    });
    onAdded(newId);
  };

  const reactorsByMoc = useMemo(() => {
    return {
      SS: reactors.filter((r) => r.moc === "SS"),
      GL: reactors.filter((r) => r.moc === "GL"),
      Hastelloy: reactors.filter((r) => r.moc === "Hastelloy"),
      "Halar lined": reactors.filter((r) => r.moc === "Halar lined"),
    };
  }, [reactors]);

  const mocLabel: Record<keyof typeof reactorsByMoc, string> = {
    SS: "SS",
    GL: "GL",
    Hastelloy: "Hastelloy",
    "Halar lined": "Halar lined",
  };

  return (
    <div className="rounded-2xl border border-cyan-300/30 bg-gradient-to-br from-cyan-300/8 via-violet-400/5 to-pink-400/5 p-5 shadow-glow animate-slide-up">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
          <Sparkles size={16} className="text-cyan-300" />
          Add New Stage
        </h3>
        <button
          onClick={onCancel}
          className="rounded-md p-1.5 text-ink-300 hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Row 1: API + Stage Name */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
        <Field label="API" className="sm:col-span-3">
          <div className="flex gap-1.5">
            <select
              value={apiId}
              onChange={(e) => {
                setApiId(e.target.value);
                setReactorPool([]);
              }}
              className="flex-1 rounded-md border border-white/10 bg-ink-900 px-2 py-2 text-sm text-white outline-none focus:border-cyan-300/50"
            >
              {apis.map((a) => (
                <option key={a.id} value={a.id} className="bg-ink-900">
                  {a.name === a.id ? a.id : `${a.name} (${a.id})`} · {a.stages.length}st
                </option>
              ))}
            </select>
            <button
              onClick={handleAddNewAPI}
              type="button"
              title="Create a new API"
              className="rounded-md border border-violet-300/30 bg-violet-300/10 px-2 text-violet-200 hover:bg-violet-300/20"
            >
              <Plus size={14} />
            </button>
          </div>
        </Field>

        <Field label="Stage Name" className="sm:col-span-4">
          <input
            value={stageName}
            onChange={(e) => setStageName(e.target.value)}
            placeholder="e.g. Intermediate-1, Final API"
            className="w-full rounded-md border border-white/10 bg-ink-900 px-2.5 py-2 text-sm text-white placeholder-ink-400 outline-none focus:border-cyan-300/50"
          />
        </Field>

        <NumField
          label="Input/Batch (kg)"
          value={inputKgPerBatch}
          onChange={setInputKgPerBatch}
          className="sm:col-span-1"
        />
        <NumField
          label="Output/Batch (kg)"
          value={batchSizeKg}
          onChange={(v) => {
            setBatchSizeKg(v);
            // Convenience: if input is still at the previous default value
            // matching the old output, keep it in sync (1:1 yield)
            if (inputKgPerBatch === batchSizeKg) setInputKgPerBatch(v);
          }}
          className="sm:col-span-1"
        />
        <NumField
          label="BCF (h)"
          value={bcfHours}
          onChange={setBcfHours}
          className="sm:col-span-1"
          tooltip="Batch Charging Frequency — interval between consecutive same-stage batch STARTS. start_n − start_(n−1) = BCF. Pool must have enough reactors for the cadence to be honoured."
        />
        <NumField
          label="BCT (h)"
          value={bctHours}
          onChange={setBctHours}
          className="sm:col-span-1"
          tooltip="Batch Cycle Time — slot duration on the reactor. The reactor is occupied for BCT hours per batch (start + BCT = reactor free)."
        />
        <NumField
          label="Analysis (h)"
          value={analysisHours}
          onChange={setAnalysisHours}
          className="sm:col-span-1"
        />
        <NumField
          label="PCO (h)"
          value={pcoHours}
          onChange={setPcoHours}
          allowZero
          className="sm:col-span-1"
        />
      </div>
      <p className="mt-1 text-[10px] text-ink-400">
        <span className="font-semibold text-ink-300">Input/Batch</span> is
        what this stage consumes per batch (= upstream demand);{" "}
        <span className="font-semibold text-ink-300">Output/Batch</span> is
        what it produces. Set equal for 1:1 yield.{" "}
        <span className="font-semibold text-ink-300">BCF</span> = interval
        between same-stage batch STARTs;{" "}
        <span className="font-semibold text-ink-300">BCT</span> = slot
        duration (reactor occupancy);{" "}
        <span className="font-semibold text-ink-300">Process</span> ≤ BCT —
        the gap (BCT − Process) renders as a faded wait bar leading into
        the process portion on the Gantt.{" "}
        <span className="font-semibold text-ink-300">PCO</span> = cleaning
        gap on campaign change. Planned batches are auto-computed.
      </p>

      {/* Row 1.5: DAG predecessors. The first stage of an API has no
          inputs — we collapse the section to a single info bar. For every
          other stage we render the multi-select. */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <Label>
            <GitBranch size={11} className="mr-1 inline opacity-70" /> Inputs
            from{" "}
            <span className="ml-1 font-mono text-[10px] text-ink-300">
              {willBeFirstStage
                ? "first stage — no predecessors"
                : `${inputStageIds.length} selected`}
            </span>
          </Label>
        </div>
        {willBeFirstStage ? (
          <div className="rounded-md border border-dashed border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-ink-400">
            This will be the first stage of{" "}
            <span className="font-bold text-ink-200">{apiId || "—"}</span>, so
            it has no DAG predecessors. Add more stages later to wire up a
            chain.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {apiStagesSorted.map((s) => {
              const on = inputStageIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleInput(s.id)}
                  title={`${s.stageName} (S${s.stageNo})`}
                  className={clsx(
                    "rounded-md border px-2 py-1 font-mono text-[11px] font-semibold transition",
                    on
                      ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-200 shadow-[0_0_8px_rgba(0,240,255,0.25)]"
                      : "border-white/10 bg-white/5 text-ink-200 hover:border-white/20 hover:bg-white/10"
                  )}
                >
                  S{s.stageNo} · {s.stageName}
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-1 text-[10px] text-ink-400">
          Default = the API's last existing stage (linear chain). Pick
          multiple for convergence (S3+S7→S8) or a sub-stream (S2 ← {"{"}
          S1, S2i{"}"}). The new stage cannot reference itself or form a
          cycle.
        </p>
      </div>

      {/* Row 2: Reactor Pool */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <Label>
            Reactor Pool{" "}
            <span className="ml-1 font-mono text-[10px] text-ink-300">
              {reactorPool.length} selected
            </span>
          </Label>
          <button
            onClick={() => setReactorPool(reactors.map((r) => r.id))}
            className="text-[10px] uppercase tracking-wider text-cyan-300 hover:text-cyan-200"
            type="button"
          >
            Select all
          </button>
        </div>
        <div className="space-y-2">
          {(["SS", "GL", "Hastelloy", "Halar lined"] as const).map((cls) => (
            <div key={cls} className="flex flex-wrap items-center gap-1.5">
              <span
                className="mr-1 inline-block w-20 text-[10px] font-bold uppercase tracking-wider text-ink-400"
                title={cls}
              >
                {mocLabel[cls]}
              </span>
              {reactorsByMoc[cls].map((r) => {
                const on = reactorPool.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => togglePool(r.id)}
                    title={r.name === r.id ? r.id : `${r.name} (id: ${r.id})`}
                    className={clsx(
                      "rounded-md border px-2 py-1 font-mono text-[11px] font-semibold transition",
                      on
                        ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-200 shadow-[0_0_8px_rgba(0,240,255,0.25)]"
                        : "border-white/10 bg-white/5 text-ink-200 hover:border-white/20 hover:bg-white/10"
                    )}
                  >
                    <Beaker size={9} className="mr-1 inline opacity-70" />
                    {r.name}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Error + actions */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-h-[20px] text-xs">
          {error && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-rose-300/30 bg-rose-400/10 px-2 py-0.5 font-semibold text-rose-300">
              <AlertCircle size={12} /> {error}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-ink-200 transition hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/40 bg-gradient-to-r from-cyan-400/30 to-violet-400/30 px-4 py-2 text-xs font-bold text-white transition hover:from-cyan-400/50 hover:to-violet-400/50 hover:shadow-glow"
          >
            <Plus size={13} /> Add Stage
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-ink-300">
      {children}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  className,
  allowZero,
  tooltip,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  className?: string;
  /** Allow 0 as a valid value (e.g. PCO = 0 → no cleaning needed). */
  allowZero?: boolean;
  /** Optional hover tooltip on the label. */
  tooltip?: string;
}) {
  // Local string buffer so the user can clear the input and retype without
  // every transient keystroke clamping back to 1.
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);

  const min = allowZero ? 0 : 1;
  const commit = () => {
    const parsed = Number(local);
    if (!Number.isFinite(parsed)) {
      setLocal(String(value));
      return;
    }
    const v = Math.max(min, parsed);
    if (v !== value) onChange(v);
    setLocal(String(v));
  };

  return (
    <div className={className}>
      <div title={tooltip}>
        <Label>{label}</Label>
      </div>
      <input
        type="number"
        min={min}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setLocal(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="cell-yellow w-full rounded-md px-2 py-2 text-right font-mono text-sm tabular-nums"
      />
    </div>
  );
}

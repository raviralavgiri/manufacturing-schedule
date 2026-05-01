import { useEffect, useMemo, useState } from "react";
import { Plus, X, Sparkles, Beaker, AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";

interface Props {
  onCancel: () => void;
  onAdded: (stageId: string) => void;
}

export default function AddStageForm({ onCancel, onAdded }: Props) {
  const apis = useStore((s) => s.apis);
  const reactors = useStore((s) => s.reactors);
  const addStage = useStore((s) => s.addStage);
  const addAPI = useStore((s) => s.addAPI);

  const [apiId, setApiId] = useState<string>(apis[0]?.id ?? "");
  const [stageName, setStageName] = useState("");
  const [batchSizeKg, setBatchSizeKg] = useState(100);
  const [cycleHours, setCycleHours] = useState(120);
  const [analysisHours, setAnalysisHours] = useState(48);
  const [plannedBatches, setPlannedBatches] = useState(10);
  const [reactorPool, setReactorPool] = useState<string[]>([]);
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

  // Default reactor pool suggestion: pick smalls if first stage, mediums otherwise
  useEffect(() => {
    const api = apis.find((a) => a.id === apiId);
    if (!api) return;
    if (reactorPool.length === 0) {
      const isFirst = api.stages.length === 0;
      const suggested = isFirst
        ? reactors.filter((r) => r.reactorClass === "Small").slice(0, 4).map((r) => r.id)
        : reactors.filter((r) => r.reactorClass === "Medium").slice(0, 3).map((r) => r.id);
      setReactorPool(suggested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiId]);

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
    if (batchSizeKg < 1 || cycleHours < 1 || analysisHours < 1 || plannedBatches < 1) {
      setError("All numbers must be ≥ 1");
      return;
    }
    const newId = addStage({
      apiId,
      stageName,
      batchSizeKg,
      cycleHours,
      analysisHours,
      plannedBatches,
      reactorPool,
    });
    onAdded(newId);
  };

  const reactorsByClass = useMemo(() => {
    return {
      Small: reactors.filter((r) => r.reactorClass === "Small"),
      Medium: reactors.filter((r) => r.reactorClass === "Medium"),
      Large: reactors.filter((r) => r.reactorClass === "Large"),
    };
  }, [reactors]);

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
                  {a.id} ({a.stages.length} st)
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
          label="Batch Size (kg)"
          value={batchSizeKg}
          onChange={setBatchSizeKg}
          className="sm:col-span-1"
        />
        <NumField
          label="Cycle (h)"
          value={cycleHours}
          onChange={setCycleHours}
          className="sm:col-span-1"
        />
        <NumField
          label="Analysis (h)"
          value={analysisHours}
          onChange={setAnalysisHours}
          className="sm:col-span-1"
        />
        <NumField
          label="Batches"
          value={plannedBatches}
          onChange={setPlannedBatches}
          className="sm:col-span-2"
        />
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
          {(["Small", "Medium", "Large"] as const).map((cls) => (
            <div key={cls} className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 inline-block w-16 text-[10px] font-bold uppercase tracking-wider text-ink-400">
                {cls}
              </span>
              {reactorsByClass[cls].map((r) => {
                const on = reactorPool.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => togglePool(r.id)}
                    className={clsx(
                      "rounded-md border px-2 py-1 font-mono text-[11px] font-semibold transition",
                      on
                        ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-200 shadow-[0_0_8px_rgba(0,240,255,0.25)]"
                        : "border-white/10 bg-white/5 text-ink-200 hover:border-white/20 hover:bg-white/10"
                    )}
                  >
                    <Beaker size={9} className="mr-1 inline opacity-70" />
                    {r.id}
                    {r.shared && (
                      <span className="ml-1 text-[8px] text-violet-300">★</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-ink-400">
          <span className="text-violet-300">★</span> = shared reactor (queued
          across stages)
        </p>
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
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
        className="cell-yellow w-full rounded-md px-2 py-2 text-right font-mono text-sm tabular-nums"
      />
    </div>
  );
}

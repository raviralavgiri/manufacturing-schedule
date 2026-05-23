import { useState } from "react";
import { Plus, Minus, Sparkles, GitBranch, Info } from "lucide-react";
import type { ForkSpec } from "../utils/topologyPresets";

interface Props {
  initial?: Partial<ForkSpec>;
  onApply: (spec: ForkSpec) => void;
  onCancel?: () => void;
}

/**
 * Spec panel for the "fork" (fan-out / divergence) topology preset.
 *
 *   Shared[1] → … → Shared[N] ──┬── Branch-A[1] → … → Branch-A[M]  (sink A)
 *                                ├── Branch-B[1] → … → Branch-B[M]  (sink B)
 *                                └── Branch-C[1] → … → Branch-C[M]  (sink C)
 *
 * The user configures: shared-preamble length, branch count, stages-per-branch,
 * and an optional output target (kg) per branch sink for unequal splits.
 */
export default function ForkTopologyEditor({ initial, onApply, onCancel }: Props) {
  const [sharedStages,    setSharedStages]    = useState(clamp(initial?.sharedStages    ?? 1, 1, 8));
  const [branches,        setBranches]        = useState(clamp(initial?.branches        ?? 2, 2, 8));
  const [stagesPerBranch, setStagesPerBranch] = useState(clamp(initial?.stagesPerBranch ?? 2, 1, 8));
  const [branchTargets,   setBranchTargets]   = useState<string[]>(
    Array.from({ length: initial?.branches ?? 2 }, (_, i) =>
      String(initial?.branchTargetKg?.[i] ?? "")
    )
  );

  const totalStages = sharedStages + branches * stagesPerBranch;

  const adjustBranches = (delta: number) => {
    const next = clamp(branches + delta, 2, 8);
    setBranches(next);
    setBranchTargets((prev) => {
      const updated = prev.slice(0, next);
      while (updated.length < next) updated.push("");
      return updated;
    });
  };

  const setTarget = (idx: number, v: string) => {
    setBranchTargets((prev) => prev.map((x, i) => (i === idx ? v : x)));
  };

  const handleApply = () => {
    const parsedTargets = branchTargets.map((t) => {
      const n = parseFloat(t);
      return Number.isFinite(n) && n > 0 ? n : 0;
    });
    onApply({
      kind: "fork",
      sharedStages:    Math.max(1, Math.floor(sharedStages)),
      branches:        Math.max(2, Math.floor(branches)),
      stagesPerBranch: Math.max(1, Math.floor(stagesPerBranch)),
      branchTargetKg:  parsedTargets.some((x) => x > 0) ? parsedTargets : undefined,
    });
  };

  return (
    <div className="rounded-xl border border-cyan-300/30 bg-gradient-to-br from-cyan-300/8 via-violet-300/5 to-lime-300/5 p-4 shadow-glowCyan">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
        <GitBranch size={14} className="text-cyan-300" />
        Fork / divergence stage flow
        <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-ink-200">
          {totalStages} stages total
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
        {/* Shared preamble */}
        <div className="sm:col-span-4">
          <Label>Shared preamble stages</Label>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setSharedStages((v) => clamp(v - 1, 1, 8))}
              disabled={sharedStages <= 1}
              className="rounded-md border border-white/10 bg-white/5 p-1.5 text-ink-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">
              <Minus size={12} />
            </button>
            <span className="flex-1 rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 text-center font-mono text-sm tabular-nums text-white">
              {sharedStages}
            </span>
            <button type="button" onClick={() => setSharedStages((v) => clamp(v + 1, 1, 8))}
              disabled={sharedStages >= 8}
              className="rounded-md border border-white/10 bg-white/5 p-1.5 text-ink-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">
              <Plus size={12} />
            </button>
          </div>
        </div>

        {/* Branch count */}
        <div className="sm:col-span-4">
          <Label>Branches</Label>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => adjustBranches(-1)}
              disabled={branches <= 2}
              className="rounded-md border border-white/10 bg-white/5 p-1.5 text-ink-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">
              <Minus size={12} />
            </button>
            <span className="flex-1 rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 text-center font-mono text-sm tabular-nums text-white">
              {branches}
            </span>
            <button type="button" onClick={() => adjustBranches(1)}
              disabled={branches >= 8}
              className="rounded-md border border-white/10 bg-white/5 p-1.5 text-ink-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">
              <Plus size={12} />
            </button>
          </div>
        </div>

        {/* Stages per branch */}
        <div className="sm:col-span-4">
          <Label>Stages per branch</Label>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setStagesPerBranch((v) => clamp(v - 1, 1, 8))}
              disabled={stagesPerBranch <= 1}
              className="rounded-md border border-white/10 bg-white/5 p-1.5 text-ink-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">
              <Minus size={12} />
            </button>
            <span className="flex-1 rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 text-center font-mono text-sm tabular-nums text-white">
              {stagesPerBranch}
            </span>
            <button type="button" onClick={() => setStagesPerBranch((v) => clamp(v + 1, 1, 8))}
              disabled={stagesPerBranch >= 8}
              className="rounded-md border border-white/10 bg-white/5 p-1.5 text-ink-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">
              <Plus size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Per-branch output targets */}
      <div className="mt-3">
        <Label>Branch output targets (kg) — optional, leave blank for equal split</Label>
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: branches }, (_, i) => {
            const letter = String.fromCharCode(65 + i);
            return (
              <div key={i} className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1">
                <span className="font-mono text-[11px] font-bold text-cyan-300">{letter}</span>
                <input
                  type="number"
                  min={0}
                  placeholder="auto"
                  value={branchTargets[i] ?? ""}
                  onChange={(e) => setTarget(i, e.target.value)}
                  className="cell-yellow w-20 rounded px-1.5 py-0.5 text-right font-mono text-xs tabular-nums"
                />
                <span className="text-[10px] text-ink-400">kg</span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[11px] text-ink-300">
        <Info size={11} className="mt-0.5 shrink-0 text-cyan-300" />
        Shared preamble stages are linear. Each branch starts from the last
        shared stage and runs independently to its own sink. Branch targets
        drive the backward cascade for that arm — set them to get unequal
        splits (e.g. 140 kg / 50 kg). Leave blank to split api.targetKg equally.
      </p>

      <div className="mt-4 flex items-center justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-ink-200 hover:bg-white/10">
            Cancel
          </button>
        )}
        <button type="button" onClick={handleApply}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/40 bg-gradient-to-r from-cyan-400/30 to-lime-400/20 px-3 py-1.5 text-xs font-bold text-white hover:from-cyan-400/50 hover:to-lime-400/40 hover:shadow-glow">
          <Sparkles size={12} /> Apply fork
        </button>
      </div>
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

function clamp(v: number, min: number, max: number): number {
  const n = Math.max(min, Math.min(max, Math.floor(v)));
  return Number.isFinite(n) ? n : min;
}

import { useEffect, useState } from "react";
import { Plus, Trash2, Sparkles, Workflow, Info } from "lucide-react";
import type {
  SideChainSpec,
  SideChainsSpec,
} from "../utils/topologyPresets";

interface Props {
  initial?: Partial<SideChainsSpec>;
  onApply: (spec: SideChainsSpec) => void;
  onCancel?: () => void;
}

/**
 * Spec panel for the "side_chains" (sub-streams) topology preset.
 *
 *   Main: S1 ── S2 ── S3 ── S4
 *                ↑       ↑
 *      side chain A     side chain B
 *      (factor)         (factor)
 *
 * Each side chain has:
 *   - `mergesIntoStageNo` — which main stage it feeds (≥ 2)
 *   - `length` — number of stages in the side chain (≥ 1)
 *   - `factor` — multiplier on the main predecessor's actualOutput that
 *     sizes the side chain's anchor demand. > 0; UI clamps to ≤ 100 so
 *     a typo can't blow up the cascade.
 *
 * The ANCHOR (first side stage) carries `cascadePolicy = { kind:
 * "side-chain", baseStageId: <main predecessor>, factor }`. Continuations
 * forward-cascade from the anchor's `actualOutput`. The merge happens by
 * appending the chain's last stage into the main backbone's
 * `inputStageIds`.
 */
export default function SideChainsTopologyEditor({
  initial,
  onApply,
  onCancel,
}: Props) {
  const [mainBackboneLength, setMainBackboneLength] = useState(
    Math.max(2, initial?.mainBackboneLength ?? 4)
  );
  const [sideChains, setSideChains] = useState<SideChainSpec[]>(
    initial?.sideChains && initial.sideChains.length > 0
      ? initial.sideChains.map((sc) => ({ ...sc }))
      : [{ mergesIntoStageNo: 2, length: 1, factor: 0.3 }]
  );

  const addSideChain = () => {
    setSideChains((p) => [
      ...p,
      {
        mergesIntoStageNo: Math.max(2, mainBackboneLength),
        length: 1,
        factor: 0.3,
      },
    ]);
  };

  const removeSideChain = (idx: number) => {
    setSideChains((p) => p.filter((_, i) => i !== idx));
  };

  const updateSideChain = (idx: number, patch: Partial<SideChainSpec>) => {
    setSideChains((p) =>
      p.map((sc, i) => (i === idx ? { ...sc, ...patch } : sc))
    );
  };

  const totalStages =
    Math.max(2, mainBackboneLength) +
    sideChains.reduce((acc, sc) => acc + Math.max(1, sc.length), 0);

  const handleApply = () => {
    onApply({
      kind: "side_chains",
      mainBackboneLength: Math.max(2, Math.floor(mainBackboneLength)),
      sideChains: sideChains.map((sc) => ({
        mergesIntoStageNo: Math.max(
          2,
          Math.min(
            Math.floor(sc.mergesIntoStageNo) || 2,
            Math.max(2, mainBackboneLength)
          )
        ),
        length: Math.max(1, Math.floor(sc.length) || 1),
        factor:
          sc.factor > 0
            ? Math.min(100, Math.max(0.0001, sc.factor))
            : 0.3,
        namePrefix: sc.namePrefix?.trim() || undefined,
      })),
    });
  };

  // Build dropdown of valid main stage numbers (≥ 2; can't feed into S1).
  const mainStageOptions: number[] = [];
  for (let i = 2; i <= Math.max(2, mainBackboneLength); i++) {
    mainStageOptions.push(i);
  }

  return (
    <div className="rounded-xl border border-cyan-300/30 bg-gradient-to-br from-cyan-300/8 via-violet-300/5 to-pink-300/5 p-4 shadow-glow">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
        <Workflow size={14} className="text-cyan-300" />
        Side-chains stage flow
        <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-ink-200">
          {totalStages} stages total
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
        <div className="sm:col-span-4">
          <Label>Main backbone length</Label>
          <NumericInput
            value={mainBackboneLength}
            min={2}
            step={1}
            fallback={2}
            onChange={(v) => setMainBackboneLength(Math.max(2, Math.floor(v)))}
            className="cell-yellow w-full rounded-md px-2.5 py-1.5 text-right font-mono text-sm tabular-nums"
          />
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <Label>Side chains</Label>
          <button
            type="button"
            onClick={addSideChain}
            className="inline-flex items-center gap-1 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-300 hover:bg-cyan-300/20"
          >
            <Plus size={10} /> Add chain
          </button>
        </div>
        {sideChains.length === 0 ? (
          <div className="rounded-md border border-dashed border-white/10 bg-white/[0.02] px-3 py-3 text-center text-[11px] text-ink-400">
            No side chains. Click "Add chain" to define one.
          </div>
        ) : (
          <div className="space-y-2">
            {sideChains.map((sc, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 items-end gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-12"
              >
                <div className="sm:col-span-1">
                  <Label>#</Label>
                  <span className="block rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-center font-mono text-xs font-bold text-cyan-300">
                    {idx + 1}
                  </span>
                </div>
                <div className="sm:col-span-3">
                  <Label>Merges into</Label>
                  <select
                    value={Math.min(
                      Math.max(2, sc.mergesIntoStageNo),
                      Math.max(2, mainBackboneLength)
                    )}
                    onChange={(e) =>
                      updateSideChain(idx, {
                        mergesIntoStageNo: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 text-sm text-white outline-none focus:border-cyan-300/50"
                  >
                    {mainStageOptions.map((n) => (
                      <option key={n} value={n} className="bg-ink-900">
                        S{n}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <Label>Length</Label>
                  <NumericInput
                    value={sc.length}
                    min={1}
                    step={1}
                    fallback={1}
                    onChange={(v) => updateSideChain(idx, { length: Math.max(1, Math.floor(v)) })}
                    className="cell-yellow w-full rounded-md px-2 py-1.5 text-right font-mono text-sm tabular-nums"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>Factor</Label>
                  <NumericInput
                    value={sc.factor}
                    min={0.0001}
                    max={100}
                    step={0.05}
                    fallback={0.3}
                    onChange={(v) => updateSideChain(idx, { factor: Math.min(100, Math.max(0.0001, v)) })}
                    className="cell-yellow w-full rounded-md px-2 py-1.5 text-right font-mono text-sm tabular-nums"
                  />
                </div>
                <div className="sm:col-span-3">
                  <Label>Name prefix</Label>
                  <input
                    type="text"
                    placeholder="S"
                    value={sc.namePrefix ?? ""}
                    onChange={(e) =>
                      updateSideChain(idx, { namePrefix: e.target.value })
                    }
                    className="w-full rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 font-mono text-sm text-white outline-none focus:border-cyan-300/50"
                  />
                </div>
                <div className="sm:col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeSideChain(idx)}
                    title="Remove side chain"
                    className="rounded-md border border-rose-300/30 bg-rose-400/10 p-2 text-rose-300 hover:bg-rose-400/20"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[11px] text-ink-300">
        <Info size={11} className="mt-0.5 shrink-0 text-cyan-300" />
        Each side chain anchors at the main predecessor of "merges into".
        The anchor's batches are sized by{" "}
        <span className="font-mono text-cyan-300">
          base.actualOutput × factor
        </span>
        ; continuations forward-cascade from the anchor.
      </p>

      <div className="mt-4 flex items-center justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-ink-200 hover:bg-white/10"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleApply}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/40 bg-gradient-to-r from-cyan-400/30 to-violet-400/30 px-3 py-1.5 text-xs font-bold text-white hover:from-cyan-400/50 hover:to-violet-400/50 hover:shadow-glow"
        >
          <Sparkles size={12} /> Apply side chains
        </button>
      </div>
    </div>
  );
}

function NumericInput({
  value,
  min,
  max,
  step,
  fallback,
  onChange,
  className,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  fallback: number;
  onChange: (val: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = parseFloat(draft);
    if (!isNaN(n) && isFinite(n)) {
      const clamped =
        min !== undefined
          ? Math.max(min, max !== undefined ? Math.min(max, n) : n)
          : max !== undefined
          ? Math.min(max, n)
          : n;
      onChange(clamped);
      setDraft(String(clamped));
    } else {
      setDraft(String(value));
    }
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className={className}
    />
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-ink-300">
      {children}
    </div>
  );
}

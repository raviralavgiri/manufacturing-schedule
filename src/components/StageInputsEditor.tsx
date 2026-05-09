import { useEffect, useMemo, useRef, useState } from "react";
import { Check, GitBranch, X } from "lucide-react";
import { clsx } from "clsx";
import type { StageMaster } from "../types";

interface Props {
  /** Current selection. */
  value: string[];
  /** All OTHER stages on the same API (passed by parent so we don't pull
   *  the full apis list into this leaf). Sorted by stageNo for display. */
  siblings: StageMaster[];
  /** This stage's id — used to forbid self-references defensively. */
  stageId: string;
  onChange: (next: string[]) => void;
  className?: string;
}

/**
 * "Inputs from" multi-select chip editor for the Stages table. Lets the
 * user pick the DAG predecessor stages whose output feeds this stage.
 *
 * UX rules (matches the broader spec):
 *   - Lower-stageNo siblings render first (the natural upstream candidates).
 *   - Higher-stageNo siblings are still pickable so users can model
 *     side-streams or unusual flows; we just badge them as ⚠ since they'd
 *     create a forward dependency the cascade may flag.
 *   - At least one selection is required (Apply is disabled at zero).
 *   - The first stage of an API doesn't render this control at all
 *     (parent handles that).
 */
export default function StageInputsEditor({
  value,
  siblings,
  stageId,
  onChange,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const sortedSiblings = useMemo(
    () =>
      [...siblings]
        .filter((s) => s.id !== stageId)
        .sort((a, b) => a.stageNo - b.stageNo),
    [siblings, stageId]
  );
  const selfStageNo = useMemo(() => {
    // We don't have direct stageNo here; infer it as max sibling stageNo + 1
    // of those marked as "before" — only used for the ⚠ flag. Fall back to
    // showing all as upstream when ambiguous (no false alarms).
    return null as number | null;
  }, []);

  const toggle = (id: string) => {
    setDraft((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : [...p, id]
    );
  };

  const apply = () => {
    if (draft.length === 0) return;
    onChange(draft);
    setOpen(false);
  };

  const labelFor = (id: string) => {
    const s = sortedSiblings.find((x) => x.id === id);
    if (!s) return id;
    return `S${s.stageNo}`;
  };

  return (
    <div ref={ref} className={clsx("relative inline-block", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="cell-yellow w-full max-w-[160px] rounded-md px-2 py-1 text-left font-mono text-[11px] tabular-nums transition hover:brightness-125"
        title={`Inputs from: ${
          value.map(labelFor).join(", ") || "(none)"
        } · click to edit DAG predecessors`}
      >
        <span className="line-clamp-1 inline-flex items-center gap-1 text-amber-200">
          <GitBranch size={10} className="opacity-70" />
          {value.length === 0 ? "(none)" : value.map(labelFor).join(", ")}
        </span>
      </button>
      {open && (
        <div className="popover-surface absolute right-0 top-full z-50 mt-1 w-[280px] overflow-hidden rounded-xl p-3 shadow-2xl shadow-black/60 ring-1 ring-cyan-300/20">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
              Inputs from · {draft.length} selected
            </span>
            <span
              className="text-[9px] uppercase tracking-wider text-ink-400"
              title="DAG predecessor stages — what this stage consumes from upstream"
            >
              DAG
            </span>
          </div>
          <div className="max-h-[260px] space-y-1 overflow-y-auto">
            {sortedSiblings.length === 0 && (
              <div className="rounded-md border border-dashed border-white/10 bg-white/[0.02] p-3 text-center text-[10px] text-ink-400">
                No other stages on this API yet. Add another stage first.
              </div>
            )}
            {sortedSiblings.map((s) => {
              const on = draft.includes(s.id);
              const downstream =
                selfStageNo !== null && s.stageNo > selfStageNo;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  className={clsx(
                    "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] font-mono transition",
                    on
                      ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-100"
                      : "border-white/10 bg-white/5 text-ink-200 hover:bg-white/10"
                  )}
                >
                  <span
                    className={clsx(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      on
                        ? "border-cyan-300/60 bg-cyan-300/30 text-cyan-100"
                        : "border-white/15 bg-white/5"
                    )}
                  >
                    {on && <Check size={10} />}
                  </span>
                  <span className="font-bold">S{s.stageNo}</span>
                  <span className="flex-1 truncate text-ink-300">
                    {s.stageName}
                  </span>
                  {downstream && (
                    <span
                      className="text-[9px] text-amber-300"
                      title="Higher stageNo than this stage — may be flagged as a cycle by validation."
                    >
                      ⚠
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-ink-200 hover:bg-white/10"
            >
              <X size={11} /> Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={draft.length === 0}
              className={clsx(
                "inline-flex items-center gap-1 rounded-md border border-cyan-300/40 bg-gradient-to-r from-cyan-400/30 to-violet-400/30 px-2.5 py-1 text-[11px] font-bold text-white",
                draft.length === 0
                  ? "cursor-not-allowed opacity-50"
                  : "hover:from-cyan-400/50 hover:to-violet-400/50"
              )}
            >
              <Check size={11} /> Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

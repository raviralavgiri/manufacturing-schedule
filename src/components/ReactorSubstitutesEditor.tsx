import { useEffect, useMemo, useRef, useState } from "react";
import { Beaker, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { clsx } from "clsx";
import type { Reactor } from "../types";

interface Props {
  /** Primary (booked) reactor pool for this stage. */
  pool: string[];
  /** Current substitute map: primaryId → ordered substitute ids. */
  value: Record<string, string[]>;
  reactors: Reactor[];
  onChange: (next: Record<string, string[]>) => void;
}

export default function ReactorSubstitutesEditor({
  pool,
  value,
  reactors,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  // Local draft so edits are committed atomically on Apply.
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      // Deep-copy so cancelling doesn't mutate the original.
      const copy: Record<string, string[]> = {};
      for (const rid of pool) copy[rid] = [...(value[rid] ?? [])];
      setDraft(copy);
    }
  }, [open, pool, value]);

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

  const reactorById = useMemo(
    () => new Map(reactors.map((r) => [r.id, r])),
    [reactors]
  );

  const totalSubs = useMemo(
    () => pool.reduce((n, rid) => n + (value[rid]?.length ?? 0), 0),
    [pool, value]
  );

  function reactorLabel(id: string): string {
    const r = reactorById.get(id);
    if (!r) return id;
    return r.name === id ? id : `${r.name} (${id})`;
  }

  // ── draft mutations ────────────────────────────────────────────────────────

  function addSub(primaryId: string, subId: string) {
    setDraft((prev) => {
      const list = prev[primaryId] ?? [];
      if (list.includes(subId)) return prev;
      return { ...prev, [primaryId]: [...list, subId] };
    });
  }

  function removeSub(primaryId: string, idx: number) {
    setDraft((prev) => {
      const list = [...(prev[primaryId] ?? [])];
      list.splice(idx, 1);
      return { ...prev, [primaryId]: list };
    });
  }

  function moveSub(primaryId: string, idx: number, dir: -1 | 1) {
    setDraft((prev) => {
      const list = [...(prev[primaryId] ?? [])];
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= list.length) return prev;
      [list[idx], list[swapIdx]] = [list[swapIdx], list[idx]];
      return { ...prev, [primaryId]: list };
    });
  }

  function apply() {
    // Strip empty lists before persisting.
    const clean: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v.length > 0) clean[k] = v;
    }
    onChange(clean);
    setOpen(false);
  }

  // ── trigger button ────────────────────────────────────────────────────────

  const triggerLabel =
    totalSubs === 0
      ? "No substitutes"
      : `${totalSubs} substitute${totalSubs === 1 ? "" : "s"}`;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Edit optional substitute reactors (BMR)"
        className={clsx(
          "rounded-md border px-2 py-1 font-mono text-[11px] transition hover:brightness-125",
          totalSubs > 0
            ? "border-violet-300/50 bg-violet-300/10 text-violet-300"
            : "border-white/10 bg-white/5 text-ink-400"
        )}
      >
        {triggerLabel}
      </button>

      {open && (
        <div className="popover-surface absolute left-0 top-full z-50 mt-1 w-[400px] overflow-hidden rounded-xl p-4 shadow-2xl shadow-black/60 ring-1 ring-violet-300/20">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-violet-300">
              Optional Substitutes (BMR)
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-ink-400 hover:text-ink-200"
            >
              <X size={12} />
            </button>
          </div>

          <p className="mb-3 text-[10px] leading-relaxed text-ink-400">
            For each booked reactor, list optional substitutes in priority
            order. The first listed is tried first. Suitability is your
            responsibility — no spec-matching is applied.
          </p>

          <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
            {pool.map((primaryId) => {
              const primary = reactorById.get(primaryId);
              const subs = draft[primaryId] ?? [];
              // Reactors eligible as substitutes: all reactors except the primary itself.
              const candidates = reactors.filter(
                (r) => r.id !== primaryId && !subs.includes(r.id)
              );

              return (
                <div key={primaryId} className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                  {/* Primary header */}
                  <div className="mb-2 flex items-center gap-1.5">
                    <Beaker size={11} className="text-cyan-300" />
                    <span className="text-[11px] font-bold text-cyan-300">
                      {primary ? (primary.name === primaryId ? primaryId : `${primary.name}`) : primaryId}
                    </span>
                    <span className="text-[10px] text-ink-500">
                      ({primary?.moc ?? "?"} · {primary?.capacityKg ?? "?"}L)
                    </span>
                  </div>

                  {/* Ordered substitute list */}
                  {subs.length === 0 ? (
                    <p className="mb-2 text-[10px] italic text-ink-500">
                      No substitutes defined — primary only.
                    </p>
                  ) : (
                    <ol className="mb-2 space-y-1">
                      {subs.map((subId, idx) => {
                        const sub = reactorById.get(subId);
                        return (
                          <li key={subId} className="flex items-center gap-1.5">
                            <span className="w-4 text-right font-mono text-[10px] text-ink-500">
                              {idx + 1}.
                            </span>
                            <span className="flex-1 rounded border border-white/8 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[11px] text-ink-100">
                              {sub
                                ? sub.name === subId
                                  ? subId
                                  : `${sub.name} (${subId})`
                                : subId}
                              <span className="ml-1 text-ink-500">
                                {sub ? `· ${sub.moc} · ${sub.capacityKg}L` : ""}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => moveSub(primaryId, idx, -1)}
                              disabled={idx === 0}
                              title="Move up (higher priority)"
                              className="rounded p-0.5 text-ink-400 hover:text-ink-200 disabled:opacity-25"
                            >
                              <ChevronUp size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveSub(primaryId, idx, 1)}
                              disabled={idx === subs.length - 1}
                              title="Move down (lower priority)"
                              className="rounded p-0.5 text-ink-400 hover:text-ink-200 disabled:opacity-25"
                            >
                              <ChevronDown size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeSub(primaryId, idx)}
                              title="Remove substitute"
                              className="rounded p-0.5 text-ink-400 hover:text-rose-300"
                            >
                              <X size={12} />
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}

                  {/* Add substitute picker */}
                  {candidates.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Plus size={11} className="shrink-0 text-ink-400" />
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) {
                            addSub(primaryId, e.target.value);
                            e.target.value = "";
                          }
                        }}
                        className="flex-1 rounded border border-white/10 bg-ink-900 px-1.5 py-0.5 font-mono text-[11px] text-ink-200 outline-none focus:border-violet-300/50"
                      >
                        <option value="" disabled>
                          Add substitute…
                        </option>
                        {(["SS", "GL", "Hastelloy", "Halar lined"] as const).map(
                          (moc) => {
                            const group = candidates.filter((r) => r.moc === moc);
                            if (group.length === 0) return null;
                            return (
                              <optgroup key={moc} label={moc}>
                                {group.map((r) => (
                                  <option key={r.id} value={r.id} className="bg-ink-900">
                                    {reactorLabel(r.id)} · {r.capacityKg}L
                                  </option>
                                ))}
                              </optgroup>
                            );
                          }
                        )}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-white/5 pt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-ink-200 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              className="inline-flex items-center gap-1 rounded-md border border-violet-300/40 bg-gradient-to-r from-violet-400/30 to-cyan-400/30 px-2.5 py-1 text-[11px] font-bold text-white hover:from-violet-400/50 hover:to-cyan-400/50"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

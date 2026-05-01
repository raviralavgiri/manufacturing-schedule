import { useEffect, useMemo, useRef, useState } from "react";
import { Beaker, Check, X } from "lucide-react";
import { clsx } from "clsx";
import type { Reactor } from "../types";

interface Props {
  value: string[];
  reactors: Reactor[];
  onChange: (next: string[]) => void;
  className?: string;
}

export default function ReactorPoolEditor({
  value,
  reactors,
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

  const reactorsByClass = useMemo(
    () => ({
      Small: reactors.filter((r) => r.reactorClass === "Small"),
      Medium: reactors.filter((r) => r.reactorClass === "Medium"),
      Large: reactors.filter((r) => r.reactorClass === "Large"),
    }),
    [reactors]
  );

  const toggle = (rid: string) => {
    setDraft((p) => (p.includes(rid) ? p.filter((x) => x !== rid) : [...p, rid]));
  };

  const apply = () => {
    if (draft.length === 0) return;
    onChange(draft);
    setOpen(false);
  };

  return (
    <div ref={ref} className={clsx("relative inline-block", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="cell-yellow w-full max-w-[260px] rounded-md px-2 py-1 text-left font-mono text-[11px] tabular-nums transition hover:brightness-125"
        title="Click to edit reactor pool"
      >
        <span className="line-clamp-1 text-amber-200">
          {value.join(", ") || "(empty)"}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-[360px] overflow-hidden rounded-xl border border-cyan-300/30 bg-ink-950/98 p-3 shadow-glow backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
              Reactor Pool · {draft.length} selected
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setDraft(reactors.map((r) => r.id))}
                type="button"
                className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-ink-200 hover:bg-white/10"
              >
                All
              </button>
              <button
                onClick={() => setDraft([])}
                type="button"
                className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-ink-200 hover:bg-white/10"
              >
                None
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {(["Small", "Medium", "Large"] as const).map((cls) => (
              <div key={cls} className="flex flex-wrap items-center gap-1">
                <span className="mr-1 inline-block w-14 text-[9px] font-bold uppercase tracking-wider text-ink-400">
                  {cls}
                </span>
                {reactorsByClass[cls].map((r) => {
                  const on = draft.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggle(r.id)}
                      className={clsx(
                        "rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold transition",
                        on
                          ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-200 shadow-[0_0_6px_rgba(0,240,255,0.25)]"
                          : "border-white/10 bg-white/5 text-ink-200 hover:bg-white/10"
                      )}
                    >
                      <Beaker size={8} className="mr-0.5 inline opacity-70" />
                      {r.id}
                      {r.shared && (
                        <span className="ml-0.5 text-[8px] text-violet-300">★</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
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

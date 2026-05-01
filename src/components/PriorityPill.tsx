import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import type { Priority } from "../types";

const META: Record<Priority, { label: string; tone: string; ring: string; tag: string }> = {
  1: {
    label: "P1 · Critical",
    tone: "from-rose-500/30 to-rose-400/15 text-rose-200 border-rose-300/40",
    ring: "shadow-[0_0_8px_rgba(244,63,94,0.45)]",
    tag: "P1",
  },
  2: {
    label: "P2 · High",
    tone: "from-amber-500/30 to-amber-400/15 text-amber-200 border-amber-300/40",
    ring: "shadow-[0_0_8px_rgba(251,191,36,0.4)]",
    tag: "P2",
  },
  3: {
    label: "P3 · Medium",
    tone: "from-cyan-500/25 to-cyan-400/10 text-cyan-200 border-cyan-300/40",
    ring: "shadow-[0_0_6px_rgba(0,240,255,0.3)]",
    tag: "P3",
  },
  4: {
    label: "P4 · Low",
    tone: "from-violet-500/20 to-violet-400/10 text-violet-200 border-violet-300/30",
    ring: "",
    tag: "P4",
  },
  5: {
    label: "P5 · Lowest",
    tone: "from-ink-600/30 to-ink-700/20 text-ink-200 border-white/15",
    ring: "",
    tag: "P5",
  },
};

interface Props {
  value: Priority;
  onChange?: (p: Priority) => void;
  size?: "sm" | "md";
  readOnly?: boolean;
}

export default function PriorityPill({
  value,
  onChange,
  size = "sm",
  readOnly,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const meta = META[value];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        disabled={readOnly}
        onClick={() => !readOnly && setOpen((v) => !v)}
        className={clsx(
          "inline-flex items-center gap-1 rounded-md border bg-gradient-to-br font-mono font-bold uppercase tracking-wider transition",
          meta.tone,
          meta.ring,
          size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs",
          !readOnly && "cursor-pointer hover:brightness-125",
          readOnly && "cursor-default opacity-90"
        )}
        title={meta.label}
      >
        {meta.tag}
        {!readOnly && <ChevronDown size={9} className="opacity-70" />}
      </button>
      {open && !readOnly && (
        <div className="absolute right-0 top-full z-30 mt-1 min-w-[140px] overflow-hidden rounded-md border border-white/15 bg-ink-950/95 shadow-xl backdrop-blur-xl">
          {([1, 2, 3, 4, 5] as Priority[]).map((p) => {
            const m = META[p];
            const active = p === value;
            return (
              <button
                key={p}
                type="button"
                onClick={() => {
                  onChange?.(p);
                  setOpen(false);
                }}
                className={clsx(
                  "flex w-full items-center justify-between gap-2 border-b border-white/5 px-3 py-1.5 text-left text-xs font-semibold transition last:border-b-0 hover:bg-white/8",
                  active && "bg-white/5"
                )}
              >
                <span
                  className={clsx(
                    "rounded border bg-gradient-to-br px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase",
                    m.tone
                  )}
                >
                  {m.tag}
                </span>
                <span className="text-ink-200">{m.label.split("· ")[1]}</span>
                {active && (
                  <span className="text-[10px] text-cyan-300">●</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, X, Check, Search } from "lucide-react";
import { clsx } from "clsx";

export interface Option {
  value: string;
  label: string;
  /** Optional grouping header (e.g. "Small" / "Medium" / "Large" for reactors). */
  group?: string;
  /** Optional small color swatch (e.g. API color dot). */
  color?: string;
  /** Optional trailing badge (e.g. priority pill). */
  badge?: ReactNode;
  /** Optional secondary text shown after the label (e.g. "id: API-01"). */
  secondary?: string;
}

interface Props {
  label: string;
  icon?: ReactNode;
  options: Option[];
  /** Empty Set means "all selected". Selecting at least one switches to filter mode. */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Width of the popover in px. */
  width?: number;
  /** Show search box (useful when options > 8). Default: auto. */
  searchable?: boolean;
}

/**
 * Multi-select popover used as a filter button.
 *
 * Convention: an EMPTY `selected` set is rendered as "All N", meaning no
 * filter is applied. As soon as the user clicks a single option, the set
 * starts holding values and acts as a filter.
 */
export default function MultiSelectPopover({
  label,
  icon,
  options,
  selected,
  onChange,
  width = 280,
  searchable,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const isAllMode = selected.size === 0;
  const useSearch = searchable ?? options.length > 8;

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.secondary?.toLowerCase().includes(q) ?? false)
    );
  }, [options, query]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Option[]>();
    filtered.forEach((o) => {
      const key = o.group ?? "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(o);
    });
    return Array.from(groups.entries());
  }, [filtered]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    // First click on "All N" mode = select everything except this one (i.e. user wants to filter OUT this one)
    // Better UX: first click = select ONLY this one (filter to just this).
    if (isAllMode) {
      onChange(new Set([value]));
      return;
    }
    if (next.has(value)) next.delete(value);
    else next.add(value);
    // If they just deselected the last one, treat as "all" (clear the filter)
    if (next.size === 0) {
      onChange(new Set());
      return;
    }
    onChange(next);
  };

  const buttonLabel = isAllMode
    ? `All ${options.length}`
    : `${selected.size} of ${options.length}`;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition",
          isAllMode
            ? "border-white/10 bg-white/5 text-ink-200 hover:bg-white/10"
            : "border-cyan-300/40 bg-cyan-300/10 text-cyan-200 hover:bg-cyan-300/20"
        )}
        title={`${label} filter — ${buttonLabel}`}
      >
        {icon}
        <span>{label}</span>
        <span
          className={clsx(
            "rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
            isAllMode
              ? "bg-white/5 text-ink-300"
              : "bg-cyan-300/20 text-cyan-100"
          )}
        >
          {buttonLabel}
        </span>
        <ChevronDown size={11} className="opacity-60" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-cyan-300/40 shadow-2xl shadow-black/60 ring-1 ring-cyan-300/20"
          style={{
            width,
            background: "linear-gradient(180deg, #0b1130 0%, #04081a 100%), #04081a",
          }}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
              {label} · {buttonLabel}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onChange(new Set())}
                type="button"
                className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-ink-200 hover:bg-white/10"
                title="Show all (clear filter)"
              >
                All
              </button>
              <button
                onClick={() =>
                  onChange(new Set(options.map((o) => o.value)))
                }
                type="button"
                className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-ink-200 hover:bg-white/10"
              >
                Pick all
              </button>
              <button
                onClick={() => onChange(new Set([options[0]?.value]))}
                type="button"
                className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-ink-200 hover:bg-white/10"
                title="Clear all picks"
              >
                None
              </button>
            </div>
          </div>

          {useSearch && (
            <div className="border-b border-white/10 p-2">
              <div className="relative">
                <Search
                  size={11}
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-400"
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                  placeholder="Search…"
                  className="w-full rounded-md border border-white/10 bg-white/5 py-1.5 pl-7 pr-2 text-xs text-white placeholder-ink-400 outline-none focus:border-cyan-300/50"
                />
              </div>
            </div>
          )}

          <div className="max-h-[300px] overflow-y-auto p-1">
            {grouped.map(([groupName, groupOpts]) => (
              <div key={groupName || "ungrouped"}>
                {groupName && (
                  <div className="px-2 pb-0.5 pt-1.5 text-[9px] font-bold uppercase tracking-wider text-ink-400">
                    {groupName}
                  </div>
                )}
                {groupOpts.map((o) => {
                  const isOn = isAllMode || selected.has(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => toggle(o.value)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition hover:bg-white/8"
                    >
                      <span
                        className={clsx(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          isOn
                            ? "border-cyan-300/60 bg-cyan-300/20 text-cyan-200"
                            : "border-white/15 bg-white/5"
                        )}
                      >
                        {isOn && <Check size={10} />}
                      </span>
                      {o.color && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background: o.color,
                            boxShadow: `0 0 6px ${o.color}80`,
                          }}
                        />
                      )}
                      <span className="flex-1 truncate font-semibold text-white">
                        {o.label}
                      </span>
                      {o.secondary && (
                        <span className="font-mono text-[9px] text-ink-400">
                          {o.secondary}
                        </span>
                      )}
                      {o.badge && <span className="shrink-0">{o.badge}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="py-4 text-center text-[11px] text-ink-400">
                No matches
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Tiny helper: a "Clear filters" pill shown only when any filter is active. */
export function ClearFiltersButton({
  active,
  onClear,
}: {
  active: boolean;
  onClear: () => void;
}) {
  if (!active) return null;
  return (
    <button
      onClick={onClear}
      className="inline-flex items-center gap-1 rounded-lg border border-rose-300/30 bg-rose-400/10 px-2.5 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-400/20"
      title="Reset all Gantt filters"
    >
      <X size={11} /> Clear
    </button>
  );
}

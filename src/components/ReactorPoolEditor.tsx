import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { Reactor } from "../types";
import { parseEquipmentCell } from "../utils/excelImport";
import { formatEquipmentCell } from "../utils/exporters";

interface Props {
  pool: string[];
  substitutes: Record<string, string[]>;
  reactors: Reactor[];
  onChange: (pool: string[], substitutes: Record<string, string[]>) => void;
  className?: string;
}

/**
 * Reactor pool + optional substitutes typed in one box, same format as the
 * Excel "Equipment (main , optional /)" column:
 *
 *   R105/R203/R118,R114,R119
 *
 *   ,  separates MAIN (pool) reactors
 *   /  after a main reactor lists its optional substitutes, in priority order
 *
 * Reactor names are accepted as well as ids (case-insensitive). Unknown
 * reactors are rejected and the previous value is kept.
 */
export default function ReactorPoolEditor({
  pool,
  substitutes,
  reactors,
  onChange,
  className,
}: Props) {
  const current = formatEquipmentCell(pool, substitutes);
  const [text, setText] = useState(current);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(current);
    setError(null);
  }, [current]);

  const commit = () => {
    if (text.trim() === current) {
      setText(current);
      setError(null);
      return;
    }
    const lookup = new Map<string, string>();
    reactors.forEach((r) => {
      lookup.set(r.id.toUpperCase(), r.id);
      lookup.set(r.name.replace(/\s+/g, "").toUpperCase(), r.id);
    });
    const parsed = parseEquipmentCell(text);
    const unknown: string[] = [];
    const resolve = (t: string) => {
      const id = lookup.get(t.toUpperCase());
      if (!id && !unknown.includes(t)) unknown.push(t);
      return id ?? t;
    };
    const nextPool: string[] = [];
    const nextSubs: Record<string, string[]> = {};
    parsed.pool.forEach((p) => {
      const main = resolve(p);
      if (!nextPool.includes(main)) nextPool.push(main);
      const subs = (parsed.substitutes[p] ?? [])
        .map(resolve)
        .filter((s, i, a) => s !== main && a.indexOf(s) === i);
      if (subs.length) nextSubs[main] = subs;
    });
    if (nextPool.length === 0) {
      setError("Enter at least one main reactor");
      return;
    }
    if (unknown.length) {
      setError(`Unknown reactor${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
      return;
    }
    setError(null);
    onChange(nextPool, nextSubs);
  };

  return (
    <div className={clsx("w-full max-w-[280px]", className)}>
      <input
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(current);
            setError(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
        spellCheck={false}
        placeholder="R105/R203,R114"
        title={
          "Main reactors separated by commas; optional substitutes after a main reactor separated by slashes.\n" +
          "e.g. R105/R203/R118,R114,R119 → main R105 (subs R203, R118), R114, R119"
        }
        className={clsx(
          "cell-yellow w-full rounded-md px-2 py-1 font-mono text-[11px] text-amber-200 outline-none focus:ring-1",
          error ? "ring-1 ring-rose-400 focus:ring-rose-400" : "focus:ring-cyan-300/60"
        )}
      />
      {error && <div className="mt-0.5 text-[10px] text-rose-300">{error}</div>}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Beaker,
  Check,
  Lock,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader } from "../components/Primitives";
import type { ReactorClass } from "../types";

const CLASS_ORDER: ReactorClass[] = ["SSR", "GLR"];
const CLASS_LABEL: Record<ReactorClass, string> = {
  SSR: "SSR",
  GLR: "GLR",
};
const CLASS_FULL: Record<ReactorClass, string> = {
  SSR: "Stainless Steel Reactor",
  GLR: "Glass Lined Reactor",
};

/**
 * Master Reactor tab — single source of truth for the reactor fleet.
 *
 * Layout: a single sticky-header table grouped by class (SSR / GLR).
 *   • id is immutable (referenced by every stage's `reactorPool`).
 *   • Click name / class toggle / capacity to edit.
 *   • Trash → confirm-inline. Cannot delete a reactor that is the only
 *     entry in some stage's pool — the store's removeReactor enforces it.
 */
export default function MasterReactorTab() {
  const reactors = useStore((s) => s.reactors);
  const apis = useStore((s) => s.apis);
  const setReactorName = useStore((s) => s.setReactorName);
  const setReactorClass = useStore((s) => s.setReactorClass);
  const setReactorCapacity = useStore((s) => s.setReactorCapacity);
  const addReactor = useStore((s) => s.addReactor);
  const removeReactor = useStore((s) => s.removeReactor);

  const [showAdd, setShowAdd] = useState(false);

  // Live "used by N stages" count for each reactor.
  const usageByReactor = useMemo(() => {
    const map: Record<string, number> = {};
    reactors.forEach((r) => (map[r.id] = 0));
    apis.forEach((a) =>
      a.stages.forEach((s) =>
        s.reactorPool.forEach((rid) => {
          if (map[rid] !== undefined) map[rid] += 1;
        })
      )
    );
    return map;
  }, [reactors, apis]);

  const groupedReactors = useMemo(() => {
    const sorted = [...reactors].sort((a, b) => {
      const aIdx = CLASS_ORDER.indexOf(a.reactorClass);
      const bIdx = CLASS_ORDER.indexOf(b.reactorClass);
      if (aIdx !== bIdx) return aIdx - bIdx;
      return a.id.localeCompare(b.id);
    });
    const buckets: Record<ReactorClass, typeof sorted> = {
      SSR: [],
      GLR: [],
    };
    sorted.forEach((r) => buckets[r.reactorClass].push(r));
    return buckets;
  }, [reactors]);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Master Reactor"
        subtitle={`${reactors.length} reactors across the fleet · ${groupedReactors.SSR.length} SSR, ${groupedReactors.GLR.length} GLR. Click any name, class, or capacity to edit; ID is immutable.`}
        right={
          <button
            onClick={() => setShowAdd((v) => !v)}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition",
              showAdd
                ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-200"
                : "border-cyan-300/30 bg-gradient-to-r from-cyan-400/20 to-violet-400/20 text-white hover:from-cyan-400/30 hover:to-violet-400/30 hover:shadow-glow"
            )}
          >
            <Plus size={13} /> {showAdd ? "Close" : "Add Reactor"}
          </button>
        }
      />

      {showAdd && (
        <AddReactorForm
          existingIds={reactors.map((r) => r.id)}
          existingByClass={groupedReactors}
          onCancel={() => setShowAdd(false)}
          onAdd={(input) => {
            const result = addReactor(input);
            if (result.ok) setShowAdd(false);
            return result;
          }}
        />
      )}

      <Card className="overflow-hidden p-0">
        <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-ink-900/90 backdrop-blur-md">
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-300">
                <Th className="w-8">&nbsp;</Th>
                <Th className="w-24">ID</Th>
                <Th yellow>Name</Th>
                <Th yellow className="w-32">
                  Class
                </Th>
                <Th yellow align="right" className="w-28">
                  Capacity (L)
                </Th>
                <Th align="right" className="w-32">
                  Used By
                </Th>
                <Th align="right" className="w-12">
                  &nbsp;
                </Th>
              </tr>
            </thead>
            <tbody>
              {CLASS_ORDER.map((cls) => {
                const list = groupedReactors[cls];
                return (
                  <ReactorClassGroup
                    key={cls}
                    cls={cls}
                    list={list}
                    usageByReactor={usageByReactor}
                    onName={setReactorName}
                    onClass={setReactorClass}
                    onCapacity={setReactorCapacity}
                    onDelete={removeReactor}
                  />
                );
              })}
              {reactors.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-ink-300">
                    No reactors yet. Click{" "}
                    <span className="font-bold text-cyan-300">+ Add Reactor</span>{" "}
                    above to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-ink-300">
          <span className="mr-1 font-bold text-ink-100">
            <Lock size={11} className="inline" /> ID is immutable:
          </span>
          Stage reactor pools reference reactors by id (e.g.{" "}
          <span className="font-mono text-cyan-300">"R101"</span>). Renaming is
          purely a display change; deleting an id rewrites every stage's pool
          to drop it.
        </div>
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-200">
          <span className="mr-1 font-bold">
            <AlertCircle size={12} className="inline" /> Delete safety:
          </span>
          A reactor cannot be deleted while it is the only entry in some
          stage's pool. Add another reactor to that stage in the Stages tab
          first.
        </div>
      </div>
    </div>
  );
}

// ─── Class group (subheader row + body rows) ─────────────────────────────────

function ReactorClassGroup({
  cls,
  list,
  usageByReactor,
  onName,
  onClass,
  onCapacity,
  onDelete,
}: {
  cls: ReactorClass;
  list: { id: string; name: string; reactorClass: ReactorClass; capacityKg: number }[];
  usageByReactor: Record<string, number>;
  onName: (rid: string, v: string) => void;
  onClass: (rid: string, c: ReactorClass) => void;
  onCapacity: (rid: string, v: number) => void;
  onDelete: (rid: string, opts?: { cascade?: boolean }) =>
    | { ok: true }
    | { ok: false; error: string; blockingStages?: string[] };
}) {
  return (
    <>
      <tr className="bg-white/[0.04]">
        <td colSpan={7} className="px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{
                background: classColor(cls),
                boxShadow: `0 0 6px ${classColor(cls)}80`,
              }}
            />
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-200">
              {CLASS_FULL[cls]} ({list.length})
            </span>
            <span className="text-[10px] text-ink-500">· {CLASS_LABEL[cls]}</span>
          </div>
        </td>
      </tr>
      {list.length === 0 ? (
        <tr>
          <td
            colSpan={7}
            className="border-t border-white/5 px-3 py-3 text-xs text-ink-400"
          >
            No {CLASS_FULL[cls].toLowerCase()} reactors. Add one above to make
            this class available to stage pools.
          </td>
        </tr>
      ) : (
        list.map((r, i) => (
          <ReactorRow
            key={r.id}
            zebra={i % 2 === 0}
            id={r.id}
            name={r.name}
            reactorClass={r.reactorClass}
            capacityKg={r.capacityKg}
            stagesUsing={usageByReactor[r.id] ?? 0}
            onName={(v) => onName(r.id, v)}
            onClass={(c) => onClass(r.id, c)}
            onCapacity={(v) => onCapacity(r.id, v)}
            onDelete={(cascade) => onDelete(r.id, { cascade })}
          />
        ))
      )}
    </>
  );
}

// ─── Single reactor row ──────────────────────────────────────────────────────

function ReactorRow({
  zebra,
  id,
  name,
  reactorClass,
  capacityKg,
  stagesUsing,
  onName,
  onClass,
  onCapacity,
  onDelete,
}: {
  zebra: boolean;
  id: string;
  name: string;
  reactorClass: ReactorClass;
  capacityKg: number;
  stagesUsing: number;
  onName: (v: string) => void;
  onClass: (c: ReactorClass) => void;
  onCapacity: (v: number) => void;
  onDelete: (cascade: boolean) =>
    | { ok: true }
    | { ok: false; error: string; blockingStages?: string[] };
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tryDelete = () => {
    setError(null);
    const probe = onDelete(false);
    if (probe.ok) return;
    if (probe.blockingStages && probe.blockingStages.length > 0) {
      setError(probe.error);
      return;
    }
    setConfirmDelete(true);
  };

  const confirm = () => {
    const result = onDelete(true);
    if (!result.ok) setError(result.error);
    setConfirmDelete(false);
  };

  return (
    <>
      <tr
        className={clsx(
          "border-t border-white/5 transition hover:bg-white/[0.04]",
          zebra && "bg-white/[0.01]"
        )}
      >
        <td className="px-3 py-2.5">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{
              background: classColor(reactorClass),
              boxShadow: `0 0 6px ${classColor(reactorClass)}80`,
            }}
          />
        </td>
        <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-ink-200">
          <span
            className="inline-flex items-center gap-1.5"
            title="Stable internal id (immutable)"
          >
            <Lock size={10} className="text-ink-500" />
            {id}
          </span>
        </td>
        <td className="px-3 py-2">
          <EditableTextCell
            value={name}
            onCommit={onName}
            placeholder={id}
            ariaLabel={`Reactor ${id} display name`}
          />
        </td>
        <td className="px-3 py-2">
          <ClassToggle value={reactorClass} onChange={onClass} />
        </td>
        <td className="px-3 py-2 text-right">
          <EditableNumCell value={capacityKg} onChange={onCapacity} />
        </td>
        <td className="px-3 py-2.5 text-right text-xs">
          {stagesUsing === 0 ? (
            <span className="text-ink-500">unused</span>
          ) : (
            <span className="font-mono text-violet-300">
              {stagesUsing} stage{stagesUsing === 1 ? "" : "s"}
            </span>
          )}
        </td>
        <td className="px-2 py-2 text-right">
          <button
            onClick={tryDelete}
            className="rounded-md p-1.5 text-ink-400 transition hover:bg-rose-400/15 hover:text-rose-300"
            title={`Delete ${id}`}
            aria-label={`Delete reactor ${id}`}
          >
            <Trash2 size={13} />
          </button>
        </td>
      </tr>
      {(confirmDelete || error) && (
        <tr className={clsx("border-t border-white/5", zebra && "bg-white/[0.01]")}>
          <td colSpan={7} className="px-3 pb-3">
            {confirmDelete && (
              <div className="rounded-md border border-rose-300/30 bg-rose-400/10 p-2 text-[11px] text-rose-200">
                <div className="mb-1.5 font-semibold">
                  Reactor <span className="font-mono">{id}</span> is in{" "}
                  {stagesUsing} stage pool{stagesUsing === 1 ? "" : "s"}.
                  Confirming will remove it from those pools and recompute the
                  schedule.
                </div>
                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-ink-200 hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirm}
                    className="rounded-md border border-rose-300/40 bg-rose-400/20 px-2 py-0.5 text-[10px] font-bold text-rose-200 hover:bg-rose-400/30"
                  >
                    Confirm delete
                  </button>
                </div>
              </div>
            )}
            {error && (
              <div className="mt-1 flex items-start gap-1.5 rounded-md border border-rose-300/30 bg-rose-400/10 p-2 text-[10px] text-rose-200">
                <AlertCircle size={11} className="mt-0.5 shrink-0" />
                <div className="flex-1">{error}</div>
                <button
                  onClick={() => setError(null)}
                  className="shrink-0 text-rose-200/70 hover:text-rose-200"
                  aria-label="Dismiss error"
                >
                  <X size={10} />
                </button>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Add Reactor form ────────────────────────────────────────────────────────

const CLASS_PREFIX: Record<ReactorClass, string> = {
  SSR: "R1",
  GLR: "R3",
};

function suggestNextId(cls: ReactorClass, existingIds: string[]): string {
  const prefix = CLASS_PREFIX[cls];
  // Pull numeric suffixes from existing ids that match the convention
  // (e.g. "R101" → 101). Free-form ids like "R-PILOT-1" are ignored.
  const usedNums = new Set<number>();
  existingIds.forEach((id) => {
    if (!id.startsWith(prefix)) return;
    const tail = id.slice(prefix.length);
    const n = Number(tail);
    if (Number.isFinite(n)) usedNums.add(n);
  });
  for (let n = 1; n < 1000; n++) {
    if (!usedNums.has(n)) {
      return `${prefix}${String(n).padStart(2, "0")}`;
    }
  }
  return `${prefix}${Date.now()}`;
}

function AddReactorForm({
  existingIds,
  existingByClass,
  onCancel,
  onAdd,
}: {
  existingIds: string[];
  existingByClass: Record<ReactorClass, { id: string; capacityKg: number }[]>;
  onCancel: () => void;
  onAdd: (input: {
    id: string;
    name: string;
    reactorClass: ReactorClass;
    capacityKg: number;
  }) => { ok: true; id: string } | { ok: false; error: string };
}) {
  const [cls, setCls] = useState<ReactorClass>("SSR");
  const initialCapacity = useMemo(() => {
    const peers = existingByClass[cls];
    if (peers.length === 0) return cls === "GLR" ? 1000 : 200;
    const mean = peers.reduce((a, b) => a + b.capacityKg, 0) / peers.length;
    return Math.round(mean);
  }, [cls, existingByClass]);
  const [id, setId] = useState(() => suggestNextId("SSR", existingIds));
  const [idTouched, setIdTouched] = useState(false);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(String(initialCapacity));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!idTouched) setId(suggestNextId(cls, existingIds));
    setCapacity(String(initialCapacity));
  }, [cls, idTouched, existingIds, initialCapacity]);

  const submit = () => {
    setError(null);
    const capNum = Number(capacity);
    if (!Number.isFinite(capNum) || capNum <= 0) {
      setError("Capacity must be a positive number.");
      return;
    }
    const result = onAdd({
      id: id.trim(),
      name: name.trim(),
      reactorClass: cls,
      capacityKg: capNum,
    });
    if (!result.ok) setError(result.error);
  };

  return (
    <Card className="!p-4">
      <div className="mb-3 flex items-center gap-2">
        <Beaker size={14} className="text-cyan-300" />
        <h3 className="text-sm font-bold uppercase tracking-wider text-white">
          New Reactor
        </h3>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <Label>Class</Label>
          <ClassToggle value={cls} onChange={setCls} />
        </div>
        <div>
          <Label>ID</Label>
          <input
            type="text"
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setIdTouched(true);
            }}
            placeholder="R101"
            className="cell-yellow w-full rounded-md px-2 py-1.5 font-mono text-sm tabular-nums"
          />
        </div>
        <div>
          <Label>Name (optional)</Label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={id || "defaults to id"}
            className="cell-yellow w-full rounded-md px-2 py-1.5 font-mono text-xs"
          />
        </div>
        <div>
          <Label>Capacity (L)</Label>
          <input
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className="cell-yellow w-full rounded-md px-2 py-1.5 text-right font-mono text-sm tabular-nums"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
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
            onClick={submit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/40 bg-gradient-to-r from-cyan-400/30 to-violet-400/30 px-4 py-2 text-xs font-bold text-white transition hover:from-cyan-400/50 hover:to-violet-400/50 hover:shadow-glow"
          >
            <Check size={13} /> Create Reactor
          </button>
        </div>
      </div>
    </Card>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function ClassToggle({
  value,
  onChange,
}: {
  value: ReactorClass;
  onChange: (v: ReactorClass) => void;
}) {
  return (
    <div className="inline-flex w-full overflow-hidden rounded-md border border-white/10 bg-white/5">
      {CLASS_ORDER.map((opt) => {
        const on = opt === value;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            title={CLASS_FULL[opt]}
            className={clsx(
              "flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition",
              on
                ? "bg-cyan-300/15 text-cyan-200 shadow-[inset_0_0_0_1px_rgba(0,240,255,0.4)]"
                : "text-ink-300 hover:bg-white/5 hover:text-white"
            )}
            aria-pressed={on}
          >
            {CLASS_LABEL[opt]}
          </button>
        );
      })}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-ink-400">
      {children}
    </div>
  );
}

function Th({
  children,
  align = "left",
  yellow,
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  yellow?: boolean;
  className?: string;
}) {
  return (
    <th
      className={clsx(
        "border-b border-white/10 px-3 py-2 font-semibold",
        align === "right" ? "text-right" : "text-left",
        yellow && "text-amber-300",
        className
      )}
    >
      <span className="inline-flex items-center gap-1">
        {yellow && (
          <span className="inline-block h-2 w-2 rounded-sm bg-amber-300/80" />
        )}
        {children}
      </span>
    </th>
  );
}

function EditableTextCell({
  value,
  onCommit,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [local, setLocal] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      ref={ref}
      type="text"
      value={local}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local.trim() && local !== value) onCommit(local);
        else setLocal(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setLocal(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="cell-yellow w-full max-w-[220px] rounded-md px-2 py-1 text-left font-mono text-xs transition"
    />
  );
}

function EditableNumCell({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);
  const commit = () => {
    const parsed = Number(local);
    if (!Number.isFinite(parsed)) {
      setLocal(String(value));
      return;
    }
    const v = Math.max(1, Math.round(parsed));
    if (v !== value) onChange(v);
    setLocal(String(v));
  };
  return (
    <input
      type="number"
      min={1}
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
      className="cell-yellow w-full rounded-md px-2 py-1 text-right font-mono text-sm tabular-nums transition"
    />
  );
}

function classColor(cls: ReactorClass): string {
  return cls === "GLR" ? "#f472b6" : "#00f0ff";
}

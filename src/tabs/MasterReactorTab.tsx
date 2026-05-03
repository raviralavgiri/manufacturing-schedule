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

/**
 * Master Reactor tab — single source of truth for the reactor fleet.
 *
 * What you can do here:
 *   • Add a new reactor (id, name, class, capacity).
 *   • Update an existing reactor's name, class, capacity. The id is
 *     immutable because it's referenced by every stage's `reactorPool`.
 *   • Delete a reactor with safety guards: blocked if it's the only
 *     reactor in some stage's pool; otherwise removed from all pools
 *     after confirmation, then schedule recomputes.
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

  // For each stage pool, build a quick lookup: how many stages does this
  // reactor appear in? Used to label the card and gate the delete UX.
  const usageByReactor = useMemo(() => {
    const map: Record<string, { stagesUsing: number; isOnlyInSomePool: boolean }> = {};
    reactors.forEach((r) => {
      map[r.id] = { stagesUsing: 0, isOnlyInSomePool: false };
    });
    apis.forEach((a) =>
      a.stages.forEach((s) => {
        s.reactorPool.forEach((rid) => {
          if (!map[rid]) return;
          map[rid].stagesUsing += 1;
          if (s.reactorPool.length <= 1) map[rid].isOnlyInSomePool = true;
        });
      })
    );
    return map;
  }, [reactors, apis]);

  const reactorsByClass = useMemo(
    () => ({
      Small: reactors.filter((r) => r.reactorClass === "Small"),
      Medium: reactors.filter((r) => r.reactorClass === "Medium"),
      Large: reactors.filter((r) => r.reactorClass === "Large"),
    }),
    [reactors]
  );

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Master Reactor"
        subtitle={`${reactors.length} reactors across the fleet. Click any name, class, or capacity to edit. ID is immutable.`}
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
          existingByClass={reactorsByClass}
          onCancel={() => setShowAdd(false)}
          onAdd={(input) => {
            const result = addReactor(input);
            if (result.ok) setShowAdd(false);
            return result;
          }}
        />
      )}

      <Card className="overflow-hidden p-0">
        <div className="space-y-4 p-4">
          {(["Small", "Medium", "Large"] as const).map((cls) => (
            <div key={cls}>
              <div className="mb-1.5 flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{
                    background: classColor(cls),
                    boxShadow: `0 0 6px ${classColor(cls)}80`,
                  }}
                />
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-300">
                  {cls} ({reactorsByClass[cls].length})
                </span>
              </div>
              {reactorsByClass[cls].length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-3 text-xs text-ink-400">
                  No {cls.toLowerCase()} reactors. Add one above to make this
                  class available to stage pools.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {reactorsByClass[cls].map((r) => (
                    <ReactorCard
                      key={r.id}
                      id={r.id}
                      name={r.name}
                      reactorClass={r.reactorClass}
                      capacityKg={r.capacityKg}
                      stagesUsing={usageByReactor[r.id]?.stagesUsing ?? 0}
                      onName={(v) => setReactorName(r.id, v)}
                      onClass={(c) => setReactorClass(r.id, c)}
                      onCapacity={(v) => setReactorCapacity(r.id, v)}
                      onDelete={(cascade) =>
                        removeReactor(r.id, { cascade })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
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

// ─── Single reactor card ─────────────────────────────────────────────────────

function ReactorCard({
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
    // First pass: no cascade. We expect this to fail with an in-use error if
    // the reactor is referenced by ≥1 stage; or with a blocking error if any
    // referencing pool would be left empty.
    const probe = onDelete(false);
    if (probe.ok) {
      // Reactor was unused — done.
      return;
    }
    if (probe.blockingStages && probe.blockingStages.length > 0) {
      // Hard block — surface error, do not enter confirm state.
      setError(probe.error);
      return;
    }
    // In-use but safe to cascade — ask for confirmation.
    setConfirmDelete(true);
  };

  const confirm = () => {
    const result = onDelete(true);
    if (!result.ok) setError(result.error);
    setConfirmDelete(false);
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 transition hover:border-white/20">
      <div className="mb-2 flex items-start gap-2">
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-sm"
          style={{
            background: classColor(reactorClass),
            boxShadow: `0 0 6px ${classColor(reactorClass)}80`,
          }}
        />
        <div className="flex-1 overflow-hidden">
          <EditableTextCell
            value={name}
            onCommit={onName}
            placeholder={id}
            ariaLabel={`Reactor ${id} display name`}
          />
          <div className="mt-1 flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-ink-500">
            <span title="Stable internal id (immutable)">
              <Lock size={9} className="mr-0.5 inline opacity-70" /> id: {id}
            </span>
            {stagesUsing > 0 && (
              <>
                <span>·</span>
                <span className="text-violet-300">
                  used by {stagesUsing} stage{stagesUsing === 1 ? "" : "s"}
                </span>
              </>
            )}
          </div>
        </div>
        {!confirmDelete && (
          <button
            onClick={tryDelete}
            className="rounded-md p-1.5 text-ink-400 transition hover:bg-rose-400/15 hover:text-rose-300"
            title="Delete reactor"
            aria-label={`Delete reactor ${id}`}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="mb-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-400">
            Class
          </div>
          <ClassToggle value={reactorClass} onChange={onClass} />
        </div>
        <div>
          <div className="mb-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-400">
            Capacity (L)
          </div>
          <EditableNumCell value={capacityKg} onChange={onCapacity} />
        </div>
      </div>

      {confirmDelete && (
        <div className="mt-3 rounded-md border border-rose-300/30 bg-rose-400/10 p-2 text-[11px] text-rose-200">
          <div className="mb-1.5 font-semibold">
            Reactor <span className="font-mono">{id}</span> is in {stagesUsing}{" "}
            stage pool{stagesUsing === 1 ? "" : "s"}. Confirming will remove it
            from those pools and recompute the schedule.
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
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-rose-300/30 bg-rose-400/10 p-2 text-[10px] text-rose-200">
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
    </div>
  );
}

// ─── Add Reactor form ────────────────────────────────────────────────────────

const CLASS_PREFIX: Record<ReactorClass, string> = {
  Small: "R1",
  Medium: "R2",
  Large: "R3",
};

function suggestNextId(
  cls: ReactorClass,
  existingIds: string[]
): string {
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
  // Default starting numbers per class: Small=01, Medium=01, Large=01
  // (combined with prefix R1/R2/R3 → R101, R201, R301).
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
  existingByClass: Record<
    ReactorClass,
    { id: string; capacityKg: number }[]
  >;
  onCancel: () => void;
  onAdd: (input: {
    id: string;
    name: string;
    reactorClass: ReactorClass;
    capacityKg: number;
  }) => { ok: true; id: string } | { ok: false; error: string };
}) {
  const [cls, setCls] = useState<ReactorClass>("Small");
  // Default capacity = mean capacity of the chosen class, or 200/500/1000
  // fallback if the class is empty.
  const initialCapacity = useMemo(() => {
    const peers = existingByClass[cls];
    if (peers.length === 0) return cls === "Small" ? 200 : cls === "Medium" ? 500 : 1000;
    const mean =
      peers.reduce((a, b) => a + b.capacityKg, 0) / peers.length;
    return Math.round(mean);
  }, [cls, existingByClass]);
  const [id, setId] = useState(() => suggestNextId("Small", existingIds));
  const [idTouched, setIdTouched] = useState(false);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(String(initialCapacity));
  const [error, setError] = useState<string | null>(null);

  // When user changes class and hasn't typed a custom id, refresh the
  // suggestion. Same for capacity.
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
  const options: ReactorClass[] = ["Small", "Medium", "Large"];
  return (
    <div className="inline-flex w-full overflow-hidden rounded-md border border-white/10 bg-white/5">
      {options.map((opt) => {
        const on = opt === value;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={clsx(
              "flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition",
              on
                ? "bg-cyan-300/15 text-cyan-200 shadow-[inset_0_0_0_1px_rgba(0,240,255,0.4)]"
                : "text-ink-300 hover:bg-white/5 hover:text-white"
            )}
            aria-pressed={on}
          >
            {opt[0]}
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
      className="cell-yellow w-full rounded-md px-2 py-1 text-left font-mono text-xs transition"
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
  if (cls === "Small") return "#00f0ff";
  if (cls === "Medium") return "#a78bfa";
  return "#f472b6";
}

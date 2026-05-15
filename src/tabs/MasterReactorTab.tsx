import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Beaker,
  Building2,
  Check,
  Lock,
  Plus,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader } from "../components/Primitives";
import {
  AGITATOR_VALUES,
  MOC_VALUES,
  REACTOR_CLASS_VALUES,
  type AgitatorType,
  type MOC,
  type ReactorClass,
} from "../types";

const MOC_FULL: Record<MOC, string> = {
  SS: "Stainless Steel",
  GL: "Glass Lined",
  Hastelloy: "Hastelloy",
  "Halar lined": "Halar lined",
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

function msToDateInput(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function dateInputToMs(s: string): number | undefined {
  if (!s) return undefined;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : undefined;
}

// ─── Sub-tab type ─────────────────────────────────────────────────────────────

type SubTab = "fleet" | "maintenance";

// ─── Root component ───────────────────────────────────────────────────────────

export default function MasterReactorTab() {
  const reactors = useStore((s) => s.reactors);
  const apis = useStore((s) => s.apis);
  const setReactorName = useStore((s) => s.setReactorName);
  const setReactorMoc = useStore((s) => s.setReactorMoc);
  const setReactorAgitator = useStore((s) => s.setReactorAgitator);
  const setReactorCapacity = useStore((s) => s.setReactorCapacity);
  const setReactorClass = useStore((s) => s.setReactorClass);
  const setReactorProductionBlock = useStore((s) => s.setReactorProductionBlock);
  const setReactorPmFirstDate = useStore((s) => s.setReactorPmFirstDate);
  const setReactorPmDuration = useStore((s) => s.setReactorPmDuration);
  const setReactorBuildingMaintenanceFirstDate = useStore(
    (s) => s.setReactorBuildingMaintenanceFirstDate
  );
  const addReactor = useStore((s) => s.addReactor);
  const removeReactor = useStore((s) => s.removeReactor);

  const [activeTab, setActiveTab] = useState<SubTab>("fleet");
  const [showAdd, setShowAdd] = useState(false);

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
      const ai = MOC_VALUES.indexOf(a.moc);
      const bi = MOC_VALUES.indexOf(b.moc);
      if (ai !== bi) return ai - bi;
      return a.id.localeCompare(b.id);
    });
    const buckets: Record<MOC, typeof sorted> = {
      SS: [],
      GL: [],
      Hastelloy: [],
      "Halar lined": [],
    };
    sorted.forEach((r) => buckets[r.moc].push(r));
    return buckets;
  }, [reactors]);

  // Count reactors that have any maintenance configured (badge on tab)
  const maintConfigured = reactors.filter(
    (r) => r.pmFirstDateMs != null || r.buildingMaintenanceFirstDateMs != null
  ).length;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Master Reactor"
        subtitle={`${reactors.length} reactors · ${MOC_VALUES
          .map((m) => `${groupedReactors[m].length} ${m}`)
          .join(", ")} · Click any field to edit; ID is immutable.`}
        right={
          activeTab === "fleet" ? (
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
          ) : null
        }
      />

      {/* ── Sub-tab pill nav ──────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1 w-fit">
        <SubTabBtn
          active={activeTab === "fleet"}
          onClick={() => setActiveTab("fleet")}
          icon={<Beaker size={13} />}
          label="Reactor Fleet"
        />
        <SubTabBtn
          active={activeTab === "maintenance"}
          onClick={() => setActiveTab("maintenance")}
          icon={<Wrench size={13} />}
          label="Maintenance Schedule"
          badge={maintConfigured > 0 ? maintConfigured : undefined}
        />
      </div>

      {/* ── Fleet sub-tab ─────────────────────────────────────────────── */}
      {activeTab === "fleet" && (
        <>
          {showAdd && (
            <AddReactorForm
              existingIds={reactors.map((r) => r.id)}
              existingByMoc={groupedReactors}
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
                    <Th className="w-20">ID</Th>
                    <Th yellow>Name</Th>
                    <Th yellow className="w-32">MOC</Th>
                    <Th yellow className="w-28">Agitator</Th>
                    <Th yellow className="w-28">Class</Th>
                    <Th yellow className="w-28">Block</Th>
                    <Th yellow align="right" className="w-24">Cap. (L)</Th>
                    <Th align="right" className="w-28">Used By</Th>
                    <Th align="right" className="w-10">&nbsp;</Th>
                  </tr>
                </thead>
                <tbody>
                  {MOC_VALUES.map((moc) => (
                    <FleetMocGroup
                      key={moc}
                      moc={moc}
                      list={groupedReactors[moc]}
                      usageByReactor={usageByReactor}
                      onName={setReactorName}
                      onMoc={setReactorMoc}
                      onAgitator={setReactorAgitator}
                      onCapacity={setReactorCapacity}
                      onClass={setReactorClass}
                      onBlock={setReactorProductionBlock}
                      onDelete={removeReactor}
                    />
                  ))}
                  {reactors.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-sm text-ink-300">
                        No reactors yet. Click{" "}
                        <span className="font-bold text-cyan-300">+ Add Reactor</span>{" "}
                        above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-ink-300">
            <span className="mr-1 font-bold text-ink-100">
              <Lock size={11} className="inline" /> ID is immutable:
            </span>
            Stage reactor pools reference reactors by id. Renaming is a display
            change only; deleting rewrites every stage's pool to drop that id.
          </div>
        </>
      )}

      {/* ── Maintenance Schedule sub-tab ──────────────────────────────── */}
      {activeTab === "maintenance" && (
        <MaintenanceTab
          reactors={reactors}
          groupedReactors={groupedReactors}
          onPmFirstDate={setReactorPmFirstDate}
          onPmDuration={setReactorPmDuration}
          onBuildingMaintenanceFirstDate={setReactorBuildingMaintenanceFirstDate}
        />
      )}
    </div>
  );
}

// ─── Sub-tab button ───────────────────────────────────────────────────────────

function SubTabBtn({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
        active
          ? "bg-white/10 text-white shadow-sm"
          : "text-ink-400 hover:text-ink-200"
      )}
    >
      {icon}
      {label}
      {badge != null && (
        <span className="ml-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-400/80 px-1 text-[9px] font-bold text-ink-900">
          {badge}
        </span>
      )}
    </button>
  );
}

// ─── Fleet sub-tab: MOC group ─────────────────────────────────────────────────

function FleetMocGroup({
  moc,
  list,
  usageByReactor,
  onName,
  onMoc,
  onAgitator,
  onCapacity,
  onClass,
  onBlock,
  onDelete,
}: {
  moc: MOC;
  list: {
    id: string;
    name: string;
    moc: MOC;
    agitatorType: AgitatorType;
    capacityKg: number;
    reactorClass?: ReactorClass;
    productionBlock?: string;
  }[];
  usageByReactor: Record<string, number>;
  onName: (rid: string, v: string) => void;
  onMoc: (rid: string, v: MOC) => void;
  onAgitator: (rid: string, v: AgitatorType) => void;
  onCapacity: (rid: string, v: number) => void;
  onClass: (rid: string, v: ReactorClass | undefined) => void;
  onBlock: (rid: string, v: string) => void;
  onDelete: (rid: string, opts?: { cascade?: boolean }) =>
    | { ok: true }
    | { ok: false; error: string; blockingStages?: string[] };
}) {
  const COLS = 10;
  return (
    <>
      <tr className="bg-white/[0.04]">
        <td colSpan={COLS} className="px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: mocColor(moc), boxShadow: `0 0 6px ${mocColor(moc)}80` }}
            />
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-200">
              {MOC_FULL[moc]} ({list.length})
            </span>
            <span className="text-[10px] text-ink-500">· {moc}</span>
          </div>
        </td>
      </tr>
      {list.length === 0 ? (
        <tr>
          <td colSpan={COLS} className="border-t border-white/5 px-3 py-3 text-xs text-ink-400">
            No {MOC_FULL[moc].toLowerCase()} reactors.
          </td>
        </tr>
      ) : (
        list.map((r, i) => (
          <FleetRow
            key={r.id}
            zebra={i % 2 === 0}
            cols={COLS}
            id={r.id}
            name={r.name}
            moc={r.moc}
            agitatorType={r.agitatorType}
            capacityKg={r.capacityKg}
            reactorClass={r.reactorClass}
            productionBlock={r.productionBlock}
            stagesUsing={usageByReactor[r.id] ?? 0}
            onName={(v) => onName(r.id, v)}
            onMoc={(v) => onMoc(r.id, v)}
            onAgitator={(v) => onAgitator(r.id, v)}
            onCapacity={(v) => onCapacity(r.id, v)}
            onClass={(v) => onClass(r.id, v)}
            onBlock={(v) => onBlock(r.id, v)}
            onDelete={(cascade) => onDelete(r.id, { cascade })}
          />
        ))
      )}
    </>
  );
}

// ─── Fleet sub-tab: single row ────────────────────────────────────────────────

function FleetRow({
  zebra,
  cols,
  id,
  name,
  moc,
  agitatorType,
  capacityKg,
  reactorClass,
  productionBlock,
  stagesUsing,
  onName,
  onMoc,
  onAgitator,
  onCapacity,
  onClass,
  onBlock,
  onDelete,
}: {
  zebra: boolean;
  cols: number;
  id: string;
  name: string;
  moc: MOC;
  agitatorType: AgitatorType;
  capacityKg: number;
  reactorClass?: ReactorClass;
  productionBlock?: string;
  stagesUsing: number;
  onName: (v: string) => void;
  onMoc: (v: MOC) => void;
  onAgitator: (v: AgitatorType) => void;
  onCapacity: (v: number) => void;
  onClass: (v: ReactorClass | undefined) => void;
  onBlock: (v: string) => void;
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

  return (
    <>
      <tr className={clsx("border-t border-white/5 transition hover:bg-white/[0.04]", zebra && "bg-white/[0.01]")}>
        <td className="px-3 py-2.5">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: mocColor(moc), boxShadow: `0 0 6px ${mocColor(moc)}80` }}
          />
        </td>
        <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-ink-200">
          <span className="inline-flex items-center gap-1.5" title="Immutable ID">
            <Lock size={10} className="text-ink-500" />
            {id}
          </span>
        </td>
        <td className="px-3 py-2">
          <EditableTextCell value={name} onCommit={onName} placeholder={id} />
        </td>
        <td className="px-3 py-2">
          <SelectCell
            value={moc}
            options={MOC_VALUES as readonly string[] as readonly MOC[]}
            onChange={(v) => onMoc(v as MOC)}
          />
        </td>
        <td className="px-3 py-2">
          <SelectCell
            value={agitatorType}
            options={AGITATOR_VALUES as readonly string[] as readonly AgitatorType[]}
            onChange={(v) => onAgitator(v as AgitatorType)}
          />
        </td>
        <td className="px-3 py-2">
          <SelectCell
            value={reactorClass ?? ""}
            options={["", ...REACTOR_CLASS_VALUES] as readonly string[]}
            onChange={(v) => onClass(v ? (v as ReactorClass) : undefined)}
            emptyLabel="— not set —"
            colorize={(v) =>
              v === "Cleanroom" ? "text-sky-300"
              : v === "Intermediate" ? "text-violet-300"
              : "text-ink-400"
            }
          />
        </td>
        <td className="px-3 py-2">
          <EditableTextCell
            value={productionBlock ?? ""}
            onCommit={onBlock}
            placeholder="e.g. Block A"
          />
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
          >
            <Trash2 size={13} />
          </button>
        </td>
      </tr>
      {(confirmDelete || error) && (
        <tr className={clsx("border-t border-white/5", zebra && "bg-white/[0.01]")}>
          <td colSpan={cols} className="px-3 pb-3">
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
                    onClick={() => {
                      const r = onDelete(true);
                      if (!r.ok) setError(r.error);
                      setConfirmDelete(false);
                    }}
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
                <button onClick={() => setError(null)} className="shrink-0 text-rose-200/70 hover:text-rose-200">
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

// ─── Maintenance Schedule sub-tab ─────────────────────────────────────────────

function MaintenanceTab({
  reactors,
  groupedReactors,
  onPmFirstDate,
  onPmDuration,
  onBuildingMaintenanceFirstDate,
}: {
  reactors: {
    id: string;
    name: string;
    moc: MOC;
    reactorClass?: ReactorClass;
    productionBlock?: string;
    pmFirstDateMs?: number;
    pmDurationDays?: number;
    buildingMaintenanceFirstDateMs?: number;
  }[];
  groupedReactors: Record<
    MOC,
    {
      id: string;
      name: string;
      moc: MOC;
      reactorClass?: ReactorClass;
      productionBlock?: string;
      pmFirstDateMs?: number;
      pmDurationDays?: number;
      buildingMaintenanceFirstDateMs?: number;
    }[]
  >;
  onPmFirstDate: (rid: string, ms: number | undefined) => void;
  onPmDuration: (rid: string, days: number) => void;
  onBuildingMaintenanceFirstDate: (rid: string, ms: number | undefined) => void;
}) {
  const COLS = 9;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-200">
        <span className="mr-1 font-bold">
          <Wrench size={12} className="inline" /> PM:
        </span>
        Preventive maintenance recurs every <strong>90 days</strong> from the first PM date.
        The reactor is unavailable for the configured duration.{" "}
        <span className="mr-1 font-bold">
          <Building2 size={12} className="inline" /> Building Maint.:
        </span>
        Applies only to <span className="text-sky-300 font-semibold">Cleanroom</span> reactors.
        Recurs every <strong>90 days</strong>, blocking the reactor for <strong>2 days</strong> per cycle.
        The scheduler skips both window types automatically.
      </div>

      <Card className="overflow-hidden p-0">
        <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-ink-900/90 backdrop-blur-md">
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-300">
                <Th className="w-8">&nbsp;</Th>
                <Th className="w-20">ID</Th>
                <Th className="w-32">Name</Th>
                <Th className="w-24">Class</Th>
                <Th className="w-28">Block</Th>
                <Th yellow className="w-36">
                  <Wrench size={10} className="inline mr-1" />PM First Date
                </Th>
                <Th yellow className="w-28">
                  PM Duration (days)
                </Th>
                <Th yellow className="w-40">
                  <Building2 size={10} className="inline mr-1" />Bldg Maint. First Date
                </Th>
                <Th className="w-20">&nbsp;</Th>
              </tr>
            </thead>
            <tbody>
              {MOC_VALUES.map((moc) => {
                const list = groupedReactors[moc];
                return (
                  <MaintMocGroup
                    key={moc}
                    moc={moc}
                    list={list}
                    cols={COLS}
                    onPmFirstDate={onPmFirstDate}
                    onPmDuration={onPmDuration}
                    onBuildingMaintenanceFirstDate={onBuildingMaintenanceFirstDate}
                  />
                );
              })}
              {reactors.length === 0 && (
                <tr>
                  <td colSpan={COLS} className="py-12 text-center text-sm text-ink-300">
                    No reactors yet. Add reactors in the{" "}
                    <span className="font-bold text-cyan-300">Reactor Fleet</span> tab.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Maintenance sub-tab: MOC group ──────────────────────────────────────────

function MaintMocGroup({
  moc,
  list,
  cols,
  onPmFirstDate,
  onPmDuration,
  onBuildingMaintenanceFirstDate,
}: {
  moc: MOC;
  list: {
    id: string;
    name: string;
    moc: MOC;
    reactorClass?: ReactorClass;
    productionBlock?: string;
    pmFirstDateMs?: number;
    pmDurationDays?: number;
    buildingMaintenanceFirstDateMs?: number;
  }[];
  cols: number;
  onPmFirstDate: (rid: string, ms: number | undefined) => void;
  onPmDuration: (rid: string, days: number) => void;
  onBuildingMaintenanceFirstDate: (rid: string, ms: number | undefined) => void;
}) {
  return (
    <>
      <tr className="bg-white/[0.04]">
        <td colSpan={cols} className="px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: mocColor(moc), boxShadow: `0 0 6px ${mocColor(moc)}80` }}
            />
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-200">
              {MOC_FULL[moc]} ({list.length})
            </span>
          </div>
        </td>
      </tr>
      {list.length === 0 ? (
        <tr>
          <td colSpan={cols} className="border-t border-white/5 px-3 py-3 text-xs text-ink-400">
            No {MOC_FULL[moc].toLowerCase()} reactors.
          </td>
        </tr>
      ) : (
        list.map((r, i) => (
          <MaintRow
            key={r.id}
            zebra={i % 2 === 0}
            cols={cols}
            id={r.id}
            name={r.name}
            moc={r.moc}
            reactorClass={r.reactorClass}
            productionBlock={r.productionBlock}
            pmFirstDateMs={r.pmFirstDateMs}
            pmDurationDays={r.pmDurationDays}
            buildingMaintenanceFirstDateMs={r.buildingMaintenanceFirstDateMs}
            onPmFirstDate={(ms) => onPmFirstDate(r.id, ms)}
            onPmDuration={(d) => onPmDuration(r.id, d)}
            onBuildingMaintenanceFirstDate={(ms) => onBuildingMaintenanceFirstDate(r.id, ms)}
          />
        ))
      )}
    </>
  );
}

// ─── Maintenance sub-tab: single row ─────────────────────────────────────────

function MaintRow({
  zebra,
  cols,
  id,
  name,
  moc,
  reactorClass,
  productionBlock,
  pmFirstDateMs,
  pmDurationDays,
  buildingMaintenanceFirstDateMs,
  onPmFirstDate,
  onPmDuration,
  onBuildingMaintenanceFirstDate,
}: {
  zebra: boolean;
  cols: number;
  id: string;
  name: string;
  moc: MOC;
  reactorClass?: ReactorClass;
  productionBlock?: string;
  pmFirstDateMs?: number;
  pmDurationDays?: number;
  buildingMaintenanceFirstDateMs?: number;
  onPmFirstDate: (ms: number | undefined) => void;
  onPmDuration: (days: number) => void;
  onBuildingMaintenanceFirstDate: (ms: number | undefined) => void;
}) {
  const isCleanroom = reactorClass === "Cleanroom";
  const hasPm = pmFirstDateMs != null && Number.isFinite(pmFirstDateMs);
  const hasBm = buildingMaintenanceFirstDateMs != null && Number.isFinite(buildingMaintenanceFirstDateMs);

  return (
    <tr className={clsx("border-t border-white/5 transition hover:bg-white/[0.04]", zebra && "bg-white/[0.01]")}>
      {/* MOC dot */}
      <td className="px-3 py-2.5">
        <span
          className="inline-block h-2 w-2 rounded-sm"
          style={{ background: mocColor(moc), boxShadow: `0 0 6px ${mocColor(moc)}80` }}
        />
      </td>

      {/* ID */}
      <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-ink-200">
        <span className="inline-flex items-center gap-1.5">
          <Lock size={10} className="text-ink-500" />
          {id}
        </span>
      </td>

      {/* Name (read-only label) */}
      <td className="px-3 py-2.5 text-xs text-ink-300">{name || id}</td>

      {/* Class badge */}
      <td className="px-3 py-2.5">
        {reactorClass ? (
          <span
            className={clsx(
              "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
              isCleanroom
                ? "bg-sky-400/15 text-sky-300"
                : "bg-violet-400/15 text-violet-300"
            )}
          >
            {reactorClass}
          </span>
        ) : (
          <span className="text-[10px] text-ink-500">—</span>
        )}
      </td>

      {/* Block */}
      <td className="px-3 py-2.5 text-xs text-ink-400">
        {productionBlock || <span className="text-ink-600">—</span>}
      </td>

      {/* PM First Date */}
      <td className="px-3 py-2">
        <input
          type="date"
          value={msToDateInput(pmFirstDateMs)}
          onChange={(e) => onPmFirstDate(dateInputToMs(e.target.value))}
          title="First preventive maintenance start date (repeats every 90 days)"
          className="cell-yellow rounded-md px-2 py-1 font-mono text-xs tabular-nums w-36"
        />
      </td>

      {/* PM Duration */}
      <td className="px-3 py-2">
        <input
          type="number"
          min={1}
          max={90}
          value={pmDurationDays ?? 7}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 1) onPmDuration(Math.round(v));
          }}
          disabled={!hasPm}
          title="Duration of each PM window in days"
          className={clsx(
            "cell-yellow w-20 rounded-md px-2 py-1 text-right font-mono text-xs tabular-nums",
            !hasPm && "opacity-30 cursor-not-allowed"
          )}
        />
      </td>

      {/* Building Maint. First Date */}
      <td className="px-3 py-2">
        {isCleanroom ? (
          <input
            type="date"
            value={msToDateInput(buildingMaintenanceFirstDateMs)}
            onChange={(e) => onBuildingMaintenanceFirstDate(dateInputToMs(e.target.value))}
            title="First building maintenance date for this reactor's production block (repeats every 90 days, blocks 2 days)"
            className="cell-yellow rounded-md px-2 py-1 font-mono text-xs tabular-nums w-36"
          />
        ) : (
          <span className="text-[10px] text-ink-600" title="Set Class = Cleanroom to enable">
            — Cleanroom only —
          </span>
        )}
      </td>

      {/* Clear buttons */}
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1">
          {hasPm && (
            <button
              onClick={() => onPmFirstDate(undefined)}
              className="rounded px-1.5 py-0.5 text-[9px] font-semibold text-rose-400/80 hover:text-rose-300 border border-rose-300/20 hover:bg-rose-400/10 transition"
              title="Clear PM date"
            >
              Clear PM
            </button>
          )}
          {hasBm && isCleanroom && (
            <button
              onClick={() => onBuildingMaintenanceFirstDate(undefined)}
              className="rounded px-1.5 py-0.5 text-[9px] font-semibold text-rose-400/80 hover:text-rose-300 border border-rose-300/20 hover:bg-rose-400/10 transition"
              title="Clear building maintenance date"
            >
              Clear BM
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Add Reactor form ─────────────────────────────────────────────────────────

const MOC_PREFIX: Record<MOC, string> = {
  SS: "R1",
  GL: "R3",
  Hastelloy: "R4",
  "Halar lined": "R5",
};

function suggestNextId(moc: MOC, existingIds: string[]): string {
  const prefix = MOC_PREFIX[moc];
  const used = new Set<number>();
  existingIds.forEach((id) => {
    if (!id.startsWith(prefix)) return;
    const n = Number(id.slice(prefix.length));
    if (Number.isFinite(n)) used.add(n);
  });
  for (let n = 1; n < 1000; n++) {
    if (!used.has(n)) return `${prefix}${String(n).padStart(2, "0")}`;
  }
  return `${prefix}${Date.now()}`;
}

function AddReactorForm({
  existingIds,
  existingByMoc,
  onCancel,
  onAdd,
}: {
  existingIds: string[];
  existingByMoc: Record<MOC, { id: string; capacityKg: number }[]>;
  onCancel: () => void;
  onAdd: (input: {
    id: string;
    name: string;
    moc: MOC;
    agitatorType: AgitatorType;
    capacityKg: number;
  }) => { ok: true; id: string } | { ok: false; error: string };
}) {
  const [moc, setMoc] = useState<MOC>("SS");
  const [agitator, setAgitator] = useState<AgitatorType>("Anchor");
  const initialCapacity = useMemo(() => {
    const peers = existingByMoc[moc];
    if (peers.length === 0) return moc === "GL" ? 1000 : 200;
    return Math.round(peers.reduce((a, b) => a + b.capacityKg, 0) / peers.length);
  }, [moc, existingByMoc]);
  const [id, setId] = useState(() => suggestNextId("SS", existingIds));
  const [idTouched, setIdTouched] = useState(false);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(String(initialCapacity));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!idTouched) setId(suggestNextId(moc, existingIds));
    setCapacity(String(initialCapacity));
  }, [moc, idTouched, existingIds, initialCapacity]);

  const submit = () => {
    setError(null);
    const capNum = Number(capacity);
    if (!Number.isFinite(capNum) || capNum <= 0) {
      setError("Capacity must be a positive number.");
      return;
    }
    const result = onAdd({ id: id.trim(), name: name.trim(), moc, agitatorType: agitator, capacityKg: capNum });
    if (!result.ok) setError(result.error);
  };

  return (
    <Card className="!p-4">
      <div className="mb-3 flex items-center gap-2">
        <Beaker size={14} className="text-cyan-300" />
        <h3 className="text-sm font-bold uppercase tracking-wider text-white">New Reactor</h3>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
        <div>
          <Label>MOC</Label>
          <SelectCell
            value={moc}
            options={MOC_VALUES as readonly string[] as readonly MOC[]}
            onChange={(v) => setMoc(v as MOC)}
          />
        </div>
        <div>
          <Label>Agitator</Label>
          <SelectCell
            value={agitator}
            options={AGITATOR_VALUES as readonly string[] as readonly AgitatorType[]}
            onChange={(v) => setAgitator(v as AgitatorType)}
          />
        </div>
        <div>
          <Label>ID</Label>
          <input
            type="text"
            value={id}
            onChange={(e) => { setId(e.target.value); setIdTouched(true); }}
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
      <p className="mt-2 text-[10px] text-ink-400">
        Class, Production Block, and maintenance dates are configured in the{" "}
        <span className="text-amber-300 font-semibold">Maintenance Schedule</span> tab after creation.
      </p>
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

// ─── Shared helpers ───────────────────────────────────────────────────────────

function SelectCell<T extends string>({
  value,
  options,
  onChange,
  emptyLabel,
  colorize,
}: {
  value: T | "";
  options: readonly (T | "")[];
  onChange: (v: T | "") => void;
  emptyLabel?: string;
  colorize?: (v: string) => string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T | "")}
      className={clsx(
        "cell-yellow w-full rounded-md border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-left font-mono text-[11px] tabular-nums text-amber-100 transition focus:border-cyan-300/50 focus:outline-none",
        colorize && colorize(value)
      )}
    >
      {options.map((opt) => (
        <option key={opt} value={opt} className="bg-ink-900 text-white">
          {opt === "" ? (emptyLabel ?? "—") : opt}
        </option>
      ))}
    </select>
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
  title,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  yellow?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <th
      title={title}
      className={clsx(
        "border-b border-white/10 px-3 py-2 font-semibold",
        align === "right" ? "text-right" : "text-left",
        yellow && "text-amber-300",
        className
      )}
    >
      <span className="inline-flex items-center gap-1">
        {yellow && <span className="inline-block h-2 w-2 rounded-sm bg-amber-300/80" />}
        {children}
      </span>
    </th>
  );
}

function EditableTextCell({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
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
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onCommit(local); else setLocal(value); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setLocal(value); (e.target as HTMLInputElement).blur(); }
      }}
      className="cell-yellow w-full max-w-[180px] rounded-md px-2 py-1 text-left font-mono text-xs transition"
    />
  );
}

function EditableNumCell({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);
  const commit = () => {
    const parsed = Number(local);
    if (!Number.isFinite(parsed)) { setLocal(String(value)); return; }
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
        if (e.key === "Escape") { setLocal(String(value)); (e.target as HTMLInputElement).blur(); }
      }}
      className="cell-yellow w-full rounded-md px-2 py-1 text-right font-mono text-sm tabular-nums transition"
    />
  );
}

function mocColor(moc: MOC): string {
  switch (moc) {
    case "GL": return "#f472b6";
    case "Hastelloy": return "#a78bfa";
    case "Halar lined": return "#fbbf24";
    case "SS":
    default: return "#00f0ff";
  }
}

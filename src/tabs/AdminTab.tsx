import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Cloud,
  HardDrive,
  Inbox,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader, Tag } from "../components/Primitives";
import {
  persistedSavedAt,
  persistedSizeBytes,
  type DataSource,
} from "../utils/storage";
import { isSupabaseEnabled } from "../services/supabase";
import { fmtDate } from "../utils/dates";

/**
 * Admin tab — control where the app reads from on boot and where it writes.
 *
 *   • "Cloud"  (default) → Supabase is the source of truth on boot. Writes
 *                          go to Supabase; localStorage is updated as a
 *                          silent backup.
 *   • "Local"            → localStorage is the source of truth. No
 *                          Supabase calls at all.
 *
 * Switching modes is just a flag flip — local cache is always kept in sync
 * even in cloud mode, so going cloud→local is friction-free. Going
 * local→cloud benefits from an explicit Push or Pull first; the buttons
 * make the data direction unambiguous.
 */
export default function AdminTab() {
  const dataSource = useStore((s) => s.dataSource);
  const isHydrating = useStore((s) => s.isHydrating);
  const cloudError = useStore((s) => s.cloudError);
  const projects = useStore((s) => s.projects);
  const lastCloudRead = useStore((s) => s.lastCloudRead);
  const setDataSource = useStore((s) => s.setDataSource);
  const pushToCloud = useStore((s) => s.pushToCloud);
  const pullFromCloud = useStore((s) => s.pullFromCloud);
  const refreshCloudSnapshot = useStore((s) => s.refreshCloudSnapshot);
  const clearLocalCache = useStore((s) => s.clearLocalCache);

  const [busy, setBusy] = useState<
    null | "push" | "pull" | "clear" | "refresh"
  >(null);
  const [opMessage, setOpMessage] = useState<
    null | { tone: "ok" | "err"; text: string }
  >(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Auto-refresh the cloud snapshot when the Admin tab mounts so the
  // comparison panel below always shows fresh numbers. Only fires when
  // Supabase is configured — local-only deployments skip the call.
  useEffect(() => {
    if (!isSupabaseEnabled) return;
    void refreshCloudSnapshot();
    // We deliberately only run on mount — manual Refresh button covers
    // re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Local cache stats — recomputed cheaply on every render; storage reads
  // are sync and tiny (~few KB).
  const localStats = useMemo(() => {
    const bytes = persistedSizeBytes();
    const savedAt = persistedSavedAt();
    return {
      bytes,
      kb: bytes > 0 ? Math.max(1, Math.round(bytes / 1024)) : 0,
      savedAt,
    };
  }, [projects, dataSource, busy]);

  useEffect(() => {
    if (!opMessage) return;
    const t = window.setTimeout(() => setOpMessage(null), 4000);
    return () => window.clearTimeout(t);
  }, [opMessage]);

  const handleSwitch = (mode: DataSource) => {
    if (mode === dataSource) return;
    setDataSource(mode);
    setOpMessage({
      tone: "ok",
      text:
        mode === "cloud"
          ? "Switched to Cloud. Future writes will sync to Supabase."
          : "Switched to Local. Cloud writes are now disabled.",
    });
  };

  const handlePush = async () => {
    setBusy("push");
    const result = await pushToCloud();
    setBusy(null);
    setOpMessage(
      result.ok
        ? { tone: "ok", text: "Local state pushed to Supabase." }
        : { tone: "err", text: `Push failed: ${result.error}` }
    );
  };

  const handlePull = async () => {
    setBusy("pull");
    const result = await pullFromCloud();
    setBusy(null);
    setOpMessage(
      result.ok
        ? { tone: "ok", text: "Loaded latest data from Supabase." }
        : { tone: "err", text: `Pull failed: ${result.error}` }
    );
  };

  const handleClear = () => {
    setBusy("clear");
    clearLocalCache();
    setBusy(null);
    setConfirmClear(false);
    setOpMessage({
      tone: "ok",
      text: "Local cache cleared. Reload to re-fetch from cloud.",
    });
  };

  const handleRefreshCloud = async () => {
    setBusy("refresh");
    const result = await refreshCloudSnapshot();
    setBusy(null);
    setOpMessage(
      result.ok
        ? {
            tone: "ok",
            text: result.info.isEmpty
              ? "Refreshed — public.projects is empty."
              : `Refreshed — ${result.info.projects.length} project${result.info.projects.length === 1 ? "" : "s"} in public.projects.`,
          }
        : { tone: "err", text: `Refresh failed: ${result.error}` }
    );
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Admin"
        subtitle="Control where the app reads and writes data. Cloud (default) keeps data in Supabase; Local keeps everything in this browser."
      />

      {/* Mode toggle */}
      <Card className="!p-5">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-ink-300">
          Current Data Source
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ModeCard
            mode="cloud"
            active={dataSource === "cloud"}
            disabled={!isSupabaseEnabled}
            onSelect={() => handleSwitch("cloud")}
            title="Cloud (Supabase)"
            subtitle="Default. Reads + writes go to Supabase. Local cache acts as a silent backup."
            icon={<Cloud size={20} />}
          />
          <ModeCard
            mode="local"
            active={dataSource === "local"}
            onSelect={() => handleSwitch("local")}
            title="Local (Browser)"
            subtitle="No cloud calls. Reads + writes are confined to this browser's localStorage."
            icon={<HardDrive size={20} />}
          />
        </div>
        {!isSupabaseEnabled && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-300/30 bg-amber-300/5 p-2.5 text-xs text-amber-200">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <div>
              Supabase is not configured in this build. Cloud mode is unavailable;
              the app is locked to Local.
            </div>
          </div>
        )}
        {cloudError && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-300/30 bg-rose-400/10 p-2.5 text-xs text-rose-200">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>{cloudError}</div>
          </div>
        )}
        {opMessage && (
          <div
            className={clsx(
              "mt-3 flex items-start gap-2 rounded-md border p-2.5 text-xs",
              opMessage.tone === "ok"
                ? "border-lime-300/30 bg-lime-400/10 text-lime-200"
                : "border-rose-300/30 bg-rose-400/10 text-rose-200"
            )}
          >
            {opMessage.tone === "ok" ? (
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            ) : (
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
            )}
            <div>{opMessage.text}</div>
          </div>
        )}
        {dataSource === "cloud" &&
          isSupabaseEnabled &&
          lastCloudRead &&
          lastCloudRead.isEmpty &&
          !lastCloudRead.error && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-300/30 bg-amber-300/5 p-2.5 text-xs text-amber-200">
              <Inbox size={14} className="mt-0.5 shrink-0" />
              <div className="flex-1">
                <span className="font-bold">Cloud table is empty.</span>{" "}
                <code className="font-mono">public.projects</code> has no rows
                yet. You're seeing your local cache below. Click{" "}
                <span className="font-bold">Push local → cloud</span> to seed
                the table with what's currently in this browser, or clear
                local cache to start clean.
              </div>
            </div>
          )}
      </Card>

      {/* Side-by-side stats */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="!p-5">
          <div className="mb-3 flex items-center gap-2">
            <HardDrive size={14} className="text-cyan-300" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">
              Local cache
            </h3>
            {dataSource === "local" && <Tag tone="cyan">Active source</Tag>}
          </div>
          <Stat
            label="Size"
            value={
              localStats.bytes === 0
                ? "(empty)"
                : `${localStats.kb} KB · ${localStats.bytes.toLocaleString()} B`
            }
          />
          <Stat
            label="Last saved"
            value={
              localStats.savedAt
                ? `${fmtDate(localStats.savedAt)} · ${formatRelative(localStats.savedAt)}`
                : "never"
            }
          />
          <Stat
            label="Projects"
            value={`${projects.length} (${projects.reduce((a, p) => a + p.apis.length, 0)} APIs total)`}
          />
        </Card>

        <Card className="!p-5">
          <div className="mb-3 flex items-center gap-2">
            <Cloud size={14} className="text-violet-300" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">
              Cloud (Supabase)
            </h3>
            {dataSource === "cloud" && isSupabaseEnabled && (
              <Tag tone="violet">Active source</Tag>
            )}
            {!isSupabaseEnabled && <Tag tone="rose">Disabled</Tag>}
          </div>
          <Stat
            label="Status"
            value={
              !isSupabaseEnabled
                ? "Not configured"
                : isHydrating
                ? (
                    <span className="inline-flex items-center gap-1.5 text-cyan-300">
                      <Loader2 size={11} className="animate-spin" /> hydrating…
                    </span>
                  )
                : cloudError
                ? <span className="text-rose-300">unreachable</span>
                : <span className="text-lime-300">connected</span>
            }
          />
          <Stat
            label="Mode"
            value={dataSource === "cloud" ? "writes go to cloud" : "writes paused"}
          />
          <Stat
            label="Backing table"
            value={<code className="font-mono text-[11px]">public.projects</code>}
          />
          <Stat
            label="Cloud rows"
            value={
              !isSupabaseEnabled
                ? "—"
                : !lastCloudRead
                ? "(unknown — refreshing)"
                : lastCloudRead.isEmpty
                ? "0"
                : `${lastCloudRead.projects.length}`
            }
          />
          <Stat
            label="Last cloud read"
            value={
              !isSupabaseEnabled
                ? "—"
                : lastCloudRead
                ? renderLastReadSummary(lastCloudRead)
                : "never"
            }
          />
          <Stat
            label="Cloud APIs"
            value={
              !isSupabaseEnabled || !lastCloudRead || lastCloudRead.isEmpty
                ? "—"
                : `${lastCloudRead.projects.reduce((a, p) => a + p.apiCount, 0)} across ${lastCloudRead.projects.length} project${lastCloudRead.projects.length === 1 ? "" : "s"}`
            }
          />
        </Card>
      </div>

      {/* Local vs Cloud comparison */}
      {isSupabaseEnabled && (
        <Card className="!p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                Projects: Local vs Cloud
              </h3>
              <span className="text-[11px] text-ink-400">
                Project-by-project drift detector
              </span>
            </div>
            <button
              onClick={handleRefreshCloud}
              disabled={busy !== null}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-[11px] font-bold text-cyan-200 transition hover:bg-cyan-300/20",
                busy !== null && "cursor-not-allowed opacity-50"
              )}
              title="Re-fetch the cloud row without touching in-memory state"
            >
              {busy === "refresh" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <RefreshCw size={11} />
              )}
              Refresh cloud snapshot
            </button>
          </div>
          <ProjectsComparison
            local={projects.map((p) => ({
              id: p.id,
              name: p.name,
              apiCount: p.apis.length,
              reactorCount: p.reactors.length,
            }))}
            cloud={lastCloudRead}
          />
        </Card>
      )}

      {/* Actions */}
      <Card className="!p-5">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">
            Manual sync actions
          </h3>
          <span className="text-[11px] text-ink-400">
            Useful when switching modes
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ActionButton
            icon={<ArrowUp size={14} />}
            tone="violet"
            disabled={!isSupabaseEnabled || busy !== null}
            label="Push local → cloud"
            description="Reconcile cloud with local: upsert every local project into public.projects and delete any cloud rows whose ids are not in your local set."
            onClick={handlePush}
            loading={busy === "push"}
          />
          <ActionButton
            icon={<ArrowDown size={14} />}
            tone="cyan"
            disabled={!isSupabaseEnabled || busy !== null}
            label="Pull cloud → local"
            description="Replace in-memory + local cache with the full set of rows from public.projects. Discards local-only projects and edits."
            onClick={handlePull}
            loading={busy === "pull"}
          />
          {confirmClear ? (
            <div className="flex flex-col gap-2 rounded-xl border border-rose-300/30 bg-rose-400/10 p-3">
              <span className="text-[11px] font-semibold text-rose-200">
                Wipe local cache? You'll lose any edits not yet pushed to cloud.
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleClear}
                  disabled={busy !== null}
                  className="flex-1 rounded-md border border-rose-300/40 bg-rose-400/20 px-2 py-1 text-[11px] font-bold text-rose-200 hover:bg-rose-400/30"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-ink-200 hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <ActionButton
              icon={<Trash2 size={14} />}
              tone="rose"
              disabled={busy !== null}
              label="Clear local cache"
              description="Remove the projects JSON from this browser's localStorage. Your data source mode preference is preserved."
              onClick={() => setConfirmClear(true)}
              loading={busy === "clear"}
            />
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

function ModeCard({
  active,
  disabled,
  onSelect,
  title,
  subtitle,
  icon,
}: {
  mode: DataSource;
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={clsx(
        "flex flex-col gap-1.5 rounded-xl border p-4 text-left transition",
        active
          ? "border-cyan-300/50 bg-gradient-to-br from-cyan-300/15 to-violet-300/10 shadow-[0_0_16px_rgba(0,240,255,0.25)]"
          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
        disabled && "cursor-not-allowed opacity-50 hover:bg-white/[0.03]"
      )}
    >
      <div className="flex items-center gap-2">
        <span className={clsx(active ? "text-cyan-300" : "text-ink-300")}>
          {icon}
        </span>
        <span
          className={clsx(
            "text-sm font-bold uppercase tracking-wider",
            active ? "text-white" : "text-ink-200"
          )}
        >
          {title}
        </span>
        {active && <Tag tone="cyan">Active</Tag>}
      </div>
      <p className="text-xs text-ink-300">{subtitle}</p>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-2 last:border-b-0">
      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
        {label}
      </span>
      <span className="truncate text-right text-[11px] text-ink-100">
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  icon,
  tone,
  disabled,
  label,
  description,
  onClick,
  loading,
}: {
  icon: React.ReactNode;
  tone: "cyan" | "violet" | "rose";
  disabled?: boolean;
  label: string;
  description: string;
  onClick: () => void;
  loading?: boolean;
}) {
  const toneCls: Record<string, string> = {
    cyan: "border-cyan-300/30 hover:border-cyan-300/60 hover:bg-cyan-300/10 text-cyan-200",
    violet:
      "border-violet-300/30 hover:border-violet-300/60 hover:bg-violet-300/10 text-violet-200",
    rose: "border-rose-300/30 hover:border-rose-300/60 hover:bg-rose-300/10 text-rose-200",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "flex flex-col gap-1.5 rounded-xl border bg-white/[0.03] p-3 text-left transition",
        toneCls[tone],
        disabled && "cursor-not-allowed opacity-50 hover:bg-white/[0.03]"
      )}
    >
      <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
        {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
        {label}
      </span>
      <span className="text-[10px] text-ink-300">{description}</span>
    </button>
  );
}

// ─── Comparison panel ───────────────────────────────────────────────────────

interface ProjectSummary {
  id: string;
  name: string;
  apiCount: number;
  reactorCount: number;
}

function ProjectsComparison({
  local,
  cloud,
}: {
  local: ProjectSummary[];
  cloud: import("../store").CloudReadInfo | null;
}) {
  // Build the union of project ids across both sides, then render side-by-side.
  const cloudProjects = cloud?.projects ?? [];
  const cloudByIdMap = new Map(cloudProjects.map((p) => [p.id, p]));
  const localByIdMap = new Map(local.map((p) => [p.id, p]));
  const allIds = Array.from(
    new Set([...local.map((p) => p.id), ...cloudProjects.map((p) => p.id)])
  );

  if (cloud && cloud.error) {
    return (
      <div className="rounded-md border border-rose-300/30 bg-rose-400/10 p-3 text-xs text-rose-200">
        <AlertCircle size={12} className="mr-1 inline" />
        Cloud read failed: {cloud.error}. Click{" "}
        <span className="font-bold">Refresh cloud snapshot</span> to retry.
      </div>
    );
  }

  if (cloud && cloud.isEmpty) {
    return (
      <div className="rounded-md border border-amber-300/30 bg-amber-300/5 p-3 text-xs text-amber-200">
        <Inbox size={12} className="mr-1 inline" />
        <code className="font-mono">public.projects</code> has no rows yet.
        Local has <span className="font-bold">{local.length} project(s)</span>.
        Push them up to seed the cloud table.
      </div>
    );
  }

  if (allIds.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs text-ink-300">
        Both stores are empty.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-white/10">
      <table className="min-w-full text-xs">
        <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wider text-ink-300">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Project</th>
            <th className="px-3 py-2 text-right font-semibold text-cyan-300">
              Local APIs
            </th>
            <th className="px-3 py-2 text-right font-semibold text-violet-300">
              Cloud APIs
            </th>
            <th className="px-3 py-2 text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {allIds.map((id, i) => {
            const l = localByIdMap.get(id);
            const c = cloudByIdMap.get(id);
            const status = computeStatus(l, c);
            return (
              <tr
                key={id}
                className={clsx(
                  "border-t border-white/5",
                  i % 2 === 0 && "bg-white/[0.01]"
                )}
              >
                <td className="px-3 py-2 font-mono text-[11px] text-ink-100">
                  <div className="font-semibold text-white">
                    {l?.name ?? c?.name ?? id}
                  </div>
                  <div className="text-[9px] text-ink-500">id: {id}</div>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-cyan-300">
                  {l ? l.apiCount : <span className="text-ink-600">—</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-violet-300">
                  {c ? c.apiCount : <span className="text-ink-600">—</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <StatusChip status={status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-white/[0.02] px-3 py-2 text-[10px] uppercase tracking-wider text-ink-400">
        <span>
          local total:{" "}
          <span className="font-bold text-cyan-300">
            {local.reduce((a, p) => a + p.apiCount, 0)}
          </span>{" "}
          APIs · cloud total:{" "}
          <span className="font-bold text-violet-300">
            {cloudProjects.reduce((a, p) => a + p.apiCount, 0)}
          </span>{" "}
          APIs
        </span>
        {cloud && (
          <span>
            cloud snapshot taken {formatRelative(cloud.at)}
          </span>
        )}
      </div>
    </div>
  );
}

type DriftStatus = "match" | "drift" | "local-only" | "cloud-only";

function computeStatus(
  l: ProjectSummary | undefined,
  c: { id: string; name: string; apiCount: number; reactorCount: number } | undefined
): DriftStatus {
  if (l && c) {
    return l.apiCount === c.apiCount && l.reactorCount === c.reactorCount
      ? "match"
      : "drift";
  }
  if (l && !c) return "local-only";
  return "cloud-only";
}

function StatusChip({ status }: { status: DriftStatus }) {
  if (status === "match") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-lime-300/30 bg-lime-400/10 px-1.5 py-0.5 text-[10px] font-bold text-lime-300">
        <CheckCircle2 size={10} /> match
      </span>
    );
  }
  if (status === "drift") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-300/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
        <AlertCircle size={10} /> drift
      </span>
    );
  }
  if (status === "local-only") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-cyan-300/30 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
        local only
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-violet-300/30 bg-violet-400/10 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">
      cloud only
    </span>
  );
}

function renderLastReadSummary(
  info: import("../store").CloudReadInfo
): string {
  const when = formatRelative(info.at);
  if (info.error) return `${when} · error`;
  if (info.isEmpty) return `${when} · no row`;
  return `${when} · ${info.projects.length} project${info.projects.length === 1 ? "" : "s"}`;
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return "in the future";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

import { useEffect, useRef, useState } from "react";
import {
  Cloud,
  CloudOff,
  Loader2,
  Check,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Copy,
  HardDrive,
  ShieldAlert,
} from "lucide-react";
import { clsx } from "clsx";
import {
  getSyncStatus,
  subscribeSyncStatus,
  type SyncStatus,
} from "../services/sync";
import { useStore } from "../store";
import { isSupabaseEnabled } from "../services/supabase";
import type { DataSource } from "../utils/storage";

const STATUS_META: Record<
  SyncStatus,
  { label: string; tone: string; icon: React.ReactNode; spin?: boolean }
> = {
  disabled: {
    label: "Local only",
    tone: "border-white/10 bg-white/5 text-ink-300",
    icon: <CloudOff size={11} />,
  },
  idle: {
    label: "Cloud ready",
    tone: "border-cyan-300/30 bg-cyan-300/5 text-cyan-300",
    icon: <Cloud size={11} />,
  },
  loading: {
    label: "Loading…",
    tone: "border-cyan-300/30 bg-cyan-300/10 text-cyan-200",
    icon: <Loader2 size={11} />,
    spin: true,
  },
  syncing: {
    label: "Syncing…",
    tone: "border-violet-300/30 bg-violet-300/10 text-violet-200",
    icon: <Loader2 size={11} />,
    spin: true,
  },
  synced: {
    label: "Synced",
    tone: "border-lime-300/30 bg-lime-300/10 text-lime-300",
    icon: <Check size={11} />,
  },
  error: {
    label: "Sync error",
    tone: "border-rose-300/40 bg-rose-300/10 text-rose-300",
    icon: <AlertTriangle size={11} />,
  },
};

/**
 * SyncBadge — a clickable pill in the top bar that:
 *   1. shows the live cloud sync status (idle / syncing / synced / error / disabled),
 *   2. opens a small popover with the Cloud ↔ Local data source toggle when clicked.
 *
 * This replaces the dedicated Admin tab. The mode toggle is the only knob,
 * surfaced in the same place where the user can see whether sync is healthy.
 */
export default function SyncBadge() {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus());
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [opMessage, setOpMessage] = useState<
    null | { tone: "ok" | "err"; text: string }
  >(null);
  const ref = useRef<HTMLDivElement>(null);

  const dataSource = useStore((s) => s.dataSource);
  const cloudError = useStore((s) => s.cloudError);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setDataSource = useStore((s) => s.setDataSource);

  useEffect(() => {
    return subscribeSyncStatus((s) => setStatus(s));
  }, []);

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

  useEffect(() => {
    if (!opMessage) return;
    const t = window.setTimeout(() => setOpMessage(null), 4000);
    return () => window.clearTimeout(t);
  }, [opMessage]);

  const meta = STATUS_META[status];

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

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(activeProjectId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold backdrop-blur-md transition",
          meta.tone,
          open && "ring-1 ring-cyan-300/40"
        )}
        title={`Cloud sync ${status} · click to change data source`}
      >
        <span className={clsx("opacity-90", meta.spin && "animate-spin")}>
          {meta.icon}
        </span>
        <span>{meta.label}</span>
        <ChevronDown
          size={11}
          className={clsx(
            "opacity-60 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="popover-surface absolute right-0 top-full z-50 mt-2 w-[340px] overflow-hidden rounded-xl shadow-2xl shadow-black/60 ring-1 ring-cyan-300/20">
          <div className="border-b border-white/10 px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">
              Data Source
            </span>
          </div>

          <div className="space-y-2 p-3">
            <ModeRow
              active={dataSource === "cloud"}
              disabled={!isSupabaseEnabled}
              onSelect={() => handleSwitch("cloud")}
              title="Cloud (Supabase)"
              subtitle="Default. Reads + writes go to Supabase. Local cache acts as a silent backup."
              icon={<Cloud size={14} />}
            />
            <ModeRow
              active={dataSource === "local"}
              onSelect={() => handleSwitch("local")}
              title="Local (Browser)"
              subtitle="No cloud calls. Reads + writes stay in this browser's localStorage."
              icon={<HardDrive size={14} />}
            />
          </div>

          {!isSupabaseEnabled && (
            <div className="mx-3 mb-2 flex items-start gap-2 rounded-md border border-amber-300/30 bg-amber-300/5 p-2 text-[10px] text-amber-200">
              <ShieldAlert size={12} className="mt-0.5 shrink-0" />
              <div>
                Supabase is not configured in this build. Cloud mode is
                unavailable.
              </div>
            </div>
          )}

          {cloudError && (
            <div className="mx-3 mb-2 flex items-start gap-2 rounded-md border border-rose-300/30 bg-rose-400/10 p-2 text-[10px] text-rose-200">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <div>{cloudError}</div>
            </div>
          )}

          {opMessage && (
            <div
              className={clsx(
                "mx-3 mb-2 flex items-start gap-2 rounded-md border p-2 text-[10px]",
                opMessage.tone === "ok"
                  ? "border-lime-300/30 bg-lime-400/10 text-lime-200"
                  : "border-rose-300/30 bg-rose-400/10 text-rose-200"
              )}
            >
              {opMessage.tone === "ok" ? (
                <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
              ) : (
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
              )}
              <div>{opMessage.text}</div>
            </div>
          )}

          {isSupabaseEnabled && (
            <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-white/[0.02] px-3 py-2 text-[10px] text-ink-400">
              <span className="truncate font-mono">
                Active project: {activeProjectId}
              </span>
              <button
                type="button"
                onClick={copyId}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-bold uppercase tracking-wider text-ink-200 hover:bg-white/10"
                title="Copy active project id"
              >
                {copied ? (
                  <>
                    <Check size={9} /> Copied
                  </>
                ) : (
                  <>
                    <Copy size={9} /> Copy id
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Mode row inside the popover ────────────────────────────────────────────

function ModeRow({
  active,
  disabled,
  onSelect,
  title,
  subtitle,
  icon,
}: {
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
        "flex w-full items-start gap-2 rounded-lg border p-2.5 text-left transition",
        active
          ? "border-cyan-300/50 bg-gradient-to-br from-cyan-300/15 to-violet-300/10 shadow-[0_0_12px_rgba(0,240,255,0.2)]"
          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
        disabled && "cursor-not-allowed opacity-50 hover:bg-white/[0.03]"
      )}
    >
      <span
        className={clsx(
          "mt-0.5 shrink-0",
          active ? "text-cyan-300" : "text-ink-300"
        )}
      >
        {icon}
      </span>
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              "text-[11px] font-bold uppercase tracking-wider",
              active ? "text-white" : "text-ink-200"
            )}
          >
            {title}
          </span>
          {active && (
            <span className="rounded-md border border-cyan-300/40 bg-cyan-300/15 px-1.5 py-0 text-[8px] font-bold uppercase tracking-wider text-cyan-200">
              Active
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[10px] leading-snug text-ink-300">
          {subtitle}
        </p>
      </div>
    </button>
  );
}

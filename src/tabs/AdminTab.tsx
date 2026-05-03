import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  HardDrive,
  ShieldAlert,
} from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";
import { Card, SectionHeader, Tag } from "../components/Primitives";
import type { DataSource } from "../utils/storage";
import { isSupabaseEnabled } from "../services/supabase";

/**
 * Admin tab — single setting: where does the app read & write data?
 *
 *   • "Cloud" (default) — Supabase (`public.projects`) is the source of truth.
 *   • "Local"           — this browser's localStorage. No cloud calls.
 *
 * Stats, sync actions, and drift comparisons were intentionally removed —
 * the toggle is the only knob here.
 */
export default function AdminTab() {
  const dataSource = useStore((s) => s.dataSource);
  const cloudError = useStore((s) => s.cloudError);
  const setDataSource = useStore((s) => s.setDataSource);

  const [opMessage, setOpMessage] = useState<
    null | { tone: "ok" | "err"; text: string }
  >(null);

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

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Admin"
        subtitle="Pick where the app reads and writes data."
      />

      <Card className="!p-5">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-ink-300">
          Current Data Source
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ModeCard
            active={dataSource === "cloud"}
            disabled={!isSupabaseEnabled}
            onSelect={() => handleSwitch("cloud")}
            title="Cloud (Supabase)"
            subtitle="Default. Reads + writes go to Supabase. Local cache acts as a silent backup."
            icon={<Cloud size={20} />}
          />
          <ModeCard
            active={dataSource === "local"}
            onSelect={() => handleSwitch("local")}
            title="Local (Browser)"
            subtitle="No cloud calls. Reads + writes stay in this browser's localStorage."
            icon={<HardDrive size={20} />}
          />
        </div>

        {!isSupabaseEnabled && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-300/30 bg-amber-300/5 p-2.5 text-xs text-amber-200">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <div>
              Supabase is not configured in this build. Cloud mode is
              unavailable; the app is locked to Local.
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
      </Card>
    </div>
  );
}

function ModeCard({
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

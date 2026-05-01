import { useEffect, useState } from "react";
import {
  Cloud,
  CloudOff,
  Loader2,
  Check,
  AlertTriangle,
  Copy,
} from "lucide-react";
import { clsx } from "clsx";
import {
  getSyncStatus,
  subscribeSyncStatus,
  type SyncStatus,
} from "../services/sync";
import { useStore } from "../store";

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

export default function SyncBadge() {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus());
  const [copied, setCopied] = useState(false);
  const cloudEnabled = useStore((s) => s.cloudEnabled);
  const workspaceId = useStore((s) => s.workspaceId);

  useEffect(() => {
    return subscribeSyncStatus((s) => setStatus(s));
  }, []);

  const meta = STATUS_META[status];

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(workspaceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className={clsx(
        "group relative inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold backdrop-blur-md transition",
        meta.tone
      )}
      title={
        cloudEnabled
          ? `Cloud sync ${status} · workspace ${workspaceId.slice(0, 8)}…`
          : "Cloud sync disabled. Set VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY to enable."
      }
    >
      <span className={clsx("opacity-90", meta.spin && "animate-spin")}>
        {meta.icon}
      </span>
      <span>{meta.label}</span>
      {cloudEnabled && (
        <button
          onClick={copyId}
          className="ml-1 rounded px-1 text-[9px] font-bold uppercase tracking-wider opacity-50 hover:opacity-100"
          title="Copy workspace ID"
        >
          {copied ? "Copied!" : <Copy size={9} />}
        </button>
      )}
    </div>
  );
}

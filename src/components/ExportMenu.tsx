import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

interface Props {
  /** Combined workbook — re-importable inputs + schedule + Gantt grids. */
  onGlobalXls: () => Promise<void> | void;
  /** Override the button's primary label (default "Export"). */
  label?: string;
}

/**
 * Single-action export button that triggers the global workbook download.
 * Renders as a header-level button matching the Import button style.
 */
export default function ExportMenu({ onGlobalXls, label = "Export" }: Props) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onGlobalXls();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title="Export global workbook (.xlsx) — APIs, Stages, Equipment, Schedule and Gantt grids in one file"
      aria-label="Export global workbook"
      className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-300 transition hover:border-cyan-300/60 hover:bg-cyan-300/20 disabled:opacity-50"
    >
      {busy ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <Download size={12} />
      )}
      {label}
    </button>
  );
}

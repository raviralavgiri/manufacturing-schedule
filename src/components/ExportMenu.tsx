import { useEffect, useRef, useState } from "react";
import {
  Download,
  ChevronDown,
  Image as ImageIcon,
  FileText,
  FileSpreadsheet,
  Printer,
  Loader2,
} from "lucide-react";
import { clsx } from "clsx";

interface Props {
  onCsv?: () => void;
  /** Extra CSV export action — typically "Reactor-wise Gantt CSV". */
  onReactorCsv?: () => void;
  /** Visual Gantt grid as Excel — coloured cells per reactor × week. */
  onGanttXls?: () => void;
  onPng?: () => Promise<void> | void;
  onPrint?: () => void;
  /** Override the button's primary label (default "Export"). */
  label?: string;
  /** Disable PNG button while a previous capture is in progress. */
  pngBusyHint?: boolean;
}

export default function ExportMenu({
  onCsv,
  onReactorCsv,
  onGanttXls,
  onPng,
  onPrint,
  label = "Export",
  pngBusyHint,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pngBusy, setPngBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const handlePng = async () => {
    if (!onPng) return;
    setOpen(false);
    setPngBusy(true);
    try {
      await onPng();
    } finally {
      setPngBusy(false);
    }
  };

  const isBusy = pngBusy || pngBusyHint;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isBusy}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition",
          isBusy
            ? "border-white/10 bg-white/5 text-ink-300"
            : "border-cyan-300/30 bg-gradient-to-r from-cyan-400/20 to-violet-400/20 text-white hover:from-cyan-400/30 hover:to-violet-400/30 hover:shadow-glow"
        )}
      >
        {isBusy ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Download size={13} />
        )}
        <span>{label}</span>
        <ChevronDown size={11} className="opacity-70" />
      </button>
      {open && (
        <div className="popover-surface absolute right-0 top-full z-50 mt-1 min-w-[200px] overflow-hidden rounded-xl shadow-2xl shadow-black/60 ring-1 ring-cyan-300/20">
          {onCsv && (
            <ExportItem
              icon={<FileText size={13} />}
              title="CSV"
              subtitle="current view — all batches"
              onClick={() => {
                setOpen(false);
                onCsv();
              }}
            />
          )}
          {onReactorCsv && (
            <ExportItem
              icon={<FileText size={13} />}
              title="Reactor-wise CSV"
              subtitle="one row per reactor per batch"
              onClick={() => {
                setOpen(false);
                onReactorCsv();
              }}
            />
          )}
          {onGanttXls && (
            <ExportItem
              icon={<FileSpreadsheet size={13} />}
              title="Gantt grid (Excel)"
              subtitle="reactor × week grid with colour fills"
              onClick={() => {
                setOpen(false);
                onGanttXls();
              }}
            />
          )}
          {onPng && (
            <ExportItem
              icon={<ImageIcon size={13} />}
              title="PNG image"
              subtitle="snapshot at current view"
              onClick={handlePng}
            />
          )}
          {onPrint && (
            <ExportItem
              icon={<Printer size={13} />}
              title="Print"
              subtitle="paper / save as PDF"
              onClick={() => {
                setOpen(false);
                onPrint();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ExportItem({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-white/5 px-3 py-2 text-left transition last:border-b-0 hover:bg-white/8"
    >
      <span className="text-cyan-300">{icon}</span>
      <div className="flex flex-col">
        <span className="text-xs font-bold text-white">{title}</span>
        <span className="text-[10px] text-ink-400">{subtitle}</span>
      </div>
    </button>
  );
}

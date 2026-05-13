import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import type { API, Reactor } from "../types";
import {
  parseExcelFile,
  ImportError,
  type ImportResult,
} from "../utils/excelImport";

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (apis: API[], reactors: Reactor[]) => void;
}

type Phase = "idle" | "parsing" | "preview" | "error";

const TOPOLOGY_BADGE: Record<
  string,
  { label: string; cls: string }
> = {
  linear: {
    label: "Linear",
    cls: "border-cyan-300/40 bg-cyan-300/10 text-cyan-300",
  },
  side_chains: {
    label: "Side chains",
    cls: "border-emerald-300/40 bg-emerald-300/10 text-emerald-300",
  },
  parallel: {
    label: "Parallel",
    cls: "border-amber-300/40 bg-amber-300/10 text-amber-300",
  },
};

export default function ExcelImportModal({ open, onClose, onImport }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setErrorMsg("");
    setResult(null);
    setDragging(false);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  async function processFile(file: File) {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      setErrorMsg("Please upload an Excel file (.xlsx or .xls).");
      setPhase("error");
      return;
    }
    setPhase("parsing");
    try {
      const r = await parseExcelFile(file);
      setResult(r);
      setPhase("preview");
    } catch (e) {
      const msg =
        e instanceof ImportError
          ? e.message
          : e instanceof Error
          ? e.message
          : "Unknown error during import.";
      setErrorMsg(msg);
      setPhase("error");
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function confirmImport() {
    if (!result) return;
    onImport(result.apis, result.reactors);
    handleClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(4,8,26,0.75)" }}
    >
      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-ink-950 shadow-2xl shadow-black/70 ring-1 ring-cyan-300/10"
        style={{ maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-6 py-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={18} className="text-emerald-400" />
            <span className="text-sm font-bold text-white">
              Import from Excel
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1 text-ink-400 hover:text-ink-200"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* ── idle: drop zone ─────────────────────────────────── */}
          {phase === "idle" && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={clsx(
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-16 transition",
                dragging
                  ? "border-cyan-300/60 bg-cyan-300/5"
                  : "border-white/15 hover:border-white/30 hover:bg-white/[0.02]"
              )}
            >
              <Upload size={32} className="text-ink-400" />
              <div className="text-center">
                <p className="text-sm font-semibold text-ink-200">
                  Drop your .xlsx file here
                </p>
                <p className="mt-1 text-[11px] text-ink-500">
                  or click to browse — requires the standard 3-sheet template
                  (API · Stages · Master Equipment)
                </p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={onFileChange}
              />
            </div>
          )}

          {/* ── parsing ──────────────────────────────────────────── */}
          {phase === "parsing" && (
            <div className="flex flex-col items-center justify-center gap-3 py-20">
              <Loader2 size={32} className="animate-spin text-cyan-300" />
              <p className="text-sm text-ink-300">Parsing workbook…</p>
            </div>
          )}

          {/* ── error ───────────────────────────────────────────── */}
          {phase === "error" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-rose-300/30 bg-rose-300/10 p-4">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-400" />
                <div>
                  <p className="text-sm font-semibold text-rose-300">
                    Import failed
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-rose-200/80">
                    {errorMsg}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-ink-200 hover:bg-white/10"
              >
                Try another file
              </button>
            </div>
          )}

          {/* ── preview ──────────────────────────────────────────── */}
          {phase === "preview" && result && (
            <div className="space-y-5">
              {/* Stat cards */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "APIs", value: result.stats.apiCount, cls: "text-amber-300" },
                  { label: "Stages", value: result.stats.stageCount, cls: "text-cyan-300" },
                  { label: "Equipment", value: result.stats.reactorCount, cls: "text-violet-300" },
                ].map((c) => (
                  <div
                    key={c.label}
                    className="flex flex-col items-center justify-center gap-0.5 rounded-xl border border-white/8 bg-white/[0.03] py-4"
                  >
                    <span className={clsx("text-2xl font-extrabold tabular-nums", c.cls)}>
                      {c.value}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-ink-400">
                      {c.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* API list with topology badges */}
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ink-400">
                  APIs detected
                </p>
                <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                  {result.apis.map((api) => {
                    const badge =
                      TOPOLOGY_BADGE[api.topology ?? "linear"] ??
                      TOPOLOGY_BADGE.linear;
                    return (
                      <div
                        key={api.id}
                        className="flex items-center gap-2 rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: api.color }}
                        />
                        <span className="flex-1 truncate font-mono text-[12px] text-ink-100">
                          {api.name}
                        </span>
                        <span className="text-[11px] tabular-nums text-ink-400">
                          {api.targetKg} kg
                        </span>
                        <span
                          className={clsx(
                            "rounded border px-1.5 py-0.5 text-[10px] font-semibold",
                            badge.cls
                          )}
                        >
                          {badge.label}
                        </span>
                        <span className="text-[11px] tabular-nums text-ink-500">
                          {api.stages.length} stage{api.stages.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3">
                  <div className="mb-2 flex items-center gap-1.5">
                    <AlertTriangle size={13} className="text-amber-400" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                      {result.warnings.length} warning
                      {result.warnings.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {result.warnings.map((w, i) => (
                      <li key={i} className="text-[11px] leading-relaxed text-amber-200/70">
                        · {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Overwrite notice */}
              <p className="text-[11px] leading-relaxed text-ink-500">
                Importing will replace <strong className="text-ink-300">all APIs and reactors</strong> in the
                current project. This cannot be undone.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        {(phase === "preview" || phase === "error") && (
          <div className="flex items-center justify-end gap-2 border-t border-white/8 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-ink-200 hover:bg-white/10"
            >
              Cancel
            </button>
            {phase === "preview" && (
              <button
                type="button"
                onClick={confirmImport}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300/40 bg-gradient-to-r from-emerald-400/25 to-cyan-400/25 px-3 py-1.5 text-[12px] font-bold text-white hover:from-emerald-400/40 hover:to-cyan-400/40"
              >
                <CheckCircle2 size={13} />
                Import {result!.stats.apiCount} API
                {result!.stats.apiCount !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

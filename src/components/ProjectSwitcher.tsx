import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  FolderOpen,
  Plus,
  Pencil,
  Check,
  X,
  Trash2,
} from "lucide-react";
import { clsx } from "clsx";
import { useStore } from "../store";

/**
 * Project switcher — top-bar dropdown that shows the active project's name
 * and lets the user switch, create, rename, or delete projects. Each
 * project is a fully isolated namespace (its own APIs, reactors, plan
 * window). Switching loads its data into every tab below.
 */
export default function ProjectSwitcher() {
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const switchProject = useStore((s) => s.switchProject);
  const createProject = useStore((s) => s.createProject);
  const renameProject = useStore((s) => s.renameProject);
  const deleteProject = useStore((s) => s.deleteProject);

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const ref = useRef<HTMLDivElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setRenamingId(null);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (creating) {
      setTimeout(() => newInputRef.current?.focus(), 50);
    }
  }, [creating]);

  const active = projects.find((p) => p.id === activeProjectId) ?? projects[0];

  const startCreate = () => {
    setCreating(true);
    setNewName("");
  };
  const commitCreate = () => {
    const name = newName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    const id = createProject(name);
    setCreating(false);
    setNewName("");
    setOpen(false);
    void id;
  };

  const startRename = (id: string, current: string) => {
    setRenamingId(id);
    setRenameValue(current);
  };
  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      renameProject(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/30 bg-gradient-to-r from-cyan-400/15 to-violet-400/15 px-3 py-1.5 text-xs font-bold text-white transition hover:from-cyan-400/25 hover:to-violet-400/25 hover:shadow-glow"
        title="Switch project"
      >
        <FolderOpen size={13} className="text-cyan-300" />
        <span className="max-w-[200px] truncate">{active?.name ?? "—"}</span>
        <span className="rounded-full bg-white/10 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-ink-200">
          {projects.length}
        </span>
        <ChevronDown size={11} className="opacity-70" />
      </button>

      {open && (
        <div
          className="popover-surface absolute left-0 top-full z-50 mt-2 w-[320px] overflow-hidden rounded-xl shadow-2xl shadow-black/60 ring-1 ring-cyan-300/20"
        >
          <div className="border-b border-white/10 px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
              Projects
            </span>
          </div>

          <div className="max-h-[280px] overflow-y-auto">
            {projects.map((p) => {
              const isActive = p.id === activeProjectId;
              const isRenaming = renamingId === p.id;
              const isConfirmingDelete = confirmDeleteId === p.id;
              return (
                <div
                  key={p.id}
                  className={clsx(
                    "group flex items-center gap-2 border-b border-white/5 px-3 py-2 transition",
                    isActive && "bg-cyan-300/8"
                  )}
                >
                  {isRenaming ? (
                    <>
                      <Pencil size={12} className="text-cyan-300" />
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        onBlur={commitRename}
                        className="flex-1 rounded-md border border-cyan-300/30 bg-white/5 px-2 py-1 text-xs text-white outline-none focus:border-cyan-300/60"
                      />
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          switchProject(p.id);
                          setOpen(false);
                        }}
                        className="flex flex-1 items-center gap-2 truncate text-left"
                      >
                        <span
                          className={clsx(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            isActive
                              ? "bg-cyan-300 shadow-[0_0_6px_rgba(0,240,255,0.8)]"
                              : "bg-ink-500"
                          )}
                        />
                        <span
                          className={clsx(
                            "truncate text-xs font-semibold",
                            isActive ? "text-white" : "text-ink-200"
                          )}
                        >
                          {p.name}
                        </span>
                        <span className="font-mono text-[9px] text-ink-400">
                          {p.apis.length} APIs
                        </span>
                      </button>
                      {isConfirmingDelete ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => {
                              deleteProject(p.id);
                              setConfirmDeleteId(null);
                            }}
                            className="rounded-md border border-rose-300/40 bg-rose-400/15 px-1.5 py-0.5 text-[9px] font-bold text-rose-300 hover:bg-rose-400/30"
                            title="Confirm delete"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold text-ink-200 hover:bg-white/10"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                          <button
                            onClick={() => startRename(p.id, p.name)}
                            className="rounded-md p-1 text-ink-400 hover:bg-white/8 hover:text-cyan-300"
                            title="Rename"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(p.id)}
                            className="rounded-md p-1 text-ink-400 hover:bg-rose-400/15 hover:text-rose-300"
                            title="Delete project"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {creating ? (
            <div className="flex items-center gap-2 border-t border-white/10 bg-cyan-300/5 px-3 py-2">
              <Plus size={12} className="text-cyan-300" />
              <input
                ref={newInputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitCreate();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                  }
                }}
                placeholder="Project name…"
                className="flex-1 rounded-md border border-cyan-300/40 bg-white/5 px-2 py-1 text-xs text-white outline-none focus:border-cyan-300/60"
              />
              <button
                onClick={commitCreate}
                className="rounded-md border border-cyan-300/40 bg-cyan-300/20 p-1 text-cyan-200 hover:bg-cyan-300/30"
                title="Create"
              >
                <Check size={11} />
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
                className="rounded-md border border-white/10 bg-white/5 p-1 text-ink-200 hover:bg-white/10"
                title="Cancel"
              >
                <X size={11} />
              </button>
            </div>
          ) : (
            <button
              onClick={startCreate}
              className="flex w-full items-center gap-2 border-t border-white/10 bg-gradient-to-r from-cyan-300/10 to-violet-300/10 px-3 py-2 text-xs font-bold text-white transition hover:from-cyan-300/20 hover:to-violet-300/20"
            >
              <Plus size={12} className="text-cyan-300" />
              New Project
              <span className="ml-auto text-[9px] uppercase tracking-wider text-ink-400">
                Empty namespace
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

import type { API, PlanWindow, Project, Reactor } from "../types";
import { getWorkspaceId, isSupabaseEnabled, supabase } from "./supabase";

export type SyncStatus =
  | "disabled"
  | "idle"
  | "syncing"
  | "synced"
  | "error"
  | "loading";

const TABLE = "workspaces";

export interface CloudSnapshot {
  projects: Project[];
  activeProjectId: string;
}

interface RowShape {
  id: string;
  // v2 shape
  projects?: Project[];
  active_project_id?: string;
  // v1 legacy shape (for backwards compat read path)
  apis?: API[];
  reactors?: Reactor[];
  window?: PlanWindow;
  updated_at?: string;
}

/**
 * Load the workspace snapshot from Supabase. Handles both v2 (projects)
 * and legacy v1 (apis/reactors/window) row shapes — v1 rows get auto-wrapped
 * into a single Default project.
 */
export async function loadFromCloud(): Promise<CloudSnapshot | null> {
  if (!isSupabaseEnabled || !supabase) return null;
  const id = getWorkspaceId();
  const { data, error } = await supabase
    .from(TABLE)
    .select("apis, reactors, window, projects, active_project_id")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[sync] loadFromCloud error:", error.message);
    return null;
  }
  if (!data) return null;
  const row = data as RowShape;

  // v2: projects array present
  if (Array.isArray(row.projects) && row.projects.length > 0) {
    const projects = row.projects.map(normalize).filter((p): p is Project => !!p);
    if (projects.length === 0) return null;
    const activeProjectId =
      typeof row.active_project_id === "string" &&
      projects.some((p) => p.id === row.active_project_id)
        ? row.active_project_id
        : projects[0].id;
    return { projects, activeProjectId };
  }

  // v1 fallback: wrap the legacy single namespace as a Default project
  if (Array.isArray(row.apis)) {
    const project: Project = {
      id: "default",
      name: "Default",
      createdAt: Date.now(),
      apis: row.apis,
      reactors: Array.isArray(row.reactors)
        ? row.reactors.map((r) => ({ ...r, name: r.name ?? r.id }))
        : [],
      window: row.window ?? { startMs: 0, endMs: 0 },
    };
    return { projects: [project], activeProjectId: "default" };
  }

  return null;
}

function normalize(p: any): Project | null {
  if (!p || !Array.isArray(p.apis)) return null;
  return {
    id: typeof p.id === "string" ? p.id : crypto.randomUUID(),
    name:
      typeof p.name === "string" && p.name.trim()
        ? p.name.trim()
        : "Untitled Project",
    createdAt:
      typeof p.createdAt === "number" && p.createdAt > 0
        ? p.createdAt
        : Date.now(),
    apis: p.apis,
    reactors: Array.isArray(p.reactors)
      ? p.reactors.map((r: any) => ({ ...r, name: r.name ?? r.id }))
      : [],
    window:
      p.window &&
      typeof p.window.startMs === "number" &&
      typeof p.window.endMs === "number"
        ? p.window
        : { startMs: 0, endMs: 0 },
  };
}

/** Upsert the workspace snapshot to Supabase. */
export async function saveToCloud(snapshot: CloudSnapshot): Promise<void> {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error("Supabase not configured");
  }
  const id = getWorkspaceId();
  const { error } = await supabase.from(TABLE).upsert(
    {
      id,
      projects: snapshot.projects,
      active_project_id: snapshot.activeProjectId,
      // Mirror the active project's data into the legacy columns for any
      // downstream tools that still read v1 shape.
      apis: getActive(snapshot)?.apis ?? [],
      reactors: getActive(snapshot)?.reactors ?? [],
      window: getActive(snapshot)?.window ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(error.message);
}

function getActive(snapshot: CloudSnapshot): Project | undefined {
  return snapshot.projects.find((p) => p.id === snapshot.activeProjectId);
}

// ─── Debounced background sync ─────────────────────────────────────────────────
let pending: CloudSnapshot | null = null;
let inflight = false;
let timer: number | undefined;

type Listener = (s: SyncStatus, lastSyncedAt: number | null) => void;
const listeners = new Set<Listener>();
let lastSyncedAt: number | null = null;
let lastStatus: SyncStatus = isSupabaseEnabled ? "idle" : "disabled";

function emit(s: SyncStatus) {
  lastStatus = s;
  listeners.forEach((l) => l(s, lastSyncedAt));
}

export function subscribeSyncStatus(fn: Listener): () => void {
  listeners.add(fn);
  fn(lastStatus, lastSyncedAt);
  return () => listeners.delete(fn);
}

export function getSyncStatus(): SyncStatus {
  return lastStatus;
}

export function queueCloudSave(
  snapshot: CloudSnapshot,
  debounceMs = 800
): void {
  if (!isSupabaseEnabled) return;
  pending = snapshot;
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(flush, debounceMs);
}

async function flush() {
  if (!pending || inflight) return;
  const snapshot = pending;
  pending = null;
  inflight = true;
  emit("syncing");
  try {
    await saveToCloud(snapshot);
    lastSyncedAt = Date.now();
    emit("synced");
    if (pending) {
      window.setTimeout(flush, 0);
    }
  } catch (err) {
    console.error("[sync] saveToCloud failed:", err);
    emit("error");
  } finally {
    inflight = false;
  }
}

export function setLoadingStatus(): void {
  emit("loading");
}
export function setIdleStatus(): void {
  emit(isSupabaseEnabled ? "idle" : "disabled");
}

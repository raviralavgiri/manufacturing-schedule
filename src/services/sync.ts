import type { Project } from "../types";
import { isSupabaseEnabled, supabase } from "./supabase";
import {
  migrateAgitator,
  migrateMoc,
  normalizeApiTopology,
  normalizeCascadePolicy,
  normalizeStageDagInputs,
} from "../utils/storage";

export type SyncStatus =
  | "disabled"
  | "idle"
  | "syncing"
  | "synced"
  | "error"
  | "loading";

const TABLE = "projects";

// ─── DB row shape ───────────────────────────────────────────────────────────
//
// Each row in `public.projects` is exactly one project. Active-project
// preference is per-browser and NOT stored here.
interface ProjectRow {
  id: string;
  name: string;
  created_at?: number;
  apis: any;
  reactors: any;
  window: any;
  updated_at?: string;
}

function rowToProject(row: ProjectRow): Project {
  // Defensive — strip the legacy `shared` flag and migrate class names if
  // they survived from the old workspace shape.
  const reactors = Array.isArray(row.reactors)
    ? row.reactors.map((r: any) => {
        // Strip legacy fields (`shared`, `reactorClass`) and rebuild with
        // the current schema: { id, name, moc, agitatorType, capacityKg }.
        const {
          shared: _shared,
          reactorClass: legacyClass,
          ...rest
        } = r;
        void _shared;
        return {
          ...rest,
          name: r.name ?? r.id,
          moc: migrateMoc(r.moc ?? legacyClass),
          agitatorType: migrateAgitator(r.agitatorType),
        };
      })
    : [];
  // Project-level window — used as the per-API window fallback when an API
  // was stored before the per-API `window` field existed.
  const projectWindow =
    row.window &&
    typeof row.window === "object" &&
    typeof row.window.startMs === "number" &&
    typeof row.window.endMs === "number"
      ? row.window
      : { startMs: 0, endMs: 0 };

  // Normalize each API: drop legacy `priority`; ensure `window` exists.
  // Without this, cloud rows written before per-API windows crash the UI
  // with "Cannot read properties of undefined (reading 'startMs')".
  const apis = Array.isArray(row.apis)
    ? row.apis.map((a: any) => {
        const { priority: _legacyPriority, ...rest } = a;
        void _legacyPriority;
        const apiWindow =
          a.window &&
          typeof a.window === "object" &&
          typeof a.window.startMs === "number" &&
          typeof a.window.endMs === "number"
            ? a.window
            : { ...projectWindow };
        // Apply the same DAG-predecessor normalization as the local
        // hydrator so cloud rows written before `inputStageIds` existed
        // collapse to the linear-chain default and don't crash the
        // cascade / scheduler.
        const stages = Array.isArray(rest.stages)
          ? rest.stages.map((s: any) => ({
              ...s,
              cascadePolicy: normalizeCascadePolicy(s.cascadePolicy),
            }))
          : [];
        normalizeStageDagInputs(stages);
        return {
          ...rest,
          stages,
          window: apiWindow,
          topology: normalizeApiTopology(a.topology),
        };
      })
    : [];

  return {
    id: row.id,
    name: row.name,
    createdAt:
      typeof row.created_at === "number" && row.created_at > 0
        ? row.created_at
        : Date.now(),
    apis,
    reactors,
    window: projectWindow,
  };
}

function projectToRow(p: Project): ProjectRow {
  return {
    id: p.id,
    name: p.name,
    created_at: p.createdAt,
    apis: p.apis,
    reactors: p.reactors,
    window: p.window,
    updated_at: new Date().toISOString(),
  };
}

// ─── Reads ─────────────────────────────────────────────────────────────────

/**
 * Fetch the entire shared set of projects from Supabase. Anyone with the
 * publishable key sees the same list — there is no per-browser scope.
 */
export async function loadAllProjectsFromCloud(): Promise<Project[] | null> {
  if (!isSupabaseEnabled || !supabase) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, name, created_at, apis, reactors, window, updated_at")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[sync] loadAllProjectsFromCloud error:", error.message);
    throw new Error(error.message);
  }
  if (!Array.isArray(data)) return [];
  return data.map((row) => rowToProject(row as ProjectRow));
}

// ─── Writes ────────────────────────────────────────────────────────────────

/** Upsert one project's row. */
export async function saveProjectToCloud(project: Project): Promise<void> {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error("Supabase not configured");
  }
  const row = projectToRow(project);
  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

/** Delete one project's row by id. */
export async function deleteProjectFromCloud(id: string): Promise<void> {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error("Supabase not configured");
  }
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Reconcile cloud with the local set: upsert every local project, then
 * delete any cloud rows whose id is no longer present locally.
 *
 * Caller passes the COMPLETE local set, not a delta. Trade-off: O(N) writes
 * per sync, but the bookkeeping is dead simple and idempotent.
 */
export async function syncAllProjectsToCloud(local: Project[]): Promise<void> {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error("Supabase not configured");
  }
  // Upsert all local rows in one round-trip.
  if (local.length > 0) {
    const rows = local.map(projectToRow);
    const { error: upErr } = await supabase
      .from(TABLE)
      .upsert(rows, { onConflict: "id" });
    if (upErr) throw new Error(upErr.message);
  }
  // Delete any cloud rows whose ids aren't in the local set.
  const { data: cloudIds, error: idErr } = await supabase
    .from(TABLE)
    .select("id");
  if (idErr) throw new Error(idErr.message);
  const localIds = new Set(local.map((p) => p.id));
  const toDelete = (cloudIds ?? [])
    .map((r: { id: string }) => r.id)
    .filter((id) => !localIds.has(id));
  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from(TABLE)
      .delete()
      .in("id", toDelete);
    if (delErr) throw new Error(delErr.message);
  }
}

// ─── Debounced background sync ─────────────────────────────────────────────
//
// Every mutation in the store calls `queueCloudSave(localProjects)`. We
// debounce 800 ms and reconcile against cloud (upsert all + delete missing).

let pending: Project[] | null = null;
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

/**
 * Queue a debounced cloud reconcile. Called by the store's persistence
 * dispatcher whenever any mutation lands. Subsequent calls within the
 * debounce window collapse into a single sync of the latest snapshot.
 */
export function queueCloudSave(
  localProjects: Project[],
  debounceMs = 800
): void {
  if (!isSupabaseEnabled) return;
  pending = localProjects;
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
    await syncAllProjectsToCloud(snapshot);
    lastSyncedAt = Date.now();
    emit("synced");
    if (pending) {
      window.setTimeout(flush, 0);
    }
  } catch (err) {
    console.error("[sync] syncAllProjectsToCloud failed:", err);
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

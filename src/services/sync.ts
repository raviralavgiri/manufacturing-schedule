import type { API } from "../types";
import { getWorkspaceId, isSupabaseEnabled, supabase } from "./supabase";

export type SyncStatus =
  | "disabled" // Supabase not configured - localStorage only
  | "idle" // Configured + nothing pending
  | "syncing" // A write is in flight
  | "synced" // Last write succeeded
  | "error" // Last write failed
  | "loading"; // Initial load in progress

const TABLE = "workspaces";

interface RowShape {
  id: string;
  apis: API[];
  updated_at?: string;
}

/**
 * Try to load APIs for this workspace from Supabase.
 * Returns null if Supabase is disabled, the row doesn't exist, or any error.
 */
export async function loadFromCloud(): Promise<API[] | null> {
  if (!isSupabaseEnabled || !supabase) return null;
  const id = getWorkspaceId();
  const { data, error } = await supabase
    .from(TABLE)
    .select("apis")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    // PGRST116 = no rows returned - that's fine, just means first-time user
    console.warn("[sync] loadFromCloud error:", error.message);
    return null;
  }
  if (!data) return null;
  const row = data as Pick<RowShape, "apis">;
  if (!Array.isArray(row.apis)) return null;
  return row.apis;
}

/**
 * Upsert the entire APIs array to Supabase. Throws on error so caller can
 * mark sync status appropriately.
 */
export async function saveToCloud(apis: API[]): Promise<void> {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error("Supabase not configured");
  }
  const id = getWorkspaceId();
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      { id, apis, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  if (error) throw new Error(error.message);
}

// ─── Debounced background sync ─────────────────────────────────────────────────
let pending: API[] | null = null;
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
 * Schedule a debounced cloud save. Coalesces rapid edits into a single write.
 */
export function queueCloudSave(apis: API[], debounceMs = 800): void {
  if (!isSupabaseEnabled) return;
  pending = apis;
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
    // If more edits arrived during the in-flight write, immediately retry
    if (pending) {
      window.setTimeout(flush, 0);
    }
  } catch (err) {
    console.error("[sync] saveToCloud failed:", err);
    emit("error");
    // Keep `pending` so the next change attempts again; the user could also
    // refresh and try again.
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

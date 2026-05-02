import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "../config/supabaseConfig";

const config = getSupabaseConfig();

export const isSupabaseEnabled = config !== null;

export const supabase: SupabaseClient | null = config
  ? createClient(config.url, config.key, {
      auth: { persistSession: false },
    })
  : null;

const WORKSPACE_KEY = "pharma:workspaceId:v1";

/**
 * Stable per-browser workspace id. Generated once and stored in localStorage so
 * the same browser keeps loading its own data on every visit. Share the id
 * across browsers (e.g. paste it in another browser's localStorage) to share
 * the same workspace.
 */
export function getWorkspaceId(): string {
  if (typeof window === "undefined") return "default";
  try {
    const existing = window.localStorage.getItem(WORKSPACE_KEY);
    if (existing) return existing;
    const fresh = newWorkspaceId();
    window.localStorage.setItem(WORKSPACE_KEY, fresh);
    return fresh;
  } catch {
    return "default";
  }
}

export function setWorkspaceId(id: string): void {
  try {
    window.localStorage.setItem(WORKSPACE_KEY, id);
  } catch {
    // ignore
  }
}

function newWorkspaceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "ws-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

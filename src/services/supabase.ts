import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

export const isSupabaseEnabled =
  typeof SUPABASE_URL === "string" &&
  SUPABASE_URL.length > 0 &&
  typeof SUPABASE_ANON_KEY === "string" &&
  SUPABASE_ANON_KEY.length > 0;

export const supabase: SupabaseClient | null = isSupabaseEnabled
  ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
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
  // crypto.randomUUID is widely supported; fallback for very old browsers
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "ws-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

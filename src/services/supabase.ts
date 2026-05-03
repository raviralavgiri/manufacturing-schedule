import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "../config/supabaseConfig";

const config = getSupabaseConfig();

export const isSupabaseEnabled = config !== null;

export const supabase: SupabaseClient | null = config
  ? createClient(config.url, config.key, {
      auth: { persistSession: false },
    })
  : null;

// NOTE: previous schema versions used a per-browser workspace UUID as the
// primary key in `public.workspaces`. The new schema (one row per project,
// keyed by project id) means there is no longer a per-browser identity.
// If anything in the codebase still imports a workspace-id helper, treat
// it as removed. The Admin tab no longer surfaces a workspace id either.

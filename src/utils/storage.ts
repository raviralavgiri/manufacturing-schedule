import type { API, Reactor } from "../types";

// Bump if schema changes - old data is then ignored & seed is used.
const STORAGE_KEY = "pharma:apis:v1";

export interface PersistedShape {
  v: 1;
  apis: API[];
  /** Optional - older saves don't have this; we fall back to the seed in that case. */
  reactors?: Reactor[];
  savedAt: number;
}

export interface PersistedSnapshot {
  apis: API[];
  reactors: Reactor[] | null;
}

export function loadPersisted(): PersistedSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedShape;
    if (parsed.v !== 1 || !Array.isArray(parsed.apis)) return null;
    if (!parsed.apis.every((a) => a && a.id && Array.isArray(a.stages))) {
      return null;
    }
    // Migrate: ensure priority field exists (older saves may lack it)
    const apis = parsed.apis.map((a) => ({
      ...a,
      priority: (a.priority ?? 3) as API["priority"],
    }));
    // Migrate: reactors may be missing in old saves; if present, ensure each
    // has a `name` field (default to id).
    let reactors: Reactor[] | null = null;
    if (Array.isArray(parsed.reactors)) {
      reactors = parsed.reactors.map((r) => ({
        ...r,
        name: r.name ?? r.id,
      }));
    }
    return { apis, reactors };
  } catch {
    return null;
  }
}

export function savePersisted(apis: API[], reactors: Reactor[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedShape = {
      v: 1,
      apis,
      reactors,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage may be full or unavailable in private mode - ignore.
  }
}

export function clearPersisted(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function isPersistedPresent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

import type { API } from "../types";

// Bump if schema changes - old data is then ignored & seed is used.
const STORAGE_KEY = "pharma:apis:v1";

export interface PersistedShape {
  v: 1;
  apis: API[];
  savedAt: number;
}

export function loadPersisted(): API[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedShape;
    if (parsed.v !== 1 || !Array.isArray(parsed.apis)) return null;
    // Defensive: ensure required fields exist; otherwise discard
    if (!parsed.apis.every((a) => a && a.id && Array.isArray(a.stages))) {
      return null;
    }
    // Migrate: ensure priority field exists (older saves may lack it)
    return parsed.apis.map((a) => ({
      ...a,
      priority: (a.priority ?? 3) as API["priority"],
    }));
  } catch {
    return null;
  }
}

export function savePersisted(apis: API[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedShape = { v: 1, apis, savedAt: Date.now() };
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

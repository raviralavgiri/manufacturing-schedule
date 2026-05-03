import type { API, PlanWindow, Reactor } from "../types";
import { FY_END_MS, FY_START_MS } from "./dates";

// Bump if schema changes - old data is then ignored & seed is used.
const STORAGE_KEY = "pharma:apis:v1";

export interface PersistedShape {
  v: 1;
  apis: API[];
  /** Older saves don't have this; we fall back to the seed in that case. */
  reactors?: Reactor[];
  /** Single global plan window. Older saves stored per-API windows. */
  window?: PlanWindow;
  savedAt: number;
}

export interface PersistedSnapshot {
  apis: API[];
  reactors: Reactor[] | null;
  window: PlanWindow;
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
    // Migrate: ensure priority + targetKg + per-stage inputKgPerBatch fields
    // exist. Strip any legacy per-API startMs/endMs (now global).
    const apis = parsed.apis.map((a) => {
      const priority = (a.priority ?? 3) as API["priority"];
      let targetKg = a.targetKg;
      if (typeof targetKg !== "number" || targetKg <= 0) {
        const stages = Array.isArray(a.stages) ? a.stages : [];
        if (stages.length > 0) {
          const finalStage = stages.reduce((acc, s) =>
            s.stageNo > acc.stageNo ? s : acc
          );
          targetKg =
            (finalStage.batchSizeKg ?? 0) * (finalStage.plannedBatches ?? 0);
        } else {
          targetKg = 0;
        }
      }
      const stages = Array.isArray(a.stages)
        ? a.stages.map((s) => ({
            ...s,
            inputKgPerBatch:
              typeof s.inputKgPerBatch === "number" && s.inputKgPerBatch > 0
                ? s.inputKgPerBatch
                : s.batchSizeKg,
          }))
        : [];
      // Drop the deprecated per-API window fields (kept by destructure).
      const {
        startMs: _legacyStart,
        endMs: _legacyEnd,
        ...rest
      } = a as API & { startMs?: number; endMs?: number };
      void _legacyStart;
      void _legacyEnd;
      return { ...rest, priority, targetKg, stages };
    });

    let reactors: Reactor[] | null = null;
    if (Array.isArray(parsed.reactors)) {
      reactors = parsed.reactors.map((r) => ({
        ...r,
        name: r.name ?? r.id,
      }));
    }

    // Resolve global window: prefer persisted top-level window, else derive
    // from the first legacy per-API window present, else default to FY 26-27.
    let resolvedWindow: PlanWindow = {
      startMs: FY_START_MS,
      endMs: FY_END_MS,
    };
    if (
      parsed.window &&
      typeof parsed.window.startMs === "number" &&
      typeof parsed.window.endMs === "number" &&
      parsed.window.endMs > parsed.window.startMs
    ) {
      resolvedWindow = parsed.window;
    } else {
      const legacy = parsed.apis.find(
        (a: any) =>
          typeof a.startMs === "number" &&
          typeof a.endMs === "number" &&
          a.endMs > a.startMs
      ) as { startMs?: number; endMs?: number } | undefined;
      if (legacy && legacy.startMs && legacy.endMs) {
        resolvedWindow = { startMs: legacy.startMs, endMs: legacy.endMs };
      }
    }

    return { apis, reactors, window: resolvedWindow };
  } catch {
    return null;
  }
}

export function savePersisted(
  apis: API[],
  reactors: Reactor[],
  planWindow: PlanWindow
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedShape = {
      v: 1,
      apis,
      reactors,
      window: planWindow,
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

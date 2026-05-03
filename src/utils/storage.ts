import type { API, PlanWindow, Project, Reactor } from "../types";
import { FY_END_MS, FY_START_MS } from "./dates";
import { refreshPaletteColors } from "../data/seed";

// We bump version when the persisted shape changes incompatibly.
// v1: single-namespace { apis, reactors, window }
// v2: multi-project namespace { projects, activeProjectId }
const STORAGE_KEY = "pharma:apis:v1"; // kept the same to avoid orphaning data
// Migration is performed inline based on the `v` field within the JSON.

interface PersistedV1 {
  v: 1;
  apis: API[];
  reactors?: Reactor[];
  window?: PlanWindow;
  savedAt?: number;
}

interface PersistedV2 {
  v: 2;
  projects: Project[];
  activeProjectId: string;
  savedAt?: number;
}

type AnyPersisted = PersistedV1 | PersistedV2;

export interface PersistedSnapshot {
  projects: Project[];
  activeProjectId: string;
}

/** Try to load the persisted state. Performs v1 → v2 migration in memory. */
export function loadPersisted(): PersistedSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AnyPersisted;
    if (!parsed || typeof parsed !== "object") return null;

    if (parsed.v === 2) {
      return migrateV2(parsed);
    }
    if (parsed.v === 1) {
      return migrateV1(parsed);
    }
    return null;
  } catch {
    return null;
  }
}

function migrateV2(v2: PersistedV2): PersistedSnapshot | null {
  if (!Array.isArray(v2.projects) || v2.projects.length === 0) return null;
  const projects = v2.projects
    .map(normalizeProject)
    .filter((p): p is Project => p !== null);
  if (projects.length === 0) return null;
  const activeProjectId = projects.some((p) => p.id === v2.activeProjectId)
    ? v2.activeProjectId
    : projects[0].id;
  return { projects, activeProjectId };
}

function migrateV1(v1: PersistedV1): PersistedSnapshot | null {
  if (!Array.isArray(v1.apis)) return null;
  // Wrap the v1 single-namespace data as a single project named "Default".
  const project = normalizeProject({
    id: "default",
    name: "Default",
    createdAt: Date.now(),
    apis: v1.apis,
    reactors: v1.reactors ?? [],
    window: v1.window ?? { startMs: FY_START_MS, endMs: FY_END_MS },
  });
  if (!project) return null;
  return { projects: [project], activeProjectId: "default" };
}

/**
 * Apply per-API / per-stage / window migrations to a single project.
 * Returns null if the project is unsalvageable (e.g. malformed).
 */
function normalizeProject(p: any): Project | null {
  if (!p || typeof p !== "object") return null;
  if (!Array.isArray(p.apis)) return null;
  if (
    !p.apis.every(
      (a: any) => a && typeof a.id === "string" && Array.isArray(a.stages)
    )
  ) {
    return null;
  }

  const migratedApis = p.apis.map((a: any) => {
    const priority = (a.priority ?? 3) as API["priority"];
    let targetKg = a.targetKg;
    if (typeof targetKg !== "number" || targetKg < 0) {
      const stages = Array.isArray(a.stages) ? a.stages : [];
      if (stages.length > 0) {
        const finalStage = stages.reduce((acc: any, s: any) =>
          s.stageNo > acc.stageNo ? s : acc
        );
        targetKg =
          (finalStage.batchSizeKg ?? 0) * (finalStage.plannedBatches ?? 0);
      } else {
        targetKg = 0;
      }
    }
    const stages = Array.isArray(a.stages)
      ? a.stages.map((s: any) => ({
          ...s,
          inputKgPerBatch:
            typeof s.inputKgPerBatch === "number" && s.inputKgPerBatch > 0
              ? s.inputKgPerBatch
              : s.batchSizeKg,
        }))
      : [];
    const {
      startMs: _legacyStart,
      endMs: _legacyEnd,
      ...rest
    } = a as API & { startMs?: number; endMs?: number };
    void _legacyStart;
    void _legacyEnd;
    return { ...rest, priority, targetKg, stages };
  });
  const apis = refreshPaletteColors(migratedApis as API[]) as API[];

  const reactors: Reactor[] = Array.isArray(p.reactors)
    ? p.reactors.map((r: any) => ({ ...r, name: r.name ?? r.id }))
    : [];

  let win: PlanWindow = { startMs: FY_START_MS, endMs: FY_END_MS };
  if (
    p.window &&
    typeof p.window.startMs === "number" &&
    typeof p.window.endMs === "number" &&
    p.window.endMs > p.window.startMs
  ) {
    win = p.window;
  }

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
    apis,
    reactors,
    window: win,
  };
}

export function savePersisted(
  projects: Project[],
  activeProjectId: string
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedV2 = {
      v: 2,
      projects,
      activeProjectId,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
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

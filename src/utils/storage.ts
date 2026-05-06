import type { API, PlanWindow, Project, Reactor } from "../types";
import { FY_END_MS, FY_START_MS } from "./dates";
import { refreshPaletteColors } from "../data/seed";

// Persisted shapes over time.
//   v1: { v: 1, apis, reactors?, window? }                           — legacy single-namespace
//   v2: { v: 2, projects, activeProjectId }                          — multi-project flat
//   v3: split into TWO keys —
//        pharma:projects:v3      = Project[] (the same set as in cloud)
//        pharma:activeProjectId  = string    (per-browser preference)
//   We keep the v1/v2 reader for one-shot migration to v3.
const PROJECTS_KEY = "pharma:projects:v3";
const ACTIVE_KEY = "pharma:activeProjectId:v3";

// Legacy combined key (v1 + v2). We try this on first boot if the v3 keys
// are absent so existing users automatically migrate.
const LEGACY_KEY = "pharma:apis:v1";

const DATA_SOURCE_KEY = "pharma:dataSource:v1";

export type DataSource = "cloud" | "local";

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

interface PersistedV3Body {
  v: 3;
  projects: Project[];
  savedAt?: number;
}

type AnyLegacy = PersistedV1 | PersistedV2;

export interface PersistedSnapshot {
  projects: Project[];
  activeProjectId: string;
}

// ─── Load ──────────────────────────────────────────────────────────────────

export function loadPersisted(): PersistedSnapshot | null {
  if (typeof window === "undefined") return null;
  // Try v3 first.
  const v3 = readV3();
  if (v3) return v3;
  // Fall back to v1/v2 and migrate forward.
  const legacy = readLegacy();
  if (!legacy) return null;
  // Persist as v3 immediately so subsequent boots take the fast path.
  saveProjects(legacy.projects);
  saveActiveProjectId(legacy.activeProjectId);
  return legacy;
}

function readV3(): PersistedSnapshot | null {
  try {
    const rawProjects = window.localStorage.getItem(PROJECTS_KEY);
    if (!rawProjects) return null;
    const parsed = JSON.parse(rawProjects) as PersistedV3Body;
    if (parsed?.v !== 3 || !Array.isArray(parsed.projects)) return null;
    const projects = parsed.projects
      .map(normalizeProject)
      .filter((p): p is Project => p !== null);
    if (projects.length === 0) return null;
    const rawActive = window.localStorage.getItem(ACTIVE_KEY);
    const activeProjectId =
      rawActive && projects.some((p) => p.id === rawActive)
        ? rawActive
        : projects[0].id;
    return { projects, activeProjectId };
  } catch {
    return null;
  }
}

function readLegacy(): PersistedSnapshot | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AnyLegacy;
    if (!parsed || typeof parsed !== "object") return null;
    if ((parsed as any).v === 2) return migrateV2(parsed as PersistedV2);
    if ((parsed as any).v === 1) return migrateV1(parsed as PersistedV1);
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
      ? a.stages.map((s: any) => {
          // Migrate the legacy `cycleHours` field to the new `bcfHours`.
          // We strip the old key so it doesn't leak through the spread.
          const { cycleHours: _legacyCycle, ...rest } = s;
          const bcfHours =
            typeof s.bcfHours === "number" && s.bcfHours > 0
              ? s.bcfHours
              : typeof _legacyCycle === "number" && _legacyCycle > 0
              ? _legacyCycle
              : 72;
          return {
            ...rest,
            bcfHours,
            inputKgPerBatch:
              typeof s.inputKgPerBatch === "number" && s.inputKgPerBatch > 0
                ? s.inputKgPerBatch
                : s.batchSizeKg,
            pcoHours:
              typeof s.pcoHours === "number" && s.pcoHours >= 0
                ? s.pcoHours
                : 8,
          };
        })
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
    ? p.reactors.map((r: any) => {
        const { shared: _shared, ...rest } = r;
        void _shared;
        return {
          ...rest,
          name: r.name ?? r.id,
          reactorClass: migrateReactorClass(r.reactorClass),
        };
      })
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

// ─── Save ──────────────────────────────────────────────────────────────────

export function savePersisted(
  projects: Project[],
  activeProjectId: string
): void {
  if (typeof window === "undefined") return;
  saveProjects(projects);
  saveActiveProjectId(activeProjectId);
}

function saveProjects(projects: Project[]): void {
  try {
    const payload: PersistedV3Body = {
      v: 3,
      projects,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
}

function saveActiveProjectId(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // ignore
  }
}

export function clearPersisted(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PROJECTS_KEY);
    window.localStorage.removeItem(ACTIVE_KEY);
    // Also drop the legacy v1/v2 blob if it's still hanging around.
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore
  }
}

export function isPersistedPresent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(PROJECTS_KEY) !== null ||
      window.localStorage.getItem(LEGACY_KEY) !== null
    );
  } catch {
    return false;
  }
}

// ─── Mode preference ───────────────────────────────────────────────────────

export function getDataSourceMode(): DataSource {
  if (typeof window === "undefined") return "cloud";
  try {
    const v = window.localStorage.getItem(DATA_SOURCE_KEY);
    if (v === "local") return "local";
    return "cloud";
  } catch {
    return "cloud";
  }
}

export function setDataSourceMode(mode: DataSource): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DATA_SOURCE_KEY, mode);
  } catch {
    // ignore
  }
}

// ─── Stats helpers (for Admin tab) ─────────────────────────────────────────

export function persistedSizeBytes(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(PROJECTS_KEY);
    return raw ? raw.length * 2 : 0;
  } catch {
    return 0;
  }
}

export function persistedSavedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROJECTS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.savedAt === "number" ? parsed.savedAt : null;
  } catch {
    return null;
  }
}

// ─── Reactor class migration helper ────────────────────────────────────────
//
// "Small" + "Medium" → "Intermediate"; "Large" → "Cleanroom". Unknown values
// fall back to "Intermediate". Exported because services/sync.ts also uses
// it on cloud reads.
export function migrateReactorClass(value: unknown): Reactor["reactorClass"] {
  if (value === "Intermediate" || value === "Cleanroom") return value;
  if (value === "Large") return "Cleanroom";
  return "Intermediate";
}

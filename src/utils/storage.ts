import type {
  API,
  ApiTopology,
  PlanWindow,
  Project,
  Reactor,
  SideChainCascadePolicy,
} from "../types";
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

  // Determine project-level window first — used as the fallback when an API
  // has no per-API window stored yet.
  let projectWin: PlanWindow = { startMs: FY_START_MS, endMs: FY_END_MS };
  if (
    p.window &&
    typeof p.window.startMs === "number" &&
    typeof p.window.endMs === "number" &&
    p.window.endMs > p.window.startMs
  ) {
    projectWin = p.window;
  }

  const migratedApis = p.apis.map((a: any) => {
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
          // Migrate legacy `cycleHours` → `bcfHours` and default `bctHours`.
          const { cycleHours: _legacyCycle, ...rest } = s;
          const bcfHours =
            typeof s.bcfHours === "number" && s.bcfHours > 0
              ? s.bcfHours
              : typeof _legacyCycle === "number" && _legacyCycle > 0
              ? _legacyCycle
              : 72;
          // BCT defaults to BCF (back-to-back batches) when not explicitly set.
          const bctHours =
            typeof s.bctHours === "number" && s.bctHours > 0
              ? s.bctHours
              : bcfHours;
          // processHours is unified with bctHours — the two were merged
          // in the UI since users always set them equal in practice. Any
          // legacy stored value is overwritten so process always fills
          // the full slot.
          const processHours = bctHours;
          // Carry through the raw inputStageIds; we do a second pass below
          // to default missing/empty values to "previous stage by stageNo"
          // so legacy linear data behaves identically.
          const rawInputs = Array.isArray(s.inputStageIds)
            ? s.inputStageIds.filter((x: unknown) => typeof x === "string")
            : null;
          return {
            ...rest,
            bcfHours,
            bctHours,
            processHours,
            inputKgPerBatch:
              typeof s.inputKgPerBatch === "number" && s.inputKgPerBatch > 0
                ? s.inputKgPerBatch
                : s.batchSizeKg,
            pcoHours:
              typeof s.pcoHours === "number" && s.pcoHours >= 0
                ? s.pcoHours
                : 8,
            inputStageIds: rawInputs ?? [],
            reactorSubstitutes: normalizeReactorSubstitutes(s.reactorSubstitutes),
            cascadePolicy: normalizeCascadePolicy(s.cascadePolicy),
            // Sentinel: stash whether the source had a stored array. If not,
            // we'll fill it with the linear-chain default in the next pass
            // so legacy data is migrated transparently.
            __inputsWereStored: rawInputs !== null,
          };
        })
      : [];
    normalizeStageDagInputs(stages);
    // Drop `priority` (no longer part of the model) and `startMs/endMs`
    // legacy direct-on-api fields.
    const {
      startMs: _legacyStart,
      endMs: _legacyEnd,
      priority: _legacyPriority,
      window: storedWindow,
      ...rest
    } = a as API & { startMs?: number; endMs?: number; priority?: any };
    void _legacyStart;
    void _legacyEnd;
    void _legacyPriority;
    // Per-API window: prefer the stored value; fall back to the project's
    // window (= every API gets the old global window after migration).
    const apiWindow: PlanWindow =
      storedWindow &&
      typeof storedWindow.startMs === "number" &&
      typeof storedWindow.endMs === "number" &&
      storedWindow.endMs > storedWindow.startMs
        ? storedWindow
        : { ...projectWin };
    return {
      ...rest,
      targetKg,
      stages,
      window: apiWindow,
      topology: normalizeApiTopology(a.topology),
    };
  });
  const apis = refreshPaletteColors(migratedApis as API[]) as API[];

  const reactors: Reactor[] = Array.isArray(p.reactors)
    ? p.reactors.map((r: any) => {
        const { shared: _shared, reactorClass: legacyClass, ...rest } = r;
        void _shared;
        return {
          ...rest,
          name: r.name ?? r.id,
          moc: migrateMoc(r.moc ?? legacyClass),
          agitatorType: migrateAgitator(r.agitatorType),
        };
      })
    : [];

  // The project-level window is now derived from the union of API windows;
  // it's stored only as a display-range cache, not authoritative. If APIs
  // exist, recompute it; otherwise keep whatever was stored / FY default.
  const win: PlanWindow =
    apis.length > 0
      ? {
          startMs: Math.min(...apis.map((x) => x.window.startMs)),
          endMs: Math.max(...apis.map((x) => x.window.endMs)),
        }
      : projectWin;

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

// ─── First-time guide flag ─────────────────────────────────────────────────

const GUIDE_KEY = "pharma:guideSeen:v1";

/** True iff the user has dismissed the welcome guide at least once. */
export function hasSeenGuide(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(GUIDE_KEY) === "1";
  } catch {
    return true;
  }
}

/** Mark the welcome guide as seen — called when the user closes it. */
export function markGuideSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GUIDE_KEY, "1");
  } catch {
    // ignore
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

// ─── Reactor MOC + agitator migration helpers ─────────────────────────────
//
// Migration chain for the wetted-surface MOC field:
//   "SS" | "GL" | "Hastelloy" | "Halar lined"             → pass-through
//   "SSR" | "Intermediate" | "Small" | "Medium"           → "SS"
//   "GLR" | "Cleanroom"    | "Large"                      → "GL"
//   anything else (incl. undefined) → "SS" (most common default)
// Exported because services/sync.ts uses it on cloud reads too.
export function migrateMoc(value: unknown): Reactor["moc"] {
  if (
    value === "SS" ||
    value === "GL" ||
    value === "Hastelloy" ||
    value === "Halar lined"
  ) {
    return value;
  }
  if (value === "GLR" || value === "Cleanroom" || value === "Large") {
    return "GL";
  }
  return "SS";
}

/** Legacy alias for migrateMoc — keeps services/sync.ts source-compatible
 *  while we sweep all callers. */
export const migrateReactorClass = migrateMoc;

/**
 * Normalize the `inputStageIds` DAG-predecessor field for every stage of
 * an API in place. Used by both the local v1/v2/v3 hydrators here and the
 * cloud-row reader in services/sync.ts so every load path produces the
 * same canonical shape.
 *
 * Rules (matching types.ts doc):
 *   - The first stage by `stageNo` always gets `[]` (no predecessors).
 *   - SIDE-CHAIN ANCHORS (`cascadePolicy.kind === "side-chain"`) are
 *     allowed to keep their stored `inputStageIds` value — typically `[]`
 *     because the anchor's demand comes from its `cascadePolicy.factor`,
 *     not from a DAG predecessor. We just scrub self-refs and danglers
 *     but do NOT fall back to the linear-chain default for them.
 *   - For every other non-first stage: if the field was MISSING from
 *     storage OR ended up empty after filtering dangling refs, default to
 *     `[previous stage by stageNo]` so legacy linear chains keep working.
 *   - Self-references are dropped; ids that don't exist in the API's stage
 *     set are filtered out (guards against stale references after deletes).
 *
 * The `__inputsWereStored` sentinel placed by the migration pass tells us
 * whether the source actually carried the field; absent that sentinel we
 * conservatively assume it was stored (i.e. an empty array means "really
 * empty", not "missing").
 */
export function normalizeStageDagInputs(stages: any[]): void {
  if (!Array.isArray(stages) || stages.length === 0) return;
  const sortedByNo = [...stages].sort((x, y) => x.stageNo - y.stageNo);
  const idSet = new Set(sortedByNo.map((s) => s.id));
  sortedByNo.forEach((s, idx) => {
    const stored: string[] = Array.isArray(s.inputStageIds)
      ? s.inputStageIds.filter(
          (x: unknown) => typeof x === "string"
        )
      : [];
    const wasStored =
      "__inputsWereStored" in s
        ? !!s.__inputsWereStored
        : Array.isArray(s.inputStageIds);
    const isSideChainAnchor =
      s.cascadePolicy &&
      typeof s.cascadePolicy === "object" &&
      s.cascadePolicy.kind === "side-chain";
    if (idx === 0) {
      s.inputStageIds = [];
    } else if (isSideChainAnchor) {
      // Anchor of a side chain — its demand is set by cascadePolicy.factor,
      // not by a DAG predecessor. Keep whatever was stored (typically [])
      // after scrubbing self-refs and danglers; do NOT fall back to linear.
      s.inputStageIds = stored.filter(
        (id) => id !== s.id && idSet.has(id)
      );
    } else if (!wasStored) {
      // Legacy data with no `inputStageIds` field at all → fall back to
      // the linear-chain default so v1/v2 saves keep behaving identically.
      s.inputStageIds = [sortedByNo[idx - 1].id];
    } else {
      // Explicitly stored (v3+ shape). An empty list is now meaningful —
      // it can be a sub-chain root in the "parallel" topology — so we
      // keep it as-is after scrubbing self-refs and danglers, instead of
      // clobbering it with the legacy linear default.
      s.inputStageIds = stored.filter(
        (id) => id !== s.id && idSet.has(id)
      );
    }
    if ("__inputsWereStored" in s) delete s.__inputsWereStored;
  });
}

/**
 * Normalize `stage.reactorSubstitutes`. Strips non-string entries and
 * empty substitute lists so the stored shape is always clean.
 * Returns `undefined` when no valid substitutes are present (old data).
 */
function normalizeReactorSubstitutes(
  value: unknown
): Record<string, string[]> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const result: Record<string, string[]> = {};
  let hasAny = false;
  for (const [key, arr] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(arr)) continue;
    const filtered = arr.filter((x): x is string => typeof x === "string" && x.length > 0);
    if (filtered.length > 0) {
      result[key] = filtered;
      hasAny = true;
    }
  }
  return hasAny ? result : undefined;
}

/**
 * Normalize an `api.topology` value. Anything not in the allowed set
 * collapses to "linear" (the default), so legacy rows that predate the
 * topology field — or rows with garbled data — keep behaving like the
 * old linear-chain APIs.
 *
 * Exported for sync.ts so cloud reads use the same allow-list.
 */
export function normalizeApiTopology(value: unknown): ApiTopology {
  if (value === "linear" || value === "parallel" || value === "side_chains") {
    return value;
  }
  return "linear";
}

/**
 * Normalize a `stage.cascadePolicy` value. Strips unknown shapes so
 * stages from older rows (before the side-chain feature) come back as
 * `undefined`, leaving them on the default "sum-from-successors" cascade
 * path.
 *
 * Currently only `kind === "side-chain"` is recognised. The shape:
 *   { kind: "side-chain", baseStageId: string, factor: number > 0 }
 *
 * Exported so sync.ts can apply the same canonicalization on cloud rows.
 */
export function normalizeCascadePolicy(
  value: unknown
): SideChainCascadePolicy | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (v.kind !== "side-chain") return undefined;
  const baseStageId =
    typeof v.baseStageId === "string" && v.baseStageId.length > 0
      ? v.baseStageId
      : null;
  if (!baseStageId) return undefined;
  const factor =
    typeof v.factor === "number" && Number.isFinite(v.factor) && v.factor > 0
      ? v.factor
      : null;
  if (factor === null) return undefined;
  return { kind: "side-chain", baseStageId, factor };
}

export function migrateAgitator(value: unknown): Reactor["agitatorType"] {
  if (
    value === "Anchor" ||
    value === "RCI" ||
    value === "PBT" ||
    value === "MIG" ||
    value === "Hydrofoil"
  ) {
    return value;
  }
  return "Anchor";
}

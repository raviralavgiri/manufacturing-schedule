import { create } from "zustand";
import { API_PALETTE, REACTORS, buildSeed, refreshPaletteColors } from "./data/seed";
import { runScheduler } from "./scheduler/scheduler";
import { cascadePlannedBatches } from "./scheduler/cascade";
import type {
  AgitatorType,
  API,
  MOC,
  PlanWindow,
  Project,
  Reactor,
  ReactorClass,
  ScheduleResult,
  StageMaster,
} from "./types";
import {
  clearPersisted,
  getDataSourceMode,
  isPersistedPresent,
  loadPersisted,
  savePersisted,
  setDataSourceMode,
  type DataSource,
} from "./utils/storage";
import {
  applyTopologyPresetToApi,
  type TopologyPresetSpec,
} from "./utils/topologyPresets";
import { isSupabaseEnabled } from "./services/supabase";
import {
  loadAllProjectsFromCloud,
  queueCloudSave,
  syncAllProjectsToCloud,
  setIdleStatus,
  setLoadingStatus,
} from "./services/sync";
import { FY_END_MS, FY_START_MS } from "./utils/dates";

/**
 * Snapshot of what the most-recent cloud read returned. Lightweight by design
 * (no full project payloads) — just enough for the Admin tab to render a
 * comparison against the local cache and show freshness.
 */
export interface CloudReadInfo {
  /** Timestamp when the read completed. */
  at: number;
  /** Reason if the read failed; null on success. */
  error: string | null;
  /** True if the row was missing OR present-but-empty (no projects). */
  isEmpty: boolean;
  /** Active project id from cloud, or null if the row didn't have one. */
  activeProjectId: string | null;
  /** Per-project summary, mirroring what the Admin tab compares against
   *  the local store. Empty array when isEmpty is true. */
  projects: Array<{
    id: string;
    name: string;
    apiCount: number;
    reactorCount: number;
  }>;
}

export interface NewStageInput {
  apiId: string;
  stageName: string;
  batchSizeKg: number;
  inputKgPerBatch: number;
  reactorPool: string[];
  bcfHours: number;
  bctHours: number;
  analysisHours: number;
  pcoHours: number;
  plannedBatches: number;
  /**
   * DAG predecessors for the new stage. Optional — when omitted, addStage
   * defaults to `[lastExistingStageId]` (linear chain) for non-first stages
   * and `[]` for the first stage of an API.
   */
  inputStageIds?: string[];
}

interface AppState {
  // ─ Project namespace ────────────────────────────────────────────
  projects: Project[];
  activeProjectId: string;

  // ─ Mirrored from active project (for tab compat) ────────────────
  apis: API[];
  reactors: Reactor[];
  window: PlanWindow;
  schedule: ScheduleResult;

  // ─ Misc state ───────────────────────────────────────────────────
  isRecomputing: boolean;
  lastRecomputeMs: number;
  recentlyAddedStageId: string | null;
  hasPersistedChanges: boolean;
  cloudEnabled: boolean;

  // ─ Data source mode ─────────────────────────────────────────────
  /** Where to read on boot: "cloud" (Supabase) or "local" (browser). Writes
   *  always go to the active source; cloud writes also mirror to local. */
  dataSource: DataSource;
  /** True while the initial cloud fetch is in flight (cloud mode boot). */
  isHydrating: boolean;
  /** Last cloud read/write error message, if any. */
  cloudError: string | null;
  /** Most-recent cloud read result. Used by the Admin tab to render
   *  comparison + freshness info. Updated on boot, on pullFromCloud,
   *  and on explicit refreshCloudSnapshot calls. */
  lastCloudRead: CloudReadInfo | null;

  // ─ Stage actions (operate on active project) ────────────────────
  updateStageField: (
    stageId: string,
    field: keyof Pick<
      StageMaster,
      | "batchSizeKg"
      | "inputKgPerBatch"
      | "bcfHours"
      | "bctHours"
      | "analysisHours"
      | "pcoHours"
      | "plannedBatches"
    >,
    value: number
  ) => void;
  setStageOutput: (stageId: string, outputKg: number) => void;
  setStageName: (stageId: string, name: string) => void;
  setStageReactorPool: (stageId: string, pool: string[]) => void;
  /** Update the BMR-defined optional substitute list for a stage. */
  setStageReactorSubstitutes: (
    stageId: string,
    substitutes: Record<string, string[]>
  ) => void;
  /**
   * Replace a stage's DAG predecessor list. Re-runs the cascade for the
   * owning API (because dependency topology changes upstream demand) and
   * triggers `forceRecompute` of the schedule. Self-references and unknown
   * ids are filtered. The first stage of an API (lowest stageNo) is
   * locked to `[]` regardless of input.
   */
  setStageInputs: (stageId: string, ids: string[]) => void;
  /** Per-stage first-batch start date (ms); pass undefined to clear → default. */
  setStageFirstBatchStart: (stageId: string, ms: number | undefined) => void;
  /** Per-stage existing on-hand stock (kg); recascades planned batches. */
  setStageExistingStock: (stageId: string, kg: number) => void;
  addStage: (input: NewStageInput) => string;
  removeStage: (stageId: string) => void;

  // ─ API actions (operate on active project) ──────────────────────
  setApiName: (apiId: string, name: string) => void;
  setApiTargetOutput: (apiId: string, targetKg: number) => void;
  /**
   * Set an API's production sequence order within the shared cleanroom.
   * LOWER number = campaign scheduled earlier. Triggers a recompute.
   */
  setApiProductionSequence: (apiId: string, sequence: number) => void;
  /** Production block / cleanroom where this API's final stage runs. */
  setApiBlock: (apiId: string, block: string) => void;
  /** Set ONE api's plan window (per-API window replaces the old global). */
  setApiWindow: (apiId: string, startMs: number, endMs: number) => void;
  setApiStageCount: (apiId: string, count: number) => void;
  /**
   * Scaffold this API's stages onto the chosen TOPOLOGY PRESET. Operates
   * in PRESERVE_THEN_ADD mode — existing stage rows are mapped to scaffold
   * positions by stageNo and have their `inputStageIds` / `cascadePolicy`
   * re-wired; missing positions are added with sensible defaults; extras
   * past the scaffold size trail with a linear chain. Re-runs the cascade
   * and triggers a schedule recompute.
   *
   * See `src/utils/topologyPresets.ts` for the spec shapes.
   */
  applyTopologyPreset: (apiId: string, spec: TopologyPresetSpec) => void;
  addAPI: (withDefaultFinalStage?: boolean) => string;
  removeAPI: (apiId: string) => void;

  // ─ Reactor actions (operate on active project) ──────────────────
  setReactorName: (reactorId: string, name: string) => void;
  setReactorMoc: (reactorId: string, moc: MOC) => void;
  setReactorAgitator: (reactorId: string, agitator: AgitatorType) => void;
  setReactorCapacity: (reactorId: string, capacityKg: number) => void;
  setReactorClass: (reactorId: string, cls: ReactorClass | undefined) => void;
  setReactorProductionBlock: (reactorId: string, block: string) => void;
  setReactorPmFirstDate: (reactorId: string, ms: number | undefined) => void;
  setReactorPmDuration: (reactorId: string, days: number) => void;
  setReactorBuildingMaintenanceFirstDate: (reactorId: string, ms: number | undefined) => void;
  addReactor: (input: {
    id: string;
    name?: string;
    moc: MOC;
    agitatorType?: AgitatorType;
    capacityKg: number;
  }) =>
    | { ok: true; id: string }
    | { ok: false; error: string };
  removeReactor: (
    reactorId: string,
    opts?: { cascade?: boolean }
  ) =>
    | { ok: true }
    | { ok: false; error: string; blockingStages?: string[] };

  // ─ Project actions ──────────────────────────────────────────────
  createProject: (name?: string) => string;
  switchProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;

  // ─ Data source actions ──────────────────────────────────────────
  /** Switch the data source. For local→cloud, prefer pushToCloud /
   *  pullFromCloud first; this method only flips the flag and starts /
   *  stops the cloud write queue. */
  setDataSource: (mode: DataSource) => void;
  /** Push the current in-memory state to Supabase, overwriting whatever's
   *  there. Useful before switching from local→cloud to preserve local
   *  edits. */
  pushToCloud: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Replace in-memory state with whatever's in Supabase. Useful when
   *  switching from local→cloud and you want to discard local edits. */
  pullFromCloud: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Re-read the cloud row WITHOUT touching in-memory state. Updates
   *  `lastCloudRead` so the Admin tab can show freshness + comparison.
   *  Used to answer "is what I'm seeing actually what's in the cloud?". */
  refreshCloudSnapshot: () =>
    Promise<{ ok: true; info: CloudReadInfo } | { ok: false; error: string }>;
  /** Wipe localStorage workspace data (keeps the workspaceId + mode). */
  clearLocalCache: () => void;

  // ─ Misc ─────────────────────────────────────────────────────────
  clearRecentlyAdded: () => void;
  resetToSeed: () => void;
  forceRecompute: () => void;
  /**
   * Replace the active project's APIs and reactors wholesale (e.g. after an
   * Excel import). Runs cascade + schedule recompute and persists.
   */
  replaceProjectData: (apis: API[], reactors: Reactor[]) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────
function freshDefaultProject(): Project {
  const seed = buildSeed();
  return {
    id: "default",
    name: "Default",
    createdAt: Date.now(),
    apis: seed.apis,
    reactors: seed.reactors,
    window: { startMs: FY_START_MS, endMs: FY_END_MS },
  };
}

function emptyProject(name: string): Project {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    name: name.trim() || "Untitled Project",
    createdAt: Date.now(),
    apis: [],
    reactors: REACTORS.map((r) => ({ ...r })), // default reactor list
    window: { startMs: FY_START_MS, endMs: FY_END_MS },
  };
}

function getActive(state: { projects: Project[]; activeProjectId: string }): Project {
  return (
    state.projects.find((p) => p.id === state.activeProjectId) ??
    state.projects[0]
  );
}

/** Compress a list of projects into the lightweight CloudReadInfo summary. */
function summarizeProjects(
  projects: Project[],
  activeProjectId: string | null
): CloudReadInfo {
  return {
    at: Date.now(),
    error: null,
    isEmpty: projects.length === 0,
    activeProjectId,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      apiCount: p.apis.length,
      reactorCount: p.reactors.length,
    })),
  };
}

// ─── Initial hydration ─────────────────────────────────────────────────────────
//
// Boot path branches on the user-selected dataSource mode:
//
//   • "local" — read localStorage synchronously (same as legacy behaviour).
//               No cloud calls happen on boot or on subsequent writes.
//
//   • "cloud" — start with an empty placeholder so React can render the
//               loading splash, then async-fetch from Supabase. Local cache
//               is used as an emergency fallback only if the cloud read
//               fails. Writes always go to Supabase AND mirror to local
//               (the local copy is purely for offline survival).
const initialMode: DataSource = isSupabaseEnabled
  ? getDataSourceMode()
  : "local";

function buildInitialFromPersisted() {
  const persisted = loadPersisted();
  const projects: Project[] = persisted?.projects ?? [freshDefaultProject()];
  const activeId =
    persisted && projects.some((p) => p.id === persisted.activeProjectId)
      ? persisted.activeProjectId
      : projects[0].id;
  const active = projects.find((p) => p.id === activeId)!;
  const apis = active.apis.map(cascadePlannedBatches);
  active.apis = apis;
  return {
    projects,
    activeProjectId: activeId,
    apis,
    reactors: active.reactors,
    window: active.window,
    schedule: runScheduler(apis, active.reactors, active.window),
    hasPersisted: !!persisted,
  };
}

const initialFromLocal = buildInitialFromPersisted();
// In cloud mode we still seed from local synchronously so first paint isn't
// blank — the async cloud fetch will replace it within a few hundred ms.
const initialProjects = initialFromLocal.projects;
const initialActiveId = initialFromLocal.activeProjectId;
const initialApis = initialFromLocal.apis;
const initialReactors = initialFromLocal.reactors;
const initialWindow = initialFromLocal.window;
const initialSchedule = initialFromLocal.schedule;

let recomputeTimer: number | undefined;

/**
 * Persistence dispatcher. Always writes localStorage (it's free, sync, and
 * acts as backup). Only queues a cloud reconcile when the user is in "cloud"
 * mode AND Supabase is actually enabled.
 *
 * Cloud reconcile = upsert every local project + delete any cloud rows
 * whose id is no longer in the local set. See syncAllProjectsToCloud.
 */
function persistAndSync(
  projects: Project[],
  activeProjectId: string,
  mode: DataSource
) {
  savePersisted(projects, activeProjectId);
  if (mode === "cloud" && isSupabaseEnabled) {
    queueCloudSave(projects);
  }
}

function scheduleRecompute(set: any, get: any, immediate = false) {
  if (recomputeTimer) window.clearTimeout(recomputeTimer);
  set({ isRecomputing: true });
  const run = () => {
    const { apis: latestApis, reactors, window: planWindow } = get();
    const sched = runScheduler(latestApis, reactors, planWindow);
    set({ schedule: sched, isRecomputing: false, lastRecomputeMs: Date.now() });
  };
  if (immediate) {
    run();
  } else {
    recomputeTimer = window.setTimeout(run, 350);
  }
}

/**
 * Apply a mutator to the active project, then mirror the result into the
 * top-level convenience fields (apis/reactors/window). Persists & queues
 * cloud sync. Caller is responsible for triggering `scheduleRecompute`
 * when needed (some mutations don't change the schedule).
 */
function mutateActive(
  set: any,
  get: any,
  mutator: (p: Project) => Project
): { changed: boolean } {
  const state = get();
  let changed = false;
  const projects = state.projects.map((p: Project) => {
    if (p.id !== state.activeProjectId) return p;
    const next = mutator(p);
    if (next !== p) changed = true;
    return next;
  });
  if (!changed) return { changed: false };
  const active = projects.find(
    (p: Project) => p.id === state.activeProjectId
  )!;
  set({
    projects,
    apis: active.apis,
    reactors: active.reactors,
    window: active.window,
    hasPersistedChanges: true,
  });
  persistAndSync(projects, state.activeProjectId, state.dataSource);
  return { changed: true };
}

// ─── Store ─────────────────────────────────────────────────────────────────────
export const useStore = create<AppState>((set, get) => ({
  projects: initialProjects,
  activeProjectId: initialActiveId,
  apis: initialApis,
  reactors: initialReactors,
  window: initialWindow,
  schedule: initialSchedule,
  isRecomputing: false,
  lastRecomputeMs: Date.now(),
  recentlyAddedStageId: null,
  hasPersistedChanges: isPersistedPresent(),
  cloudEnabled: isSupabaseEnabled,

  // ─ Data source defaults ─────────────────────────────────────────
  dataSource: initialMode,
  isHydrating: initialMode === "cloud" && isSupabaseEnabled,
  cloudError: null,
  lastCloudRead: null,

  // ─ Stage actions ────────────────────────────────────────────────
  updateStageField: (stageId, field, value) => {
    // PCO is the only field where 0 is meaningful ("no cleaning needed");
    // every other numeric stage field has a minimum of 1.
    const minValue = field === "pcoHours" ? 0 : 1;
    const clamped = Math.max(minValue, value);
    mutateActive(set, get, (p) => {
      const apis = p.apis.map((a) => {
        const idx = a.stages.findIndex((s) => s.id === stageId);
        if (idx < 0) return a;
        const updatedStages = a.stages.map((s) => {
          if (s.id !== stageId) return s;
          // BCT (slot duration) is the single source of truth for both
          // reactor occupancy AND active processing — they were merged in
          // the UI because in practice users always set them equal. We
          // keep `processHours` in the data model for back-compat but
          // mirror it onto bctHours on every write.
          if (field === "bctHours") {
            return {
              ...s,
              bctHours: clamped,
              processHours: clamped,
            };
          }
          return { ...s, [field]: clamped };
        });
        const updated = { ...a, stages: updatedStages };
        if (
          field === "batchSizeKg" ||
          field === "inputKgPerBatch" ||
          field === "plannedBatches"
        ) {
          return cascadePlannedBatches(updated);
        }
        return updated;
      });
      return { ...p, apis };
    });
    scheduleRecompute(set, get);
  },

  setStageOutput: (stageId, outputKg) => {
    const owningApi = get().apis.find((a: API) =>
      a.stages.some((s) => s.id === stageId)
    );
    if (!owningApi) return;
    const finalStage = owningApi.stages.reduce((acc, s) =>
      s.stageNo > acc.stageNo ? s : acc
    );
    if (finalStage.id !== stageId) return;
    get().setApiTargetOutput(owningApi.id, outputKg);
  },

  setStageName: (stageId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    mutateActive(set, get, (p) => {
      const apis = p.apis.map((a) => ({
        ...a,
        stages: a.stages.map((s) =>
          s.id === stageId ? { ...s, stageName: trimmed } : s
        ),
      }));
      return { ...p, apis };
    });
  },

  setStageReactorPool: (stageId, pool) => {
    if (pool.length === 0) return;
    mutateActive(set, get, (p) => {
      const apis = p.apis.map((a) => ({
        ...a,
        stages: a.stages.map((s) =>
          s.id === stageId ? { ...s, reactorPool: pool.slice() } : s
        ),
      }));
      return { ...p, apis };
    });
    scheduleRecompute(set, get, true);
  },

  setStageReactorSubstitutes: (stageId, substitutes) => {
    mutateActive(set, get, (p) => {
      const apis = p.apis.map((a) => ({
        ...a,
        stages: a.stages.map((s) =>
          s.id === stageId ? { ...s, reactorSubstitutes: { ...substitutes } } : s
        ),
      }));
      return { ...p, apis };
    });
    scheduleRecompute(set, get, true);
  },

  setStageInputs: (stageId, ids) => {
    mutateActive(set, get, (p) => {
      const apis = p.apis.map((a) => {
        if (!a.stages.some((s) => s.id === stageId)) return a;
        // Locate this API's first-stage id (lowest stageNo) so we can lock
        // it to []. Self-refs and unknown ids are filtered as defense in
        // depth — UI guards against them but cloud edits could sneak in.
        const sorted = [...a.stages].sort((x, y) => x.stageNo - y.stageNo);
        const firstId = sorted[0]?.id;
        const idSet = new Set(a.stages.map((s) => s.id));
        const stages = a.stages.map((s) => {
          if (s.id !== stageId) return s;
          if (s.id === firstId) {
            return { ...s, inputStageIds: [] };
          }
          const cleaned = ids.filter(
            (x) => typeof x === "string" && x !== s.id && idSet.has(x)
          );
          return { ...s, inputStageIds: cleaned };
        });
        // Topology change → re-cascade so plannedBatches / projectionKg
        // reflect the new demand graph before scheduling kicks in.
        return cascadePlannedBatches({ ...a, stages });
      });
      return { ...p, apis };
    });
    scheduleRecompute(set, get, true);
  },

  setStageFirstBatchStart: (stageId, ms) => {
    const value =
      typeof ms === "number" && Number.isFinite(ms) ? ms : undefined;
    mutateActive(set, get, (p) => {
      const apis = p.apis.map((a) => {
        if (!a.stages.some((s) => s.id === stageId)) return a;
        const stages = a.stages.map((s) =>
          s.id === stageId ? { ...s, firstBatchStartMs: value } : s
        );
        return { ...a, stages };
      });
      return { ...p, apis };
    });
    // No cascade — only affects WHEN the stage starts, not HOW MANY batches.
    scheduleRecompute(set, get, true);
  },

  setStageExistingStock: (stageId, kg) => {
    const value = Number.isFinite(kg) ? Math.max(0, kg) : 0;
    mutateActive(set, get, (p) => {
      const apis = p.apis.map((a) => {
        if (!a.stages.some((s) => s.id === stageId)) return a;
        const stages = a.stages.map((s) =>
          s.id === stageId ? { ...s, existingStockKg: value } : s
        );
        // Existing stock reduces net demand → re-cascade planned batches.
        return cascadePlannedBatches({ ...a, stages });
      });
      return { ...p, apis };
    });
    scheduleRecompute(set, get, true);
  },

  addStage: (input) => {
    let newId = "";
    mutateActive(set, get, (p) => {
      const api = p.apis.find((a) => a.id === input.apiId);
      if (!api) return p;
      const nextStageNo =
        api.stages.length === 0
          ? 1
          : Math.max(...api.stages.map((s) => s.stageNo)) + 1;
      newId = `${api.id}-S${nextStageNo}`;

      // DAG predecessor default: linear chain ([lastExistingStage]) for
      // non-first stages, [] for the first. Caller-supplied list wins
      // when provided; we still scrub self-refs / unknown ids.
      const stageIdSet = new Set(api.stages.map((s) => s.id));
      const isFirst = api.stages.length === 0;
      let inputStageIds: string[];
      if (isFirst) {
        inputStageIds = [];
      } else if (Array.isArray(input.inputStageIds)) {
        inputStageIds = input.inputStageIds.filter(
          (id) => typeof id === "string" && id !== newId && stageIdSet.has(id)
        );
        if (inputStageIds.length === 0) {
          const last = [...api.stages].sort(
            (x, y) => x.stageNo - y.stageNo
          )[api.stages.length - 1];
          inputStageIds = last ? [last.id] : [];
        }
      } else {
        const last = [...api.stages].sort(
          (x, y) => x.stageNo - y.stageNo
        )[api.stages.length - 1];
        inputStageIds = last ? [last.id] : [];
      }

      const bct = Math.max(1, input.bctHours);
      const newStage: StageMaster = {
        id: newId,
        apiId: api.id,
        apiName: api.name,
        stageNo: nextStageNo,
        stageName: input.stageName.trim() || `Intermediate-${nextStageNo}`,
        batchSizeKg: Math.max(1, input.batchSizeKg),
        inputKgPerBatch: Math.max(1, input.inputKgPerBatch),
        reactorPool: input.reactorPool.slice(),
        bcfHours: Math.max(1, input.bcfHours),
        bctHours: bct,
        // Process == BCT (the two were merged in the UI; processHours
        // remains in the data model only for back-compat).
        processHours: bct,
        analysisHours: Math.max(1, input.analysisHours),
        pcoHours: Math.max(0, input.pcoHours),
        plannedBatches: Math.max(1, input.plannedBatches),
        inputStageIds,
      };
      const apis = p.apis.map((a) =>
        a.id === api.id
          ? cascadePlannedBatches({ ...a, stages: [...a.stages, newStage] })
          : a
      );
      return { ...p, apis };
    });
    set({ recentlyAddedStageId: newId });
    scheduleRecompute(set, get, true);
    return newId;
  },

  removeStage: (stageId) => {
    mutateActive(set, get, (p) => {
      const apis = p.apis.map((a) => {
        if (!a.stages.some((s) => s.id === stageId)) return a;
        // Drop any dangling references to the deleted stage from siblings'
        // inputStageIds. If a sibling's list is filtered down to empty
        // BUT was originally non-empty (i.e. all of its predecessors were
        // the deleted stage or other casualties), fall back to its
        // previous-by-stageNo sibling so the cascade has a sensible chain
        // to walk. Stages that originally had an empty list (sub-chain
        // roots, side-chain anchors) are preserved as-is.
        const remainingSorted = a.stages
          .filter((s) => s.id !== stageId)
          .sort((x, y) => x.stageNo - y.stageNo);
        const remainingIds = new Set(remainingSorted.map((s) => s.id));
        const stages = remainingSorted.map((s, idx) => {
          const original = Array.isArray(s.inputStageIds)
            ? s.inputStageIds
            : [];
          const filtered = original.filter((id) => remainingIds.has(id));
          let next = filtered;
          if (idx === 0) {
            next = [];
          } else if (filtered.length === 0 && original.length > 0) {
            // Originally had predecessors, but they were all wiped by
            // deletions — fall back to linear default for the chain.
            next = [remainingSorted[idx - 1].id];
          }
          // Also strip cascadePolicy.baseStageId if it pointed at the
          // deleted stage — leaves the policy intact otherwise.
          let cascadePolicy = s.cascadePolicy;
          if (
            cascadePolicy &&
            cascadePolicy.kind === "side-chain" &&
            !remainingIds.has(cascadePolicy.baseStageId)
          ) {
            cascadePolicy = undefined;
          }
          if (
            next.length === original.length &&
            next.every((id, i) => id === original[i]) &&
            cascadePolicy === s.cascadePolicy
          ) {
            return s;
          }
          return { ...s, inputStageIds: next, cascadePolicy };
        });
        return cascadePlannedBatches({ ...a, stages });
      });
      return { ...p, apis };
    });
    scheduleRecompute(set, get, true);
  },

  // ─ API actions ─────────────────────────────────────────────────
  setApiName: (apiId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    mutateActive(set, get, (p) => {
      const apis = p.apis.map((a) =>
        a.id === apiId
          ? {
              ...a,
              name: trimmed,
              stages: a.stages.map((s) => ({ ...s, apiName: trimmed })),
            }
          : a
      );
      return { ...p, apis };
    });
    scheduleRecompute(set, get);
  },

  setApiTargetOutput: (apiId, targetKg) => {
    const target = Math.max(0, targetKg);
    mutateActive(set, get, (p) => {
      const apis = p.apis.map((a) =>
        a.id === apiId ? cascadePlannedBatches({ ...a, targetKg: target }) : a
      );
      return { ...p, apis };
    });
    scheduleRecompute(set, get);
  },

  setApiProductionSequence: (apiId, sequence) => {
    const seq = Number.isFinite(sequence)
      ? Math.max(0, Math.round(sequence))
      : undefined;
    mutateActive(set, get, (p) => {
      const apis = p.apis.map((a) =>
        a.id === apiId ? { ...a, productionSequence: seq } : a
      );
      return { ...p, apis };
    });
    scheduleRecompute(set, get, true);
  },

  setApiBlock: (apiId, block) => {
    const trimmed = block.trim();
    mutateActive(set, get, (p) => {
      const apis = p.apis.map((a) =>
        a.id === apiId ? { ...a, block: trimmed || undefined } : a
      );
      return { ...p, apis };
    });
    // Block is informational metadata — no schedule recompute needed.
  },

  setApiWindow: (apiId, startMs, endMs) => {
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs <= startMs
    )
      return;
    const apiWindow: PlanWindow = { startMs, endMs };
    mutateActive(set, get, (p) => {
      const apis = p.apis.map((a) =>
        a.id === apiId ? { ...a, window: apiWindow } : a
      );
      // Recompute the project-level display window from the union of API
      // windows so Gantt / Schedule / Equipment all stay aligned.
      const win =
        apis.length > 0
          ? {
              startMs: Math.min(...apis.map((x) => x.window.startMs)),
              endMs: Math.max(...apis.map((x) => x.window.endMs)),
            }
          : p.window;
      return { ...p, apis, window: win };
    });
    scheduleRecompute(set, get, true);
  },

  setApiStageCount: (apiId, count) => {
    const target = Math.max(1, Math.min(24, Math.round(count)));
    mutateActive(set, get, (p) => {
      const reactors = p.reactors;
      const apis = p.apis.map((a) => {
        if (a.id !== apiId) return a;
        const sorted = [...a.stages].sort((x, y) => x.stageNo - y.stageNo);
        let stages = sorted.slice();
        if (stages.length === target) return a;

        if (stages.length > target) {
          stages = stages.slice(0, target);
          const last = stages[stages.length - 1];
          if (last && !/final/i.test(last.stageName)) {
            stages[stages.length - 1] = { ...last, stageName: "Final API" };
          }
        } else {
          const defaultPool = reactors
            .filter((r) => r.moc === "SS")
            .slice(0, 2)
            .map((r) => r.id);
          while (stages.length < target) {
            const nextNo = stages.length + 1;
            const isFinal = nextNo === target;
            const out = isFinal ? 100 : 80;
            const prev = stages[stages.length - 1];
            stages.push({
              id: `${a.id}-S${nextNo}`,
              apiId: a.id,
              apiName: a.name,
              stageNo: nextNo,
              stageName: isFinal ? "Final API" : `Intermediate-${nextNo}`,
              batchSizeKg: out,
              inputKgPerBatch: out,
              reactorPool:
                defaultPool.length > 0 ? defaultPool : [reactors[0]?.id ?? ""],
              bcfHours: isFinal ? 120 : 72,
              bctHours: isFinal ? 120 : 72,
              processHours: isFinal ? 120 : 72,
              analysisHours: isFinal ? 48 : 24,
              pcoHours: isFinal ? 12 : 8,
              plannedBatches: 1,
              // Linear default for auto-created stages (matches seed).
              inputStageIds: prev ? [prev.id] : [],
            });
          }
        }
        return cascadePlannedBatches({ ...a, stages });
      });
      return { ...p, apis };
    });
    scheduleRecompute(set, get, true);
  },

  applyTopologyPreset: (apiId, spec) => {
    mutateActive(set, get, (p) => {
      const api = p.apis.find((a) => a.id === apiId);
      if (!api) return p;
      // Defaults for any newly-scaffolded stage rows. Reactor pool draws
      // from the API's first existing stage's pool — falling back to the
      // project's first SS reactor if there is none — so additions feel
      // continuous with whatever the user already configured.
      const firstExistingPool =
        api.stages.find((s) => s.reactorPool.length > 0)?.reactorPool ?? [];
      const fallbackPool = p.reactors
        .filter((r) => r.moc === "SS")
        .slice(0, 2)
        .map((r) => r.id);
      const reactorPool =
        firstExistingPool.length > 0 ? firstExistingPool : fallbackPool;
      const scaffolded = applyTopologyPresetToApi(api, spec, {
        batchSizeKg: 100,
        inputKgPerBatch: 100,
        bcfHours: 120,
        bctHours: 120,
        processHours: 120,
        analysisHours: 48,
        pcoHours: 8,
        plannedBatches: 10,
        reactorPool,
      });
      const cascaded = cascadePlannedBatches(scaffolded);
      const apis = p.apis.map((a) => (a.id === apiId ? cascaded : a));
      return { ...p, apis };
    });
    scheduleRecompute(set, get, true);
  },

  addAPI: (withDefaultFinalStage = true) => {
    let newId = "";
    mutateActive(set, get, (p) => {
      const nums = p.apis
        .map((a) => Number(a.id.replace(/^API-/, "")))
        .filter((n) => !Number.isNaN(n));
      const nextNum = nums.length === 0 ? 1 : Math.max(...nums) + 1;
      newId = `API-${String(nextNum).padStart(2, "0")}`;
      const color = API_PALETTE[(nextNum - 1) % API_PALETTE.length];
      const stages: StageMaster[] = withDefaultFinalStage
        ? [
            {
              id: `${newId}-S1`,
              apiId: newId,
              apiName: newId,
              stageNo: 1,
              stageName: "Final API",
              batchSizeKg: 100,
              inputKgPerBatch: 100,
              reactorPool: p.reactors
                .filter((r) => r.moc === "GL")
                .slice(0, 2)
                .map((r) => r.id),
              bcfHours: 120,
              bctHours: 120,
              processHours: 120,
              analysisHours: 48,
              pcoHours: 12,
              plannedBatches: 5,
              inputStageIds: [],
            },
          ]
        : [];
      // New API inherits the project window as its starting plan window.
      const newApi: API = cascadePlannedBatches({
        id: newId,
        name: newId,
        color,
        targetKg: withDefaultFinalStage ? 500 : 0,
        projectionKg: 0,
        stages,
        window: { ...p.window },
      });
      return { ...p, apis: [...p.apis, newApi] };
    });
    scheduleRecompute(set, get, true);
    return newId;
  },

  removeAPI: (apiId) => {
    mutateActive(set, get, (p) => ({
      ...p,
      apis: p.apis.filter((a) => a.id !== apiId),
    }));
    scheduleRecompute(set, get, true);
  },

  // ─ Reactor actions ─────────────────────────────────────────────
  setReactorName: (reactorId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    mutateActive(set, get, (p) => ({
      ...p,
      reactors: p.reactors.map((r) =>
        r.id === reactorId ? { ...r, name: trimmed } : r
      ),
    }));
  },

  setReactorMoc: (reactorId, moc) => {
    const valid: MOC[] = ["SS", "GL", "Hastelloy", "Halar lined"];
    if (!valid.includes(moc)) return;
    mutateActive(set, get, (p) => ({
      ...p,
      reactors: p.reactors.map((r) =>
        r.id === reactorId ? { ...r, moc } : r
      ),
    }));
  },

  setReactorAgitator: (reactorId, agitator) => {
    const valid: AgitatorType[] = [
      "Anchor",
      "RCI",
      "PBT",
      "MIG",
      "Hydrofoil",
    ];
    if (!valid.includes(agitator)) return;
    mutateActive(set, get, (p) => ({
      ...p,
      reactors: p.reactors.map((r) =>
        r.id === reactorId ? { ...r, agitatorType: agitator } : r
      ),
    }));
  },

  setReactorCapacity: (reactorId, capacityKg) => {
    const v = Math.max(1, Math.round(capacityKg));
    if (!Number.isFinite(v)) return;
    mutateActive(set, get, (p) => ({
      ...p,
      reactors: p.reactors.map((r) =>
        r.id === reactorId ? { ...r, capacityKg: v } : r
      ),
    }));
  },

  setReactorClass: (reactorId, cls) => {
    mutateActive(set, get, (p) => ({
      ...p,
      reactors: p.reactors.map((r) =>
        r.id === reactorId ? { ...r, reactorClass: cls } : r
      ),
    }));
    scheduleRecompute(set, get);
  },

  setReactorProductionBlock: (reactorId, block) => {
    mutateActive(set, get, (p) => ({
      ...p,
      reactors: p.reactors.map((r) =>
        r.id === reactorId ? { ...r, productionBlock: block.trim() || undefined } : r
      ),
    }));
    scheduleRecompute(set, get);
  },

  setReactorPmFirstDate: (reactorId, ms) => {
    mutateActive(set, get, (p) => ({
      ...p,
      reactors: p.reactors.map((r) =>
        r.id === reactorId ? { ...r, pmFirstDateMs: ms } : r
      ),
    }));
    scheduleRecompute(set, get);
  },

  setReactorPmDuration: (reactorId, days) => {
    const v = Math.max(1, Math.round(days));
    if (!Number.isFinite(v)) return;
    mutateActive(set, get, (p) => ({
      ...p,
      reactors: p.reactors.map((r) =>
        r.id === reactorId ? { ...r, pmDurationDays: v } : r
      ),
    }));
    scheduleRecompute(set, get);
  },

  setReactorBuildingMaintenanceFirstDate: (reactorId, ms) => {
    mutateActive(set, get, (p) => ({
      ...p,
      reactors: p.reactors.map((r) =>
        r.id === reactorId ? { ...r, buildingMaintenanceFirstDateMs: ms } : r
      ),
    }));
    scheduleRecompute(set, get);
  },

  addReactor: (input) => {
    const trimmedId = (input.id ?? "").trim();
    if (!trimmedId) return { ok: false, error: "ID is required." };
    if (/\s/.test(trimmedId))
      return { ok: false, error: "ID cannot contain whitespace." };
    const cap = Math.round(input.capacityKg);
    if (!Number.isFinite(cap) || cap <= 0)
      return { ok: false, error: "Capacity must be a positive number." };
    const validMoc: MOC[] = ["SS", "GL", "Hastelloy", "Halar lined"];
    if (!validMoc.includes(input.moc)) {
      return { ok: false, error: "MOC must be SS, GL, Hastelloy, or Halar lined." };
    }
    const validAg: AgitatorType[] = [
      "Anchor",
      "RCI",
      "PBT",
      "MIG",
      "Hydrofoil",
    ];
    const agitatorType: AgitatorType =
      input.agitatorType && validAg.includes(input.agitatorType)
        ? input.agitatorType
        : "Anchor";
    const state = get();
    const active = getActive(state);
    if (active.reactors.some((r) => r.id === trimmedId)) {
      return { ok: false, error: `ID "${trimmedId}" is already in use.` };
    }
    const newReactor: Reactor = {
      id: trimmedId,
      name: (input.name ?? "").trim() || trimmedId,
      moc: input.moc,
      agitatorType,
      capacityKg: cap,
    };
    mutateActive(set, get, (p) => ({
      ...p,
      reactors: [...p.reactors, newReactor],
    }));
    return { ok: true, id: trimmedId };
  },

  removeReactor: (reactorId, opts) => {
    const cascade = opts?.cascade ?? false;
    const state = get();
    const active = getActive(state);
    if (!active.reactors.some((r) => r.id === reactorId)) {
      return { ok: false, error: `Reactor "${reactorId}" not found.` };
    }
    // Find every stage whose pool would become empty if we strip this id.
    const blockingStages: string[] = [];
    const usingStages: string[] = [];
    active.apis.forEach((a) => {
      a.stages.forEach((s) => {
        if (!s.reactorPool.includes(reactorId)) return;
        usingStages.push(`${a.name} · S${s.stageNo}`);
        if (s.reactorPool.length <= 1) {
          blockingStages.push(`${a.name} · S${s.stageNo}`);
        }
      });
    });
    if (blockingStages.length > 0) {
      return {
        ok: false,
        error: `Cannot delete ${reactorId} — it's the only reactor assigned to ${blockingStages
          .slice(0, 3)
          .join(", ")}${blockingStages.length > 3 ? ` and ${blockingStages.length - 3} more` : ""}. Assign another reactor to those stage(s) first.`,
        blockingStages,
      };
    }
    if (usingStages.length > 0 && !cascade) {
      return {
        ok: false,
        error: `Reactor ${reactorId} is in ${usingStages.length} stage pool(s). Confirm to remove it from all of them.`,
      };
    }
    mutateActive(set, get, (p) => ({
      ...p,
      reactors: p.reactors.filter((r) => r.id !== reactorId),
      apis: p.apis.map((a) => ({
        ...a,
        stages: a.stages.map((s) =>
          s.reactorPool.includes(reactorId)
            ? { ...s, reactorPool: s.reactorPool.filter((id) => id !== reactorId) }
            : s
        ),
      })),
    }));
    if (usingStages.length > 0) {
      // Pool changes affect scheduling; recompute.
      scheduleRecompute(set, get, true);
    }
    return { ok: true };
  },

  // ─ Project actions ──────────────────────────────────────────────
  createProject: (name) => {
    const project = emptyProject(name ?? "New Project");
    const state = get();
    const projects = [...state.projects, project];
    set({
      projects,
      activeProjectId: project.id,
      apis: project.apis,
      reactors: project.reactors,
      window: project.window,
      hasPersistedChanges: true,
      recentlyAddedStageId: null,
    });
    persistAndSync(projects, project.id, get().dataSource);
    scheduleRecompute(set, get, true);
    return project.id;
  },

  switchProject: (id) => {
    const state = get();
    const project = state.projects.find((p) => p.id === id);
    if (!project) return;
    if (project.id === state.activeProjectId) return;
    set({
      activeProjectId: project.id,
      apis: project.apis.map(cascadePlannedBatches),
      reactors: project.reactors,
      window: project.window,
      recentlyAddedStageId: null,
    });
    persistAndSync(state.projects, project.id, state.dataSource);
    scheduleRecompute(set, get, true);
  },

  renameProject: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const state = get();
    const projects = state.projects.map((p) =>
      p.id === id ? { ...p, name: trimmed } : p
    );
    set({ projects, hasPersistedChanges: true });
    persistAndSync(projects, state.activeProjectId, state.dataSource);
  },

  deleteProject: (id) => {
    const state = get();
    let projects = state.projects.filter((p) => p.id !== id);
    if (projects.length === 0) {
      projects = [freshDefaultProject()];
    }
    let activeProjectId = state.activeProjectId;
    if (id === state.activeProjectId) {
      activeProjectId = projects[0].id;
    }
    const active = projects.find((p) => p.id === activeProjectId)!;
    set({
      projects,
      activeProjectId,
      apis: active.apis.map(cascadePlannedBatches),
      reactors: active.reactors,
      window: active.window,
      hasPersistedChanges: true,
    });
    persistAndSync(projects, activeProjectId, state.dataSource);
    scheduleRecompute(set, get, true);
  },

  // ─ Data source actions ──────────────────────────────────────────
  setDataSource: (mode) => {
    if (mode !== "cloud" && mode !== "local") return;
    if (mode === "cloud" && !isSupabaseEnabled) {
      set({ cloudError: "Supabase is not configured in this build." });
      return;
    }
    setDataSourceMode(mode);
    set({ dataSource: mode, cloudError: null });
    // If we just switched TO cloud, push current state up so the cloud
    // table reflects what the user is seeing right now.
    if (mode === "cloud") {
      const state = get();
      queueCloudSave(state.projects);
    }
  },

  pushToCloud: async () => {
    if (!isSupabaseEnabled) {
      return { ok: false, error: "Supabase is not configured." };
    }
    const state = get();
    try {
      await syncAllProjectsToCloud(state.projects);
      set({ cloudError: null });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ cloudError: msg });
      return { ok: false, error: msg };
    }
  },

  pullFromCloud: async () => {
    if (!isSupabaseEnabled) {
      return { ok: false, error: "Supabase is not configured." };
    }
    set({ isHydrating: true, cloudError: null });
    try {
      const cloudProjects = await loadAllProjectsFromCloud();
      if (!cloudProjects || cloudProjects.length === 0) {
        set({
          isHydrating: false,
          lastCloudRead: {
            at: Date.now(),
            error: null,
            isEmpty: true,
            activeProjectId: null,
            projects: [],
          },
        });
        return { ok: false, error: "No projects found in Supabase." };
      }
      const projects = cloudProjects.map((p) => ({
        ...p,
        apis: refreshPaletteColors(p.apis).map(cascadePlannedBatches),
      }));
      // Active project is purely a per-browser preference. If the previously
      // active id is still in the new set, keep it; otherwise fall back to
      // the first project.
      const prevActive = get().activeProjectId;
      const activeId = projects.some((p) => p.id === prevActive)
        ? prevActive
        : projects[0].id;
      const active = projects.find((p) => p.id === activeId)!;
      const sched = runScheduler(active.apis, active.reactors, active.window);
      set({
        projects,
        activeProjectId: activeId,
        apis: active.apis,
        reactors: active.reactors,
        window: active.window,
        schedule: sched,
        hasPersistedChanges: true,
        isHydrating: false,
        lastCloudRead: summarizeProjects(projects, activeId),
      });
      // Mirror to local cache so a subsequent local-mode boot has fresh data.
      savePersisted(projects, activeId);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({
        isHydrating: false,
        cloudError: msg,
        lastCloudRead: {
          at: Date.now(),
          error: msg,
          isEmpty: true,
          activeProjectId: null,
          projects: [],
        },
      });
      return { ok: false, error: msg };
    }
  },

  refreshCloudSnapshot: async () => {
    if (!isSupabaseEnabled) {
      const info: CloudReadInfo = {
        at: Date.now(),
        error: "Supabase is not configured.",
        isEmpty: true,
        activeProjectId: null,
        projects: [],
      };
      set({ lastCloudRead: info });
      return { ok: false, error: info.error! };
    }
    try {
      const cloudProjects = await loadAllProjectsFromCloud();
      if (!cloudProjects || cloudProjects.length === 0) {
        const info: CloudReadInfo = {
          at: Date.now(),
          error: null,
          isEmpty: true,
          activeProjectId: null,
          projects: [],
        };
        set({ lastCloudRead: info });
        return { ok: true, info };
      }
      const info: CloudReadInfo = {
        at: Date.now(),
        error: null,
        isEmpty: false,
        // active project is a browser-local concept now; the cloud rows
        // themselves don't carry it.
        activeProjectId: null,
        projects: cloudProjects.map((p) => ({
          id: p.id,
          name: p.name,
          apiCount: p.apis.length,
          reactorCount: p.reactors.length,
        })),
      };
      set({ lastCloudRead: info });
      return { ok: true, info };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const info: CloudReadInfo = {
        at: Date.now(),
        error: msg,
        isEmpty: true,
        activeProjectId: null,
        projects: [],
      };
      set({ lastCloudRead: info });
      return { ok: false, error: msg };
    }
  },

  clearLocalCache: () => {
    clearPersisted();
    set({ hasPersistedChanges: false });
  },

  // ─ Misc ────────────────────────────────────────────────────────
  clearRecentlyAdded: () => set({ recentlyAddedStageId: null }),

  forceRecompute: () => {
    const { apis, reactors, window: planWindow } = get();
    set({ isRecomputing: true });
    const sched = runScheduler(apis, reactors, planWindow);
    set({ schedule: sched, isRecomputing: false, lastRecomputeMs: Date.now() });
  },

  resetToSeed: () => {
    // Reset only the ACTIVE project to a fresh seed snapshot.
    const fresh = freshDefaultProject();
    mutateActive(set, get, (p) => ({
      ...p,
      apis: fresh.apis,
      reactors: fresh.reactors,
      window: fresh.window,
    }));
    set({ recentlyAddedStageId: null });
    scheduleRecompute(set, get, true);
  },

  replaceProjectData: (apis, reactors) => {
    const cascaded = apis.map(cascadePlannedBatches);
    // Derive project-level window from union of API windows.
    const window: import("./types").PlanWindow =
      cascaded.length > 0
        ? {
            startMs: Math.min(...cascaded.map((a) => a.window.startMs)),
            endMs: Math.max(...cascaded.map((a) => a.window.endMs)),
          }
        : get().window;
    mutateActive(set, get, (p) => ({
      ...p,
      apis: cascaded,
      reactors,
      window,
    }));
    set({ recentlyAddedStageId: null });
    scheduleRecompute(set, get, true);
  },
}));

// ─── Async cloud hydration on startup ──────────────────────────────────────────
//
// In CLOUD mode (default): cloud is the source of truth. We always replace
// the locally-seeded state with whatever's in Supabase, even if local has
// edits. This is the user-visible difference between cloud and local mode.
// If the cloud read fails we keep the local-seeded state and surface a
// `cloudError` so the Admin tab can show "fell back to local cache".
//
// In LOCAL mode: we never call Supabase on boot.
if (initialMode === "cloud" && isSupabaseEnabled) {
  setLoadingStatus();
  void loadAllProjectsFromCloud()
    .then((cloudProjects) => {
      if (!cloudProjects || cloudProjects.length === 0) {
        // No projects in cloud yet — seed it from whatever we have locally
        // so the table is bootstrapped on next boot. Leave the user looking
        // at the local seed for now.
        const state = useStore.getState();
        queueCloudSave(state.projects);
        useStore.setState({
          isHydrating: false,
          lastCloudRead: {
            at: Date.now(),
            error: null,
            isEmpty: true,
            activeProjectId: null,
            projects: [],
          },
        });
        setIdleStatus();
        return;
      }
      const projects = cloudProjects.map((p) => ({
        ...p,
        apis: refreshPaletteColors(p.apis).map(cascadePlannedBatches),
      }));
      // Active project is a per-browser preference; preserve it if still
      // valid, otherwise fall back to the first project in the cloud set.
      const state = useStore.getState();
      const activeId = projects.some((p) => p.id === state.activeProjectId)
        ? state.activeProjectId
        : projects[0].id;
      const active = projects.find((p) => p.id === activeId)!;
      const sched = runScheduler(active.apis, active.reactors, active.window);
      useStore.setState({
        projects,
        activeProjectId: activeId,
        apis: active.apis,
        reactors: active.reactors,
        window: active.window,
        schedule: sched,
        hasPersistedChanges: true,
        isHydrating: false,
        lastCloudRead: summarizeProjects(projects, activeId),
      });
      // Mirror cloud → local so a future LOCAL-mode boot has fresh data.
      savePersisted(projects, activeId);
      setIdleStatus();
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[sync] hydrate failed:", e);
      useStore.setState({
        isHydrating: false,
        cloudError: `Cloud unavailable: ${msg}. Showing last local cache.`,
        lastCloudRead: {
          at: Date.now(),
          error: msg,
          isEmpty: true,
          activeProjectId: null,
          projects: [],
        },
      });
      setIdleStatus();
    });
} else {
  // local mode (or supabase disabled) → already seeded synchronously
  useStore.setState({ isHydrating: false });
}

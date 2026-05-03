import { create } from "zustand";
import { API_PALETTE, buildSeed, refreshPaletteColors } from "./data/seed";
import { runScheduler } from "./scheduler/scheduler";
import { cascadePlannedBatches } from "./scheduler/cascade";
import type {
  API,
  PlanWindow,
  Priority,
  Reactor,
  ScheduleResult,
  StageMaster,
} from "./types";
import {
  clearPersisted,
  isPersistedPresent,
  loadPersisted,
  savePersisted,
} from "./utils/storage";
import { isSupabaseEnabled } from "./services/supabase";
import { FY_END_MS, FY_START_MS } from "./utils/dates";
import {
  loadFromCloud,
  queueCloudSave,
  setIdleStatus,
  setLoadingStatus,
} from "./services/sync";
import { getWorkspaceId } from "./services/supabase";

export interface NewStageInput {
  apiId: string;
  stageName: string;
  batchSizeKg: number;
  inputKgPerBatch: number;
  reactorPool: string[];
  cycleHours: number;
  analysisHours: number;
  plannedBatches: number;
}

interface AppState {
  apis: API[];
  reactors: Reactor[];
  /** Single global plan window applied to every API. */
  window: PlanWindow;
  schedule: ScheduleResult;
  isRecomputing: boolean;
  lastRecomputeMs: number;
  recentlyAddedStageId: string | null;
  hasPersistedChanges: boolean;
  cloudEnabled: boolean;
  workspaceId: string;

  // ─ Stage actions ────────────────────────────────────────────────
  updateStageField: (
    stageId: string,
    field: keyof Pick<
      StageMaster,
      | "batchSizeKg"
      | "inputKgPerBatch"
      | "cycleHours"
      | "analysisHours"
      | "plannedBatches"
    >,
    value: number
  ) => void;
  setStageOutput: (stageId: string, outputKg: number) => void;
  setStageName: (stageId: string, name: string) => void;
  setStageReactorPool: (stageId: string, pool: string[]) => void;
  addStage: (input: NewStageInput) => string;
  removeStage: (stageId: string) => void;

  // ─ API actions ─────────────────────────────────────────────────
  setApiPriority: (apiId: string, priority: Priority) => void;
  setApiName: (apiId: string, name: string) => void;
  /** Sets the API target output (kg). Triggers cascade across all stages. */
  setApiTargetOutput: (apiId: string, targetKg: number) => void;
  /** Set the global plan window (epoch ms). Applies to every API. */
  setWindow: (startMs: number, endMs: number) => void;
  /** Add or remove trailing stages so the API has exactly `count` stages. */
  setApiStageCount: (apiId: string, count: number) => void;
  /**
   * Add a brand-new API. If `withDefaultFinalStage` is true (default),
   * also creates a single "Final API" stage so the API has something to
   * schedule and the target-qty editor on the APIs tab is meaningful.
   */
  addAPI: (withDefaultFinalStage?: boolean) => string;
  removeAPI: (apiId: string) => void;

  // ─ Reactor actions ─────────────────────────────────────────────
  setReactorName: (reactorId: string, name: string) => void;

  // ─ Misc ────────────────────────────────────────────────────────
  clearRecentlyAdded: () => void;
  resetToSeed: () => void;
  /** Synchronously rebuild the schedule using the current state. */
  forceRecompute: () => void;
}

// ─── Initial hydration: seed → localStorage → cloud (async) ─────────────────────
const seed = buildSeed();
const persisted = loadPersisted();
const initialApisRaw = persisted?.apis ?? seed.apis;
// Run cascade on every API so plannedBatches is always in sync with targetKg
// and current batch sizes. Idempotent on the seed (numbers don't change).
const initialApis = initialApisRaw.map(cascadePlannedBatches);
const initialReactors = persisted?.reactors ?? seed.reactors;
const initialWindow: PlanWindow = persisted?.window ?? {
  startMs: FY_START_MS,
  endMs: FY_END_MS,
};
const initialSchedule = runScheduler(initialApis, initialReactors, initialWindow);

let recomputeTimer: number | undefined;

function persistAndSync(
  apis: API[],
  reactors: Reactor[],
  planWindow: PlanWindow
) {
  savePersisted(apis, reactors, planWindow);
  queueCloudSave({ apis, reactors, window: planWindow });
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

export const useStore = create<AppState>((set, get) => ({
  apis: initialApis,
  reactors: initialReactors,
  window: initialWindow,
  schedule: initialSchedule,
  isRecomputing: false,
  lastRecomputeMs: Date.now(),
  recentlyAddedStageId: null,
  hasPersistedChanges: isPersistedPresent(),
  cloudEnabled: isSupabaseEnabled,
  workspaceId: getWorkspaceId(),

  // ─ Stage actions ────────────────────────────────────────────────
  updateStageField: (stageId, field, value) => {
    const apis = get().apis.map((a) => {
      const idx = a.stages.findIndex((s) => s.id === stageId);
      if (idx < 0) return a;
      const updatedStages = a.stages.map((s) =>
        s.id === stageId ? { ...s, [field]: Math.max(1, value) } : s
      );
      const updated = { ...a, stages: updatedStages };
      // Cascade fires when anything that changes material flow changes.
      // cycleHours/analysisHours don't change material flow.
      if (
        field === "batchSizeKg" ||
        field === "inputKgPerBatch" ||
        field === "plannedBatches"
      ) {
        return cascadePlannedBatches(updated);
      }
      return updated;
    });
    set({ apis, hasPersistedChanges: true });
    persistAndSync(apis, get().reactors, get().window);
    scheduleRecompute(set, get);
  },

  setStageOutput: (stageId, outputKg) => {
    // Kept for back-compat - now equivalent to setting the API target if this
    // is the final stage, otherwise a no-op (cascade owns plannedBatches).
    const apis = get().apis;
    const owningApi = apis.find((a) =>
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
    const apis = get().apis.map((a) => ({
      ...a,
      stages: a.stages.map((s) =>
        s.id === stageId ? { ...s, stageName: trimmed } : s
      ),
    }));
    set({ apis, hasPersistedChanges: true });
    persistAndSync(apis, get().reactors, get().window);
  },

  setStageReactorPool: (stageId, pool) => {
    if (pool.length === 0) return;
    const apis = get().apis.map((a) => ({
      ...a,
      stages: a.stages.map((s) =>
        s.id === stageId ? { ...s, reactorPool: pool.slice() } : s
      ),
    }));
    set({ apis, hasPersistedChanges: true });
    persistAndSync(apis, get().reactors, get().window);
    scheduleRecompute(set, get, true);
  },

  addStage: (input) => {
    const apis = get().apis;
    const api = apis.find((a) => a.id === input.apiId);
    if (!api) return "";
    const nextStageNo =
      api.stages.length === 0
        ? 1
        : Math.max(...api.stages.map((s) => s.stageNo)) + 1;
    const newId = `${api.id}-S${nextStageNo}`;

    const newStage: StageMaster = {
      id: newId,
      apiId: api.id,
      apiName: api.name,
      stageNo: nextStageNo,
      stageName: input.stageName.trim() || `Intermediate-${nextStageNo}`,
      batchSizeKg: Math.max(1, input.batchSizeKg),
      inputKgPerBatch: Math.max(1, input.inputKgPerBatch),
      reactorPool: input.reactorPool.slice(),
      cycleHours: Math.max(1, input.cycleHours),
      analysisHours: Math.max(1, input.analysisHours),
      plannedBatches: Math.max(1, input.plannedBatches),
    };

    const updatedApis = apis.map((a) => {
      if (a.id !== api.id) return a;
      return cascadePlannedBatches({
        ...a,
        stages: [...a.stages, newStage],
      });
    });

    set({
      apis: updatedApis,
      recentlyAddedStageId: newId,
      hasPersistedChanges: true,
    });
    persistAndSync(updatedApis, get().reactors, get().window);
    scheduleRecompute(set, get, true);
    return newId;
  },

  removeStage: (stageId) => {
    const apis = get().apis.map((a) => {
      if (!a.stages.some((s) => s.id === stageId)) return a;
      return cascadePlannedBatches({
        ...a,
        stages: a.stages.filter((s) => s.id !== stageId),
      });
    });
    set({ apis, hasPersistedChanges: true });
    persistAndSync(apis, get().reactors, get().window);
    scheduleRecompute(set, get, true);
  },

  // ─ API actions ─────────────────────────────────────────────────
  setApiPriority: (apiId, priority) => {
    const apis = get().apis.map((a) =>
      a.id === apiId ? { ...a, priority } : a
    );
    set({ apis, hasPersistedChanges: true });
    persistAndSync(apis, get().reactors, get().window);
    scheduleRecompute(set, get, true);
  },

  setApiName: (apiId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const apis = get().apis.map((a) =>
      a.id === apiId
        ? {
            ...a,
            name: trimmed,
            stages: a.stages.map((s) => ({ ...s, apiName: trimmed })),
          }
        : a
    );
    set({ apis, hasPersistedChanges: true });
    persistAndSync(apis, get().reactors, get().window);
    scheduleRecompute(set, get);
  },

  setApiTargetOutput: (apiId, targetKg) => {
    // 0 is allowed - signals "park this API, don't schedule any batches"
    const target = Math.max(0, targetKg);
    const apis = get().apis.map((a) =>
      a.id === apiId ? cascadePlannedBatches({ ...a, targetKg: target }) : a
    );
    set({ apis, hasPersistedChanges: true });
    persistAndSync(apis, get().reactors, get().window);
    scheduleRecompute(set, get);
  },

  setWindow: (startMs, endMs) => {
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs <= startMs
    )
      return;
    const planWindow: PlanWindow = { startMs, endMs };
    set({ window: planWindow, hasPersistedChanges: true });
    persistAndSync(get().apis, get().reactors, planWindow);
    scheduleRecompute(set, get, true);
  },

  setApiStageCount: (apiId, count) => {
    const target = Math.max(1, Math.min(24, Math.round(count)));
    const reactors = get().reactors;
    const apis = get().apis.map((a) => {
      if (a.id !== apiId) return a;
      const sorted = [...a.stages].sort((x, y) => x.stageNo - y.stageNo);
      let stages = sorted.slice();

      if (stages.length === target) return a; // no-op

      if (stages.length > target) {
        // Trim trailing stages
        stages = stages.slice(0, target);
      } else {
        // Append default stages until we reach target
        const defaultPool = reactors
          .filter((r) => r.reactorClass === "Medium")
          .slice(0, 2)
          .map((r) => r.id);
        while (stages.length < target) {
          const nextNo = stages.length + 1;
          const isFinal = nextNo === target;
          const out = isFinal ? 100 : 80;
          stages.push({
            id: `${a.id}-S${nextNo}`,
            apiId: a.id,
            apiName: a.name,
            stageNo: nextNo,
            stageName: isFinal ? "Final API" : `Intermediate-${nextNo}`,
            batchSizeKg: out,
            inputKgPerBatch: out, // 1:1 yield default
            reactorPool: defaultPool.length > 0 ? defaultPool : [reactors[0]?.id ?? ""],
            cycleHours: isFinal ? 120 : 72,
            analysisHours: isFinal ? 48 : 24,
            plannedBatches: 1, // overwritten by cascade below
          });
        }
      }
      // After last stage may now be a different stage, recompute names so
      // the highest stageNo is "Final API" (only when we trimmed - leave
      // user-customized names alone otherwise).
      if (stages.length < sorted.length) {
        // We trimmed; rename the new last stage to "Final API" for clarity.
        const last = stages[stages.length - 1];
        if (last && !/final/i.test(last.stageName)) {
          stages[stages.length - 1] = { ...last, stageName: "Final API" };
        }
      }
      return cascadePlannedBatches({ ...a, stages });
    });
    set({ apis, hasPersistedChanges: true });
    persistAndSync(apis, get().reactors, get().window);
    scheduleRecompute(set, get, true);
  },

  addAPI: (withDefaultFinalStage = true) => {
    const apis = get().apis;
    const reactors = get().reactors;
    const nums = apis
      .map((a) => Number(a.id.replace(/^API-/, "")))
      .filter((n) => !Number.isNaN(n));
    const nextNum = nums.length === 0 ? 1 : Math.max(...nums) + 1;
    const newId = `API-${String(nextNum).padStart(2, "0")}`;
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
            inputKgPerBatch: 100, // 1:1 yield default
            reactorPool: reactors
              .filter((r) => r.reactorClass === "Large")
              .slice(0, 2)
              .map((r) => r.id),
            cycleHours: 120,
            analysisHours: 48,
            plannedBatches: 5,
          },
        ]
      : [];
    // Default target = 500kg (5 batches of 100kg in the default Final stage).
    // Run cascade so plannedBatches matches targetKg from the start.
    const newApi: API = cascadePlannedBatches({
      id: newId,
      name: newId,
      color,
      priority: 3,
      targetKg: withDefaultFinalStage ? 500 : 0,
      projectionKg: 0,
      stages,
    });
    const updated = [...apis, newApi];
    set({ apis: updated, hasPersistedChanges: true });
    persistAndSync(updated, reactors, get().window);
    scheduleRecompute(set, get, true);
    return newId;
  },

  removeAPI: (apiId) => {
    const apis = get().apis.filter((a) => a.id !== apiId);
    set({ apis, hasPersistedChanges: true });
    persistAndSync(apis, get().reactors, get().window);
    scheduleRecompute(set, get, true);
  },

  // ─ Reactor actions ─────────────────────────────────────────────
  setReactorName: (reactorId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const reactors = get().reactors.map((r) =>
      r.id === reactorId ? { ...r, name: trimmed } : r
    );
    set({ reactors, hasPersistedChanges: true });
    persistAndSync(get().apis, reactors, get().window);
    // Names don't affect schedule numbers, only labels - skip recompute
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
    clearPersisted();
    const fresh = buildSeed();
    const freshWindow: PlanWindow = { startMs: FY_START_MS, endMs: FY_END_MS };
    const sched = runScheduler(fresh.apis, fresh.reactors, freshWindow);
    set({
      apis: fresh.apis,
      reactors: fresh.reactors,
      window: freshWindow,
      schedule: sched,
      isRecomputing: false,
      lastRecomputeMs: Date.now(),
      recentlyAddedStageId: null,
      hasPersistedChanges: false,
    });
    queueCloudSave({
      apis: fresh.apis,
      reactors: fresh.reactors,
      window: freshWindow,
    });
  },
}));

// ─── Async cloud hydration on startup ──────────────────────────────────────────
if (isSupabaseEnabled) {
  setLoadingStatus();
  void loadFromCloud()
    .then((cloud) => {
      if (!cloud) {
        setIdleStatus();
        return;
      }
      const state = useStore.getState();
      if (!state.hasPersistedChanges) {
        const reactors =
          cloud.reactors && cloud.reactors.length > 0
            ? cloud.reactors
            : state.reactors;
        const cloudWindow: PlanWindow =
          cloud.window &&
          typeof cloud.window.startMs === "number" &&
          typeof cloud.window.endMs === "number" &&
          cloud.window.endMs > cloud.window.startMs
            ? cloud.window
            : state.window;
        // Refresh API colors from the current palette so cloud-saved
        // entries with stale colors pick up the latest palette automatically
        const cloudApis = refreshPaletteColors(cloud.apis);
        const sched = runScheduler(cloudApis, reactors, cloudWindow);
        useStore.setState({
          apis: cloudApis,
          reactors,
          window: cloudWindow,
          schedule: sched,
          hasPersistedChanges: true,
        });
        savePersisted(cloudApis, reactors, cloudWindow);
      }
      setIdleStatus();
    })
    .catch((e) => {
      console.error("[sync] hydrate failed:", e);
      setIdleStatus();
    });
}

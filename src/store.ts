import { create } from "zustand";
import { API_PALETTE, buildSeed } from "./data/seed";
import { runScheduler } from "./scheduler/scheduler";
import type { API, Priority, Reactor, ScheduleResult, StageMaster } from "./types";
import {
  clearPersisted,
  isPersistedPresent,
  loadPersisted,
  savePersisted,
} from "./utils/storage";
import { isSupabaseEnabled } from "./services/supabase";
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
  reactorPool: string[];
  cycleHours: number;
  analysisHours: number;
  plannedBatches: number;
}

interface AppState {
  apis: API[];
  reactors: Reactor[];
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
      "batchSizeKg" | "cycleHours" | "analysisHours" | "plannedBatches"
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
  /** Sets the FINAL stage's outputTarget; high-level "API target qty" UX. */
  setApiTargetOutput: (apiId: string, targetKg: number) => void;
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
}

// ─── Initial hydration: seed → localStorage → cloud (async) ─────────────────────
const seed = buildSeed();
const persisted = loadPersisted();
const initialApis = persisted?.apis ?? seed.apis;
const initialReactors = persisted?.reactors ?? seed.reactors;
const initialSchedule = runScheduler(initialApis, initialReactors);

let recomputeTimer: number | undefined;

function persistAndSync(apis: API[], reactors: Reactor[]) {
  savePersisted(apis, reactors);
  queueCloudSave({ apis, reactors });
}

function scheduleRecompute(set: any, get: any, immediate = false) {
  if (recomputeTimer) window.clearTimeout(recomputeTimer);
  set({ isRecomputing: true });
  const run = () => {
    const { apis: latestApis, reactors } = get();
    const sched = runScheduler(latestApis, reactors);
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
  schedule: initialSchedule,
  isRecomputing: false,
  lastRecomputeMs: Date.now(),
  recentlyAddedStageId: null,
  hasPersistedChanges: isPersistedPresent(),
  cloudEnabled: isSupabaseEnabled,
  workspaceId: getWorkspaceId(),

  // ─ Stage actions ────────────────────────────────────────────────
  updateStageField: (stageId, field, value) => {
    const apis = get().apis.map((a) => ({
      ...a,
      stages: a.stages.map((s) =>
        s.id === stageId ? { ...s, [field]: Math.max(1, value) } : s
      ),
    }));
    set({ apis, hasPersistedChanges: true });
    persistAndSync(apis, get().reactors);
    scheduleRecompute(set, get);
  },

  setStageOutput: (stageId, outputKg) => {
    const target = Math.max(1, outputKg);
    const apis = get().apis.map((a) => ({
      ...a,
      stages: a.stages.map((s) => {
        if (s.id !== stageId) return s;
        const planned = Math.max(1, Math.ceil(target / Math.max(1, s.batchSizeKg)));
        return { ...s, plannedBatches: planned };
      }),
    }));
    set({ apis, hasPersistedChanges: true });
    persistAndSync(apis, get().reactors);
    scheduleRecompute(set, get);
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
    persistAndSync(apis, get().reactors);
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
    persistAndSync(apis, get().reactors);
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
      reactorPool: input.reactorPool.slice(),
      cycleHours: Math.max(1, input.cycleHours),
      analysisHours: Math.max(1, input.analysisHours),
      plannedBatches: Math.max(1, input.plannedBatches),
    };

    const updatedApis = apis.map((a) =>
      a.id === api.id ? { ...a, stages: [...a.stages, newStage] } : a
    );

    set({
      apis: updatedApis,
      recentlyAddedStageId: newId,
      hasPersistedChanges: true,
    });
    persistAndSync(updatedApis, get().reactors);
    scheduleRecompute(set, get, true);
    return newId;
  },

  removeStage: (stageId) => {
    const apis = get().apis.map((a) => ({
      ...a,
      stages: a.stages.filter((s) => s.id !== stageId),
    }));
    set({ apis, hasPersistedChanges: true });
    persistAndSync(apis, get().reactors);
    scheduleRecompute(set, get, true);
  },

  // ─ API actions ─────────────────────────────────────────────────
  setApiPriority: (apiId, priority) => {
    const apis = get().apis.map((a) =>
      a.id === apiId ? { ...a, priority } : a
    );
    set({ apis, hasPersistedChanges: true });
    persistAndSync(apis, get().reactors);
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
    persistAndSync(apis, get().reactors);
    scheduleRecompute(set, get);
  },

  setApiTargetOutput: (apiId, targetKg) => {
    // "Target output for this API" maps to the FINAL stage's output target.
    const apis = get().apis;
    const api = apis.find((a) => a.id === apiId);
    if (!api || api.stages.length === 0) return;
    // Final stage = highest stageNo
    const finalStage = api.stages.reduce((acc, s) =>
      s.stageNo > acc.stageNo ? s : acc
    );
    const target = Math.max(1, targetKg);
    const plannedFinal = Math.max(
      1,
      Math.ceil(target / Math.max(1, finalStage.batchSizeKg))
    );
    const updated = apis.map((a) =>
      a.id !== apiId
        ? a
        : {
            ...a,
            stages: a.stages.map((s) =>
              s.id === finalStage.id ? { ...s, plannedBatches: plannedFinal } : s
            ),
          }
    );
    set({ apis: updated, hasPersistedChanges: true });
    persistAndSync(updated, get().reactors);
    scheduleRecompute(set, get);
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
    const newApi: API = {
      id: newId,
      name: newId,
      color,
      priority: 3,
      projectionKg: 0,
      stages,
    };
    const updated = [...apis, newApi];
    set({ apis: updated, hasPersistedChanges: true });
    persistAndSync(updated, reactors);
    scheduleRecompute(set, get, true);
    return newId;
  },

  removeAPI: (apiId) => {
    const apis = get().apis.filter((a) => a.id !== apiId);
    set({ apis, hasPersistedChanges: true });
    persistAndSync(apis, get().reactors);
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
    persistAndSync(get().apis, reactors);
    // Names don't affect schedule numbers, only labels - skip recompute
  },

  // ─ Misc ────────────────────────────────────────────────────────
  clearRecentlyAdded: () => set({ recentlyAddedStageId: null }),

  resetToSeed: () => {
    clearPersisted();
    const fresh = buildSeed();
    const sched = runScheduler(fresh.apis, fresh.reactors);
    set({
      apis: fresh.apis,
      reactors: fresh.reactors,
      schedule: sched,
      isRecomputing: false,
      lastRecomputeMs: Date.now(),
      recentlyAddedStageId: null,
      hasPersistedChanges: false,
    });
    queueCloudSave({ apis: fresh.apis, reactors: fresh.reactors });
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
        const sched = runScheduler(cloud.apis, reactors);
        useStore.setState({
          apis: cloud.apis,
          reactors,
          schedule: sched,
          hasPersistedChanges: true,
        });
        savePersisted(cloud.apis, reactors);
      }
      setIdleStatus();
    })
    .catch((e) => {
      console.error("[sync] hydrate failed:", e);
      setIdleStatus();
    });
}

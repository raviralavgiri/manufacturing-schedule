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

  updateStageField: (
    stageId: string,
    field: keyof Pick<
      StageMaster,
      "batchSizeKg" | "cycleHours" | "analysisHours" | "plannedBatches"
    >,
    value: number
  ) => void;
  setApiPriority: (apiId: string, priority: Priority) => void;
  addStage: (input: NewStageInput) => string;
  addAPI: () => string;
  removeStage: (stageId: string) => void;
  clearRecentlyAdded: () => void;
  resetToSeed: () => void;
}

// ─── Initial hydration ──────────────────────────────────────────────────────────
const seed = buildSeed();
const persistedApis = loadPersisted();
const initialApis = persistedApis ?? seed.apis;
const initialSchedule = runScheduler(initialApis, seed.reactors);

let recomputeTimer: number | undefined;

function persist(apis: API[]) {
  savePersisted(apis);
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
  reactors: seed.reactors,
  schedule: initialSchedule,
  isRecomputing: false,
  lastRecomputeMs: Date.now(),
  recentlyAddedStageId: null,
  hasPersistedChanges: isPersistedPresent(),

  updateStageField: (stageId, field, value) => {
    const apis = get().apis.map((a) => ({
      ...a,
      stages: a.stages.map((s) =>
        s.id === stageId ? { ...s, [field]: Math.max(1, value) } : s
      ),
    }));
    set({ apis, hasPersistedChanges: true });
    persist(apis);
    scheduleRecompute(set, get);
  },

  setApiPriority: (apiId, priority) => {
    const apis = get().apis.map((a) =>
      a.id === apiId ? { ...a, priority } : a
    );
    set({ apis, hasPersistedChanges: true });
    persist(apis);
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
    persist(updatedApis);
    scheduleRecompute(set, get, true);
    return newId;
  },

  addAPI: () => {
    const apis = get().apis;
    const nums = apis
      .map((a) => Number(a.id.replace(/^API-/, "")))
      .filter((n) => !Number.isNaN(n));
    const nextNum = nums.length === 0 ? 1 : Math.max(...nums) + 1;
    const newId = `API-${String(nextNum).padStart(2, "0")}`;
    const color = API_PALETTE[(nextNum - 1) % API_PALETTE.length];
    const newApi: API = {
      id: newId,
      name: newId,
      color,
      priority: 3,
      projectionKg: 0,
      stages: [],
    };
    const updated = [...apis, newApi];
    set({ apis: updated, hasPersistedChanges: true });
    persist(updated);
    scheduleRecompute(set, get, true);
    return newId;
  },

  removeStage: (stageId) => {
    const apis = get().apis.map((a) => ({
      ...a,
      stages: a.stages.filter((s) => s.id !== stageId),
    }));
    set({ apis, hasPersistedChanges: true });
    persist(apis);
    scheduleRecompute(set, get, true);
  },

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
  },
}));

import { create } from "zustand";
import { API_PALETTE, REACTORS, buildSeed, refreshPaletteColors } from "./data/seed";
import { runScheduler } from "./scheduler/scheduler";
import { cascadePlannedBatches } from "./scheduler/cascade";
import type {
  API,
  PlanWindow,
  Priority,
  Project,
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
import {
  loadFromCloud,
  queueCloudSave,
  setIdleStatus,
  setLoadingStatus,
} from "./services/sync";
import { getWorkspaceId } from "./services/supabase";
import { FY_END_MS, FY_START_MS } from "./utils/dates";

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
  workspaceId: string;

  // ─ Stage actions (operate on active project) ────────────────────
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

  // ─ API actions (operate on active project) ──────────────────────
  setApiPriority: (apiId: string, priority: Priority) => void;
  setApiName: (apiId: string, name: string) => void;
  setApiTargetOutput: (apiId: string, targetKg: number) => void;
  setWindow: (startMs: number, endMs: number) => void;
  setApiStageCount: (apiId: string, count: number) => void;
  addAPI: (withDefaultFinalStage?: boolean) => string;
  removeAPI: (apiId: string) => void;

  // ─ Reactor actions (operate on active project) ──────────────────
  setReactorName: (reactorId: string, name: string) => void;

  // ─ Project actions ──────────────────────────────────────────────
  createProject: (name?: string) => string;
  switchProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;

  // ─ Misc ─────────────────────────────────────────────────────────
  clearRecentlyAdded: () => void;
  resetToSeed: () => void;
  forceRecompute: () => void;
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

// ─── Initial hydration ─────────────────────────────────────────────────────────
const persisted = loadPersisted();
const initialProjects: Project[] = persisted?.projects ?? [freshDefaultProject()];
const initialActiveId =
  persisted && initialProjects.some((p) => p.id === persisted.activeProjectId)
    ? persisted.activeProjectId
    : initialProjects[0].id;
const initialActive = initialProjects.find((p) => p.id === initialActiveId)!;
const initialApis = initialActive.apis.map(cascadePlannedBatches);
const initialReactors = initialActive.reactors;
const initialWindow = initialActive.window;
const initialSchedule = runScheduler(initialApis, initialReactors, initialWindow);

// Sync the cascade-corrected apis back into the project so persistence stays consistent
initialActive.apis = initialApis;

let recomputeTimer: number | undefined;

function persistAndSync(projects: Project[], activeProjectId: string) {
  savePersisted(projects, activeProjectId);
  queueCloudSave({ projects, activeProjectId });
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
  persistAndSync(projects, state.activeProjectId);
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
  workspaceId: getWorkspaceId(),

  // ─ Stage actions ────────────────────────────────────────────────
  updateStageField: (stageId, field, value) => {
    mutateActive(set, get, (p) => {
      const apis = p.apis.map((a) => {
        const idx = a.stages.findIndex((s) => s.id === stageId);
        if (idx < 0) return a;
        const updatedStages = a.stages.map((s) =>
          s.id === stageId ? { ...s, [field]: Math.max(1, value) } : s
        );
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
        return cascadePlannedBatches({
          ...a,
          stages: a.stages.filter((s) => s.id !== stageId),
        });
      });
      return { ...p, apis };
    });
    scheduleRecompute(set, get, true);
  },

  // ─ API actions ─────────────────────────────────────────────────
  setApiPriority: (apiId, priority) => {
    mutateActive(set, get, (p) => {
      const apis = p.apis.map((a) =>
        a.id === apiId ? { ...a, priority } : a
      );
      return { ...p, apis };
    });
    scheduleRecompute(set, get, true);
  },

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

  setWindow: (startMs, endMs) => {
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs <= startMs
    )
      return;
    const planWindow: PlanWindow = { startMs, endMs };
    mutateActive(set, get, (p) => ({ ...p, window: planWindow }));
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
              inputKgPerBatch: out,
              reactorPool:
                defaultPool.length > 0 ? defaultPool : [reactors[0]?.id ?? ""],
              cycleHours: isFinal ? 120 : 72,
              analysisHours: isFinal ? 48 : 24,
              plannedBatches: 1,
            });
          }
        }
        return cascadePlannedBatches({ ...a, stages });
      });
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
                .filter((r) => r.reactorClass === "Large")
                .slice(0, 2)
                .map((r) => r.id),
              cycleHours: 120,
              analysisHours: 48,
              plannedBatches: 5,
            },
          ]
        : [];
      const newApi: API = cascadePlannedBatches({
        id: newId,
        name: newId,
        color,
        priority: 3,
        targetKg: withDefaultFinalStage ? 500 : 0,
        projectionKg: 0,
        stages,
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
    persistAndSync(projects, project.id);
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
    persistAndSync(state.projects, project.id);
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
    persistAndSync(projects, state.activeProjectId);
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
    persistAndSync(projects, activeProjectId);
    scheduleRecompute(set, get, true);
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
        // Apply latest palette across all projects
        const projects = cloud.projects.map((p) => ({
          ...p,
          apis: refreshPaletteColors(p.apis).map(cascadePlannedBatches),
        }));
        const activeId = projects.some((p) => p.id === cloud.activeProjectId)
          ? cloud.activeProjectId
          : projects[0]?.id;
        if (!activeId || projects.length === 0) {
          setIdleStatus();
          return;
        }
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
        });
        savePersisted(projects, activeId);
      }
      setIdleStatus();
    })
    .catch((e) => {
      console.error("[sync] hydrate failed:", e);
      setIdleStatus();
    });
}

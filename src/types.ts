/**
 * Reactor classification.
 *
 * - "Intermediate" (display: INT) — upstream / intermediate-stage equipment.
 * - "Cleanroom"    (display: CR)  — cleanroom-grade equipment, typically
 *                                   used for the final API stage.
 */
export type ReactorClass = "Intermediate" | "Cleanroom";

export interface Reactor {
  id: string;            // stable internal reference (e.g. "R101")
  name: string;          // editable display name (defaults to id)
  reactorClass: ReactorClass;
  capacityKg: number;
}

export interface StageMaster {
  id: string;
  apiId: string;
  apiName: string;
  stageNo: number;
  stageName: string;
  /**
   * Output produced per batch (kg). This is what the cascade uses to compute
   * `plannedBatches` from the downstream stage's input demand.
   */
  batchSizeKg: number;
  /**
   * Input consumed per batch (kg). May differ from batchSizeKg when the
   * reaction has a yield ≠ 100% (e.g. yield loss → input > output;
   * crystallization with carriers → input < output). Defaults to batchSizeKg
   * (1:1 yield) on legacy data via the storage loader.
   */
  inputKgPerBatch: number;
  reactorPool: string[];
  cycleHours: number;
  analysisHours: number;
  /**
   * Product Change Over (PCO) cleaning time in hours. Required BEFORE running
   * this stage on a reactor whose previous occupant was a different
   * (apiId, stageId) campaign. Same-campaign batches go back-to-back with no
   * PCO. Defaults to 8h on legacy data via the storage loader.
   */
  pcoHours: number;
  plannedBatches: number;
}

export type Priority = 1 | 2 | 3 | 4 | 5;

export interface API {
  id: string;
  name: string;
  color: string;
  priority: Priority;
  /**
   * Final-API output target in kg. Drives the cascading derivation of
   * `plannedBatches` for every stage:
   *   final stage:  ⌈ targetKg ÷ final batch size ⌉
   *   stage N:      ⌈ next stage actual output ÷ stage N batch size ⌉
   */
  targetKg: number;
  /** Legacy field, kept for back-compat with old Quarterly summary code. */
  projectionKg: number;
  stages: StageMaster[];
}

/**
 * Global plan window that applies to every API. Batches cannot start before
 * `startMs`; any batch finishing after `endMs` is flagged "Ovr".
 */
export interface PlanWindow {
  startMs: number;
  endMs: number;
}

/**
 * A namespace bundling APIs, reactors, and a plan window into a single
 * planning context. Multiple projects can co-exist; the user picks an
 * active one via the project switcher in the app header.
 */
export interface Project {
  id: string;          // stable internal id
  name: string;        // editable display name
  createdAt: number;
  apis: API[];
  reactors: Reactor[];
  window: PlanWindow;
}

export interface BatchScheduleEntry {
  batchId: string;
  apiId: string;
  apiName: string;
  apiColor: string;
  stageId: string;
  stageNo: number;
  stageName: string;
  batchNo: number;
  /** Primary / lead reactor in the train (= reactorIds[0]). Kept for backwards compat. */
  reactorId: string;
  /** Full reactor train: every reactor locked for the cycle window. */
  reactorIds: string[];
  startMs: number;
  endMs: number;
  analysisEndMs: number;
  inFY: boolean;
  clash: boolean;
  /** Output produced by this batch (kg) — typically equals the stage's batchSizeKg. */
  outputKg: number;
  /** Input consumed by this batch (kg) — equals stage.inputKgPerBatch. */
  inputKg: number;
}

export interface ScheduleResult {
  batches: BatchScheduleEntry[];
  totalBatches: number;
  fyBatches: number;
  overflowBatches: number;
  clashCount: number;
  reactorUsage: Record<string, { busyHours: number; batchCount: number }>;
  weeklyReactorOccupancy: number[][];
}

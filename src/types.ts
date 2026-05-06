/**
 * Reactor classification.
 *
 * - "SSR" (Stainless Steel Reactor)  — upstream / intermediate-stage equipment.
 * - "GLR" (Glass Lined Reactor)      — glass-lined equipment, typically
 *                                      used for the final API stage.
 */
export type ReactorClass = "SSR" | "GLR";

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
  /**
   * Batch Charging Frequency (BCF) — the time interval in hours between the
   * START of two consecutive same-campaign batches at the same stage.
   *
   *   start₁ + BCF = start₂   (same campaign, same stage)
   *
   * Must be >= bctHours (can't start the next batch before the reactor is
   * physically free). Defaults to bctHours (= back-to-back) on legacy data.
   * Was previously called `cycleHours`.
   */
  bcfHours: number;
  /**
   * Batch Completion Time (BCT) — the total duration a single batch physically
   * occupies the reactor, from start to completion.
   *
   *   start + BCT = reactor free time
   *
   * Controls reactor occupancy duration in the scheduler. Can be <= BCF.
   * Defaults to bcfHours (= BCF) on legacy data.
   */
  bctHours: number;
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
  /**
   * Cleaning gap (ms) that the scheduler enforced immediately BEFORE this
   * batch's start. 0 if no cleaning was required (back-to-back same-campaign).
   * Drives the faded tail rendered in front of the bar on the Gantt chart.
   */
  cleaningBeforeMs: number;
  /**
   * What kind of cleaning preceded this batch:
   *   - "none"     → back-to-back with previous same-campaign batch
   *   - "pco"      → predecessor was a different (apiId, stageId) campaign
   *   - "campaign" → same campaign, but the 30-day campaign clock tripped
   *                  so a campaign cleaning was inserted (resets the clock)
   */
  cleaningType: "none" | "pco" | "campaign";
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

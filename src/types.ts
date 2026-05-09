/**
 * Material of Construction (MOC) of a reactor — the wetted-surface metallurgy.
 *
 *   - "SS"          — Stainless Steel (was the old "SSR" class)
 *   - "GL"          — Glass Lined     (was the old "GLR" class)
 *   - "Hastelloy"   — corrosion-resistant nickel-molybdenum alloy
 *   - "Halar lined" — ECTFE polymer liner
 */
export type MOC = "SS" | "GL" | "Hastelloy" | "Halar lined";
export const MOC_VALUES: readonly MOC[] = [
  "SS",
  "GL",
  "Hastelloy",
  "Halar lined",
] as const;

/** Agitator / impeller geometry options used for reactor records. */
export type AgitatorType =
  | "Anchor"
  | "RCI"
  | "PBT"
  | "MIG"
  | "Hydrofoil";
export const AGITATOR_VALUES: readonly AgitatorType[] = [
  "Anchor",
  "RCI",
  "PBT",
  "MIG",
  "Hydrofoil",
] as const;

export interface Reactor {
  id: string;            // stable internal reference (e.g. "R101")
  name: string;          // editable display name (defaults to id)
  /** Material of Construction (was: reactorClass = SSR | GLR). */
  moc: MOC;
  /** Agitator / impeller type. */
  agitatorType: AgitatorType;
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
   * Batch Cycle Time (BCT) — total SLOT DURATION on this stage's reactor.
   * The reactor is locked for `bctHours` per batch. The active processing
   * is `processHours` (≤ bctHours); the difference (`bctHours − processHours`)
   * is the WAIT period at the START of the slot — the reactor is claimed
   * but not yet producing.
   *
   *   start + BCT = reactor free time
   *
   * For the bottleneck (Reactor 1) BCT == BCF == processHours (no wait).
   * For downstream reactors BCT == BCF, processHours < BCT (visible wait).
   * For Filtration & Drying BCT == processHours < BCF (no wait, idle gap
   * between consecutive batches at this equipment).
   */
  bctHours: number;
  /**
   * Active processing time within the slot. `bctHours − processHours` is
   * the leading wait period rendered as a faded bar at the start of the
   * batch's slot on the Gantt chart. Defaults to `bctHours` on legacy data
   * (= no wait, i.e. process fills the full slot).
   */
  processHours: number;
  analysisHours: number;
  /**
   * Product Change Over (PCO) cleaning time in hours. Required BEFORE running
   * this stage on a reactor whose previous occupant was a different
   * (apiId, stageId) campaign. Same-campaign batches go back-to-back with no
   * PCO. Defaults to 8h on legacy data via the storage loader.
   */
  pcoHours: number;
  plannedBatches: number;
  /**
   * DAG predecessor list: ids of OTHER stages on the same API whose output
   * feeds this stage's input. Replaces the old "previous stageNo" linear
   * assumption with a real dependency graph.
   *
   *   - First stage of an API → empty array (no predecessors).
   *   - Linear chain (legacy default) → [previous-stage-by-stageNo].
   *   - Convergence (S3 + S7 → S8) → S8.inputStageIds = [S3.id, S7.id].
   *   - Side-stream (S2 ← {S1, S2i}) → S2.inputStageIds = [S1.id, S2i.id].
   *
   * Cascade demand from each successor ADDS UP at this stage (see
   * cascadePlannedBatches). The scheduler waits for batch N's analysis-end
   * on every predecessor before starting batch N here ("any_done" rule).
   */
  inputStageIds: string[];
}

export interface API {
  id: string;
  name: string;
  color: string;
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
  /**
   * Per-API plan window. Each API has its own start/end dates — batches
   * outside this window are flagged "Ovr". The project-level window is
   * derived from the union of API windows for display purposes.
   */
  window: PlanWindow;
}

/**
 * A start/end date range. Used per-API as `API.window` for scheduling, and
 * also at the project level as a derived display range (= min start, max
 * end across all APIs).
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
  /** The reactor this batch is booked on. Single reactor per batch in the
   *  pool model (was: lead reactor in a train under the legacy train model). */
  reactorId: string;
  /** Reactors used by this batch. Single-element array under the pool model;
   *  kept as an array for backwards compat with old batch payloads that may
   *  still carry multiple ids. */
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

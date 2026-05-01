export type ReactorClass = "Small" | "Medium" | "Large";

export interface Reactor {
  id: string;
  reactorClass: ReactorClass;
  capacityKg: number;
  shared: boolean;
}

export interface StageMaster {
  id: string;
  apiId: string;
  apiName: string;
  stageNo: number;
  stageName: string;
  batchSizeKg: number;
  reactorPool: string[];
  cycleHours: number;
  analysisHours: number;
  plannedBatches: number;
}

export type Priority = 1 | 2 | 3 | 4 | 5;

export interface API {
  id: string;
  name: string;
  color: string;
  priority: Priority;
  projectionKg: number;
  stages: StageMaster[];
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
  outputKg: number;
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

import type { API, Priority, Reactor, StageMaster } from "../types";
import { FY_END_MS, FY_START_MS } from "../utils/dates";

// Deterministic PRNG (mulberry32) so the demo is reproducible
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260401);
const ri = (lo: number, hi: number) => Math.floor(rand() * (hi - lo + 1)) + lo;
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

// 20 distinct, accessible colors for each API
export const API_PALETTE = [
  "#00f0ff", "#a78bfa", "#f472b6", "#a3e635", "#fbbf24",
  "#34d399", "#fb7185", "#60a5fa", "#facc15", "#c084fc",
  "#f87171", "#22d3ee", "#84cc16", "#e879f9", "#38bdf8",
  "#fda4af", "#86efac", "#fcd34d", "#7dd3fc", "#d8b4fe",
];

// Reactors: 20 total, with shared ones across stages.
// `id` is the stable internal reference; `name` is the editable display label.
function r(
  id: string,
  cls: Reactor["reactorClass"],
  capacityKg: number,
  shared: boolean
): Reactor {
  return { id, name: id, reactorClass: cls, capacityKg, shared };
}

export const REACTORS: Reactor[] = [
  // Small reactors R101..R108 — R105-R108 are shared across multiple intermediate stages
  r("R101", "Small", 200, false),
  r("R102", "Small", 200, false),
  r("R103", "Small", 250, false),
  r("R104", "Small", 250, false),
  r("R105", "Small", 300, true),
  r("R106", "Small", 300, true),
  r("R107", "Small", 350, true),
  r("R108", "Small", 350, true),
  // Medium R201..R206 — R205, R206 shared
  r("R201", "Medium", 500, false),
  r("R202", "Medium", 500, false),
  r("R203", "Medium", 600, false),
  r("R204", "Medium", 600, false),
  r("R205", "Medium", 700, true),
  r("R206", "Medium", 700, true),
  // Large R301..R306 — final-stage / large volume
  r("R301", "Large", 1000, false),
  r("R302", "Large", 1000, false),
  r("R303", "Large", 1200, false),
  r("R304", "Large", 1200, false),
  r("R305", "Large", 1500, false),
  r("R306", "Large", 1500, false),
];

// Distribution of stage counts per API to total 82 stages over 20 APIs:
//   12 APIs * 4 stages = 48
//    6 APIs * 5 stages = 30
//    2 APIs * 3 stages = 6 -> wait that's 84, adjust
// Let's try: 14 APIs * 4 = 56, 4 APIs * 5 = 20, 2 APIs * 3 = 6 -> 82  ✓
const STAGE_COUNT_BY_API: number[] = [
  4, 4, 5, 4, 3, 4, 4, 5, 4, 4, // APIs 1-10
  4, 5, 3, 4, 4, 4, 5, 4, 4, 4, // APIs 11-20
];
// Sanity: sum should be 82
// 4*14 + 5*4 + 3*2 = 56 + 20 + 6 = 82 ✓

const STAGE_NAMES = [
  "Intermediate-1",
  "Intermediate-2",
  "Intermediate-3",
  "Intermediate-4",
  "Final API",
];

// Train model: each stage uses a small set of reactors (1-3) that lock together
// for every batch. We pick a deterministic subset from the stage's eligible
// equipment class so batches of the same stage run serially on that train,
// while different stages can run in parallel on different reactors.
function reactorPoolFor(
  stageIdx: number,
  totalStages: number,
  apiIdx: number
): string[] {
  const isFinal = stageIdx === totalStages - 1;

  // Eligible reactors for this stage's equipment class
  let eligible: string[];
  if (isFinal) {
    eligible = ["R301", "R302", "R303", "R304", "R305", "R306"];
  } else if (stageIdx === 0) {
    eligible = ["R101", "R102", "R103", "R104", "R105", "R106", "R107", "R108"];
  } else if (stageIdx === 1) {
    eligible = ["R103", "R104", "R105", "R106", "R107", "R108", "R201", "R202"];
  } else {
    eligible = ["R107", "R108", "R201", "R202", "R203", "R204", "R205", "R206"];
  }

  // Train size: deterministic 1-3 reactors per stage (mostly 2-3)
  // - 30% single-reactor stages (size 1)
  // - 50% two-reactor trains
  // - 20% three-reactor trains
  const sizeRoll = (apiIdx * 7 + stageIdx * 11) % 10;
  const trainSize = sizeRoll < 3 ? 1 : sizeRoll < 8 ? 2 : 3;

  // Pick a deterministic offset into the eligible list so different APIs
  // get different (but overlapping) trains - this means shared reactors
  // R105-R108 / R205-R206 still get used across multiple APIs, exactly like
  // the original spec said.
  const startOffset = (apiIdx * 3 + stageIdx * 5) % eligible.length;
  const pool: string[] = [];
  for (let i = 0; i < trainSize; i++) {
    pool.push(eligible[(startOffset + i) % eligible.length]);
  }
  return pool;
}

// Total batches must be 848. With 82 stages, mean ~10.34 batches/stage.
// We'll pick per-stage counts so the grand total equals 848 exactly.
function distributeBatches(stageCount: number, total: number): number[] {
  const base = Math.floor(total / stageCount);
  const remainder = total - base * stageCount;
  const out = new Array(stageCount).fill(base);
  // Vary +/- around base for realism while preserving sum, then absorb remainder
  for (let i = 0; i < stageCount; i++) {
    if (rand() < 0.5 && out[i] > 1) {
      const delta = ri(1, 3);
      out[i] -= delta;
      out[(i + 1) % stageCount] += delta;
    }
  }
  // Distribute remainder
  for (let i = 0; i < remainder; i++) out[i % stageCount] += 1;
  return out;
}

export function buildSeed(): { apis: API[]; reactors: Reactor[] } {
  const totalStages = STAGE_COUNT_BY_API.reduce((a, b) => a + b, 0); // 82
  const TOTAL_BATCHES_TARGET = 848;
  const batchAllocations = distributeBatches(totalStages, TOTAL_BATCHES_TARGET);

  let stageCursor = 0;
  const apis: API[] = STAGE_COUNT_BY_API.map((nStages, apiIdx) => {
    const apiId = `API-${String(apiIdx + 1).padStart(2, "0")}`;
    const apiName = `${apiId}`;
    const stages: StageMaster[] = [];
    for (let s = 0; s < nStages; s++) {
      const stageIdx = s;
      const isFinal = stageIdx === nStages - 1;
      const stageName = isFinal
        ? "Final API"
        : `Intermediate-${stageIdx + 1}`;
      const pool = reactorPoolFor(stageIdx, nStages, apiIdx);

      // Realistic params (pharma campaigns: intermediates 4-7 days, final 7-12 days)
      const batchSizeKg = isFinal
        ? ri(80, 220)
        : stageIdx === 0
        ? ri(40, 110)
        : ri(60, 160);
      // Train model uses reactors serially per-stage, so cycle times need to
      // be shorter than the parallel-pool model to fit ~848 batches in a year.
      const cycleHours = isFinal ? ri(96, 168) : ri(48, 96);
      const analysisHours = isFinal ? ri(36, 72) : ri(24, 48);
      const plannedBatches = batchAllocations[stageCursor];
      stageCursor++;

      stages.push({
        id: `${apiId}-S${s + 1}`,
        apiId,
        apiName,
        stageNo: s + 1,
        stageName,
        batchSizeKg,
        inputKgPerBatch: batchSizeKg, // 1:1 yield default; user can adjust
        reactorPool: pool,
        cycleHours,
        analysisHours,
        plannedBatches,
      });
    }
    const projectionKg = stages
      .filter((st) => st.stageName === "Final API")
      .reduce((acc, st) => acc + st.batchSizeKg * st.plannedBatches, 0);
    // Initial target = final stage's actual output (so cascade is a no-op
    // on first load and the seed numbers stay identical to before).
    const finalStage =
      stages.length > 0
        ? stages.reduce((acc, s) => (s.stageNo > acc.stageNo ? s : acc))
        : null;
    const targetKg = finalStage
      ? finalStage.batchSizeKg * finalStage.plannedBatches
      : 0;
    // Priority distribution: 2x P1, 4x P2, 8x P3, 4x P4, 2x P5  (total 20)
    const priorityByIdx: Priority[] = [
      1, 1,                      // 2 critical
      2, 2, 2, 2,                // 4 high
      3, 3, 3, 3, 3, 3, 3, 3,    // 8 medium
      4, 4, 4, 4,                // 4 low
      5, 5,                      // 2 lowest
    ];
    return {
      id: apiId,
      name: apiName,
      color: API_PALETTE[apiIdx % API_PALETTE.length],
      priority: priorityByIdx[apiIdx] ?? 3,
      targetKg,
      // Default per-API window: the legacy FY 2026-27 dates. User can edit
      // per API on the APIs tab to shift any individual API's plan.
      startMs: FY_START_MS,
      endMs: FY_END_MS,
      projectionKg,
      stages,
    };
  });

  return { apis, reactors: REACTORS };
}

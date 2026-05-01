import type { API, Reactor, StageMaster } from "../types";

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

// Reactors: 20 total, with shared ones across stages
export const REACTORS: Reactor[] = [
  // Small reactors R101..R108 — R105-R108 are shared across multiple intermediate stages
  { id: "R101", reactorClass: "Small", capacityKg: 200, shared: false },
  { id: "R102", reactorClass: "Small", capacityKg: 200, shared: false },
  { id: "R103", reactorClass: "Small", capacityKg: 250, shared: false },
  { id: "R104", reactorClass: "Small", capacityKg: 250, shared: false },
  { id: "R105", reactorClass: "Small", capacityKg: 300, shared: true },
  { id: "R106", reactorClass: "Small", capacityKg: 300, shared: true },
  { id: "R107", reactorClass: "Small", capacityKg: 350, shared: true },
  { id: "R108", reactorClass: "Small", capacityKg: 350, shared: true },
  // Medium R201..R206 — R205, R206 shared
  { id: "R201", reactorClass: "Medium", capacityKg: 500, shared: false },
  { id: "R202", reactorClass: "Medium", capacityKg: 500, shared: false },
  { id: "R203", reactorClass: "Medium", capacityKg: 600, shared: false },
  { id: "R204", reactorClass: "Medium", capacityKg: 600, shared: false },
  { id: "R205", reactorClass: "Medium", capacityKg: 700, shared: true },
  { id: "R206", reactorClass: "Medium", capacityKg: 700, shared: true },
  // Large R301..R306 — final-stage / large volume
  { id: "R301", reactorClass: "Large", capacityKg: 1000, shared: false },
  { id: "R302", reactorClass: "Large", capacityKg: 1000, shared: false },
  { id: "R303", reactorClass: "Large", capacityKg: 1200, shared: false },
  { id: "R304", reactorClass: "Large", capacityKg: 1200, shared: false },
  { id: "R305", reactorClass: "Large", capacityKg: 1500, shared: false },
  { id: "R306", reactorClass: "Large", capacityKg: 1500, shared: false },
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

// Pools by stage index — earlier stages use small reactors, later stages medium/large.
// Intermediate stages frequently use shared reactors R105-R108, R205-R206.
function reactorPoolFor(stageIdx: number, totalStages: number): string[] {
  const isFinal = stageIdx === totalStages - 1;
  if (isFinal) {
    // Final stage: large reactors only
    return ["R301", "R302", "R303", "R304", "R305", "R306"];
  }
  if (stageIdx === 0) {
    // First intermediate: smalls (incl. shared)
    return ["R101", "R102", "R103", "R104", "R105", "R106", "R107", "R108"];
  }
  if (stageIdx === 1) {
    // 2nd intermediate: smalls (heavy use of shared) + medium R201/R202
    return ["R103", "R104", "R105", "R106", "R107", "R108", "R201", "R202"];
  }
  // 3rd / 4th intermediate: mediums + shared smalls
  return ["R107", "R108", "R201", "R202", "R203", "R204", "R205", "R206"];
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
      const pool = reactorPoolFor(stageIdx, nStages);

      // Realistic params (pharma campaigns: intermediates 4-7 days, final 7-12 days)
      const batchSizeKg = isFinal
        ? ri(80, 220)
        : stageIdx === 0
        ? ri(40, 110)
        : ri(60, 160);
      const cycleHours = isFinal ? ri(192, 312) : ri(120, 216);
      const analysisHours = isFinal ? ri(60, 108) : ri(42, 84);
      const plannedBatches = batchAllocations[stageCursor];
      stageCursor++;

      stages.push({
        id: `${apiId}-S${s + 1}`,
        apiId,
        apiName,
        stageNo: s + 1,
        stageName,
        batchSizeKg,
        reactorPool: pool,
        cycleHours,
        analysisHours,
        plannedBatches,
      });
    }
    const projectionKg = stages
      .filter((st) => st.stageName === "Final API")
      .reduce((acc, st) => acc + st.batchSizeKg * st.plannedBatches, 0);
    return {
      id: apiId,
      name: apiName,
      color: API_PALETTE[apiIdx % API_PALETTE.length],
      projectionKg,
      stages,
    };
  });

  return { apis, reactors: REACTORS };
}

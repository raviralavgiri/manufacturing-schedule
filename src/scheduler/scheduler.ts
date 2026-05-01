import type { API, BatchScheduleEntry, Reactor, ScheduleResult } from "../types";
import {
  FY_WEEKS,
  SCHEDULE_HORIZON_START,
  WEEKS_IN_FY,
  hoursToMs,
  isInFY,
  weekIndexOf,
} from "../utils/dates";

interface BookedSlot {
  startMs: number;
  endMs: number; // includes analysis tail
  cycleEndMs: number; // physical reactor occupancy end (for util math); = endMs - analysis tail
}

/**
 * Equipment-availability sequencer.
 *
 * Strategy:
 * - For each API, walk stage 1 -> stage N. Earlier stages must finish before later
 *   stages can start (we use "earliest start = max(reactor available, prev stage end)").
 * - Within a stage, schedule its planned batches sequentially by picking the reactor
 *   from the allowed pool that becomes free earliest.
 * - The reactor is booked for the cycle window [start, start + cycle]. Analysis time
 *   runs after, but the physical reactor is FREE during analysis so the next batch
 *   on the same reactor can start as soon as cycleEnd.
 * - A small inter-stage buffer is added (4h) to model material transfer / QC release.
 */
export function runScheduler(apis: API[], reactors: Reactor[]): ScheduleResult {
  const reactorBookings = new Map<string, BookedSlot[]>();
  reactors.forEach((r) => reactorBookings.set(r.id, []));

  const HORIZON_MS = SCHEDULE_HORIZON_START.getTime();
  const INTER_STAGE_BUFFER_HOURS = 4;

  const allBatches: BatchScheduleEntry[] = [];
  let clashCount = 0;

  // Round-robin through APIs by interleaving batches to spread load over the year.
  // We compute, per API and per stage, all batches; then we run *campaign rounds*:
  //   round 0: each API's stage1 batch1 + stage2 batch1 + ...
  //   round 1: each API's stage1 batch2 + ...
  // This keeps the Gantt chart visually distributed and respects stage ordering.

  // Find max batches across all stages
  let maxBatches = 0;
  apis.forEach((a) =>
    a.stages.forEach((s) => {
      if (s.plannedBatches > maxBatches) maxBatches = s.plannedBatches;
    })
  );

  // Per-API stage end-time tracker: latest end for stage i so stage i+1 can start after
  const apiStageLastEnd = new Map<string, number[]>();
  apis.forEach((a) =>
    apiStageLastEnd.set(
      a.id,
      a.stages.map(() => HORIZON_MS)
    )
  );

  for (let round = 0; round < maxBatches; round++) {
    for (const api of apis) {
      for (let sIdx = 0; sIdx < api.stages.length; sIdx++) {
        const stage = api.stages[sIdx];
        if (round >= stage.plannedBatches) continue;
        const cycleMs = hoursToMs(stage.cycleHours);
        const analysisMs = hoursToMs(stage.analysisHours);
        const bufferMs = hoursToMs(INTER_STAGE_BUFFER_HOURS);

        // Earliest possible start = max(prev stage's batch end, horizon)
        const prevStageReady =
          sIdx === 0 ? HORIZON_MS : apiStageLastEnd.get(api.id)![sIdx - 1] + bufferMs;
        const earliestStart = Math.max(prevStageReady, HORIZON_MS);

        // Pick reactor in pool that becomes free earliest >= earliestStart
        let bestReactor: string | null = null;
        let bestStart = Infinity;
        for (const rid of stage.reactorPool) {
          const slots = reactorBookings.get(rid)!;
          const lastEnd = slots.length === 0 ? HORIZON_MS : slots[slots.length - 1].cycleEndMs;
          const candidateStart = Math.max(lastEnd, earliestStart);
          if (candidateStart < bestStart) {
            bestStart = candidateStart;
            bestReactor = rid;
          }
        }
        if (!bestReactor) continue; // shouldn't happen

        const startMs = bestStart;
        const cycleEndMs = startMs + cycleMs;
        const analysisEndMs = cycleEndMs + analysisMs;

        // Detect clash defensively (sequencer guarantees zero, but verify)
        const slots = reactorBookings.get(bestReactor)!;
        let clash = false;
        if (slots.length > 0) {
          const last = slots[slots.length - 1];
          if (startMs < last.cycleEndMs) clash = true;
        }
        if (clash) clashCount++;

        slots.push({ startMs, endMs: analysisEndMs, cycleEndMs });

        const stageEndForNext = analysisEndMs; // next stage waits for THIS stage's analysis to clear
        apiStageLastEnd.get(api.id)![sIdx] = Math.max(
          apiStageLastEnd.get(api.id)![sIdx],
          stageEndForNext
        );

        const entry: BatchScheduleEntry = {
          batchId: `${stage.id}-B${round + 1}`,
          apiId: api.id,
          apiName: api.name,
          apiColor: api.color,
          stageId: stage.id,
          stageNo: stage.stageNo,
          stageName: stage.stageName,
          batchNo: round + 1,
          reactorId: bestReactor,
          startMs,
          endMs: cycleEndMs,
          analysisEndMs,
          inFY: isInFY(startMs) && isInFY(cycleEndMs),
          clash,
          outputKg: stage.batchSizeKg,
        };
        allBatches.push(entry);
      }
    }
  }

  // Sort for stable output
  allBatches.sort((a, b) => a.startMs - b.startMs);

  // Reactor usage stats
  const reactorUsage: Record<string, { busyHours: number; batchCount: number }> = {};
  reactors.forEach((r) => (reactorUsage[r.id] = { busyHours: 0, batchCount: 0 }));
  allBatches.forEach((b) => {
    const u = reactorUsage[b.reactorId];
    u.busyHours += (b.endMs - b.startMs) / 3600000;
    u.batchCount += 1;
  });

  // Weekly occupancy matrix [reactorIdx][weekIdx] = hours busy in that week (cycle only, not analysis)
  const weeklyReactorOccupancy: number[][] = reactors.map(() =>
    new Array(WEEKS_IN_FY).fill(0)
  );
  const reactorIndex = new Map(reactors.map((r, i) => [r.id, i]));
  allBatches.forEach((b) => {
    const rIdx = reactorIndex.get(b.reactorId)!;
    // Distribute busy hours across weeks the cycle spans
    let cursor = b.startMs;
    while (cursor < b.endMs) {
      const wIdx = weekIndexOf(cursor);
      if (wIdx < 0) {
        // Past horizon -> stop
        break;
      }
      const weekEnd = FY_WEEKS[wIdx].start.getTime() + 7 * 24 * 3600 * 1000;
      const segmentEnd = Math.min(b.endMs, weekEnd);
      const hours = (segmentEnd - cursor) / 3600000;
      weeklyReactorOccupancy[rIdx][wIdx] += hours;
      cursor = segmentEnd;
    }
  });

  const fyBatches = allBatches.filter((b) => b.inFY).length;

  return {
    batches: allBatches,
    totalBatches: allBatches.length,
    fyBatches,
    overflowBatches: allBatches.length - fyBatches,
    clashCount,
    reactorUsage,
    weeklyReactorOccupancy,
  };
}

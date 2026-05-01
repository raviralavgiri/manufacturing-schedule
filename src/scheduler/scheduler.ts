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
  cycleEndMs: number; // physical reactor occupancy end (= endMs - analysis tail)
}

/**
 * Equipment-availability sequencer — TRAIN model.
 *
 * Each batch of a stage locks **every reactor in stage.reactorPool**
 * simultaneously for the cycle window [start, start + cycleHours]. Examples:
 *
 *   pool = [R101, R102, R103]      → batch 1 books all 3 reactors together
 *   10 batches with the same pool  → run strictly serially
 *                                    (you cannot run two batches in parallel
 *                                    even though there are 3 reactors —
 *                                    they're all needed for one batch)
 *
 * Constraints (provably never violated):
 *   1. No reactor clash: a reactor's [start, cycleEnd] windows are
 *      non-overlapping, so even when shared across stages there's no
 *      double-booking.
 *   2. Stage ordering inside an API: stage N+1's batch B can only start
 *      after stage N's batch B finishes its analysis window plus a 4-hour
 *      transfer buffer.
 *   3. Priority ordering: APIs are processed in priority order (P1 first,
 *      P5 last) within each round so high-priority APIs grab earliest slots.
 *
 * Reactor analysis windows (analysisHours) DO NOT lock the reactor — they
 * only delay the next stage of the SAME API. Other batches can use these
 * reactors as soon as cycleEnd.
 */
export function runScheduler(apis: API[], reactors: Reactor[]): ScheduleResult {
  const reactorBookings = new Map<string, BookedSlot[]>();
  const reactorLoadHours = new Map<string, number>();
  const reactorBatchCount = new Map<string, number>();
  reactors.forEach((r) => {
    reactorBookings.set(r.id, []);
    reactorLoadHours.set(r.id, 0);
    reactorBatchCount.set(r.id, 0);
  });

  const HORIZON_MS = SCHEDULE_HORIZON_START.getTime();
  const INTER_STAGE_BUFFER_HOURS = 4;

  const allBatches: BatchScheduleEntry[] = [];
  let clashCount = 0;

  // APIs in priority order (P1 first ... P5 last)
  const apisInPriorityOrder = [...apis].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id)
  );

  // Find max batches across all stages (loop bound)
  let maxBatches = 0;
  apis.forEach((a) =>
    a.stages.forEach((s) => {
      if (s.plannedBatches > maxBatches) maxBatches = s.plannedBatches;
    })
  );

  // Per-API per-stage end tracker: latest analysis end so stage N+1 can wait
  const apiStageLastEnd = new Map<string, number[]>();
  apis.forEach((a) =>
    apiStageLastEnd.set(
      a.id,
      a.stages.map(() => HORIZON_MS)
    )
  );

  // Helper: when does the entire reactor train become available together?
  function trainReadyAt(pool: string[], earliest: number): number {
    let trainStart = earliest;
    for (const rid of pool) {
      const slots = reactorBookings.get(rid)!;
      const lastEnd =
        slots.length === 0 ? HORIZON_MS : slots[slots.length - 1].cycleEndMs;
      if (lastEnd > trainStart) trainStart = lastEnd;
    }
    return trainStart;
  }

  for (let round = 0; round < maxBatches; round++) {
    for (const api of apisInPriorityOrder) {
      for (let sIdx = 0; sIdx < api.stages.length; sIdx++) {
        const stage = api.stages[sIdx];
        if (round >= stage.plannedBatches) continue;
        if (stage.reactorPool.length === 0) continue;

        const cycleMs = hoursToMs(stage.cycleHours);
        const analysisMs = hoursToMs(stage.analysisHours);
        const bufferMs = hoursToMs(INTER_STAGE_BUFFER_HOURS);

        // 1. Earliest possible start = max(prev stage's batch end + buffer, horizon)
        const prevStageReady =
          sIdx === 0
            ? HORIZON_MS
            : apiStageLastEnd.get(api.id)![sIdx - 1] + bufferMs;
        const earliestStart = Math.max(prevStageReady, HORIZON_MS);

        // 2. Train start = max(earliestStart, max-of-pool-last-cycle-end)
        const startMs = trainReadyAt(stage.reactorPool, earliestStart);
        const cycleEndMs = startMs + cycleMs;
        const analysisEndMs = cycleEndMs + analysisMs;

        // 3. Defensive clash check (algorithm guarantees this never fires)
        let clash = false;
        for (const rid of stage.reactorPool) {
          const slots = reactorBookings.get(rid)!;
          if (slots.length > 0 && startMs < slots[slots.length - 1].cycleEndMs) {
            clash = true;
            break;
          }
        }
        if (clash) clashCount++;

        // 4. Book the cycle on EVERY reactor in the train
        for (const rid of stage.reactorPool) {
          reactorBookings.get(rid)!.push({
            startMs,
            endMs: analysisEndMs,
            cycleEndMs,
          });
          reactorLoadHours.set(
            rid,
            (reactorLoadHours.get(rid) ?? 0) + stage.cycleHours
          );
          reactorBatchCount.set(
            rid,
            (reactorBatchCount.get(rid) ?? 0) + 1
          );
        }

        // 5. Stage N+1 of THIS API waits for analysis end
        apiStageLastEnd.get(api.id)![sIdx] = Math.max(
          apiStageLastEnd.get(api.id)![sIdx],
          analysisEndMs
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
          reactorId: stage.reactorPool[0], // primary / lead reactor
          reactorIds: stage.reactorPool.slice(),
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

  // Sort by start for stable output
  allBatches.sort((a, b) => a.startMs - b.startMs);

  // Reactor usage stats — count every reactor in every batch's train
  const reactorUsage: Record<string, { busyHours: number; batchCount: number }> = {};
  reactors.forEach((r) => (reactorUsage[r.id] = { busyHours: 0, batchCount: 0 }));
  allBatches.forEach((b) => {
    const cycleHours = (b.endMs - b.startMs) / 3600000;
    b.reactorIds.forEach((rid) => {
      const u = reactorUsage[rid];
      if (!u) return;
      u.busyHours += cycleHours;
      u.batchCount += 1;
    });
  });

  // Weekly occupancy: bill every reactor in the train for the cycle window
  const weeklyReactorOccupancy: number[][] = reactors.map(() =>
    new Array(WEEKS_IN_FY).fill(0)
  );
  const reactorIndex = new Map(reactors.map((r, i) => [r.id, i]));
  allBatches.forEach((b) => {
    b.reactorIds.forEach((rid) => {
      const rIdx = reactorIndex.get(rid);
      if (rIdx === undefined) return;
      let cursor = b.startMs;
      while (cursor < b.endMs) {
        const wIdx = weekIndexOf(cursor);
        if (wIdx < 0) break;
        const weekEnd =
          FY_WEEKS[wIdx].start.getTime() + 7 * 24 * 3600 * 1000;
        const segmentEnd = Math.min(b.endMs, weekEnd);
        const hours = (segmentEnd - cursor) / 3600000;
        weeklyReactorOccupancy[rIdx][wIdx] += hours;
        cursor = segmentEnd;
      }
    });
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

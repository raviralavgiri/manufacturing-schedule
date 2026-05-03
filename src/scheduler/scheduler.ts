import type {
  API,
  BatchScheduleEntry,
  PlanWindow,
  Reactor,
  ScheduleResult,
} from "../types";
import {
  FY_END_MS,
  FY_START_MS,
  computeWeeks,
  hoursToMs,
  weekIndexIn,
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
export function runScheduler(
  apis: API[],
  reactors: Reactor[],
  planWindow?: PlanWindow
): ScheduleResult {
  // Global plan window applied to every API. Falls back to FY 26-27 if not
  // provided (e.g. legacy callers).
  const windowStart =
    planWindow && Number.isFinite(planWindow.startMs)
      ? planWindow.startMs
      : FY_START_MS;
  const windowEnd =
    planWindow && Number.isFinite(planWindow.endMs)
      ? planWindow.endMs
      : FY_END_MS;
  const reactorBookings = new Map<string, BookedSlot[]>();
  const reactorLoadHours = new Map<string, number>();
  const reactorBatchCount = new Map<string, number>();
  reactors.forEach((r) => {
    reactorBookings.set(r.id, []);
    reactorLoadHours.set(r.id, 0);
    reactorBatchCount.set(r.id, 0);
  });

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

  // Per-API per-stage end tracker: latest analysis end so stage N+1 can wait.
  // All APIs share the global window's start as their initial horizon.
  const apiStageLastEnd = new Map<string, number[]>();
  apis.forEach((a) =>
    apiStageLastEnd.set(
      a.id,
      a.stages.map(() => windowStart)
    )
  );

  /**
   * Find the EARLIEST time t >= earliest such that [t, t + cycleMs) is free
   * on every reactor in the pool simultaneously.
   *
   * Why this matters: a reactor R might have a booking at week 5-6 (because
   * it's in API-01's stage-4 train, gated by stage-3 analysis). But R is
   * IDLE in weeks 0-5 — and other APIs whose pool also contains R should
   * be able to slot in there. A naive "look at last booking end" approach
   * misses these earlier gaps; this gap-finder uses them.
   *
   * Algorithm: start at t=earliest. If any reactor in the pool has a
   * booking that overlaps [t, t+cycleMs), jump t to that booking's end and
   * retry. Repeats until a clean slot is found. O(B * P) where B is total
   * bookings across the pool and P is pool size.
   */
  function findTrainSlot(
    pool: string[],
    earliest: number,
    cycleMs: number
  ): number {
    let t = earliest;
    // Per-reactor sorted booking lists (we keep them sorted by sorted insert
    // below, so this is just a reference, no copying).
    const lookups = pool.map((rid) => reactorBookings.get(rid)!);

    for (let safety = 0; safety < 5000; safety++) {
      let conflictEnd = t;
      let foundConflict = false;
      for (const slots of lookups) {
        for (const slot of slots) {
          // Slot ends before our window starts → no overlap, skip
          if (slot.cycleEndMs <= t) continue;
          // Slot starts at/after our window ends → no overlap, and since
          // slots are sorted by startMs, no later slot in this reactor can
          // overlap either.
          if (slot.startMs >= t + cycleMs) break;
          // Genuine overlap: must wait until this reactor frees
          if (slot.cycleEndMs > conflictEnd) conflictEnd = slot.cycleEndMs;
          foundConflict = true;
          break;
        }
        if (foundConflict) break;
      }
      if (!foundConflict) return t;
      t = conflictEnd;
    }
    // Safety fallback (should never hit unless something is malformed)
    return t;
  }

  /** Insert a booking into a reactor's sorted slot list (by startMs). */
  function insertSorted(slots: BookedSlot[], slot: BookedSlot): void {
    // Linear scan from the end (most appends are still chronological because
    // the algorithm processes batches mostly in order). Falls back to early
    // insertion when a low-priority API slots into an earlier gap.
    let i = slots.length;
    while (i > 0 && slots[i - 1].startMs > slot.startMs) i--;
    slots.splice(i, 0, slot);
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

        // 1. Earliest possible start = max(prev stage's batch end + buffer,
        //    global plan window start)
        const prevStageReady =
          sIdx === 0
            ? windowStart
            : apiStageLastEnd.get(api.id)![sIdx - 1] + bufferMs;
        const earliestStart = Math.max(prevStageReady, windowStart);

        // 2. Find the EARLIEST gap on the train where [t, t+cycle) is free on
        //    every pool reactor simultaneously. This is the key fix: it lets
        //    low-priority / late-stage trains slot into the early-week idle
        //    windows that high-priority APIs leave behind on shared reactors.
        const startMs = findTrainSlot(stage.reactorPool, earliestStart, cycleMs);
        const cycleEndMs = startMs + cycleMs;
        const analysisEndMs = cycleEndMs + analysisMs;

        // 3. Defensive clash check — verify the slot we found genuinely doesn't
        //    overlap any existing booking on any pool reactor.
        let clash = false;
        for (const rid of stage.reactorPool) {
          const slots = reactorBookings.get(rid)!;
          for (const s of slots) {
            if (s.cycleEndMs <= startMs) continue;
            if (s.startMs >= cycleEndMs) break;
            clash = true;
            break;
          }
          if (clash) break;
        }
        if (clash) clashCount++;

        // 4. Book the cycle on EVERY reactor in the train, inserting at the
        //    sorted position so future gap-finder scans walk slots in time order.
        const newSlot: BookedSlot = { startMs, endMs: analysisEndMs, cycleEndMs };
        for (const rid of stage.reactorPool) {
          insertSorted(reactorBookings.get(rid)!, newSlot);
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
          // "In FY" = batch fits within the global plan window
          inFY:
            startMs >= windowStart &&
            cycleEndMs <= windowEnd,
          clash,
          outputKg: stage.batchSizeKg,
          inputKg:
            typeof stage.inputKgPerBatch === "number" && stage.inputKgPerBatch > 0
              ? stage.inputKgPerBatch
              : stage.batchSizeKg,
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

  // Weekly occupancy: bill every reactor in the train for the cycle window.
  // Range = the global plan window so the heatmap mirrors the planning span.
  const weeks = computeWeeks(windowStart, windowEnd);
  const weekCount = weeks.length;
  const weeklyReactorOccupancy: number[][] = reactors.map(() =>
    new Array(weekCount).fill(0)
  );
  const reactorIndex = new Map(reactors.map((r, i) => [r.id, i]));
  allBatches.forEach((b) => {
    b.reactorIds.forEach((rid) => {
      const rIdx = reactorIndex.get(rid);
      if (rIdx === undefined) return;
      let cursor = b.startMs;
      while (cursor < b.endMs) {
        const wIdx = weekIndexIn(weeks, cursor);
        if (wIdx < 0) break;
        const weekEnd =
          weeks[wIdx].startMs + 7 * 24 * 3600 * 1000;
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

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
  // Campaign metadata — used by PCO checks to decide whether a cleaning gap
  // is needed before/after this slot when something else lands on the same
  // reactor. Two slots are "same campaign" iff (apiId, stageId) match — i.e.
  // the SAME stage of the SAME API. Same-campaign batches go back-to-back
  // with no PCO; everything else needs a cleaning gap.
  apiId: string;
  stageId: string;
  pcoMs: number;
}

/**
 * Equipment-availability sequencer — TRAIN model + PCO.
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
 *   4. Product Change Over (PCO): when a reactor switches from one
 *      (apiId, stageId) campaign to a different one, the new batch's start
 *      must be >= prev.cycleEnd + newStage.pcoHours. Same-campaign batches
 *      have zero PCO. The same rule applies in reverse for any successor
 *      slot we'd land BEFORE: our cycleEnd must be <= next.start - next.pco
 *      if we differ from `next`'s campaign.
 *
 * Reactor analysis windows (analysisHours) DO NOT lock the reactor — they
 * only delay the next stage of the SAME API. Other batches can use these
 * reactors as soon as cycleEnd (subject to PCO).
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
   * on every reactor in the pool simultaneously, INCLUDING the PCO cleaning
   * gap before/after any campaign change.
   *
   * For each reactor R in the train, t is valid iff:
   *   1. No booked slot on R overlaps [t, t+cycleMs).
   *   2. (Predecessor PCO) For every booked slot S on R with S.cycleEnd <= t:
   *        if S.campaign !== newCampaign → t >= S.cycleEnd + newPcoMs
   *   3. (Successor PCO) For the first booked slot S on R with S.start
   *      >= t+cycleMs: if S.campaign !== newCampaign → t+cycleMs <=
   *        S.start - S.pcoMs (i.e. there's room for S's own cleaning gap
   *        BEFORE S runs). If not, we treat S as a hard block and advance
   *        past it (next iteration will use S as predecessor instead).
   *
   * If any check fails on any reactor, advance t to the maximum required
   * advance across all checks and retry.
   *
   * Why predecessor + successor: a low-priority API may slot into an early
   * gap — and we need the gap to be PCO-safe on BOTH ends, not just before
   * us. Otherwise we'd be forcing whoever already booked the next slot to
   * either wait or violate their own PCO requirement, which is worse.
   *
   * Worst case O(B * P * iters); B = total bookings across pool, P = pool
   * size, iters bounded by the safety counter (5000).
   */
  function findTrainSlot(
    pool: string[],
    earliest: number,
    cycleMs: number,
    newApiId: string,
    newStageId: string,
    newPcoMs: number
  ): number {
    let t = earliest;
    const lookups = pool.map((rid) => reactorBookings.get(rid)!);

    for (let safety = 0; safety < 5000; safety++) {
      let advance = t;
      let needAdvance = false;

      for (const slots of lookups) {
        let predRequired = -Infinity;
        let conflictThisReactor = false;

        for (const slot of slots) {
          const sameCampaign =
            slot.apiId === newApiId && slot.stageId === newStageId;

          if (slot.cycleEndMs <= t) {
            // Predecessor: enforce PCO before us if campaign differs.
            const required =
              slot.cycleEndMs + (sameCampaign ? 0 : newPcoMs);
            if (required > predRequired) predRequired = required;
            continue;
          }

          if (slot.startMs >= t + cycleMs) {
            // Successor: we need to leave room for ITS cleaning gap before
            // it runs (if its campaign differs from ours).
            const requiredEnd =
              slot.startMs - (sameCampaign ? 0 : slot.pcoMs);
            if (t + cycleMs > requiredEnd) {
              // Can't fit before this slot — jump past it. Next iteration
              // will treat slot as the predecessor and apply newPcoMs.
              if (slot.cycleEndMs > advance) advance = slot.cycleEndMs;
              needAdvance = true;
              conflictThisReactor = true;
            }
            // No later slot on this reactor can affect us (sorted by start).
            break;
          }

          // Slot overlaps [t, t+cycleMs) — wait for it to free.
          if (slot.cycleEndMs > advance) advance = slot.cycleEndMs;
          needAdvance = true;
          conflictThisReactor = true;
          break;
        }

        if (!conflictThisReactor && predRequired > t) {
          if (predRequired > advance) advance = predRequired;
          needAdvance = true;
        }
      }

      if (!needAdvance) return t;
      t = advance;
    }
    return t; // safety fallback
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
        // PCO defaults to 8h on legacy data via the storage migration; treat
        // anything missing/invalid as 0 here (defensive — should never fire
        // after migration).
        const pcoMs = hoursToMs(
          typeof stage.pcoHours === "number" && stage.pcoHours >= 0
            ? stage.pcoHours
            : 0
        );

        // 1. Earliest possible start = max(prev stage's batch end + buffer,
        //    global plan window start)
        const prevStageReady =
          sIdx === 0
            ? windowStart
            : apiStageLastEnd.get(api.id)![sIdx - 1] + bufferMs;
        const earliestStart = Math.max(prevStageReady, windowStart);

        // 2. Find the EARLIEST gap on the train where [t, t+cycle) is free on
        //    every pool reactor simultaneously, with PCO checks against
        //    predecessor and successor campaigns on each reactor.
        const startMs = findTrainSlot(
          stage.reactorPool,
          earliestStart,
          cycleMs,
          api.id,
          stage.id,
          pcoMs
        );
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
        const newSlot: BookedSlot = {
          startMs,
          endMs: analysisEndMs,
          cycleEndMs,
          apiId: api.id,
          stageId: stage.id,
          pcoMs,
        };
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

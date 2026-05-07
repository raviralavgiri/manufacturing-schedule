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
  cycleEndMs: number; // physical reactor occupancy end = startMs + bctMs
  // ─ Campaign metadata ─────────────────────────────────────────────────────
  // Two slots are "same campaign" iff their (apiId, stageId) match.
  apiId: string;
  stageId: string;
  /** Stage's PCO time (ms) — needed by future scans to know how big a gap
   *  to leave when something else lands BEFORE this slot. */
  pcoMs: number;
  /** When this slot's CURRENT campaign began on the reactor it lives on.
   *  Used to enforce the 30-day campaign cap: if a same-campaign successor
   *  would land more than 30 days after `campaignStartMs`, we insert a
   *  campaign-cleaning gap and reset the clock. */
  campaignStartMs: number;
  /**
   * Earliest start for the NEXT same-campaign batch at the same stage on
   * this reactor. Equals startMs + bcfMs (BCF = Batch Charging Frequency).
   * Cross-campaign slots use cycleEndMs + pcoMs instead (PCO path).
   * Stored here so checkPredecessor doesn't need to recompute it.
   */
  nextSameCampaignStartMs: number;
}

/** Maximum continuous campaign duration before a forced campaign cleaning. */
const CAMPAIGN_MAX_MS = 30 * 24 * 3600 * 1000;

/**
 * Equipment-availability sequencer — POOL model + PCO + 30-day campaign cap.
 *
 * Each batch uses ONE reactor at a time. `stage.reactorPool` is the list of
 * eligible reactors; the scheduler picks whichever one becomes free earliest
 * at the candidate start time. So pool size determines achievable concurrency.
 *
 *   pool = [R101, R102, R103], BCF = 24h, BCT = 72h
 *      → B1 on R1 [0, 72]
 *        B2 on R2 [24, 96]   ← 24h after B1 — BCF honoured
 *        B3 on R3 [48, 120]
 *        B4 on R1 [72, 144]  ← R1 free again at 72 — cadence holds
 *
 *   pool = [R101], BCF = 24h, BCT = 72h
 *      → B1 on R1 [0, 72]
 *        B2 on R1 [72, 144]  ← BCT dominates, BCF can't be honoured
 *      Add reactors to the pool to unlock BCF cadence.
 *
 * Constraints (provably never violated):
 *   1. No reactor clash: a reactor's [start, cycleEnd] windows are
 *      non-overlapping per reactor.
 *   2. Stage ordering inside an API: stage N+1's batch B can only start
 *      after stage N's batch B finishes its analysis window plus a 4-hour
 *      transfer buffer.
 *   3. Priority ordering: APIs are processed in priority order (P1 first,
 *      P5 last) within each round so high-priority APIs grab earliest slots.
 *   4. BCF cadence: same-stage consecutive batches respect
 *      start_n - start_(n-1) >= BCF (cross-reactor; tracked per stage in
 *      stageLastBatchStart).
 *   5. PCO: when a reactor switches from one (apiId, stageId) campaign to a
 *      different one, the new batch's start must be
 *      >= prev.cycleEnd + newStage.pcoHours.
 *   6. Campaign cap: even within the SAME campaign, a continuous run on a
 *      reactor cannot exceed 30 days. Triggers a campaign-cleaning gap
 *      (= the stage's pcoHours) and resets the clock. Tagged separately so
 *      the Gantt can colour it green vs PCO yellow.
 *
 * Reactor analysis windows (analysisHours) DO NOT lock the reactor — they
 * only delay the next stage of the SAME API.
 */
export function runScheduler(
  apis: API[],
  reactors: Reactor[],
  planWindow?: PlanWindow
): ScheduleResult {
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

  const apisInPriorityOrder = [...apis].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id)
  );

  let maxBatches = 0;
  apis.forEach((a) =>
    a.stages.forEach((s) => {
      if (s.plannedBatches > maxBatches) maxBatches = s.plannedBatches;
    })
  );

  const apiStageLastEnd = new Map<string, number[]>();
  apis.forEach((a) =>
    apiStageLastEnd.set(
      a.id,
      a.stages.map(() => windowStart)
    )
  );

  // BCF gate (cross-reactor): for each stage, the last booked batch's start.
  // The next batch of the same stage cannot start before
  // `stageLastBatchStart + bcfMs`, regardless of which reactor it lands on.
  // Tracked by stageId so we don't depend on reactor choice. -Infinity means
  // no batch booked yet for this stage.
  const stageLastBatchStart = new Map<string, number>();

  /**
   * Decide what cleaning (if any) is required when we want to book a new
   * slot at time `t` on reactor R, given R's current sorted slot list.
   *
   * Returns:
   *   - kind: 'none' | 'pco' | 'campaign'
   *   - earliestStart: minimum start time on R that satisfies the cleaning
   *                    requirement implied by the predecessor (could be
   *                    `t` unchanged if no predecessor or no cleaning).
   *
   * `kind === 'campaign'` is set only when the same campaign has been
   * running on R for more than CAMPAIGN_MAX_MS (measured from the
   * predecessor's `campaignStartMs`).
   */
  function checkPredecessor(
    slots: BookedSlot[],
    t: number,
    newApiId: string,
    newStageId: string,
    newPcoMs: number
  ): { kind: "none" | "pco" | "campaign"; earliestStart: number } {
    // Walk forward to find the slot with the largest cycleEndMs <= t.
    let pred: BookedSlot | null = null;
    for (const slot of slots) {
      if (slot.cycleEndMs <= t) {
        if (!pred || slot.cycleEndMs > pred.cycleEndMs) pred = slot;
      } else {
        break;
      }
    }
    if (!pred) return { kind: "none", earliestStart: t };
    const sameCampaign =
      pred.apiId === newApiId && pred.stageId === newStageId;
    if (!sameCampaign) {
      return {
        kind: "pco",
        earliestStart: Math.max(t, pred.cycleEndMs + newPcoMs),
      };
    }
    // Same campaign — check the 30-day cap.
    const campaignAge = t - pred.campaignStartMs;
    if (campaignAge > CAMPAIGN_MAX_MS) {
      return {
        kind: "campaign",
        earliestStart: Math.max(t, pred.cycleEndMs + newPcoMs),
      };
    }
    // Same campaign, within 30-day cap.
    // Next start = max(BCF interval from previous start, reactor free time).
    // The BCF constraint enforces the "start₁ + BCF = start₂" rule.
    return {
      kind: "none",
      earliestStart: Math.max(t, pred.nextSameCampaignStartMs, pred.cycleEndMs),
    };
  }

  /**
   * Find the EARLIEST time t >= earliest such that [t, t + cycleMs) is free
   * on every reactor in the pool simultaneously, INCLUDING any cleaning
   * gap required by predecessor or successor slots.
   *
   * Algorithm:
   *   - For each reactor in the supplied list (single-element under the
   *     pool model; multi-element is supported for the legacy code paths
   *     that probe a "best of pool" via repeated single-reactor calls),
   *     compute the predecessor cleaning constraint and the successor
   *     PCO constraint.
   *   - If any constraint forces an advance, jump to the max required
   *     advance and retry.
   *   - On success, return both the start time and the cleaning kind
   *     (campaign > pco > none — campaign and pco have the same duration
   *     but the Gantt colours them differently).
   */
  function findTrainSlot(
    pool: string[],
    earliest: number,
    cycleMs: number,
    newApiId: string,
    newStageId: string,
    newPcoMs: number
  ): { startMs: number; cleaningKind: "none" | "pco" | "campaign" } {
    let t = earliest;
    const lookups = pool.map((rid) => reactorBookings.get(rid)!);

    for (let safety = 0; safety < 5000; safety++) {
      let advance = t;
      let needAdvance = false;

      for (const slots of lookups) {
        // Successor + overlap pass. We also separately compute the
        // predecessor requirement via checkPredecessor below.
        let conflictThisReactor = false;
        for (const slot of slots) {
          const sameCampaign =
            slot.apiId === newApiId && slot.stageId === newStageId;
          if (slot.cycleEndMs <= t) continue;
          if (slot.startMs >= t + cycleMs) {
            const requiredEnd =
              slot.startMs - (sameCampaign ? 0 : slot.pcoMs);
            if (t + cycleMs > requiredEnd) {
              if (slot.cycleEndMs > advance) advance = slot.cycleEndMs;
              needAdvance = true;
              conflictThisReactor = true;
            }
            break;
          }
          // Slot overlaps [t, t+cycleMs)
          if (slot.cycleEndMs > advance) advance = slot.cycleEndMs;
          needAdvance = true;
          conflictThisReactor = true;
          break;
        }
        if (conflictThisReactor) continue;

        const pred = checkPredecessor(
          slots,
          t,
          newApiId,
          newStageId,
          newPcoMs
        );
        if (pred.earliestStart > t) {
          if (pred.earliestStart > advance) advance = pred.earliestStart;
          needAdvance = true;
        }
      }

      if (!needAdvance) {
        // We've found a valid t. Now compute the strongest cleaning kind
        // across all reactors in the pool — that's what gets shown on
        // the batch's faded tail.
        let cleaningKind: "none" | "pco" | "campaign" = "none";
        for (const slots of lookups) {
          const pred = checkPredecessor(
            slots,
            t,
            newApiId,
            newStageId,
            newPcoMs
          );
          if (pred.kind === "campaign") {
            cleaningKind = "campaign";
            break; // strongest kind, no need to keep looking
          }
          if (pred.kind === "pco" && cleaningKind === "none") {
            cleaningKind = "pco";
          }
        }
        return { startMs: t, cleaningKind };
      }
      t = advance;
    }
    return { startMs: t, cleaningKind: "none" }; // safety fallback
  }

  /** Insert a booking into a reactor's sorted slot list (by startMs). */
  function insertSorted(slots: BookedSlot[], slot: BookedSlot): void {
    let i = slots.length;
    while (i > 0 && slots[i - 1].startMs > slot.startMs) i--;
    slots.splice(i, 0, slot);
  }

  /**
   * Compute the campaignStartMs for a freshly-booked slot on reactor R.
   * Continues the predecessor's campaign clock if (a) same campaign and
   * (b) the gap stayed within CAMPAIGN_MAX_MS. Otherwise this slot starts
   * a new campaign at its own startMs.
   */
  function deriveCampaignStart(
    slots: BookedSlot[],
    newStartMs: number,
    newApiId: string,
    newStageId: string
  ): number {
    let pred: BookedSlot | null = null;
    for (const slot of slots) {
      if (slot.cycleEndMs <= newStartMs) {
        if (!pred || slot.cycleEndMs > pred.cycleEndMs) pred = slot;
      } else {
        break;
      }
    }
    if (
      pred &&
      pred.apiId === newApiId &&
      pred.stageId === newStageId &&
      newStartMs - pred.campaignStartMs <= CAMPAIGN_MAX_MS
    ) {
      return pred.campaignStartMs;
    }
    return newStartMs;
  }

  for (let round = 0; round < maxBatches; round++) {
    for (const api of apisInPriorityOrder) {
      for (let sIdx = 0; sIdx < api.stages.length; sIdx++) {
        const stage = api.stages[sIdx];
        if (round >= stage.plannedBatches) continue;
        if (stage.reactorPool.length === 0) continue;

        // BCT = physical reactor occupancy duration (per batch).
        // BCF = interval between consecutive same-stage batch STARTS
        //       (cross-reactor; honoured if the pool has enough reactors,
        //       otherwise BCT dominates because the reactor stays busy).
        const bctMs = hoursToMs(
          typeof stage.bctHours === "number" && stage.bctHours > 0
            ? stage.bctHours
            : stage.bcfHours // defensive fallback for legacy data
        );
        const bcfMs = hoursToMs(stage.bcfHours);
        // cycleMs = reactor occupancy = BCT.
        const cycleMs = bctMs;
        const analysisMs = hoursToMs(stage.analysisHours);
        const bufferMs = hoursToMs(INTER_STAGE_BUFFER_HOURS);
        const pcoMs = hoursToMs(
          typeof stage.pcoHours === "number" && stage.pcoHours >= 0
            ? stage.pcoHours
            : 0
        );

        const prevStageReady =
          sIdx === 0
            ? windowStart
            : apiStageLastEnd.get(api.id)![sIdx - 1] + bufferMs;

        // BCF gate: the next batch of THIS stage cannot start before
        // (last booked start of this stage) + BCF, no matter which reactor.
        const prevSameStageStart = stageLastBatchStart.get(stage.id);
        const bcfGate =
          prevSameStageStart !== undefined
            ? prevSameStageStart + bcfMs
            : -Infinity;

        const earliestStart = Math.max(
          prevStageReady,
          windowStart,
          bcfGate
        );

        // POOL pick: probe every reactor in the pool with a single-reactor
        // findTrainSlot call, then choose the one that becomes free earliest.
        // Each call respects per-reactor PCO + 30-day campaign rules.
        let bestStart = Infinity;
        let bestReactor = stage.reactorPool[0];
        let bestKind: "none" | "pco" | "campaign" = "none";
        for (const rid of stage.reactorPool) {
          const probe = findTrainSlot(
            [rid],
            earliestStart,
            cycleMs,
            api.id,
            stage.id,
            pcoMs
          );
          if (probe.startMs < bestStart) {
            bestStart = probe.startMs;
            bestReactor = rid;
            bestKind = probe.cleaningKind;
          }
        }

        const startMs = bestStart;
        const cleaningKind = bestKind;
        const cycleEndMs = startMs + cycleMs;
        const analysisEndMs = cycleEndMs + analysisMs;

        // Defensive clash check on the chosen reactor only.
        let clash = false;
        const chosenSlots = reactorBookings.get(bestReactor)!;
        for (const s of chosenSlots) {
          if (s.cycleEndMs <= startMs) continue;
          if (s.startMs >= cycleEndMs) break;
          clash = true;
          break;
        }
        if (clash) clashCount++;

        // Book the slot on the chosen reactor (only).
        const campaignStartMs = deriveCampaignStart(
          chosenSlots,
          startMs,
          api.id,
          stage.id
        );
        const newSlot: BookedSlot = {
          startMs,
          endMs: analysisEndMs,
          cycleEndMs,
          nextSameCampaignStartMs: startMs + bcfMs,
          apiId: api.id,
          stageId: stage.id,
          pcoMs,
          campaignStartMs,
        };
        insertSorted(chosenSlots, newSlot);
        const bctHrs =
          typeof stage.bctHours === "number" && stage.bctHours > 0
            ? stage.bctHours
            : stage.bcfHours;
        reactorLoadHours.set(
          bestReactor,
          (reactorLoadHours.get(bestReactor) ?? 0) + bctHrs
        );
        reactorBatchCount.set(
          bestReactor,
          (reactorBatchCount.get(bestReactor) ?? 0) + 1
        );

        apiStageLastEnd.get(api.id)![sIdx] = Math.max(
          apiStageLastEnd.get(api.id)![sIdx],
          analysisEndMs
        );
        stageLastBatchStart.set(stage.id, startMs);

        const cleaningBeforeMs = cleaningKind === "none" ? 0 : pcoMs;

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
          // Single-reactor list (pool model) — kept as array for API compat.
          reactorIds: [bestReactor],
          startMs,
          endMs: cycleEndMs,
          analysisEndMs,
          inFY: startMs >= windowStart && cycleEndMs <= windowEnd,
          clash,
          outputKg: stage.batchSizeKg,
          inputKg:
            typeof stage.inputKgPerBatch === "number" &&
            stage.inputKgPerBatch > 0
              ? stage.inputKgPerBatch
              : stage.batchSizeKg,
          cleaningBeforeMs,
          cleaningType: cleaningKind,
        };
        allBatches.push(entry);
      }
    }
  }

  allBatches.sort((a, b) => a.startMs - b.startMs);

  const reactorUsage: Record<string, { busyHours: number; batchCount: number }> = {};
  reactors.forEach((r) => (reactorUsage[r.id] = { busyHours: 0, batchCount: 0 }));
  allBatches.forEach((b) => {
    const bctHours = (b.endMs - b.startMs) / 3600000;
    b.reactorIds.forEach((rid) => {
      const u = reactorUsage[rid];
      if (!u) return;
      u.busyHours += bctHours;
      u.batchCount += 1;
    });
  });

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
        const weekEnd = weeks[wIdx].startMs + 7 * 24 * 3600 * 1000;
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

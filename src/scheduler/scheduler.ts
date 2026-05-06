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
}

/** Maximum continuous campaign duration before a forced campaign cleaning. */
const CAMPAIGN_MAX_MS = 30 * 24 * 3600 * 1000;

/**
 * Equipment-availability sequencer — TRAIN model + PCO + 30-day campaign cap.
 *
 * Each batch of a stage locks **every reactor in stage.reactorPool**
 * simultaneously for the cycle window [start, start + bcfHours]. Examples:
 *
 *   pool = [R101, R102, R103]      → batch 1 books all 3 reactors together
 *   10 batches with the same pool  → run strictly serially, BCF apart
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
 *   4. PCO: when a reactor switches from one (apiId, stageId) campaign to a
 *      different one, the new batch's start must be
 *      >= prev.cycleEnd + newStage.pcoHours.
 *   5. Campaign cap: even within the SAME campaign, a continuous run on a
 *      reactor cannot exceed 30 days. The 11th-or-later batch in a
 *      30-days-old campaign incurs a campaign-cleaning gap (= the stage's
 *      pcoHours) and resets the campaign clock. Treated as a PCO
 *      equivalent in terms of duration but tagged separately so the Gantt
 *      can colour it differently.
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
    return { kind: "none", earliestStart: Math.max(t, pred.cycleEndMs) };
  }

  /**
   * Find the EARLIEST time t >= earliest such that [t, t + cycleMs) is free
   * on every reactor in the pool simultaneously, INCLUDING any cleaning
   * gap required by predecessor or successor slots.
   *
   * Algorithm:
   *   - For each reactor in the train, compute the predecessor cleaning
   *     constraint via checkPredecessor and the successor PCO constraint.
   *   - If any constraint forces an advance, jump to the max required
   *     advance across all reactors and retry.
   *   - On success, return both the start time and the per-reactor
   *     cleaning kinds (we use the strongest cleaning kind across the
   *     train as the cleaning-type label for the batch — campaign > pco
   *     > none, since campaign and pco have the same duration but
   *     different semantics).
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

        const cycleMs = hoursToMs(stage.bcfHours);
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
        const earliestStart = Math.max(prevStageReady, windowStart);

        const { startMs, cleaningKind } = findTrainSlot(
          stage.reactorPool,
          earliestStart,
          cycleMs,
          api.id,
          stage.id,
          pcoMs
        );
        const cycleEndMs = startMs + cycleMs;
        const analysisEndMs = cycleEndMs + analysisMs;

        // Defensive clash check — verify the slot we found genuinely doesn't
        // overlap any existing booking on any pool reactor.
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

        // Book on every reactor in the train, computing each reactor's own
        // campaign start (they may differ if the train's reactors had
        // different campaign histories — which is rare but possible when
        // pools change over time).
        for (const rid of stage.reactorPool) {
          const slots = reactorBookings.get(rid)!;
          const campaignStartMs = deriveCampaignStart(
            slots,
            startMs,
            api.id,
            stage.id
          );
          const newSlot: BookedSlot = {
            startMs,
            endMs: analysisEndMs,
            cycleEndMs,
            apiId: api.id,
            stageId: stage.id,
            pcoMs,
            campaignStartMs,
          };
          insertSorted(slots, newSlot);
          reactorLoadHours.set(
            rid,
            (reactorLoadHours.get(rid) ?? 0) + stage.bcfHours
          );
          reactorBatchCount.set(rid, (reactorBatchCount.get(rid) ?? 0) + 1);
        }

        apiStageLastEnd.get(api.id)![sIdx] = Math.max(
          apiStageLastEnd.get(api.id)![sIdx],
          analysisEndMs
        );

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
          reactorId: stage.reactorPool[0],
          reactorIds: stage.reactorPool.slice(),
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

import type {
  API,
  BatchScheduleEntry,
  PlanWindow,
  Reactor,
  ScheduleResult,
  StageMaster,
} from "../types";
import {
  FY_END_MS,
  FY_START_MS,
  computeWeeks,
  hoursToMs,
  weekIndexIn,
} from "../utils/dates";
import { topologicalStageOrder } from "../utils/validation";

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
 * PCO-minimisation: how far into the future we push a candidate batch when
 * it would cause a PCO on a reactor whose current campaign still has batches
 * remaining. 90 days is large enough that the scheduler always prefers to
 * finish the active campaign first. If the active campaign is genuinely blocked
 * for longer than this horizon, the switch is allowed (preventing starvation).
 */
const CAMPAIGN_SWITCH_PENALTY_MS = 90 * 24 * 3600 * 1000;

/**
 * Equipment-availability sequencer — POOL model + PCO + 30-day campaign cap.
 *
 * Each batch uses ONE reactor at a time. `stage.reactorPool` is the list of
 * primary (booked) reactors; the scheduler picks whichever one becomes free
 * earliest at the candidate start time.
 *
 * SUBSTITUTION RULE (BMR-defined): against each primary reactor the user may
 * list optional substitute reactors in `stage.reactorSubstitutes` (entered in
 * the Stages tab). When the primary is busy, substitutes are tried in the
 * order listed. Substitution requires the optional reactor to be available at
 * scheduling time. No automatic spec-matching (capacity / MOC / agitator) is
 * applied — the user takes responsibility for suitability.
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
 *   2. Input-material gate (cumulative mass balance): to start batch K of a
 *      stage S, EACH predecessor in `inputStageIds` must have accumulated
 *      enough APPROVED output — cumulative ≥ K × S.inputKgPerBatch — where
 *      "approved" means the predecessor batch's analysis (QC) window has
 *      ended. One large upstream batch can feed several downstream batches,
 *      or several upstream batches accumulate to feed one. This replaces the
 *      old 1:1 "batch B waits for predecessor batch B" rule and is why the
 *      engine uses LIST SCHEDULING (book whichever ready batch starts
 *      earliest) instead of a fixed round-robin: a downstream batch is never
 *      placed before the upstream batches that supply it.
 *   3. Sequence ordering: when two ready batches could start at the same
 *      time, ties break by `api.productionSequence` (lower = earlier) so the
 *      planner runs API campaigns on a shared cleanroom in the user-defined
 *      order, then by API id + topological order. APIs without an explicit
 *      sequence keep the legacy id-alphabetical order.
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
  // Per-API plan windows are authoritative now; the project-level planWindow
  // arg is used only to anchor the weekly-occupancy heatmap range. We derive
  // it from min(start)/max(end) across API windows, falling back to FY.
  const apiStartMs = (a: API): number =>
    a.window && Number.isFinite(a.window.startMs)
      ? a.window.startMs
      : FY_START_MS;
  const apiEndMs = (a: API): number =>
    a.window && Number.isFinite(a.window.endMs)
      ? a.window.endMs
      : FY_END_MS;
  const projectStart =
    planWindow && Number.isFinite(planWindow.startMs)
      ? planWindow.startMs
      : apis.length > 0
      ? Math.min(...apis.map(apiStartMs))
      : FY_START_MS;
  const projectEnd =
    planWindow && Number.isFinite(planWindow.endMs)
      ? planWindow.endMs
      : apis.length > 0
      ? Math.max(...apis.map(apiEndMs))
      : FY_END_MS;
  // Used by the weekly occupancy heatmap (not authoritative for inFY).
  const windowStart = projectStart;
  const windowEnd = projectEnd;
  // ─ BMR substitute expansion ──────────────────────────────────────────────
  // Build the effective candidate pool for a stage:
  //   primary_1, sub_1a, sub_1b, …, primary_2, sub_2a, …
  // Substitutes are the user-defined ordered list from stage.reactorSubstitutes.
  // No automatic spec-matching. Reactors absent from the master list are
  // skipped silently (guards against stale IDs after reactor deletions).
  const reactorById = new Map(reactors.map((r) => [r.id, r]));
  function expandPool(
    explicit: string[],
    substitutes: Record<string, string[]> | undefined
  ): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const rid of explicit) {
      if (!reactorById.has(rid)) continue;
      if (!seen.has(rid)) {
        seen.add(rid);
        out.push(rid); // primary always comes first
      }
      const subs = substitutes?.[rid] ?? [];
      for (const sub of subs) {
        if (!reactorById.has(sub)) continue; // unknown reactor — skip
        if (!seen.has(sub)) {
          seen.add(sub);
          out.push(sub); // substitute in declared priority order
        }
      }
    }
    return out;
  }

  const reactorBookings = new Map<string, BookedSlot[]>();
  const reactorLoadHours = new Map<string, number>();
  const reactorBatchCount = new Map<string, number>();
  reactors.forEach((r) => {
    reactorBookings.set(r.id, []);
    reactorLoadHours.set(r.id, 0);
    reactorBatchCount.set(r.id, 0);
  });

  /**
   * Last committed (apiId, stageId) campaign per reactor.
   * Used by the PCO-minimisation heuristic: when a candidate batch would
   * cause a PCO on a reactor whose current campaign still has batches
   * remaining, its effective start is inflated by CAMPAIGN_SWITCH_PENALTY_MS
   * so the scheduler finishes the active campaign before switching.
   */
  const reactorActiveCampaign = new Map<
    string,
    { apiId: string; stageId: string } | null
  >(reactors.map((r) => [r.id, null]));

  // ─ Maintenance windows ───────────────────────────────────────────────────
  // Pre-compute unavailability windows per reactor:
  //   1. PM windows: every 90 days from pmFirstDateMs, lasting pmDurationDays.
  //   2. Building maintenance (Cleanroom reactors only): every 90 days from
  //      buildingMaintenanceFirstDateMs, lasting 2 days (the reactor is in a
  //      cleanroom whose building maintenance blocks it).
  // Windows are sorted by startMs for efficient scan.
  interface MaintWindow { startMs: number; endMs: number; }
  const PM_INTERVAL_MS = 90 * 24 * 3600 * 1000;
  const BM_DURATION_MS = 2 * 24 * 3600 * 1000;

  function buildPeriodicWindows(
    firstMs: number,
    durationMs: number,
    rangeStart: number,
    rangeEnd: number
  ): MaintWindow[] {
    const out: MaintWindow[] = [];
    // Find first occurrence that could intersect [rangeStart, rangeEnd]
    let t = firstMs;
    if (t + durationMs <= rangeStart) {
      const skip = Math.floor((rangeStart - (t + durationMs)) / PM_INTERVAL_MS);
      t += (skip + 1) * PM_INTERVAL_MS;
    }
    while (t < rangeEnd) {
      out.push({ startMs: t, endMs: t + durationMs });
      t += PM_INTERVAL_MS;
    }
    return out;
  }

  const reactorMaintWindows = new Map<string, MaintWindow[]>();
  // First pass: PM windows per reactor
  reactors.forEach((r) => {
    const windows: MaintWindow[] = [];
    if (r.pmFirstDateMs != null && Number.isFinite(r.pmFirstDateMs)) {
      const durMs = (r.pmDurationDays ?? 7) * 24 * 3600 * 1000;
      windows.push(...buildPeriodicWindows(r.pmFirstDateMs, durMs, windowStart, windowEnd + durMs));
    }
    reactorMaintWindows.set(r.id, windows);
  });

  // Second pass: building maintenance for Cleanroom reactors.
  // The building maintenance date is stored per-reactor but represents the
  // block-level schedule — only the FIRST Cleanroom reactor in a block that
  // has a date set is used to generate the windows for all reactors in that block.
  const blockBmWindows = new Map<string, MaintWindow[]>();
  reactors.forEach((r) => {
    if (r.reactorClass !== "CL") return;
    if (!r.productionBlock || !r.buildingMaintenanceFirstDateMs) return;
    if (blockBmWindows.has(r.productionBlock)) return; // already computed
    blockBmWindows.set(
      r.productionBlock,
      buildPeriodicWindows(r.buildingMaintenanceFirstDateMs, BM_DURATION_MS, windowStart, windowEnd + BM_DURATION_MS)
    );
  });

  // Merge building maintenance windows into Cleanroom reactors
  reactors.forEach((r) => {
    if (r.reactorClass !== "CL" || !r.productionBlock) return;
    const bmWins = blockBmWindows.get(r.productionBlock);
    if (!bmWins || bmWins.length === 0) return;
    const existing = reactorMaintWindows.get(r.id) ?? [];
    // Merge and sort by startMs
    const merged = [...existing, ...bmWins].sort((a, b) => a.startMs - b.startMs);
    reactorMaintWindows.set(r.id, merged);
  });

  // Inter-stage transfer buffer between consecutive stages of the SAME
  // batch. Set to 0 for the user's pipeline spec where stage N+1's slot
  // starts exactly at stage N's slot end. (Was 4h previously to model
  // material transfer + QC release; users who want that can set the
  // upstream stage's analysisHours instead, which is per-stage configurable.)
  const INTER_STAGE_BUFFER_HOURS = 0;

  const allBatches: BatchScheduleEntry[] = [];
  let clashCount = 0;

  // Priority sort dropped — APIs are processed in stable id-alphabetical
  // order. Round-robin across APIs ensures fair scheduling.
  const apisInOrder = [...apis].sort((a, b) => a.id.localeCompare(b.id));

  // Topological order of stages PER API. Falls back to stageNo order if
  // the DAG is cyclic (validation surfaces that elsewhere; the scheduler
  // never crashes). For a clean linear chain this is identical to the
  // old `[...api.stages].sort((a,b) => a.stageNo - b.stageNo)`.
  const apiTopoStages = new Map<string, StageMaster[]>();
  apis.forEach((a) => {
    const byId = new Map(a.stages.map((s) => [s.id, s]));
    const ordered = topologicalStageOrder(a.stages)
      .map((id) => byId.get(id))
      .filter((s): s is StageMaster => !!s);
    apiTopoStages.set(a.id, ordered);
  });

  // ─ Sequence + predecessor lookups (for the per-round work-item sort) ──
  // stageById: any stage by id. predStagesById: each stage's same-API
  // predecessor stage objects (resolved from inputStageIds). sequenceOf:
  // the user-defined per-API production sequence (set in the APIs tab), or a
  // sentinel that sorts last so unsequenced APIs keep the legacy id order.
  const stageById = new Map<string, StageMaster>();
  apis.forEach((a) => a.stages.forEach((s) => stageById.set(s.id, s)));
  const predStagesById = new Map<string, StageMaster[]>();
  apis.forEach((a) =>
    a.stages.forEach((s) => {
      const preds = (Array.isArray(s.inputStageIds) ? s.inputStageIds : [])
        .map((id) => stageById.get(id))
        .filter((x): x is StageMaster => !!x);
      predStagesById.set(s.id, preds);
    })
  );
  const NO_SEQUENCE = Number.MAX_SAFE_INTEGER;
  const sequenceOf = (api: API): number =>
    typeof api.productionSequence === "number" &&
    Number.isFinite(api.productionSequence)
      ? api.productionSequence
      : NO_SEQUENCE;
  const apiIndexById = new Map(apisInOrder.map((a, i) => [a.id, i]));

  // Per-stage APPROVED-output timeline: each stage's booked-batch analysisEnd
  // (= QC-done) times, kept SORTED ascending. The material gate reads the
  // m-th element to learn when cumulative approved output crosses a threshold
  // (see materialReadyTime). Sorted insert happens in commitBatch.
  const stageBatchAnalysisEnds = new Map<string, number[]>();
  apis.forEach((a) =>
    a.stages.forEach((s) => stageBatchAnalysisEnds.set(s.id, []))
  );

  // Per-stage placement counts per quarter [Q0..Q3] for the soft per-quarter
  // cap (≈ planned/4 each). Incremented in commitBatch, read in recompute.
  const stageQuarterlyBooked = new Map<string, number[]>();
  apis.forEach((a) =>
    a.stages.forEach((s) => stageQuarterlyBooked.set(s.id, [0, 0, 0, 0]))
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
    const maintLookups = pool.map((rid) => reactorMaintWindows.get(rid) ?? []);

    for (let safety = 0; safety < 5000; safety++) {
      let advance = t;
      let needAdvance = false;

      for (let ri = 0; ri < lookups.length; ri++) {
        const slots = lookups[ri];
        const maintWins = maintLookups[ri];

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

        // Maintenance window check: skip any window that overlaps [t, t+cycleMs)
        for (const mw of maintWins) {
          if (mw.endMs <= t) continue;
          if (mw.startMs >= t + cycleMs) break;
          // Overlaps — push past this window
          if (mw.endMs > advance) advance = mw.endMs;
          needAdvance = true;
          break;
        }
        if (advance > t) continue; // already flagged a conflict above

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

  type CleanKind = "none" | "pco" | "campaign";

  // ─ Per-stage scheduling runtime ──────────────────────────────────────────
  // One record per schedulable stage. `booked` advances as batches are placed.
  // Hour fields are pre-converted to ms once. `effectivePool` already folds in
  // the BMR substitutes. Stages with 0 planned batches or an empty pool are
  // dropped here (they can never be booked).
  interface StageRT {
    api: API;
    stage: StageMaster;
    topoIndex: number;
    planned: number;
    booked: number;
    bctMs: number;
    bcfMs: number;
    cycleMs: number;
    analysisMs: number;
    pcoMs: number;
    inputPerBatch: number;
    effectivePool: string[];
    apiStart: number;
    apiEnd: number;
  }

  const bufferMs = hoursToMs(INTER_STAGE_BUFFER_HOURS);
  const stageRTs: StageRT[] = [];
  for (const api of apisInOrder) {
    const apiStart = apiStartMs(api);
    const apiEnd = apiEndMs(api);
    const stagesInOrder = apiTopoStages.get(api.id) ?? api.stages;
    stagesInOrder.forEach((stage, topoIndex) => {
      const planned = stage.plannedBatches;
      if (planned <= 0) return;
      const effectivePool = expandPool(
        stage.reactorPool,
        stage.reactorSubstitutes
      );
      if (effectivePool.length === 0) return;
      const bctMs = hoursToMs(
        typeof stage.bctHours === "number" && stage.bctHours > 0
          ? stage.bctHours
          : stage.bcfHours
      );
      stageRTs.push({
        api,
        stage,
        topoIndex,
        planned,
        booked: 0,
        bctMs,
        bcfMs: hoursToMs(stage.bcfHours),
        cycleMs: bctMs,
        analysisMs: hoursToMs(stage.analysisHours),
        pcoMs: hoursToMs(
          typeof stage.pcoHours === "number" && stage.pcoHours >= 0
            ? stage.pcoHours
            : 0
        ),
        inputPerBatch:
          typeof stage.inputKgPerBatch === "number" &&
          stage.inputKgPerBatch > 0
            ? stage.inputKgPerBatch
            : stage.batchSizeKg,
        effectivePool,
        apiStart,
        apiEnd,
      });
    });
  }

  // MATERIAL GATE — cumulative mass balance.
  // To start batch K (= booked + 1) of a stage, EACH predecessor must have
  // accumulated enough APPROVED output: cumulative ≥ K × inputPerBatch.
  // "Approved" = the predecessor batch's analysisEnd has been reached (QC
  // done). Each predecessor batch contributes its stage's batchSizeKg, so the
  // number of predecessor batches needed is m = ⌈required / predOutputPerBatch⌉
  // and the gate is that predecessor's m-th approved analysisEnd. The arrays
  // in `stageBatchAnalysisEnds` are kept sorted ascending so element m-1 is the
  // m-th approval time.
  //   • returns the latest material-ready time across predecessors, or
  //   • null when a predecessor hasn't booked m batches YET (book it first), or
  //   • (fallback mode) the predecessor's LAST approval when it can never
  //     supply m batches — avoids a deadlock on a cascade-rounding shortfall.
  const materialReadyTime = (rt: StageRT, fallback: boolean): number | null => {
    const preds = predStagesById.get(rt.stage.id) ?? [];
    if (preds.length === 0) return rt.apiStart;
    const K = rt.booked + 1;
    const required = K * rt.inputPerBatch;
    let matTime = rt.apiStart;
    for (const P of preds) {
      const outPer =
        typeof P.batchSizeKg === "number" && P.batchSizeKg > 0
          ? P.batchSizeKg
          : 1;
      const m = Math.max(1, Math.ceil(required / outPer));
      const ends = stageBatchAnalysisEnds.get(P.id) ?? [];
      if (ends.length < m) {
        if (!fallback) return null; // wait until predecessor books more
        if (ends.length === 0) continue; // nothing yet — leave at apiStart
        const last = ends[ends.length - 1];
        if (last > matTime) matTime = last;
        continue;
      }
      const perP = ends[m - 1];
      if (perP > matTime) matTime = perP;
    }
    return matTime;
  };

  // Probe the stage's effective pool for the earliest feasible slot ≥ earliest,
  // honouring reactor occupancy + PCO/campaign cleaning + maintenance. Pure —
  // does not mutate any booking state.
  const findBestSlot = (
    rt: StageRT,
    earliest: number
  ): { startMs: number; reactor: string; cleaningKind: CleanKind } => {
    let bestStart = Infinity;
    let bestReactor = rt.effectivePool[0] ?? rt.stage.reactorPool[0];
    let bestKind: CleanKind = "none";
    for (const rid of rt.effectivePool) {
      const probe = findTrainSlot(
        [rid],
        earliest,
        rt.cycleMs,
        rt.api.id,
        rt.stage.id,
        rt.pcoMs
      );
      if (probe.startMs < bestStart) {
        bestStart = probe.startMs;
        bestReactor = rid;
        bestKind = probe.cleaningKind;
      }
    }
    return { startMs: bestStart, reactor: bestReactor, cleaningKind: bestKind };
  };

  // Commit a batch: book the reactor slot, update load/usage counters, record
  // the (sorted) approval time + last start, and emit the BatchScheduleEntry.
  const commitBatch = (
    rt: StageRT,
    slot: { startMs: number; reactor: string; cleaningKind: CleanKind }
  ): void => {
    const { api, stage } = rt;
    const startMs = slot.startMs;
    const bestReactor = slot.reactor;
    const cleaningKind = slot.cleaningKind;
    const cycleEndMs = startMs + rt.cycleMs;
    const analysisEndMs = cycleEndMs + rt.analysisMs;
    const batchNo = rt.booked + 1;

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
      nextSameCampaignStartMs: startMs + rt.bcfMs,
      apiId: api.id,
      stageId: stage.id,
      pcoMs: rt.pcoMs,
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

    // Sorted insert of this batch's approval time so the material gate can
    // read the m-th approval in O(1).
    const ends = stageBatchAnalysisEnds.get(stage.id)!;
    let qi = ends.length;
    while (qi > 0 && ends[qi - 1] > analysisEndMs) qi--;
    ends.splice(qi, 0, analysisEndMs);
    stageLastBatchStart.set(stage.id, startMs);

    // Tally this placement into its quarter bucket (soft per-quarter cap).
    const qLenC = (rt.apiEnd - rt.apiStart) / 4;
    const qIdxC =
      qLenC > 0
        ? Math.max(0, Math.min(3, Math.floor((startMs - rt.apiStart) / qLenC)))
        : 0;
    const qArrC = stageQuarterlyBooked.get(stage.id);
    if (qArrC) qArrC[qIdxC]++;

    const cleaningBeforeMs = cleaningKind === "none" ? 0 : rt.pcoMs;
    allBatches.push({
      batchId: `${stage.stageName.replace(/\s+/g, "")}#${String(batchNo).padStart(3, "0")}`,
      apiId: api.id,
      apiName: api.name,
      apiColor: api.color,
      stageId: stage.id,
      stageNo: stage.stageNo,
      stageName: stage.stageName,
      batchNo,
      reactorId: bestReactor,
      reactorIds: [bestReactor],
      startMs,
      endMs: cycleEndMs,
      analysisEndMs,
      inFY: startMs >= rt.apiStart && cycleEndMs <= rt.apiEnd,
      clash,
      outputKg: stage.batchSizeKg,
      inputKg: rt.inputPerBatch,
      cleaningBeforeMs,
      cleaningType: cleaningKind,
    });
    rt.booked++;
    // Track the active campaign on this reactor for PCO-minimisation.
    reactorActiveCampaign.set(bestReactor, { apiId: api.id, stageId: stage.id });
  };

  // Tie-break between two equally-early candidates: user priority first
  // (lower = earlier), then API order, then topological order, then id. This
  // is where the cleanroom Q-Plan priority and the legacy ordering apply.
  const aWins = (a: StageRT, b: StageRT): boolean => {
    const sa = sequenceOf(a.api);
    const sb = sequenceOf(b.api);
    if (sa !== sb) return sa < sb;
    const ia = apiIndexById.get(a.api.id) ?? 0;
    const ib = apiIndexById.get(b.api.id) ?? 0;
    if (ia !== ib) return ia < ib;
    if (a.topoIndex !== b.topoIndex) return a.topoIndex < b.topoIndex;
    return a.stage.id < b.stage.id;
  };

  const bcfGateOf = (rt: StageRT): number => {
    const prev = stageLastBatchStart.get(rt.stage.id);
    return prev !== undefined ? prev + rt.bcfMs : -Infinity;
  };

  // ─ Quarterly distribution (backward integration from API quantities) ───────
  // Each stage's planned batches are spread roughly evenly across the API's
  // four quarters (≈ planned/4 per quarter) so every API stays "live" in a
  // shared cleanroom every quarter instead of one API monopolising a quarter.
  //
  // This is enforced as a SOFT CAP, not a hard floor: a batch may start as
  // early as the reactor frees (right after the previous batch's PROCESS end
  // + PCO — analysis runs in parallel off-reactor and never gates reactor
  // reuse). A batch is deferred to a later quarter ONLY when its quarter has
  // already taken its ≈ planned/4 share. This keeps the reactor busy and never
  // idles it at a quarter boundary when there is still capacity in the current
  // quarter.
  //
  //   perQuarterLimit = ⌈ planned / 4 ⌉
  const perQuarterLimitOf = (rt: StageRT): number =>
    Math.max(1, Math.ceil(rt.planned / 4));

  const quarterLenOf = (rt: StageRT): number => {
    const span = rt.apiEnd - rt.apiStart;
    return span > 0 ? span / 4 : 0;
  };

  /** Quarter index (0..3) that a timestamp falls in within rt's API window. */
  const quarterOfTime = (rt: StageRT, ms: number): number => {
    const qLen = quarterLenOf(rt);
    if (qLen <= 0) return 0;
    return Math.max(0, Math.min(3, Math.floor((ms - rt.apiStart) / qLen)));
  };

  type Cand = { startMs: number; reactor: string; cleaningKind: CleanKind } | null;

  // Invalidation indexes: which stages must be re-probed when a reactor is
  // booked (pool sharers) or when a stage produces another approved batch
  // (its successors may newly clear their material gate).
  const rtByStageId = new Map(stageRTs.map((rt) => [rt.stage.id, rt]));
  const sharersOfReactor = new Map<string, StageRT[]>();
  const successorsOfStage = new Map<string, StageRT[]>();
  for (const rt of stageRTs) {
    for (const rid of rt.effectivePool) {
      const arr = sharersOfReactor.get(rid);
      if (arr) arr.push(rt);
      else sharersOfReactor.set(rid, [rt]);
    }
    for (const P of predStagesById.get(rt.stage.id) ?? []) {
      const arr = successorsOfStage.get(P.id);
      if (arr) arr.push(rt);
      else successorsOfStage.set(P.id, [rt]);
    }
  }

  // Cached earliest-start candidate per stage. `dirty` holds stage ids whose
  // candidate must be recomputed before the next pick.
  const cand = new Map<string, Cand>();
  const dirty = new Set<string>(stageRTs.map((rt) => rt.stage.id));

  const recompute = (rt: StageRT): void => {
    if (rt.booked >= rt.planned) {
      cand.set(rt.stage.id, null);
      return;
    }
    const matTime = materialReadyTime(rt, false);
    if (matTime === null) {
      cand.set(rt.stage.id, null);
      return;
    }
    let earliest = Math.max(matTime + bufferMs, rt.apiStart, bcfGateOf(rt));
    let slot = findBestSlot(rt, earliest);
    // Soft per-quarter cap. If the chosen slot lands in a quarter that has
    // already taken its ≈ planned/4 share for this stage, defer to the start
    // of the earliest later quarter that still has room. While the current
    // quarter has capacity the batch starts as soon as the reactor frees, so
    // the reactor is never idled at a quarter boundary.
    const limit = perQuarterLimitOf(rt);
    const qBooked = stageQuarterlyBooked.get(rt.stage.id) ?? [0, 0, 0, 0];
    for (let g = 0; g < 4; g++) {
      const q = quarterOfTime(rt, slot.startMs);
      if (qBooked[q] < limit) break; // room in this quarter
      let nq = q + 1;
      while (nq < 4 && qBooked[nq] >= limit) nq++;
      if (nq > 3) break; // no later capacity — allow placement anyway
      const nqStart = rt.apiStart + nq * quarterLenOf(rt);
      if (nqStart <= earliest) break; // can't push further — avoid spinning
      earliest = nqStart;
      slot = findBestSlot(rt, earliest);
    }
    cand.set(rt.stage.id, slot);
  };

  // Commit a placement, then invalidate exactly the stages whose earliest
  // start could have changed: this stage (next batch), every stage that can
  // use the just-booked reactor, and any previously-unready successor.
  const place = (
    rt: StageRT,
    slot: { startMs: number; reactor: string; cleaningKind: CleanKind }
  ): void => {
    const stageId = rt.stage.id;
    commitBatch(rt, slot);
    dirty.add(stageId);
    for (const other of sharersOfReactor.get(slot.reactor) ?? [])
      dirty.add(other.stage.id);
    for (const succ of successorsOfStage.get(stageId) ?? [])
      if (cand.get(succ.stage.id) == null) dirty.add(succ.stage.id);
  };

  // ─ PCO-minimisation helper ────────────────────────────────────────────────
  /**
   * Returns the "effective" start time used for candidate comparison.
   *
   * If the candidate batch would cause a PCO (`cleaningKind === "pco"`) on
   * the chosen reactor, AND that reactor's currently active campaign still has
   * batches remaining, we inflate the effective start by
   * CAMPAIGN_SWITCH_PENALTY_MS. This makes the scheduler strongly prefer
   * continuing the active campaign (no PCO) over starting a new one
   * (PCO), naturally serialising campaigns on shared reactors and minimising
   * the total number of PCOs. If the active campaign is genuinely blocked for
   * longer than the penalty window, the switch proceeds normally to prevent
   * starvation.
   */
  const effectiveStartOf = (rt: StageRT, c: NonNullable<Cand>): number => {
    if (c.cleaningKind !== "pco") return c.startMs;
    const active = reactorActiveCampaign.get(c.reactor);
    if (!active) return c.startMs;
    if (active.apiId === rt.api.id && active.stageId === rt.stage.id)
      return c.startMs; // same campaign — no penalty
    // Different campaign: penalise the switch ONLY if the active campaign still
    // owes batches in THIS quarter (or an earlier one). Once it has filled its
    // quarterly quota, the remaining batches belong to later quarters and must
    // NOT block another API's current-quarter campaign — otherwise a single API
    // would monopolise the shared cleanroom. This is the quarter-aware fix for
    // the old "annual remaining" check that starved later campaigns.
    const candQ = quarterOfTime(rt, c.startMs);
    const hasRemainingThisQuarter = stageRTs.some((srt) => {
      if (srt.api.id !== active.apiId || srt.stage.id !== active.stageId)
        return false;
      if (srt.booked >= srt.planned) return false;
      // Earliest quarter the active campaign can still place a batch in, given
      // the soft per-quarter cap (greedy fills the lowest open quarter first).
      // If that quarter is the candidate's quarter or earlier, the active
      // campaign still owes work here → keep it consolidated (penalise the
      // switch). Once its current-quarter quota is met, the switch is free.
      const aLimit = perQuarterLimitOf(srt);
      const aBooked = stageQuarterlyBooked.get(srt.stage.id) ?? [0, 0, 0, 0];
      let aNextQ = 0;
      while (aNextQ < 3 && aBooked[aNextQ] >= aLimit) aNextQ++;
      return aNextQ <= candQ;
    });
    return hasRemainingThisQuarter
      ? c.startMs + CAMPAIGN_SWITCH_PENALTY_MS
      : c.startMs;
  };

  // ─ List-scheduling main loop ───────────────────────────────────────────
  // Repeatedly book whichever ready batch can start earliest. "Ready" = its
  // material gate is satisfiable from already-approved upstream output. This
  // replaces the old round-robin so a downstream batch is never placed before
  // the upstream batches that feed it have been scheduled.
  let remainingBatches = stageRTs.reduce((n, rt) => n + rt.planned, 0);
  const guardMax = remainingBatches + stageRTs.length + 10;
  let guard = 0;
  while (remainingBatches > 0 && guard++ < guardMax) {
    for (const sid of dirty) {
      const rt = rtByStageId.get(sid);
      if (rt) recompute(rt);
    }
    dirty.clear();

    let best: Cand = null;
    let bestRt: StageRT | null = null;
    let bestEff = Infinity;
    for (const rt of stageRTs) {
      if (rt.booked >= rt.planned) continue;
      const c = cand.get(rt.stage.id);
      if (!c) continue;
      // Use campaign-penalty-adjusted effective start for comparison so the
      // scheduler finishes the active campaign before switching to a new one.
      const cEff = effectiveStartOf(rt, c);
      if (
        best === null ||
        cEff < bestEff ||
        (cEff === bestEff && bestRt !== null && aWins(rt, bestRt))
      ) {
        best = c;
        bestRt = rt;
        bestEff = cEff;
      }
    }

    if (best === null || bestRt === null) {
      // No stage is materially ready — upstream genuinely can't supply enough
      // (usually a cascade-rounding shortfall). Force progress on the
      // best-ranked unbooked stage, gated on its predecessors' LAST approval.
      let fb: StageRT | null = null;
      for (const rt of stageRTs) {
        if (rt.booked >= rt.planned) continue;
        if (fb === null || aWins(rt, fb)) fb = rt;
      }
      if (!fb) break;
      const matTime = materialReadyTime(fb, true) ?? fb.apiStart;
      const earliest = Math.max(matTime + bufferMs, fb.apiStart, bcfGateOf(fb));
      place(fb, findBestSlot(fb, earliest));
      remainingBatches--;
      continue;
    }

    place(bestRt, best);
    remainingBatches--;
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

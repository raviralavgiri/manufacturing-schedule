/**
 * Quarterly batch-distribution analyser for pharma production planning.
 *
 * Indian pharma FY: Apr 1 – Mar 31
 *   Q1 = Apr · May · Jun
 *   Q2 = Jul · Aug · Sep
 *   Q3 = Oct · Nov · Dec
 *   Q4 = Jan · Feb · Mar
 *
 * Pure utility — no React, no store access.
 */
import type { API, BatchScheduleEntry, Reactor } from "../types";
import { FY_START_MS } from "../utils/dates";

// ─── Calendar quarter types ───────────────────────────────────────────────────

export type QLabel = "Q1" | "Q2" | "Q3" | "Q4";
export const QLABELS: QLabel[] = ["Q1", "Q2", "Q3", "Q4"];

export interface CalendarQuarter {
  label: QLabel;
  /** Short display name e.g. "Q1 Apr–Jun" */
  name: string;
  /** "Apr · May · Jun" */
  months: string;
  /** Inclusive start (ms) */
  startMs: number;
  /** Exclusive end (ms) — first ms of the NEXT quarter */
  endMs: number;
  durationHours: number;
}

/**
 * Build 4 calendar quarters from the FY start date (April 1).
 * Safe to call with any FY year — year is extracted from fyStartMs.
 */
export function buildFYQuarters(fyStartMs: number = FY_START_MS): CalendarQuarter[] {
  const d = new Date(fyStartMs);
  const y = d.getFullYear(); // e.g. 2026

  function startOf(year: number, month0: number): number {
    return new Date(year, month0, 1, 0, 0, 0, 0).getTime();
  }

  const defs = [
    { label: "Q1" as QLabel, name: "Q1 Apr–Jun", months: "Apr · May · Jun", s: startOf(y, 3),     e: startOf(y, 6) },
    { label: "Q2" as QLabel, name: "Q2 Jul–Sep", months: "Jul · Aug · Sep", s: startOf(y, 6),     e: startOf(y, 9) },
    { label: "Q3" as QLabel, name: "Q3 Oct–Dec", months: "Oct · Nov · Dec", s: startOf(y, 9),     e: startOf(y + 1, 0) },
    { label: "Q4" as QLabel, name: "Q4 Jan–Mar", months: "Jan · Feb · Mar", s: startOf(y + 1, 0), e: startOf(y + 1, 3) },
  ] as const;

  return defs.map(b => ({
    label: b.label,
    name:  b.name,
    months: b.months,
    startMs: b.s,
    endMs:   b.e,
    durationHours: (b.e - b.s) / 3600000,
  }));
}

/** Which calendar quarter does a timestamp fall in? Returns null if outside all quarters. */
export function quarterLabelOf(ms: number, quarters: CalendarQuarter[]): QLabel | null {
  for (const q of quarters) {
    if (ms >= q.startMs && ms < q.endMs) return q.label;
  }
  return null;
}

// ─── Analysis result types ────────────────────────────────────────────────────

export interface ApiQuarterSummary {
  apiId: string;
  apiName: string;
  apiColor: string;
  window: { startMs: number; endMs: number };
  /** Total planned batches for the final (output) stage. */
  plannedBatches: number;
  /** Total target output in kg. */
  targetKg: number;
  /** Actual scheduled final-stage batches per quarter. */
  scheduledPerQ: Record<QLabel, number>;
  /**
   * Theoretical maximum final-stage batches per quarter, calculated as:
   *   floor(window∩quarter_hours / BCT) × poolSize
   * Represents achievable capacity if the scheduler could fill it perfectly.
   */
  maxPerQ: Record<QLabel, number>;
  /** Actual output kg produced per quarter. */
  outputKgPerQ: Record<QLabel, number>;
  /** Final-stage batches scheduled OUTSIDE the API's plan window. */
  overflowCount: number;
  /**
   * Distribution evenness 0–1 across quarters covered by the window.
   * 1.0 = perfectly uniform; 0.0 = all batches in one quarter.
   */
  evenness: number;
}

export interface ReactorQuarterLoad {
  reactorId: string;
  /** BCT hours booked per quarter (from all APIs). */
  bookedHoursPerQ: Record<QLabel, number>;
  /** Fraction of quarter hours booked (0..1+). */
  utilizationPerQ: Record<QLabel, number>;
}

export type SuggestionType =
  | "extend_window"
  | "shift_window"
  | "balance_load"
  | "increase_target";

export interface QuarterlySuggestion {
  id: string;
  severity: "critical" | "warning" | "info";
  type: SuggestionType;
  title: string;
  description: string;
  /** Short impact label shown on the badge, e.g. "+4 batches in Q2". */
  gain: string;
  /** If present, an Apply button is shown that fires setApiWindow(action). */
  action?: {
    apiId: string;
    newStartMs?: number;
    newEndMs?: number;
  };
}

export interface QuarterlyAnalysis {
  quarters: CalendarQuarter[];
  apiSummaries: ApiQuarterSummary[];
  reactorLoads: ReactorQuarterLoad[];
  /** Total batches (all stages) per quarter. */
  totalBatchesPerQ: Record<QLabel, number>;
  /** Avg reactor utilization (0..1) per quarter across all reactors. */
  reactorAvgUtilPerQ: Record<QLabel, number>;
  suggestions: QuarterlySuggestion[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function zeroQ<T>(val: T): Record<QLabel, T> {
  return { Q1: val, Q2: val, Q3: val, Q4: val } as Record<QLabel, T>;
}

// ─── Main analysis function ───────────────────────────────────────────────────

/**
 * Analyse an existing schedule result across calendar quarters.
 *
 * @param apis       The current project's API list.
 * @param reactors   The current reactor fleet.
 * @param batches    All scheduled batches from runScheduler().
 * @param fyStartMs  FY start date (default = Apr 1 2026). Used to derive quarters.
 */
export function analyzeQuarterly(
  apis: API[],
  reactors: Reactor[],
  batches: BatchScheduleEntry[],
  fyStartMs: number = FY_START_MS,
): QuarterlyAnalysis {
  const quarters = buildFYQuarters(fyStartMs);

  // ── 1. Per-API summary ────────────────────────────────────────────────────
  const apiSummaries: ApiQuarterSummary[] = apis.map(api => {
    // Identify the "output" stage — highest stageNo among all sink stages.
    // For a linear chain this is simply the last stage. For a convergent
    // topology (parallel or side-chains) it's the true final output stage.
    const sortedStages = [...api.stages].sort((a, b) => b.stageNo - a.stageNo);
    const finalStage = sortedStages[0];

    if (!finalStage) {
      return {
        apiId: api.id, apiName: api.name, apiColor: api.color,
        window: api.window, plannedBatches: 0, targetKg: api.targetKg,
        scheduledPerQ: zeroQ(0), maxPerQ: zeroQ(0), outputKgPerQ: zeroQ(0),
        overflowCount: 0, evenness: 0,
      };
    }

    // Count scheduled FINAL-stage batches per quarter (that's the API output)
    const finalBatches = batches.filter(b => b.stageId === finalStage.id);
    const scheduledPerQ = zeroQ(0);
    const outputKgPerQ  = zeroQ(0);
    let overflowCount = 0;

    for (const b of finalBatches) {
      if (!b.inFY) overflowCount++;
      const ql = quarterLabelOf(b.startMs, quarters);
      if (ql) {
        scheduledPerQ[ql]++;
        outputKgPerQ[ql] += b.outputKg;
      }
    }

    // Theoretical maximum final-stage batches per quarter
    const poolSize  = Math.max(1, finalStage.reactorPool.length);
    const bctHours  = Math.max(1, finalStage.bctHours || finalStage.bcfHours || 120);
    const maxPerQ   = zeroQ(0);

    for (const q of quarters) {
      const overlapStart = Math.max(api.window.startMs, q.startMs);
      const overlapEnd   = Math.min(api.window.endMs,   q.endMs);
      if (overlapEnd <= overlapStart) { maxPerQ[q.label] = 0; continue; }
      const overlapHrs = (overlapEnd - overlapStart) / 3600000;
      maxPerQ[q.label] = Math.floor(overlapHrs / bctHours) * poolSize;
    }

    // Evenness score: how evenly batches are spread across covered quarters
    const coveredQs  = QLABELS.filter(q => maxPerQ[q] > 0);
    let evenness = 1;
    if (coveredQs.length > 1) {
      const counts = coveredQs.map(q => scheduledPerQ[q]);
      const total  = counts.reduce((a, b) => a + b, 0);
      if (total > 0) {
        const ideal    = total / coveredQs.length;
        const variance = counts.reduce((acc, c) => acc + Math.abs(c - ideal), 0) / total;
        evenness = Math.max(0, 1 - variance);
      }
    }

    return {
      apiId: api.id,
      apiName: api.name,
      apiColor: api.color,
      window: api.window,
      plannedBatches: finalStage.plannedBatches,
      targetKg: api.targetKg,
      scheduledPerQ,
      maxPerQ,
      outputKgPerQ,
      overflowCount,
      evenness,
    };
  });

  // ── 2. Reactor loads per quarter ──────────────────────────────────────────
  const reactorLoads: ReactorQuarterLoad[] = reactors.map(reactor => {
    const rb = batches.filter(b => b.reactorId === reactor.id);
    const bookedHoursPerQ = zeroQ(0);

    for (const b of rb) {
      const ql = quarterLabelOf(b.startMs, quarters);
      if (!ql) continue;
      bookedHoursPerQ[ql] += (b.endMs - b.startMs) / 3600000;
    }

    const utilizationPerQ = zeroQ(0);
    for (const q of quarters) {
      utilizationPerQ[q.label] = bookedHoursPerQ[q.label] / q.durationHours;
    }

    return { reactorId: reactor.id, bookedHoursPerQ, utilizationPerQ };
  });

  // ── 3. Cross-reactor totals per quarter ───────────────────────────────────
  const totalBatchesPerQ = zeroQ(0);
  for (const b of batches) {
    const ql = quarterLabelOf(b.startMs, quarters);
    if (ql) totalBatchesPerQ[ql]++;
  }

  const reactorAvgUtilPerQ = zeroQ(0);
  if (reactorLoads.length > 0) {
    for (const ql of QLABELS) {
      reactorAvgUtilPerQ[ql] =
        reactorLoads.reduce((acc, r) => acc + r.utilizationPerQ[ql], 0) / reactorLoads.length;
    }
  }

  // ── 4. Generate suggestions ───────────────────────────────────────────────
  const suggestions: QuarterlySuggestion[] = [];
  let sid = 0;

  for (const summary of apiSummaries) {
    const api = apis.find(a => a.id === summary.apiId)!;
    const finalStage = [...api.stages].sort((a, b) => b.stageNo - a.stageNo)[0];
    if (!finalStage) continue;

    const bctMs = Math.max(1, finalStage.bctHours || 120) * 3600000;

    // ─ Overflow: batches scheduled beyond the plan window ───────────────────
    if (summary.overflowCount > 0) {
      const extraDays = Math.ceil(summary.overflowCount * bctMs / (24 * 3600000)) + 7;
      suggestions.push({
        id: `s${sid++}`,
        severity: "critical",
        type: "extend_window",
        title: `${summary.apiName}: ${summary.overflowCount} batch${summary.overflowCount > 1 ? "es" : ""} overflow`,
        description:
          `${summary.overflowCount} scheduled batch${summary.overflowCount > 1 ? "es" : ""} fall outside the plan window ` +
          `and won't be counted as in-plan production. Extend the end date by ≈${extraDays} days to capture them.`,
        gain: `+${summary.overflowCount} in-plan batch${summary.overflowCount > 1 ? "es" : ""}`,
        action: {
          apiId: summary.apiId,
          newEndMs: api.window.endMs + summary.overflowCount * bctMs + 7 * 24 * 3600000,
        },
      });
    }

    // ─ Uneven distribution: window covers multiple quarters but batches cluster ─
    const coveredQs = QLABELS.filter(q => summary.maxPerQ[q] > 0);
    if (coveredQs.length > 1 && summary.evenness < 0.45 && summary.plannedBatches >= 3) {
      const heavyQ = coveredQs.reduce((a, b) =>
        summary.scheduledPerQ[a] >= summary.scheduledPerQ[b] ? a : b
      );
      const lightQs = coveredQs.filter(
        q => q !== heavyQ && summary.scheduledPerQ[q] < summary.scheduledPerQ[heavyQ] * 0.6
      );
      if (lightQs.length > 0) {
        const lightQ = lightQs[0];
        const gap = summary.scheduledPerQ[heavyQ] - summary.scheduledPerQ[lightQ];
        suggestions.push({
          id: `s${sid++}`,
          severity: "warning",
          type: "balance_load",
          title: `${summary.apiName}: front-loaded — ${summary.scheduledPerQ[heavyQ]} in ${heavyQ}, ${summary.scheduledPerQ[lightQ]} in ${lightQ}`,
          description:
            `Production is concentrated in ${heavyQ} while ${lightQ} is underutilized, though the plan window covers both. ` +
            `This typically means the cascade places all batches early. Consider starting some batches later ` +
            `or splitting the API into two plan windows to force even distribution.`,
          gain: `Balance ~${Math.ceil(gap / 2)} batches into ${lightQ}`,
        });
      }
    }

    // ─ Unused capacity within window ────────────────────────────────────────
    for (const ql of QLABELS) {
      const max    = summary.maxPerQ[ql];
      const actual = summary.scheduledPerQ[ql];
      if (max > 2 && actual > 0 && actual < max * 0.5) {
        // Window covers this quarter and has batches, but far from capacity
        const extra = max - actual;
        suggestions.push({
          id: `s${sid++}`,
          severity: "info",
          type: "increase_target",
          title: `${summary.apiName} ${ql}: ${extra} more batch${extra > 1 ? "es" : ""} possible`,
          description:
            `Reactor capacity in ${ql} could support up to ${max} batches ` +
            `but only ${actual} ${actual === 1 ? "is" : "are"} planned. ` +
            `Increasing ${summary.apiName}'s target output (currently ${api.targetKg} kg) ` +
            `would deploy this idle capacity.`,
          gain: `Up to +${extra} batch${extra > 1 ? "es" : ""} in ${ql}`,
        });
      }
    }
  }

  // ─ Cross-API: reactor overloaded in one quarter, spare in another ─────────
  for (const ql of QLABELS) {
    const avgLoad = reactorAvgUtilPerQ[ql];
    if (avgLoad > 0.70) {
      const lighterQl = QLABELS.find(
        lq => lq !== ql && reactorAvgUtilPerQ[lq] < 0.40
      );
      if (lighterQl) {
        // Largest contributor to the heavy quarter
        const heaviestApi = apiSummaries
          .filter(s => s.scheduledPerQ[ql] > 0)
          .sort((a, b) => b.scheduledPerQ[ql] - a.scheduledPerQ[ql])[0];

        if (heaviestApi) {
          const targetQ = quarters.find(q => q.label === lighterQl)!;
          const batInQ  = heaviestApi.scheduledPerQ[ql];
          suggestions.push({
            id: `s${sid++}`,
            severity: "warning",
            type: "shift_window",
            title: `${ql} reactor load ${Math.round(avgLoad * 100)}% — shift ${heaviestApi.apiName} to ${lighterQl}`,
            description:
              `Average reactor utilization in ${ql} is ${Math.round(avgLoad * 100)}% while ${lighterQl} ` +
              `sits at ${Math.round(reactorAvgUtilPerQ[lighterQl] * 100)}%. ` +
              `Moving ${heaviestApi.apiName}'s ${batInQ} ${ql} batches into ${lighterQl} ` +
              `(${targetQ.months}) reduces ${ql} pressure and improves total throughput.`,
            gain: `${batInQ} batch${batInQ > 1 ? "es" : ""} ${ql}→${lighterQl}`,
            action: {
              apiId: heaviestApi.apiId,
              newStartMs: targetQ.startMs,
              newEndMs:   targetQ.endMs,
            },
          });
        }
      }
    }
  }

  // Sort: critical → warning → info
  const ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  suggestions.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  return {
    quarters,
    apiSummaries,
    reactorLoads,
    totalBatchesPerQ,
    reactorAvgUtilPerQ,
    suggestions,
  };
}

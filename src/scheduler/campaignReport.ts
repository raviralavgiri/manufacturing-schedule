/**
 * Campaign report — validates a schedule against the campaign plan and
 * summarises it for the dashboard:
 *
 *   • campaigns planned vs required per API, per quarter
 *   • every campaign's target quarter, actual start/end and status, with a
 *     reason for anything unscheduled, partial, off-quarter or out of window
 *   • intermediate-stage completion vs the EARLIEST ACHIEVABLE completion
 *     (the same API scheduled alone, i.e. with no cleanroom/equipment
 *     contention from other APIs)
 *   • cleanroom (production block) and equipment utilisation per quarter
 *   • clashes and configuration issues
 *
 * Pure — no React / store access. Nothing about the APIs, stages, cleanrooms
 * or reactors is hard-coded; everything is derived from the master data.
 */
import type { API, BatchScheduleEntry, PlanWindow, Reactor, ScheduleResult } from "../types";
import { runScheduler } from "./scheduler";
import {
  QUARTER_COUNT,
  campaignCountOf,
  campaignQuarterTargets,
  campaignSizes,
  isCampaignMode,
  quarterIndexIn,
  sinkStageIds,
} from "./campaigns";

export const NO_CLEANROOM = "(no cleanroom)";

export type CampaignStatus =
  | "on-target" //  scheduled, starts and ends in its target quarter
  | "spilled" //    scheduled, but starts or ends outside its target quarter
  | "outside-window" // a batch ends after the API plan window
  | "partial" //    some of its batches could not be scheduled
  | "unscheduled"; // no batch could be scheduled

export interface CampaignRow {
  apiId: string;
  apiName: string;
  apiColor: string;
  cleanroom: string;
  campaignNo: number; // 1-based
  targetQuarter: number; // 0..3
  requiredBatches: number;
  scheduledBatches: number;
  startMs: number | null;
  endMs: number | null; // last cycle end
  releaseMs: number | null; // last analysis end
  startQuarter: number | null; // -1 = outside window
  endQuarter: number | null;
  status: CampaignStatus;
  reason?: string;
}

export interface IntermediateRow {
  apiId: string;
  apiName: string;
  stageId: string;
  stageNo: number;
  stageName: string;
  plannedBatches: number;
  scheduledBatches: number;
  firstStartMs: number | null;
  /** Last batch analysis end = material fully released. */
  completionMs: number | null;
  /** Completion when this API is scheduled alone (no contention). */
  earliestCompletionMs: number | null;
  /** completion − earliest, hours (≥ 0). */
  delayHours: number | null;
  /** First start of any downstream stage batch. */
  firstDownstreamStartMs: number | null;
  status: "earliest" | "delayed" | "incomplete";
  reason?: string;
}

export interface UtilRow {
  id: string; // cleanroom name or reactor id
  label: string;
  reactorCount: number;
  apiNames: string[];
  /** Required campaigns (cleanrooms only). */
  campaignsRequired: number;
  campaignsScheduled: number;
  busyHoursPerQ: number[];
  /** Busy fraction per quarter (0..1); overlapping batches on a reactor are
   *  merged so BCF < BCT overlap is never double counted. */
  utilPerQ: number[];
  utilTotal: number;
}

export interface CampaignIssue {
  severity: "error" | "warn" | "info";
  apiName?: string;
  msg: string;
}

export interface CampaignApiSummary {
  apiId: string;
  apiName: string;
  apiColor: string;
  cleanroom: string;
  required: number;
  scheduled: number; // fully scheduled campaigns (any status except partial/unscheduled)
  onTarget: number;
  requiredPerQ: number[];
  scheduledPerQ: number[]; // by START quarter of fully-scheduled campaigns
}

export interface CampaignReport {
  /** True when at least one API is in campaign mode. */
  active: boolean;
  quarters: { label: string; startMs: number; endMs: number }[];
  apis: CampaignApiSummary[];
  campaigns: CampaignRow[];
  intermediates: IntermediateRow[];
  cleanrooms: UtilRow[];
  equipment: UtilRow[];
  clashes: BatchScheduleEntry[];
  issues: CampaignIssue[];
  totals: {
    required: number;
    scheduled: number;
    onTarget: number;
    unscheduled: number;
  };
}

const H = 3600 * 1000;

/** Cleanroom of an API: explicit `api.block`, else the production block of
 *  its final-stage reactors, else NO_CLEANROOM. */
export function cleanroomOfApi(api: API, reactors: Reactor[]): string {
  if (api.block && api.block.trim()) return api.block.trim();
  const byId = new Map(reactors.map((r) => [r.id, r]));
  const sinks = sinkStageIds(api);
  for (const s of api.stages) {
    if (!sinks.has(s.id)) continue;
    for (const rid of s.reactorPool) {
      const b = byId.get(rid)?.productionBlock;
      if (b && b.trim()) return b.trim();
    }
  }
  return NO_CLEANROOM;
}

/** Merge [start,end) intervals and return the busy hours inside [qs,qe). */
function busyHoursIn(intervals: [number, number][], qs: number, qe: number): number {
  const clipped = intervals
    .map(([a, b]) => [Math.max(a, qs), Math.min(b, qe)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curS = -Infinity;
  let curE = -Infinity;
  for (const [a, b] of clipped) {
    if (a > curE) {
      if (curE > curS) total += curE - curS;
      curS = a;
      curE = b;
    } else if (b > curE) curE = b;
  }
  if (curE > curS) total += curE - curS;
  return total / H;
}

/**
 * Material-ready time for the first batch of a final-stage campaign: the
 * moment cumulative APPROVED predecessor output covers all batches up to
 * and including that one (same rule as the scheduler's material gate).
 */
function materialReadyFor(
  api: API,
  stageId: string,
  batchNo: number,
  batchesByStage: Map<string, BatchScheduleEntry[]>
): number | null {
  const stage = api.stages.find((s) => s.id === stageId);
  if (!stage) return null;
  const preds = (stage.inputStageIds ?? [])
    .map((id) => api.stages.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s);
  if (preds.length === 0) return null;
  const input =
    stage.inputKgPerBatch > 0 ? stage.inputKgPerBatch : stage.batchSizeKg;
  const required = batchNo * input;
  let ready = -Infinity;
  for (const p of preds) {
    const outPer = p.batchSizeKg > 0 ? p.batchSizeKg : 1;
    const m = Math.max(1, Math.ceil(required / outPer));
    const ends = (batchesByStage.get(p.id) ?? [])
      .map((b) => b.analysisEndMs)
      .sort((a, b) => a - b);
    if (ends.length < m) return ends.length ? ends[ends.length - 1] : null;
    ready = Math.max(ready, ends[m - 1]);
  }
  return Number.isFinite(ready) ? ready : null;
}

export function buildCampaignReport(
  apis: API[],
  reactors: Reactor[],
  schedule: ScheduleResult,
  planWindow: PlanWindow,
  options: { computeEarliest?: boolean } = {}
): CampaignReport {
  const computeEarliest = options.computeEarliest !== false;
  const qLen = (planWindow.endMs - planWindow.startMs) / QUARTER_COUNT;
  const quarters = Array.from({ length: QUARTER_COUNT }, (_, q) => ({
    label: `Q${q + 1}`,
    startMs: planWindow.startMs + q * qLen,
    endMs: planWindow.startMs + (q + 1) * qLen,
  }));

  const batchesByStage = new Map<string, BatchScheduleEntry[]>();
  for (const b of schedule.batches) {
    const arr = batchesByStage.get(b.stageId);
    if (arr) arr.push(b);
    else batchesByStage.set(b.stageId, [b]);
  }
  batchesByStage.forEach((arr) => arr.sort((a, b) => a.batchNo - b.batchNo));

  const reactorById = new Map(reactors.map((r) => [r.id, r]));
  const issues: CampaignIssue[] = [];
  const campaigns: CampaignRow[] = [];
  const intermediates: IntermediateRow[] = [];
  const apiSummaries: CampaignApiSummary[] = [];

  const campaignApis = apis.filter(isCampaignMode);

  for (const api of campaignApis) {
    const C = campaignCountOf(api);
    const cleanroom = cleanroomOfApi(api, reactors);
    const { targets, issue } = campaignQuarterTargets(api);
    if (issue) issues.push({ severity: "warn", apiName: api.name, msg: issue });
    const span = api.window.endMs - api.window.startMs;
    const days = span / (24 * H);
    if (days < 330 || days > 400)
      issues.push({
        severity: "info",
        apiName: api.name,
        msg: `Plan window is ${Math.round(days)} days, not a year — "per year" campaigns are distributed over the four quarters of this window.`,
      });

    const sinks = sinkStageIds(api);
    const sinkStages = api.stages.filter((s) => sinks.has(s.id));

    // ── Campaign rows (aggregated across all final stages) ──────────────
    const rows: CampaignRow[] = Array.from({ length: C }, (_, c) => ({
      apiId: api.id,
      apiName: api.name,
      apiColor: api.color,
      cleanroom,
      campaignNo: c + 1,
      targetQuarter: targets[c] ?? 0,
      requiredBatches: 0,
      scheduledBatches: 0,
      startMs: null,
      endMs: null,
      releaseMs: null,
      startQuarter: null,
      endQuarter: null,
      status: "unscheduled",
    }));
    const firstBatchOf: (BatchScheduleEntry | null)[] = rows.map(() => null);

    for (const s of sinkStages) {
      const sizes = campaignSizes(s.plannedBatches, C);
      sizes.forEach((n, c) => (rows[c].requiredBatches += n));
      if (s.plannedBatches < C)
        issues.push({
          severity: "error",
          apiName: api.name,
          msg: `Final stage S${s.stageNo} · ${s.stageName} has ${s.plannedBatches} batch(es) for ${C} campaigns — ${
            C - s.plannedBatches === 1
              ? `campaign ${C} has`
              : `campaigns ${s.plannedBatches + 1}–${C} have`
          } no batches. Raise the target kg or lower campaigns/yr.`,
        });
      if (s.reactorPool.filter((id) => reactorById.has(id)).length === 0)
        issues.push({
          severity: "error",
          apiName: api.name,
          msg: `Final stage S${s.stageNo} · ${s.stageName} has no valid reactor pool — none of its batches can be scheduled.`,
        });
      for (const b of batchesByStage.get(s.id) ?? []) {
        const c = (b.campaignNo ?? 1) - 1;
        const r = rows[c];
        if (!r) continue;
        r.scheduledBatches++;
        r.startMs = r.startMs === null ? b.startMs : Math.min(r.startMs, b.startMs);
        r.endMs = r.endMs === null ? b.endMs : Math.max(r.endMs, b.endMs);
        r.releaseMs =
          r.releaseMs === null ? b.analysisEndMs : Math.max(r.releaseMs, b.analysisEndMs);
        if (!firstBatchOf[c] || b.startMs < firstBatchOf[c]!.startMs) firstBatchOf[c] = b;
      }
    }

    rows.forEach((r, c) => {
      if (r.startMs !== null) {
        r.startQuarter = quarterIndexIn(r.startMs, api.window.startMs, api.window.endMs);
        r.endQuarter = quarterIndexIn(r.endMs! - 1, api.window.startMs, api.window.endMs);
      }
      if (r.requiredBatches === 0) {
        r.status = "unscheduled";
        r.reason = "No final-stage batches allocated — fewer planned batches than campaigns.";
      } else if (r.scheduledBatches === 0) {
        r.status = "unscheduled";
        r.reason = "No batch could be placed — final stage has no valid reactor pool.";
      } else if (r.scheduledBatches < r.requiredBatches) {
        r.status = "partial";
        r.reason = `${r.requiredBatches - r.scheduledBatches} of ${r.requiredBatches} batch(es) could not be placed.`;
      } else if (r.endMs! > api.window.endMs) {
        r.status = "outside-window";
        r.reason = `Ends ${new Date(r.endMs!).toISOString().slice(0, 10)}, after the plan window — capacity or material is insufficient within the window.`;
      } else if (r.startQuarter !== r.targetQuarter || r.endQuarter !== r.targetQuarter) {
        r.status = "spilled";
        const fb = firstBatchOf[c]!;
        const ready = materialReadyFor(api, fb.stageId, fb.batchNo, batchesByStage);
        const where =
          r.startQuarter !== r.targetQuarter
            ? `Starts in Q${(r.startQuarter ?? 0) + 1}`
            : `Runs into Q${(r.endQuarter ?? 0) + 1}`;
        const cause =
          r.startQuarter !== r.targetQuarter && ready !== null && ready >= fb.startMs - H
            ? `intermediate material released only on ${new Date(ready).toISOString().slice(0, 10)}`
            : r.startQuarter !== r.targetQuarter
            ? "final-stage reactors / cleanroom occupied by other campaigns"
            : "campaign duration exceeds the time left in the quarter";
        r.reason = `${where} (target Q${r.targetQuarter + 1}) — ${cause}.`;
      } else {
        r.status = "on-target";
      }
    });
    campaigns.push(...rows);

    const requiredPerQ = new Array(QUARTER_COUNT).fill(0);
    const scheduledPerQ = new Array(QUARTER_COUNT).fill(0);
    rows.forEach((r) => {
      requiredPerQ[r.targetQuarter]++;
      if (
        (r.status === "on-target" || r.status === "spilled" || r.status === "outside-window") &&
        r.startQuarter !== null &&
        r.startQuarter >= 0
      )
        scheduledPerQ[r.startQuarter]++;
    });
    apiSummaries.push({
      apiId: api.id,
      apiName: api.name,
      apiColor: api.color,
      cleanroom,
      required: C,
      scheduled: rows.filter(
        (r) => r.status !== "unscheduled" && r.status !== "partial"
      ).length,
      onTarget: rows.filter((r) => r.status === "on-target").length,
      requiredPerQ,
      scheduledPerQ,
    });

    // ── Intermediate completion vs earliest achievable ──────────────────
    let isolated: Map<string, number> | null = null;
    if (computeEarliest) {
      isolated = new Map();
      const solo = runScheduler([api], reactors, planWindow);
      for (const b of solo.batches)
        isolated.set(b.stageId, Math.max(isolated.get(b.stageId) ?? -Infinity, b.analysisEndMs));
    }
    const successors = new Map<string, string[]>();
    api.stages.forEach((s) =>
      (s.inputStageIds ?? []).forEach((pid) => {
        const arr = successors.get(pid);
        if (arr) arr.push(s.id);
        else successors.set(pid, [s.id]);
      })
    );
    for (const s of [...api.stages].sort((a, b) => a.stageNo - b.stageNo)) {
      if (sinks.has(s.id) || s.plannedBatches <= 0) continue;
      const bs = batchesByStage.get(s.id) ?? [];
      const completion = bs.length ? Math.max(...bs.map((b) => b.analysisEndMs)) : null;
      const earliest = isolated?.get(s.id) ?? null;
      const downstreamStarts = (successors.get(s.id) ?? []).flatMap((id) =>
        (batchesByStage.get(id) ?? []).map((b) => b.startMs)
      );
      const delay =
        completion !== null && earliest !== null ? Math.max(0, (completion - earliest) / H) : null;
      const incomplete = bs.length < s.plannedBatches;
      intermediates.push({
        apiId: api.id,
        apiName: api.name,
        stageId: s.id,
        stageNo: s.stageNo,
        stageName: s.stageName,
        plannedBatches: s.plannedBatches,
        scheduledBatches: bs.length,
        firstStartMs: bs.length ? Math.min(...bs.map((b) => b.startMs)) : null,
        completionMs: completion,
        earliestCompletionMs: earliest,
        delayHours: delay,
        firstDownstreamStartMs: downstreamStarts.length ? Math.min(...downstreamStarts) : null,
        status: incomplete ? "incomplete" : delay !== null && delay > 1 ? "delayed" : "earliest",
        reason: incomplete
          ? `${s.plannedBatches - bs.length} batch(es) not scheduled — check the reactor pool.`
          : delay !== null && delay > 1
          ? "Shared reactors / cleanroom occupied by other APIs' campaigns."
          : undefined,
      });
    }
  }

  // ── Equipment + cleanroom utilisation (merged intervals, no double count) ─
  const intervalsByReactor = new Map<string, [number, number][]>();
  for (const b of schedule.batches)
    for (const rid of b.reactorIds) {
      const arr = intervalsByReactor.get(rid);
      if (arr) arr.push([b.startMs, b.endMs]);
      else intervalsByReactor.set(rid, [[b.startMs, b.endMs]]);
    }
  const qHours = quarters.map((q) => (q.endMs - q.startMs) / H);
  const yearHours = qHours.reduce((a, b) => a + b, 0);
  const apisByReactor = new Map<string, Set<string>>();
  for (const b of schedule.batches)
    for (const rid of b.reactorIds) {
      const set = apisByReactor.get(rid) ?? new Set<string>();
      set.add(b.apiName);
      apisByReactor.set(rid, set);
    }

  const equipment: UtilRow[] = reactors.map((r) => {
    const iv = intervalsByReactor.get(r.id) ?? [];
    const busy = quarters.map((q) => busyHoursIn(iv, q.startMs, q.endMs));
    return {
      id: r.id,
      label: r.name || r.id,
      reactorCount: 1,
      apiNames: Array.from(apisByReactor.get(r.id) ?? []).sort(),
      campaignsRequired: 0,
      campaignsScheduled: 0,
      busyHoursPerQ: busy,
      utilPerQ: busy.map((h, i) => (qHours[i] > 0 ? h / qHours[i] : 0)),
      utilTotal: yearHours > 0 ? busy.reduce((a, b) => a + b, 0) / yearHours : 0,
    };
  });

  const cleanroomNames = new Set<string>();
  reactors.forEach((r) => r.productionBlock?.trim() && cleanroomNames.add(r.productionBlock.trim()));
  campaignApis.forEach((a) => cleanroomNames.add(cleanroomOfApi(a, reactors)));
  const cleanrooms: UtilRow[] = Array.from(cleanroomNames)
    .sort()
    .map((name) => {
      const rs = reactors.filter((r) => (r.productionBlock?.trim() || NO_CLEANROOM) === name);
      const eq = equipment.filter((e) => rs.some((r) => r.id === e.id));
      const busy = quarters.map((_, q) => eq.reduce((a, e) => a + e.busyHoursPerQ[q], 0));
      const assigned = campaignApis.filter((a) => cleanroomOfApi(a, reactors) === name);
      const apiNames = new Set<string>(assigned.map((a) => a.name));
      eq.forEach((e) => e.apiNames.forEach((n) => apiNames.add(n)));
      const summaries = apiSummaries.filter((s) => s.cleanroom === name);
      return {
        id: name,
        label: name,
        reactorCount: rs.length,
        apiNames: Array.from(apiNames).sort(),
        campaignsRequired: summaries.reduce((a, s) => a + s.required, 0),
        campaignsScheduled: summaries.reduce((a, s) => a + s.scheduled, 0),
        busyHoursPerQ: busy,
        utilPerQ: busy.map((h, i) => (rs.length && qHours[i] ? h / (rs.length * qHours[i]) : 0)),
        utilTotal:
          rs.length && yearHours ? busy.reduce((a, b) => a + b, 0) / (rs.length * yearHours) : 0,
      };
    });

  for (const cr of cleanrooms) {
    if (cr.id === NO_CLEANROOM || cr.reactorCount > 0) continue;
    issues.push({
      severity: "warn",
      msg: `Cleanroom "${cr.id}" is assigned to ${cr.apiNames.join(", ")} but no reactor has it as its production block — set the reactors' block on the Equipment tab.`,
    });
  }

  const clashes = schedule.batches.filter((b) => b.clash);
  if (clashes.length > 0)
    issues.push({
      severity: "error",
      msg: `${clashes.length} batch(es) are double-booked on a reactor — see the Clash tab.`,
    });

  const totals = {
    required: campaigns.length,
    scheduled: campaigns.filter((r) => r.status !== "unscheduled" && r.status !== "partial").length,
    onTarget: campaigns.filter((r) => r.status === "on-target").length,
    unscheduled: campaigns.filter((r) => r.status === "unscheduled" || r.status === "partial").length,
  };

  return {
    active: campaignApis.length > 0,
    quarters,
    apis: apiSummaries,
    campaigns,
    intermediates,
    cleanrooms,
    equipment,
    clashes,
    issues,
    totals,
  };
}

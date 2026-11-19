/**
 * Campaign-mode helpers shared by the scheduler and the campaign report.
 *
 * Campaign mode is enabled per API by setting `api.campaignsPerYear > 0`.
 * Quarters are the four equal quarters of the API's plan window
 * (index 0 = Q1 … 3 = Q4), the same definition the scheduler uses.
 *
 * Pure functions — no store or React access.
 */
import type { API, StageMaster } from "../types";

export const QUARTER_COUNT = 4;

/** True when the API is scheduled campaign-wise. */
export function isCampaignMode(api: API): boolean {
  return (
    typeof api.campaignsPerYear === "number" &&
    Number.isFinite(api.campaignsPerYear) &&
    api.campaignsPerYear > 0
  );
}

/** Number of campaigns per year (0 when not in campaign mode). */
export function campaignCountOf(api: API): number {
  return isCampaignMode(api) ? Math.round(api.campaignsPerYear as number) : 0;
}

export interface CampaignQuarterTargets {
  /** Target quarter index (0..3) for each campaign, in campaign order. */
  targets: number[];
  /** Set when the requested split was unusable and the even split was used. */
  issue?: string;
}

/**
 * Target quarter for every campaign of the API.
 *
 *   • explicit `campaignQuarterSplit` [n1,n2,n3,n4] summing to C → campaigns
 *     are assigned in order: n1 to Q1, n2 to Q2, …
 *   • otherwise the even distribution: campaign c (0-based) → ⌊c × 4 / C⌋
 *     (C = 4 → Q1,Q2,Q3,Q4 · C = 2 → Q1,Q3 · C = 8 → two per quarter).
 *
 * The campaign COUNT is never changed — only the distribution falls back.
 */
export function campaignQuarterTargets(api: API): CampaignQuarterTargets {
  const C = campaignCountOf(api);
  if (C <= 0) return { targets: [] };
  const even = Array.from({ length: C }, (_, c) =>
    Math.min(QUARTER_COUNT - 1, Math.floor((c * QUARTER_COUNT) / C))
  );
  const split = api.campaignQuarterSplit;
  if (!split || split.length === 0) return { targets: even };
  const valid =
    split.length === QUARTER_COUNT &&
    split.every((n) => Number.isInteger(n) && n >= 0);
  const sum = valid ? split.reduce((a, b) => a + b, 0) : NaN;
  if (!valid || sum !== C) {
    return {
      targets: even,
      issue: `Quarter split [${split.join(", ")}] ${
        valid ? `sums to ${sum}` : "is not 4 whole numbers"
      } but ${C} campaign(s)/yr are required — even distribution used instead.`,
    };
  }
  const targets: number[] = [];
  split.forEach((n, q) => {
    for (let i = 0; i < n; i++) targets.push(q);
  });
  return { targets };
}

/**
 * Split `planned` batches into `C` campaigns as evenly as possible (earlier
 * campaigns take the remainder). When C > planned the trailing campaigns get
 * 0 batches — they are reported as unscheduled, never silently dropped.
 */
export function campaignSizes(planned: number, C: number): number[] {
  if (C <= 0) return [];
  const base = Math.floor(planned / C);
  const rem = planned - base * C;
  return Array.from({ length: C }, (_, c) => base + (c < rem ? 1 : 0));
}

/** 0-based campaign index of the 0-based batch index `k` given the sizes. */
export function campaignIndexOfBatch(k: number, sizes: number[]): number {
  let acc = 0;
  for (let c = 0; c < sizes.length; c++) {
    acc += sizes[c];
    if (k < acc) return c;
  }
  return Math.max(0, sizes.length - 1);
}

/** Stages no other stage of the API consumes (the final / product stages). */
export function sinkStageIds(api: API): Set<string> {
  const consumed = new Set<string>();
  api.stages.forEach((s) =>
    (Array.isArray(s.inputStageIds) ? s.inputStageIds : []).forEach((id) =>
      consumed.add(id)
    )
  );
  return new Set(
    api.stages.filter((s: StageMaster) => !consumed.has(s.id)).map((s) => s.id)
  );
}

/** Quarter index (0..3) of `ms` within [startMs, endMs); -1 when outside. */
export function quarterIndexIn(
  ms: number,
  startMs: number,
  endMs: number
): number {
  const span = endMs - startMs;
  if (span <= 0 || ms < startMs || ms >= endMs) return -1;
  return Math.min(
    QUARTER_COUNT - 1,
    Math.floor(((ms - startMs) / span) * QUARTER_COUNT)
  );
}

/** Start (ms) of quarter `q` of the window. */
export function quarterStartOf(q: number, startMs: number, endMs: number): number {
  return startMs + ((endMs - startMs) / QUARTER_COUNT) * q;
}

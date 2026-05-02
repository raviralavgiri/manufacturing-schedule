import type { API, StageMaster } from "../types";

/**
 * Given an API with `targetKg` and an ordered list of stages (S1 → SN),
 * compute `plannedBatches` for every stage via the backwards cascade:
 *
 *   final stage:    plannedBatches = ⌈ targetKg ÷ batchSize ⌉
 *   stage N (intermediate):
 *                   plannedBatches = ⌈ next_stage_actual_output ÷ batchSize ⌉
 *
 *   actual_output = batchSize × plannedBatches  (always rounds UP to whole batches)
 *
 * Returns a new API object with stages updated and `projectionKg` refreshed.
 * Pure: no side effects.
 */
export function cascadePlannedBatches(api: API): API {
  if (api.stages.length === 0) {
    return { ...api, projectionKg: 0 };
  }

  // Sort stages by stageNo so cascade walks in the right direction
  const sorted = [...api.stages].sort((a, b) => a.stageNo - b.stageNo);
  const target = Math.max(0, api.targetKg ?? 0);

  // Walk backwards: nextStageDemandKg starts as the API's target output.
  // For each stage, plannedBatches = ⌈ demand ÷ batchSize ⌉, then the
  // demand for the upstream stage = this stage's actual output.
  let demandKg = target;
  const updatedStages: StageMaster[] = sorted.slice();
  for (let i = sorted.length - 1; i >= 0; i--) {
    const s = sorted[i];
    const batchSize = Math.max(1, s.batchSizeKg);
    const planned = Math.max(1, Math.ceil(demandKg / batchSize));
    updatedStages[i] = { ...s, plannedBatches: planned };
    demandKg = batchSize * planned;
  }

  const finalStage = updatedStages[updatedStages.length - 1];
  const projectionKg = finalStage.batchSizeKg * finalStage.plannedBatches;

  return { ...api, stages: updatedStages, projectionKg };
}

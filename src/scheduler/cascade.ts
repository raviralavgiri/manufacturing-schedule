import type { API, StageMaster } from "../types";

/**
 * Backwards cascade: given an API with `targetKg` and an ordered list of
 * stages (S1 → SN), compute `plannedBatches` for every stage from the
 * downstream demand.
 *
 * Per stage:
 *   plannedBatches = ⌈ output demand on this stage  ÷ outputPerBatch ⌉
 *   actual output  = plannedBatches × outputPerBatch  (≥ demand, rounded up)
 *   input consumed = plannedBatches × inputPerBatch   ← upstream demand
 *
 *   final stage's output demand   = api.targetKg
 *   stage N's output demand       = stage N+1's input consumed
 *
 * If `inputPerBatch === outputPerBatch` (1:1 yield), this collapses to the
 * simpler single-batch-size cascade. With non-1:1 yields it correctly tracks
 * material loss / gain through the chain.
 */
export function cascadePlannedBatches(api: API): API {
  if (api.stages.length === 0) {
    return { ...api, projectionKg: 0 };
  }

  const sorted = [...api.stages].sort((a, b) => a.stageNo - b.stageNo);
  const target = Math.max(0, api.targetKg ?? 0);

  // Walk backwards
  let outputDemandKg = target;
  const updatedStages: StageMaster[] = sorted.slice();
  for (let i = sorted.length - 1; i >= 0; i--) {
    const s = sorted[i];
    const outputPerBatch = Math.max(1, s.batchSizeKg);
    const inputPerBatch = Math.max(
      1,
      typeof s.inputKgPerBatch === "number" && s.inputKgPerBatch > 0
        ? s.inputKgPerBatch
        : s.batchSizeKg
    );
    // Zero demand → zero batches for this stage and all upstream stages.
    // This is how an API with targetKg=0 gets "parked": no batches scheduled.
    const planned =
      outputDemandKg <= 0
        ? 0
        : Math.max(1, Math.ceil(outputDemandKg / outputPerBatch));
    updatedStages[i] = { ...s, plannedBatches: planned };
    // What this stage requires from upstream = planned × input/batch.
    // When planned=0, demand becomes 0 → cascade naturally stops upstream too.
    outputDemandKg = inputPerBatch * planned;
  }

  const finalStage = updatedStages[updatedStages.length - 1];
  const projectionKg = finalStage.batchSizeKg * finalStage.plannedBatches;

  return { ...api, stages: updatedStages, projectionKg };
}

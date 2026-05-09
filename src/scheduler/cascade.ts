import type { API, StageMaster } from "../types";
import {
  buildSuccessors,
  hasCycle,
  topologicalStageOrder,
} from "../utils/validation";

/**
 * Backwards cascade — DAG version.
 *
 * Each stage carries `inputStageIds`: the predecessor stages whose output
 * it consumes. The cascade walks the DAG in REVERSE topological order
 * (sinks first, roots last) and propagates demand:
 *
 *   plannedBatches  = ⌈ outputDemandKg ÷ outputPerBatch ⌉
 *   inputConsumed   = plannedBatches × inputPerBatch
 *   demand on pred  += this stage's inputConsumed   (sum across successors)
 *
 *   sink demand     = api.targetKg               (single sink)
 *                   = api.targetKg ÷ #sinks      (multi-sink, equal split)
 *
 * Multi-sink note: for now we split the API target equally across sinks.
 * TODO(future): support a per-sink weighting if a real use-case lands.
 *
 * Back-compat: a strictly linear chain (every non-first stage has
 * `inputStageIds = [prev]`) collapses to exactly the old per-stage formula
 * because each stage has exactly one successor and
 * `outputDemand = inputConsumed of that one successor`.
 *
 * Cycle handling: if the inputs form a cycle we fall back to the legacy
 * linear cascade (sorted by `stageNo`) and emit a single console.warn.
 * Validation surfaces the cycle to the user; the cascade never crashes.
 */
export function cascadePlannedBatches(api: API): API {
  if (api.stages.length === 0) {
    return { ...api, projectionKg: 0 };
  }

  if (hasCycle(api.stages)) {
    console.warn(
      `[cascade] Cycle detected in API "${api.id}" — falling back to linear stageNo order.`
    );
    return cascadeLinear(api);
  }

  const stagesById = new Map(api.stages.map((s) => [s.id, s]));
  const successors = buildSuccessors(api.stages);
  const topo = topologicalStageOrder(api.stages); // roots → sinks

  // Sinks = no successors. Equal split of api.targetKg across sinks.
  const sinks = api.stages.filter(
    (s) => (successors.get(s.id)?.length ?? 0) === 0
  );
  const target = Math.max(0, api.targetKg ?? 0);
  const perSinkTarget =
    sinks.length === 0 ? 0 : target / sinks.length;
  const sinkIds = new Set(sinks.map((s) => s.id));

  // Walk REVERSE topo so each stage is visited only after every successor
  // has already booked its demand into `outputDemandByStageId`.
  const outputDemandByStageId = new Map<string, number>();
  api.stages.forEach((s) => outputDemandByStageId.set(s.id, 0));
  sinks.forEach((s) => outputDemandByStageId.set(s.id, perSinkTarget));

  const plannedById = new Map<string, number>();
  for (let i = topo.length - 1; i >= 0; i--) {
    const sid = topo[i];
    const s = stagesById.get(sid);
    if (!s) continue;
    const outputPerBatch = Math.max(1, s.batchSizeKg);
    const inputPerBatch = effectiveInputPerBatch(s);
    const demand = outputDemandByStageId.get(sid) ?? 0;
    // Same zero-target → zero-batches semantics as the legacy cascade.
    const planned = demand <= 0 ? 0 : Math.max(1, Math.ceil(demand / outputPerBatch));
    plannedById.set(sid, planned);
    const inputConsumed = inputPerBatch * planned;
    // Add this stage's input demand to each predecessor's output demand.
    // Multiple successors sharing the same predecessor => demands SUM.
    const preds = Array.isArray(s.inputStageIds) ? s.inputStageIds : [];
    for (const pid of preds) {
      outputDemandByStageId.set(
        pid,
        (outputDemandByStageId.get(pid) ?? 0) + inputConsumed
      );
    }
  }

  const updatedStages: StageMaster[] = api.stages.map((s) => ({
    ...s,
    plannedBatches: plannedById.get(s.id) ?? 0,
  }));

  // projectionKg = sum of (sink stage's actual output). For a single-sink
  // linear chain this equals finalStage.batchSizeKg * finalStage.plannedBatches
  // exactly as before, so existing dashboards see no change.
  const projectionKg = updatedStages
    .filter((s) => sinkIds.has(s.id))
    .reduce((acc, s) => acc + s.batchSizeKg * s.plannedBatches, 0);

  return { ...api, stages: updatedStages, projectionKg };
}

/**
 * Legacy linear cascade — used as the cycle fallback. Identical in formula
 * to the pre-DAG implementation: sort by `stageNo`, walk back from final
 * stage, propagate `inputConsumed` upstream as `outputDemand`.
 */
function cascadeLinear(api: API): API {
  const sorted = [...api.stages].sort((a, b) => a.stageNo - b.stageNo);
  const target = Math.max(0, api.targetKg ?? 0);
  let outputDemandKg = target;
  const updatedStages: StageMaster[] = sorted.slice();
  for (let i = sorted.length - 1; i >= 0; i--) {
    const s = sorted[i];
    const outputPerBatch = Math.max(1, s.batchSizeKg);
    const inputPerBatch = effectiveInputPerBatch(s);
    const planned =
      outputDemandKg <= 0
        ? 0
        : Math.max(1, Math.ceil(outputDemandKg / outputPerBatch));
    updatedStages[i] = { ...s, plannedBatches: planned };
    outputDemandKg = inputPerBatch * planned;
  }
  const finalStage = updatedStages[updatedStages.length - 1];
  const projectionKg = finalStage.batchSizeKg * finalStage.plannedBatches;
  // Preserve original ordering (caller may rely on .stages order downstream).
  const updatedById = new Map(updatedStages.map((s) => [s.id, s]));
  const stages = api.stages.map((s) => updatedById.get(s.id) ?? s);
  return { ...api, stages, projectionKg };
}

/** inputKgPerBatch with the legacy "fall back to batchSizeKg if missing/zero" rule. */
function effectiveInputPerBatch(s: StageMaster): number {
  return Math.max(
    1,
    typeof s.inputKgPerBatch === "number" && s.inputKgPerBatch > 0
      ? s.inputKgPerBatch
      : s.batchSizeKg
  );
}

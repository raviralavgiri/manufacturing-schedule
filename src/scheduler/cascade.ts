import type { API, StageMaster } from "../types";
import {
  buildSuccessors,
  hasCycle,
  topologicalStageOrder,
} from "../utils/validation";

/**
 * Backwards cascade — DAG version with side-chain support.
 *
 * MAIN PASS (reverse-topo over non-side-chain stages):
 *   plannedBatches  = ⌈ outputDemandKg ÷ outputPerBatch ⌉
 *   inputConsumed   = plannedBatches × inputPerBatch
 *   demand on pred  += this stage's inputConsumed   (sum across successors)
 *   sink demand     = api.targetKg                  (single sink)
 *                   = api.targetKg ÷ #sinks         (multi-sink, equal split)
 *
 * SIDE-CHAIN PASS (forward-topo over side-chain stages):
 *   Side-chain stages = {anchors} ∪ {continuations reachable forward from
 *   anchors whose every predecessor is itself a side-chain stage}.
 *
 *   For an ANCHOR (`stage.cascadePolicy.kind === "side-chain"`):
 *       outputDemand = baseStage.actualOutput × factor
 *     where baseStage is the upstream main-backbone stage referenced by
 *     `cascadePolicy.baseStageId` and its `actualOutput` was computed in
 *     the main pass.
 *
 *   For a CONTINUATION (no cascadePolicy, all inputStageIds are side-chain):
 *       input = Σ predecessor.actualOutput   (for each side-chain pred)
 *       plannedBatches = ⌈ input ÷ inputPerBatch ⌉
 *
 *   These are forward-cascaded so each side-stage actually produces what the
 *   factor (and yield losses along the chain) imply, NOT what the merge
 *   stage demands. The merge stage's `inputStageIds` listing the side
 *   chain's last stage matters only for the SCHEDULER's per-batch wait
 *   rule, not for cascade demand propagation.
 *
 * BACK-COMPAT — a strictly linear chain (every non-first stage has
 * `inputStageIds = [prev]`, no `cascadePolicy` anywhere) collapses to
 * exactly the old per-stage formula because the side-chain pass is a
 * no-op and the main pass walks the entire DAG.
 *
 * CYCLE HANDLING — if the inputStageIds form a cycle we fall back to the
 * legacy linear cascade (sorted by `stageNo`) and emit a single
 * console.warn. Validation surfaces the cycle to the user; the cascade
 * never crashes.
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

  // ─ Identify side-chain stages ─────────────────────────────────────
  // Anchors: stages with cascadePolicy.kind === "side-chain".
  // Continuations: closure of stages whose every predecessor is already
  // marked side-chain. Computed via fixed-point over the stage list.
  const sideChainStageIds = identifySideChainStages(api.stages);

  // ─ Pass 1: main-stage reverse-topo cascade ────────────────────────
  // Sinks = main stages with no successors. Side-chain stages are
  // intentionally never sinks (they always feed into the merge).
  const isMain = (id: string) => !sideChainStageIds.has(id);
  const mainSinks = api.stages.filter(
    (s) =>
      isMain(s.id) &&
      (successors.get(s.id) ?? []).length === 0
  );
  const target = Math.max(0, api.targetKg ?? 0);

  // Per-sink demand seeding: split api.targetKg equally across all main sinks.
  // Stage-level input/output quantities (batchSizeKg, inputKgPerBatch) on each
  // stage drive the material balance — the cascade works backward from these
  // per-sink seeds using those per-stage quantities.
  const perSink = mainSinks.length > 0 ? target / mainSinks.length : 0;

  const mainSinkIds = new Set(mainSinks.map((s) => s.id));

  const outputDemandByStageId = new Map<string, number>();
  api.stages.forEach((s) => outputDemandByStageId.set(s.id, 0));
  mainSinks.forEach((s) => outputDemandByStageId.set(s.id, perSink));

  const plannedById = new Map<string, number>();
  api.stages.forEach((s) => plannedById.set(s.id, 0));

  for (let i = topo.length - 1; i >= 0; i--) {
    const sid = topo[i];
    if (sideChainStageIds.has(sid)) continue; // side chains handled in pass 2
    const s = stagesById.get(sid);
    if (!s) continue;
    const outputPerBatch = Math.max(1, s.batchSizeKg);
    const inputPerBatch = effectiveInputPerBatch(s);
    const demand = outputDemandByStageId.get(sid) ?? 0;
    // Subtract any existing on-hand stock: only the SHORTFALL must be produced.
    const netDemand = Math.max(0, demand - existingStockOf(s));
    const planned =
      netDemand <= 0 ? 0 : Math.max(1, Math.ceil(netDemand / outputPerBatch));
    plannedById.set(sid, planned);
    const inputConsumed = inputPerBatch * planned;
    // Add this stage's input demand to each predecessor's output demand,
    // BUT skip side-chain predecessors — their demand is set by the
    // factor cascade in pass 2, not by what flows back from the merge.
    // CONVERGENCE factor: for a parallel merge, each branch consumes a
    // different stoichiometric quantity. The base input (inputKgPerBatch) is
    // branch A (factor 1); other branches use inputFactorByStageId[pred].
    const preds = Array.isArray(s.inputStageIds) ? s.inputStageIds : [];
    const factorOf = (pid: string) => {
      const f = s.inputFactorByStageId?.[pid];
      return typeof f === "number" && f > 0 ? f : 1;
    };
    for (const pid of preds) {
      if (sideChainStageIds.has(pid)) continue;
      outputDemandByStageId.set(
        pid,
        (outputDemandByStageId.get(pid) ?? 0) + inputConsumed * factorOf(pid)
      );
    }
  }

  // ─ Pass 2: side-chain forward cascade ─────────────────────────────
  // Walk topo FORWARD over side-chain stages only. Anchors come first
  // (their inputStageIds are typically [] → topo seeds them as roots);
  // continuations follow because their inputStageIds point at side-chain
  // predecessors that are already processed.
  for (const sid of topo) {
    if (!sideChainStageIds.has(sid)) continue;
    const s = stagesById.get(sid);
    if (!s) continue;
    const outputPerBatch = Math.max(1, s.batchSizeKg);
    const inputPerBatch = effectiveInputPerBatch(s);

    let demand = 0;
    if (s.cascadePolicy && s.cascadePolicy.kind === "side-chain") {
      // Anchor: factor × baseStage.actualOutput.
      const base = stagesById.get(s.cascadePolicy.baseStageId);
      if (base) {
        const basePlanned = plannedById.get(base.id) ?? 0;
        const baseActualOutput = Math.max(1, base.batchSizeKg) * basePlanned;
        demand = baseActualOutput * Math.max(0, s.cascadePolicy.factor);
      } else {
        // Dangling baseStageId — validation surfaces this; cascade just
        // produces 0 batches so we don't crash.
        demand = 0;
      }
    } else {
      // Continuation: sum predecessors' actualOutputs as feed-in, then
      // size by inputPerBatch.
      let totalInput = 0;
      const preds = Array.isArray(s.inputStageIds) ? s.inputStageIds : [];
      for (const pid of preds) {
        const pred = stagesById.get(pid);
        if (!pred) continue;
        const predPlanned = plannedById.get(pred.id) ?? 0;
        totalInput += Math.max(1, pred.batchSizeKg) * predPlanned;
      }
      // For continuations, the relevant per-batch divisor is inputPerBatch.
      const netInput = Math.max(0, totalInput - existingStockOf(s));
      const planned =
        netInput <= 0
          ? 0
          : Math.max(1, Math.ceil(netInput / inputPerBatch));
      plannedById.set(sid, planned);
      continue;
    }

    const netDemand = Math.max(0, demand - existingStockOf(s));
    const planned =
      netDemand <= 0 ? 0 : Math.max(1, Math.ceil(netDemand / outputPerBatch));
    plannedById.set(sid, planned);
  }

  const updatedStages: StageMaster[] = api.stages.map((s) => ({
    ...s,
    plannedBatches: plannedById.get(s.id) ?? 0,
  }));

  // projectionKg = sum of (main-sink stage's actual output). For a single-
  // sink linear chain this equals finalStage.batchSizeKg * finalStage
  // .plannedBatches exactly as before, so existing dashboards see no
  // change. Side-chain stages are intentionally excluded — they're not
  // part of the API's deliverable.
  const projectionKg = updatedStages
    .filter((s) => mainSinkIds.has(s.id))
    .reduce((acc, s) => acc + s.batchSizeKg * s.plannedBatches, 0);

  return { ...api, stages: updatedStages, projectionKg };
}

/**
 * Identify the set of stage ids that belong to a side chain. Two rules:
 *   1. ANCHOR — `cascadePolicy.kind === "side-chain"`.
 *   2. CONTINUATION — has at least one `inputStageId`, and EVERY entry
 *      in `inputStageIds` is itself a side-chain stage (anchor or earlier
 *      continuation). Computed by fixed-point iteration so a chain of any
 *      length collapses correctly.
 *
 * Pure helper — exported only for testing if we ever need it; not used
 * outside this module.
 */
function identifySideChainStages(stages: StageMaster[]): Set<string> {
  const out = new Set<string>();
  for (const s of stages) {
    if (s.cascadePolicy && s.cascadePolicy.kind === "side-chain") {
      out.add(s.id);
    }
  }
  if (out.size === 0) return out;
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of stages) {
      if (out.has(s.id)) continue;
      const inputs = Array.isArray(s.inputStageIds) ? s.inputStageIds : [];
      if (inputs.length === 0) continue; // pure root → only anchors qualify
      if (inputs.every((id) => out.has(id))) {
        out.add(s.id);
        changed = true;
      }
    }
  }
  return out;
}

/**
 * Legacy linear cascade — used as the cycle fallback. Identical in formula
 * to the pre-DAG implementation: sort by `stageNo`, walk back from final
 * stage, propagate `inputConsumed` upstream as `outputDemand`. Side-chain
 * policies are ignored in the fallback (the cycle itself is the bigger
 * problem; validation surfaces it to the user).
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
    const netDemand = Math.max(0, outputDemandKg - existingStockOf(s));
    const planned =
      netDemand <= 0
        ? 0
        : Math.max(1, Math.ceil(netDemand / outputPerBatch));
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

/** Existing on-hand stock (kg) of this stage's output; 0 when unset/invalid. */
function existingStockOf(s: StageMaster): number {
  return typeof s.existingStockKg === "number" && s.existingStockKg > 0
    ? s.existingStockKg
    : 0;
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

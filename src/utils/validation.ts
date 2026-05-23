import type { API, StageMaster } from "../types";

/**
 * One issue surfaced by `validateApiDag`. Errors are user-fixable problems
 * that would break correctness (cycles, dangling refs); warnings are flags
 * worth showing but the cascade/scheduler still produce a valid result.
 *
 * `stageId` is null when the issue is API-level (e.g. multi-sink layout).
 */
export interface DagIssue {
  apiId: string;
  stageId: string | null;
  level: "error" | "warn";
  msg: string;
}

/**
 * Validate an API's stage DAG. Detects:
 *   - cycles (error)
 *   - first stage with non-empty `inputStageIds` (error)
 *   - self-references (error)
 *   - dangling references (id not in this API's stage set) (error)
 *   - side-chain `cascadePolicy.factor <= 0` (error)
 *   - side-chain `cascadePolicy.baseStageId` missing/unknown (error)
 *   - side-chain anchor whose `baseStageId` is downstream of itself
 *     (would be a cycle once you account for the implicit factor edge —
 *     error)
 *   - side-chain producing < 1 batch (warn — chain is too small to deliver)
 *   - topology = "parallel" with no merge stage (warn)
 *   - multiple MAIN sink stages (warn — distribution rule applies)
 *
 * Pure function — never mutates the API. Returns an empty array on a
 * clean linear chain.
 *
 * Used by:
 *   - cascade.ts (logged as console.warn, never thrown)
 *   - ClashTab.tsx (rendered as a "DAG issues" panel)
 *   - AddStageForm.tsx (submit-time validation)
 */
export function validateApiDag(api: API): DagIssue[] {
  const issues: DagIssue[] = [];
  const stages = api.stages;
  if (stages.length === 0) return issues;

  const sortedByNo = [...stages].sort((a, b) => a.stageNo - b.stageNo);
  const firstStageId = sortedByNo[0].id;
  const idSet = new Set(stages.map((s) => s.id));

  // Side-chain stage set (anchors + continuations) — same definition as
  // the cascade. We need it to refine the multi-sink warning so dangling
  // side-chain "tails" are flagged separately from main-graph multi-sink.
  const sideChainStageIds = identifySideChainStages(stages);

  // ─ Per-stage shape checks ───────────────────────────────────────────
  for (const s of stages) {
    const inputs = Array.isArray(s.inputStageIds) ? s.inputStageIds : [];
    if (s.id === firstStageId && inputs.length > 0) {
      issues.push({
        apiId: api.id,
        stageId: s.id,
        level: "error",
        msg: `First stage "${s.stageName}" cannot have predecessors.`,
      });
    }
    for (const id of inputs) {
      if (id === s.id) {
        issues.push({
          apiId: api.id,
          stageId: s.id,
          level: "error",
          msg: `Stage "${s.stageName}" references itself as an input.`,
        });
      } else if (!idSet.has(id)) {
        issues.push({
          apiId: api.id,
          stageId: s.id,
          level: "error",
          msg: `Stage "${s.stageName}" references missing stage id "${id}".`,
        });
      }
    }
  }

  // ─ Cycle detection (DFS w/ white/gray/black coloring) ───────────────
  // 0 = white (unvisited), 1 = gray (on current DFS path), 2 = black (done).
  // We walk forward over successors; cycle iff we hit a gray node again.
  const successors = buildSuccessors(stages);
  const color = new Map<string, 0 | 1 | 2>();
  stages.forEach((s) => color.set(s.id, 0));
  let cycleFound = false;
  let cycleStageId: string | null = null;

  const dfs = (id: string): boolean => {
    color.set(id, 1);
    for (const next of successors.get(id) ?? []) {
      const c = color.get(next) ?? 0;
      if (c === 1) {
        cycleStageId = next;
        return true;
      }
      if (c === 0 && dfs(next)) return true;
    }
    color.set(id, 2);
    return false;
  };

  for (const s of stages) {
    if ((color.get(s.id) ?? 0) === 0) {
      if (dfs(s.id)) {
        cycleFound = true;
        break;
      }
    }
  }
  if (cycleFound) {
    issues.push({
      apiId: api.id,
      stageId: cycleStageId,
      level: "error",
      msg: `Cycle detected involving stage "${
        stages.find((s) => s.id === cycleStageId)?.stageName ?? cycleStageId
      }". The cascade will fall back to linear order.`,
    });
  }

  // ─ Side-chain (cascadePolicy) checks ────────────────────────────────
  // Anchors must reference a real, valid baseStageId with factor > 0,
  // and the baseStage must NOT be reachable forward from the anchor (else
  // we'd have an implicit cycle through the factor edge).
  for (const s of stages) {
    if (!s.cascadePolicy || s.cascadePolicy.kind !== "side-chain") continue;
    const policy = s.cascadePolicy;
    if (!(policy.factor > 0)) {
      issues.push({
        apiId: api.id,
        stageId: s.id,
        level: "error",
        msg: `Side-chain anchor "${s.stageName}" has factor ${policy.factor}; must be > 0.`,
      });
    }
    if (!policy.baseStageId || !idSet.has(policy.baseStageId)) {
      issues.push({
        apiId: api.id,
        stageId: s.id,
        level: "error",
        msg: `Side-chain anchor "${s.stageName}" references unknown base stage id "${policy.baseStageId ?? "(missing)"}".`,
      });
    } else {
      // Cycle-via-factor check: walk forward from the anchor following
      // both `inputStageIds`-driven successor edges AND the factor edge.
      // If baseStage is reachable, we have an implicit cycle.
      if (isReachableForward(stages, successors, s.id, policy.baseStageId)) {
        const baseName =
          stages.find((x) => x.id === policy.baseStageId)?.stageName ??
          policy.baseStageId;
        issues.push({
          apiId: api.id,
          stageId: s.id,
          level: "error",
          msg: `Side-chain anchor "${s.stageName}" has baseStage "${baseName}" downstream of itself — would form a cycle.`,
        });
      }
    }
  }

  // Side chain producing < 1 batch — warn the user the chain is too
  // small (typically due to a tiny factor combined with a small main
  // output). Uses the most recent cascaded plannedBatches.
  for (const s of stages) {
    if (!sideChainStageIds.has(s.id)) continue;
    if ((s.plannedBatches ?? 0) < 1) {
      issues.push({
        apiId: api.id,
        stageId: s.id,
        level: "warn",
        msg: `Side-chain stage "${s.stageName}" produces 0 batches — factor or upstream output is too small.`,
      });
    }
  }

  // ─ Topology-level warnings ───────────────────────────────────────────
  if (api.topology === "parallel") {
    // A "parallel" API should have at least one stage that pulls from
    // multiple predecessors — that's the merge stage. If none exists the
    // scaffold either wasn't applied or was edited away.
    const hasMerge = stages.some(
      (s) => Array.isArray(s.inputStageIds) && s.inputStageIds.length >= 2
    );
    if (!hasMerge) {
      issues.push({
        apiId: api.id,
        stageId: null,
        level: "warn",
        msg: `Topology is "parallel" but no merge stage (≥ 2 inputs) was found. Re-apply the topology preset on the APIs tab.`,
      });
    }
  }

  // ─ Multi-sink warning ───────────────────────────────────────────────
  // Sinks = stages with no successors AND that aren't side-chain stages
  // (a side-chain stage with no successors is its own warning above —
  // "produces 0 batches" also catches under-sized chains).
  const mainSinks = stages.filter(
    (s) =>
      !sideChainStageIds.has(s.id) &&
      (successors.get(s.id) ?? []).length === 0
  );
  // For fork topology, multiple sinks are intentional — suppress the warning
  // (each sink carries its own outputTargetKg, or equal-split applies).
  if (mainSinks.length > 1 && api.topology !== "fork") {
    issues.push({
      apiId: api.id,
      stageId: null,
      level: "warn",
      msg: `${mainSinks.length} sink stages (${mainSinks
        .map((s) => s.stageName)
        .join(", ")}). API target is distributed equally across sinks.`,
    });
  }

  return issues;
}

/**
 * Identify the side-chain stage set — same fixed-point rule as cascade.ts.
 * Duplicated here (rather than imported) to keep validation a leaf module
 * with no scheduler dependencies.
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
      if (inputs.length === 0) continue;
      if (inputs.every((id) => out.has(id))) {
        out.add(s.id);
        changed = true;
      }
    }
  }
  return out;
}

/**
 * Forward reachability check: is `targetId` reachable from `fromId` by
 * walking successors (the natural inputStageIds graph)? Used by the
 * side-chain "baseStage downstream of anchor" cycle check — if the base
 * is downstream we'd have a closed loop once you fold in the factor edge.
 */
function isReachableForward(
  stages: StageMaster[],
  successors: Map<string, string[]>,
  fromId: string,
  targetId: string
): boolean {
  if (fromId === targetId) return true;
  const seen = new Set<string>();
  const stack = [fromId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of successors.get(id) ?? []) {
      if (next === targetId) return true;
      if (!seen.has(next)) stack.push(next);
    }
  }
  // Reference `stages` so the parameter is "used" — keeps the signature
  // explicit for callers that may want to swap to a custom successor map.
  void stages;
  return false;
}

/**
 * Build a successor-by-stageId map for an API. `successors[X]` lists every
 * stage Y on the same API where Y.inputStageIds includes X. Used by both
 * cycle detection here and the cascade walk in cascade.ts.
 *
 * Pure helper — exported so the same map is consumed in multiple places
 * without rebuilding.
 */
export function buildSuccessors(stages: StageMaster[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  stages.forEach((s) => out.set(s.id, []));
  for (const s of stages) {
    const ins = Array.isArray(s.inputStageIds) ? s.inputStageIds : [];
    for (const pred of ins) {
      const list = out.get(pred);
      if (list) list.push(s.id);
    }
  }
  return out;
}

/**
 * Detect a cycle in the DAG defined by `stages` + `inputStageIds`. Cheap
 * forwarder around the same DFS coloring used in `validateApiDag`. Returns
 * true if cyclic — the cascade and scheduler use this to decide whether to
 * fall back to linear stageNo ordering.
 */
export function hasCycle(stages: StageMaster[]): boolean {
  if (stages.length === 0) return false;
  const successors = buildSuccessors(stages);
  const color = new Map<string, 0 | 1 | 2>();
  stages.forEach((s) => color.set(s.id, 0));
  const dfs = (id: string): boolean => {
    color.set(id, 1);
    for (const next of successors.get(id) ?? []) {
      const c = color.get(next) ?? 0;
      if (c === 1) return true;
      if (c === 0 && dfs(next)) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const s of stages) {
    if ((color.get(s.id) ?? 0) === 0 && dfs(s.id)) return true;
  }
  return false;
}

/**
 * Topological sort (Kahn's algorithm). Returns stage ids in execution order
 * (predecessors before successors). When the graph is cyclic OR contains
 * nodes unreachable from the natural roots, the leftovers are appended in
 * `stageNo` order so callers always get a complete ordering — matches the
 * "fall back to linear cascade" cycle policy.
 */
export function topologicalStageOrder(stages: StageMaster[]): string[] {
  if (stages.length === 0) return [];
  const successors = buildSuccessors(stages);
  const indeg = new Map<string, number>();
  stages.forEach((s) =>
    indeg.set(
      s.id,
      Array.isArray(s.inputStageIds) ? s.inputStageIds.length : 0
    )
  );
  // Seed roots in stageNo order so a clean linear chain produces
  // [S1,S2,S3,...] identical to the legacy behaviour.
  const sortedByNo = [...stages].sort((a, b) => a.stageNo - b.stageNo);
  const queue: string[] = [];
  for (const s of sortedByNo) {
    if ((indeg.get(s.id) ?? 0) === 0) queue.push(s.id);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const succ of successors.get(id) ?? []) {
      indeg.set(succ, (indeg.get(succ) ?? 0) - 1);
      if ((indeg.get(succ) ?? 0) <= 0) queue.push(succ);
    }
  }
  // Cycle leftover → append in stageNo order to keep callers complete.
  for (const s of sortedByNo) {
    if (!seen.has(s.id)) out.push(s.id);
  }
  return out;
}

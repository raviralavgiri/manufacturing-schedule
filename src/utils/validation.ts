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
 *   - multiple sink stages (warn — distribution rule applies)
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

  // ─ Multi-sink warning ───────────────────────────────────────────────
  // Sinks = stages with no successors. Multiple sinks means the API target
  // gets split equally; flag so the user knows.
  const sinks = stages.filter(
    (s) => (successors.get(s.id)?.length ?? 0) === 0
  );
  if (sinks.length > 1) {
    issues.push({
      apiId: api.id,
      stageId: null,
      level: "warn",
      msg: `${sinks.length} sink stages (${sinks
        .map((s) => s.stageName)
        .join(", ")}). API target is distributed equally across sinks.`,
    });
  }

  return issues;
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

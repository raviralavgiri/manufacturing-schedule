import type { API, ApiTopology, StageMaster } from "../types";

/**
 * Spec for `applyTopologyPreset` — discriminated union over the three
 * topology kinds. The spec defines the SHAPE of the DAG; the store
 * action ({@link applyTopologyPreset}) merges this shape onto the API's
 * existing stages in PRESERVE_THEN_ADD mode (keep existing stage rows
 * with their custom batch sizes / pools / etc, only ADD missing ones
 * and re-wire `inputStageIds` and `cascadePolicy`).
 */
export type TopologyPresetSpec =
  | LinearSpec
  | ParallelSpec
  | SideChainsSpec;

export interface LinearSpec {
  kind: "linear";
}

export interface ParallelSpec {
  kind: "parallel";
  /** Number of sub-chains feeding the merge stage. ≥ 2. */
  subChainCount: number;
  /** Length of each sub-chain. `length === subChainCount`. Each entry ≥ 1. */
  subChainLengths: number[];
  /** Display name of the merge stage. Defaults to "Merge" when blank. */
  mergeStageName: string;
  /** Number of stages chained AFTER the merge. ≥ 0. */
  postMergeCount: number;
}

export interface SideChainsSpec {
  kind: "side_chains";
  /** Length of the main backbone (S1 → … → SN). ≥ 2. */
  mainBackboneLength: number;
  /** List of side chains. Each feeds into a specific main-backbone stage. */
  sideChains: SideChainSpec[];
}

export interface SideChainSpec {
  /** Main-backbone stage number this side chain merges into. ≥ 2. */
  mergesIntoStageNo: number;
  /** Number of stages in this side chain. ≥ 1. */
  length: number;
  /** Multiplier applied to the main predecessor's actualOutput to size
   *  the anchor's outputDemand. > 0. Typical: 0.1..1.0. */
  factor: number;
  /** Optional name prefix override. Defaults to `S{n}i` / `S{n}i_a` etc. */
  namePrefix?: string;
}

/** Defaults for newly-scaffolded stage rows. */
export interface ScaffoldDefaults {
  batchSizeKg: number;
  inputKgPerBatch: number;
  bcfHours: number;
  bctHours: number;
  processHours: number;
  analysisHours: number;
  pcoHours: number;
  plannedBatches: number;
  reactorPool: string[];
}

/** Compute the topology to mark on the API after applying `spec`. */
export function topologyOf(spec: TopologyPresetSpec): ApiTopology {
  return spec.kind === "parallel"
    ? "parallel"
    : spec.kind === "side_chains"
    ? "side_chains"
    : "linear";
}

/**
 * Apply a topology preset to an API. Returns a NEW API with rewritten
 * `stages`, `topology`, and (re-)wired `inputStageIds` + `cascadePolicy`.
 *
 * PRESERVE_THEN_ADD mode:
 *   - Existing stage rows are mapped to scaffold positions BY `stageNo`
 *     (lowest first). Their `stageName`, `batchSizeKg`, `inputKgPerBatch`,
 *     `reactorPool`, hour fields, `pcoHours`, and `plannedBatches` are all
 *     preserved.
 *   - Missing positions are ADDED as new stages using `defaults`.
 *   - `inputStageIds` and `cascadePolicy` are ALWAYS re-derived from the
 *     spec (the topology graph is the spec's responsibility).
 *   - Existing stages with `stageNo` BEYOND the scaffold size are left at
 *     the tail with a linear-chain `inputStageIds = [prev]` and no
 *     cascadePolicy — they trail the canonical layout but aren't deleted.
 *
 * The cascade is NOT run here; the caller (the store action) does that
 * after applying so it can also fire `forceRecompute`.
 */
export function applyTopologyPresetToApi(
  api: API,
  spec: TopologyPresetSpec,
  defaults: ScaffoldDefaults
): API {
  const positions = buildPositions(spec);
  const sortedExisting = [...api.stages].sort((a, b) => a.stageNo - b.stageNo);
  const existingByStageNo = new Map<number, StageMaster>();
  sortedExisting.forEach((s, idx) => {
    // Re-key by 1-based ordinal so we map stage rows to scaffold slots
    // even when the existing stageNos aren't contiguous.
    existingByStageNo.set(idx + 1, s);
  });

  // Track every id already in use (existing rows) so we can mint
  // collision-free ids for any newly-scaffolded rows.
  const usedIds = new Set(api.stages.map((s) => s.id));
  const mintId = (preferredStageNo: number): string => {
    const baseAttempt = `${api.id}-S${preferredStageNo}`;
    if (!usedIds.has(baseAttempt)) {
      usedIds.add(baseAttempt);
      return baseAttempt;
    }
    // Fall back to a unique suffix — keeps the prefix readable in dev
    // tools while guaranteeing no clash with a preserved stage that
    // happens to already use the same `${apiId}-S${n}` slot.
    for (let n = 1; n < 10_000; n++) {
      const candidate = `${api.id}-S${preferredStageNo}-N${n}`;
      if (!usedIds.has(candidate)) {
        usedIds.add(candidate);
        return candidate;
      }
    }
    // Final fallback (effectively unreachable with sane inputs).
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `${api.id}-${crypto.randomUUID().slice(0, 8)}`
        : `${api.id}-S${preferredStageNo}-${Date.now()}`;
    usedIds.add(id);
    return id;
  };

  // ─ Build out the scaffold rows in stageNo order ────────────────────
  const scaffoldRows: StageMaster[] = positions.map((pos, idx) => {
    const stageNo = idx + 1;
    const existing = existingByStageNo.get(stageNo);
    if (existing) {
      // Preserve user-customised fields. Re-use existing.id so references
      // from elsewhere (e.g. another stage's inputStageIds in another API
      // — defensive) stay valid; just rewrite linkage and policy.
      return {
        ...existing,
        stageNo,
        stageName: existing.stageName,
        // inputStageIds / cascadePolicy are filled in below once all rows
        // have a stable id.
        inputStageIds: [],
        cascadePolicy: undefined,
      };
    }
    return {
      id: mintId(stageNo),
      apiId: api.id,
      apiName: api.name,
      stageNo,
      stageName: pos.defaultName,
      batchSizeKg: defaults.batchSizeKg,
      inputKgPerBatch: defaults.inputKgPerBatch,
      reactorPool: defaults.reactorPool.slice(),
      bcfHours: defaults.bcfHours,
      bctHours: defaults.bctHours,
      processHours: defaults.processHours,
      analysisHours: defaults.analysisHours,
      pcoHours: defaults.pcoHours,
      plannedBatches: defaults.plannedBatches,
      inputStageIds: [],
      cascadePolicy: undefined,
    };
  });

  // ─ Append untouched "trailing" existing stages (stageNo > scaffold) ─
  const trailing: StageMaster[] = [];
  for (let stageNo = positions.length + 1; ; stageNo++) {
    const existing = existingByStageNo.get(stageNo);
    if (!existing) break;
    trailing.push({
      ...existing,
      stageNo,
      // Trail with linear-chain wiring; predecessor is the previous row
      // (= last scaffold row when we're the first trailer, else prior
      // trailer). Filled in below once ids are stable.
      inputStageIds: [],
      cascadePolicy: undefined,
    });
  }

  const allRows: StageMaster[] = [...scaffoldRows, ...trailing];
  const idByStageNo = new Map<number, string>(
    allRows.map((s) => [s.stageNo, s.id])
  );

  // ─ Rewire inputStageIds + cascadePolicy from the spec ──────────────
  positions.forEach((pos, idx) => {
    const stageNo = idx + 1;
    const row = allRows.find((r) => r.stageNo === stageNo)!;
    row.inputStageIds = pos.inputStageNos
      .map((n) => idByStageNo.get(n))
      .filter((id): id is string => typeof id === "string");
    if (pos.cascadePolicy) {
      const baseId = idByStageNo.get(pos.cascadePolicy.baseStageNo);
      if (baseId) {
        row.cascadePolicy = {
          kind: "side-chain",
          baseStageId: baseId,
          factor: pos.cascadePolicy.factor,
        };
      }
    }
  });

  // Trailing rows get linear-chain wiring.
  trailing.forEach((row, i) => {
    const prevStageNo = row.stageNo - 1;
    const prevId = idByStageNo.get(prevStageNo);
    row.inputStageIds = prevId ? [prevId] : [];
    void i;
  });

  return {
    ...api,
    stages: allRows,
    topology: topologyOf(spec),
  };
}

// ─── Position builders ────────────────────────────────────────────────────

/**
 * Internal scaffold position. Represents one stage in stageNo order with
 * its display name, the stageNos it should pull from in `inputStageIds`,
 * and an optional `cascadePolicy` (only side-chain anchors).
 */
interface ScaffoldPosition {
  defaultName: string;
  inputStageNos: number[];
  cascadePolicy?: { baseStageNo: number; factor: number };
}

function buildPositions(spec: TopologyPresetSpec): ScaffoldPosition[] {
  if (spec.kind === "linear") return buildLinearPositions();
  if (spec.kind === "parallel") return buildParallelPositions(spec);
  return buildSideChainsPositions(spec);
}

/**
 * Linear topology — degenerate scaffold with zero positions. The store
 * action handles "linear" by leaving existing stages in place and just
 * re-wiring them as a chain (see below). Returning [] makes the merge
 * path collapse to "all existing stages become trailing → linear wired".
 */
function buildLinearPositions(): ScaffoldPosition[] {
  return [];
}

function buildParallelPositions(spec: ParallelSpec): ScaffoldPosition[] {
  const positions: ScaffoldPosition[] = [];
  const subSum = spec.subChainLengths.reduce((a, b) => a + b, 0);

  // Sub-chains: stageNos 1..subSum. For each chain, its stages are
  // contiguous in the global stageNo space. Chain 0 = letter "A", etc.
  const lastStageNoOfChain: number[] = [];
  let stageNo = 1;
  for (let chainIdx = 0; chainIdx < spec.subChainCount; chainIdx++) {
    const len = spec.subChainLengths[chainIdx] ?? 0;
    const letter = chainLabel(chainIdx);
    for (let p = 0; p < len; p++) {
      positions.push({
        defaultName: `${letter}${p + 1}`,
        inputStageNos: p === 0 ? [] : [stageNo - 1],
      });
      stageNo++;
    }
    lastStageNoOfChain.push(stageNo - 1);
  }

  // Merge stage at stageNo subSum + 1 — pulls from every sub-chain's last.
  const mergeStageNo = subSum + 1;
  positions.push({
    defaultName: spec.mergeStageName.trim() || "Merge",
    inputStageNos: lastStageNoOfChain.slice(),
  });

  // Post-merge: linear chain after the merge.
  for (let p = 0; p < spec.postMergeCount; p++) {
    const isLast = p === spec.postMergeCount - 1;
    positions.push({
      defaultName: isLast ? "Final API" : `Post-${p + 1}`,
      inputStageNos: [mergeStageNo + p],
    });
  }
  return positions;
}

function buildSideChainsPositions(spec: SideChainsSpec): ScaffoldPosition[] {
  const positions: ScaffoldPosition[] = [];

  // Main backbone — stageNos 1..M with linear chain.
  for (let i = 0; i < spec.mainBackboneLength; i++) {
    const stageNo = i + 1;
    const isLast = i === spec.mainBackboneLength - 1;
    positions.push({
      defaultName: isLast ? "Final API" : `Intermediate-${i + 1}`,
      inputStageNos: i === 0 ? [] : [stageNo - 1],
    });
  }

  // Side chains — laid out AFTER the main backbone in stageNo space, in
  // the order they appear in the spec. Each chain's anchor comes first,
  // then its continuations. The merge happens by appending the chain's
  // LAST stageNo into the corresponding main backbone stage's
  // `inputStageNos`.
  let nextStageNo = spec.mainBackboneLength + 1;
  for (const sc of spec.sideChains) {
    const mergeMainStageNo = Math.max(2, Math.floor(sc.mergesIntoStageNo));
    const baseStageNo = mergeMainStageNo - 1;
    const len = Math.max(1, Math.floor(sc.length));
    const factor = sc.factor > 0 ? sc.factor : 0.3;
    const prefix = (sc.namePrefix && sc.namePrefix.trim()) || "S";

    const chainStageNos: number[] = [];
    for (let k = 0; k < len; k++) {
      const stageNo = nextStageNo++;
      chainStageNos.push(stageNo);
      const isAnchor = k === 0;
      const defaultName =
        len === 1
          ? `${prefix}${mergeMainStageNo}i`
          : `${prefix}${mergeMainStageNo}i_${suffixLetter(k)}`;
      positions.push({
        defaultName,
        inputStageNos: isAnchor ? [] : [stageNo - 1],
        cascadePolicy: isAnchor ? { baseStageNo, factor } : undefined,
      });
    }

    // Wire the merge: append the chain's last stageNo into the main
    // backbone stage at `mergeMainStageNo`.
    const lastSideStageNo = chainStageNos[chainStageNos.length - 1];
    const mainPos = positions[mergeMainStageNo - 1];
    if (mainPos) {
      mainPos.inputStageNos = [...mainPos.inputStageNos, lastSideStageNo];
    }
  }

  return positions;
}

function chainLabel(idx: number): string {
  // 0 → "A", 1 → "B", … 25 → "Z", 26 → "AA", etc. Unlikely to ever exceed
  // 26 in this domain but the wrap is harmless.
  if (idx < 26) return String.fromCharCode(65 + idx);
  const first = Math.floor(idx / 26) - 1;
  const second = idx % 26;
  return chainLabel(first) + String.fromCharCode(65 + second);
}

function suffixLetter(idx: number): string {
  // 0 → "a", 1 → "b", … same wrap-around as chainLabel for length > 26.
  if (idx < 26) return String.fromCharCode(97 + idx);
  return suffixLetter(Math.floor(idx / 26) - 1) + suffixLetter(idx % 26);
}

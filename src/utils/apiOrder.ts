import type { API, Reactor } from "../types";

/**
 * Resolve an API's production block for ordering/grouping:
 *   1. explicit `api.block` (set in the APIs tab), else
 *   2. the production block of the first reactor in the API's FINAL (sink)
 *      stage pool — i.e. where the API stage actually runs (Equipment tab),
 *   3. "" when neither is known.
 */
export function resolveApiBlock(
  api: API,
  reactorBlockById: Map<string, string>
): string {
  const explicit = (api.block ?? "").trim();
  if (explicit) return explicit;
  const consumed = new Set<string>();
  api.stages.forEach((s) =>
    (s.inputStageIds ?? []).forEach((id) => consumed.add(id))
  );
  const sinks = api.stages.filter((s) => !consumed.has(s.id));
  for (const s of sinks) {
    for (const rid of s.reactorPool) {
      const blk = reactorBlockById.get(rid);
      if (blk) return blk;
    }
  }
  return "";
}

/** reactorId → production block map (skips reactors with no block). */
export function buildReactorBlockMap(reactors: Reactor[]): Map<string, string> {
  const m = new Map<string, string>();
  reactors.forEach((r) => {
    const blk = (r.productionBlock ?? "").trim();
    if (blk) m.set(r.id, blk);
  });
  return m;
}

/**
 * Comparator that orders APIs by production block (A→Z, natural/numeric so
 * B1 < B5 < B10), with blank-block APIs sorted last, then A→Z by name, then id.
 */
export function makeApiBlockComparator(
  reactorBlockById: Map<string, string>
): (a: API, b: API) => number {
  const coll = (x: string, y: string) =>
    x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
  return (a, b) => {
    const ba = resolveApiBlock(a, reactorBlockById);
    const bb = resolveApiBlock(b, reactorBlockById);
    if (ba && bb) {
      const c = coll(ba, bb);
      if (c !== 0) return c;
    } else if (ba && !bb) {
      return -1; // APIs with a block come before those without
    } else if (!ba && bb) {
      return 1;
    }
    const nameCmp = coll(a.name || a.id, b.name || b.id);
    return nameCmp !== 0 ? nameCmp : a.id.localeCompare(b.id);
  };
}

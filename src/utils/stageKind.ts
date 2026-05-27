import type { API, StageMaster } from "../types";

export type StageKind = "IM" | "API";

/**
 * Effective IM/API classification for a stage. Honours an explicit
 * `stage.stageKind`; otherwise falls back to the smart default:
 *   sink (final, no-successor) stage ⇒ "API", everything else ⇒ "IM".
 */
export function effectiveStageKind(
  stage: StageMaster,
  isSink: boolean
): StageKind {
  if (stage.stageKind === "IM" || stage.stageKind === "API") {
    return stage.stageKind;
  }
  return isSink ? "API" : "IM";
}

/** Build a stageId → effective IM/API kind map across all APIs. */
export function buildStageKindMap(apis: API[]): Map<string, StageKind> {
  const map = new Map<string, StageKind>();
  apis.forEach((a) => {
    const consumed = new Set<string>();
    a.stages.forEach((s) =>
      (s.inputStageIds ?? []).forEach((id) => consumed.add(id))
    );
    a.stages.forEach((s) => {
      const isSink = !consumed.has(s.id);
      map.set(s.id, effectiveStageKind(s, isSink));
    });
  });
  return map;
}

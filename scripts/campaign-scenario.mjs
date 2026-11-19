// Shared validation scenario for the campaign scheduler (see verify-campaigns.mjs):
// 4 APIs whose final stage shares cleanroom CR-1, 4 campaigns / year each.
export const FY = { startMs: Date.UTC(2026, 3, 1), endMs: Date.UTC(2027, 3, 1) }; // Apr–Mar

const reactor = (id, cls, block) => ({
  id, name: id, moc: "SSR", agitatorType: "Anchor", capacityKg: 2000,
  reactorClass: cls, productionBlock: block,
});
export const reactors = [
  reactor("R101", "INT", "INT-1"), reactor("R102", "INT", "INT-1"),
  reactor("R103", "INT", "INT-1"), reactor("R104", "INT", "INT-1"),
  reactor("R301", "CL", "CR-1"), reactor("R302", "CL", "CR-1"),
];

const stage = (apiId, no, name, pool, planned, bct, inputs, extra = {}) => ({
  id: `${apiId}-S${no}`, apiId, apiName: apiId, stageNo: no, stageName: name,
  batchSizeKg: 100, inputKgPerBatch: 100, reactorPool: pool,
  bcfHours: bct, bctHours: bct, processHours: bct, analysisHours: 24, pcoHours: 12,
  plannedBatches: planned, inputStageIds: inputs, ...extra,
});
const mkApi = (n, color, intPoolA, intPoolB) => {
  const id = `API-0${n}`;
  return {
    id, name: id, color, targetKg: 800, projectionKg: 800, window: FY,
    block: "CR-1", campaignsPerYear: 4,
    stages: [
      stage(id, 1, "Int-1", [intPoolA], 8, 72, []),
      stage(id, 2, "Int-2", [intPoolB], 8, 48, [`${id}-S1`]),
      stage(id, 3, "Final API", ["R301", "R302"], 8, 96, [`${id}-S2`]),
    ],
  };
};
export const apis = [
  mkApi(1, "#ef4444", "R101", "R103"),
  mkApi(2, "#22d3ee", "R101", "R104"),
  mkApi(3, "#a3e635", "R102", "R103"),
  mkApi(4, "#f59e0b", "R102", "R104"),
];

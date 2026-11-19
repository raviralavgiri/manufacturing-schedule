// Campaign-scheduler validation scenario (run: npx tsx scripts/verify-campaigns.mjs)
//
//   • 4 APIs, all with their FINAL stage in the same cleanroom "CR-1"
//     (shared train R301 + R302).
//   • Each API: 4 campaigns / year → 16 campaigns, target one per API per quarter.
//   • Intermediates S1/S2 run on shared intermediate reactors (R101/R102 are
//     shared by two APIs each) and must finish as early as feasible.
//   • Asserts: all 16 campaigns scheduled, each in its target quarter, no
//     clashes, every final batch starts after its intermediate material is
//     released, and intermediates finish long before the year end.
//
// Exits non-zero on any failed assertion.
import { runScheduler } from "../src/scheduler/scheduler.ts";
import { buildCampaignReport } from "../src/scheduler/campaignReport.ts";
import { FY, apis, reactors } from "./campaign-scenario.mjs";

const H = 3600 * 1000;

const schedule = runScheduler(apis, reactors, FY);
const report = buildCampaignReport(apis, reactors, schedule, FY);

const d = (ms) => (ms == null ? "—" : new Date(ms).toISOString().slice(0, 16).replace("T", " "));
let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failed++;
};

console.log("\nCampaign plan");
console.log("API      Camp  Target  Start             End               Batches  Status");
for (const c of report.campaigns)
  console.log(
    `${c.apiName.padEnd(8)} ${String(c.campaignNo).padStart(4)}  Q${c.targetQuarter + 1}      ${d(c.startMs)}  ${d(c.endMs)}  ${c.scheduledBatches}/${c.requiredBatches}      ${c.status}${c.reason ? " — " + c.reason : ""}`
  );

console.log("\nIntermediate completion");
for (const r of report.intermediates)
  console.log(
    `${r.apiName.padEnd(8)} S${r.stageNo} ${r.stageName.padEnd(6)} done ${d(r.completionMs)}  earliest ${d(r.earliestCompletionMs)}  delay ${Math.round(r.delayHours ?? 0)} h  ${r.status}`
  );

console.log("\nCleanroom utilisation");
for (const c of report.cleanrooms)
  console.log(
    `${c.label.padEnd(6)} reactors ${c.reactorCount}  campaigns ${c.campaignsScheduled}/${c.campaignsRequired}  ` +
      c.utilPerQ.map((u, i) => `Q${i + 1} ${(u * 100).toFixed(0)}%`).join("  ") +
      `  APIs: ${c.apiNames.join(", ")}`
  );
console.log("\nIssues:", report.issues.length ? "" : "none");
report.issues.forEach((i) => console.log(`  [${i.severity}] ${i.apiName ?? ""} ${i.msg}`));
console.log("");

check(report.totals.required === 16, `16 campaigns required (got ${report.totals.required})`);
check(report.totals.scheduled === 16, `all 16 campaigns scheduled (got ${report.totals.scheduled})`);
check(report.totals.onTarget === 16, `all 16 campaigns in their target quarter (got ${report.totals.onTarget})`);
for (const a of report.apis)
  check(
    a.scheduledPerQ.every((n) => n === 1),
    `${a.apiName}: one campaign per quarter (${a.scheduledPerQ.join("/")})`
  );
const crPerQ = [0, 1, 2, 3].map((q) => report.campaigns.filter((c) => c.startQuarter === q).length);
check(crPerQ.every((n) => n === 4), `CR-1 runs 4 campaigns in every quarter (${crPerQ.join("/")})`);
check(schedule.clashCount === 0, `no reactor clashes (got ${schedule.clashCount})`);

// Dependency / material readiness: final batch k starts after intermediate batch k is released.
let depOk = true;
for (const api of apis) {
  for (const s of api.stages) {
    for (const pid of s.inputStageIds) {
      const pred = schedule.batches.filter((b) => b.stageId === pid).sort((a, b) => a.analysisEndMs - b.analysisEndMs);
      for (const b of schedule.batches.filter((x) => x.stageId === s.id))
        if (b.startMs < pred[b.batchNo - 1].analysisEndMs) depOk = false;
    }
  }
}
check(depOk, "every batch starts only after its upstream material is released");

const lastIntermediate = Math.max(...report.intermediates.map((r) => r.completionMs ?? 0));
check(
  lastIntermediate < FY.startMs + (FY.endMs - FY.startMs) / 2,
  `all intermediates complete in the first half of the year (last release ${d(lastIntermediate)})`
);
// No avoidable idle time on the first-stage intermediate reactors (no
// material dependency there): batches run back-to-back, with only the PCO
// between the two APIs sharing each reactor. Any "delay" vs the stand-alone
// earliest completion is therefore pure equipment contention.
for (const rid of ["R101", "R102"]) {
  const bs = schedule.batches.filter((b) => b.reactorIds.includes(rid)).sort((a, b) => a.startMs - b.startMs);
  const busy = bs.reduce((a, b) => a + (b.endMs - b.startMs), 0);
  const span = bs[bs.length - 1].endMs - bs[0].startMs;
  const idle = (span - busy) / H;
  check(bs[0].startMs === FY.startMs && idle <= 12, `${rid}: starts at year start, back-to-back (idle ${idle} h = PCO only)`);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);

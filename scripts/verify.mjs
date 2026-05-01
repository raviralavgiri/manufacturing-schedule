// Quick verification: run scheduler outside React and assert spec numbers.
// Uses tsx to compile TS on the fly.
import { buildSeed } from "../src/data/seed.ts";
import { runScheduler } from "../src/scheduler/scheduler.ts";

const { apis, reactors } = buildSeed();
const totalStages = apis.reduce((a, b) => a + b.stages.length, 0);
const plannedBatches = apis.reduce(
  (a, b) => a + b.stages.reduce((s, st) => s + st.plannedBatches, 0),
  0
);

console.log("APIs        :", apis.length);
console.log("Total stages:", totalStages);
console.log("Reactors    :", reactors.length);
console.log("Planned bts :", plannedBatches);

const sched = runScheduler(apis, reactors);
console.log("Scheduled   :", sched.totalBatches);
console.log("In FY       :", sched.fyBatches);
console.log("Overflow    :", sched.overflowBatches);
console.log("Clashes     :", sched.clashCount);
console.log(
  "Reactors used:",
  Object.entries(sched.reactorUsage)
    .map(([id, u]) => `${id}=${u.batchCount}`)
    .join(" ")
);

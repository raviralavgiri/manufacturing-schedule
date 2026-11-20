// Excel export → re-import round trip (run: npx tsx scripts/verify-excel-roundtrip.mts [out.xlsx]).
// Checks the Stages "Equipment" cell format R105/R203/R118,R114,R119 (main ,
// optional /) and that every input field survives export + import.
import { computeWeeks } from "../src/utils/dates.ts";
import { buildSeed } from "../src/data/seed.ts";
import { runScheduler } from "../src/scheduler/scheduler.ts";
import { buildGlobalWorkbook } from "../src/utils/exporters.ts";
import { parseExcelFile, parseEquipmentCell } from "../src/utils/excelImport.ts";
import ExcelJS from "exceljs";
import { cascadePlannedBatches } from "../src/scheduler/cascade.ts";
import fs from "fs";

const OUT = process.argv[2];
let fail = 0;
const check = (ok: boolean, m: string) => { console.log(ok ? "PASS" : "FAIL", m); if (!ok) fail++; };

// 1. Cell parser
const p = parseEquipmentCell("R-105/R-203/R-118,R-114,R-119");
check(JSON.stringify(p) === JSON.stringify({ pool: ["R-105","R-114","R-119"], substitutes: { "R-105": ["R-203","R-118"] } }), `parse "R-105/R-203/R-118,R-114,R-119" -> ${JSON.stringify(p)}`);
check(JSON.stringify(parseEquipmentCell(" R101 , R102 / R103 ")) === JSON.stringify({ pool: ["R101","R102"], substitutes: { R102: ["R103"] } }), "spaces ignored");

// 2. Round trip with substitutes, process, kind, maintenance, display name
const seed = buildSeed();
// The app always holds cascade-derived planned batches (the importer runs the
// same cascade), so compare against the cascaded model.
const apis = seed.apis.map(cascadePlannedBatches);
const reactors = seed.reactors;
console.info = () => {}; // silence the importer's diagnostic dump
const api = apis[0];
const st = [...api.stages].sort((a, b) => a.stageNo - b.stageNo)[1];
const ids = reactors.map(r => r.id);
const pool = ids.slice(0, 3);
st.reactorPool = pool;
st.reactorSubstitutes = { [pool[0]]: [ids[5], ids[6]] };
st.processHours = Math.max(1, st.bctHours - 10);
st.stageKind = "IM";
reactors[0].pmDurationDays = 5;
reactors[0].buildingMaintenanceFirstDateMs = Date.UTC(2026, 5, 1);
reactors[0].name = "Reactor-A";
reactors[0].reactorClass = "CL";
const schedule = runScheduler(apis, reactors);
const wb = await buildGlobalWorkbook({ apis, reactors, schedule, weeks: computeWeeks(Date.UTC(2026,3,1), Date.UTC(2027,3,1)) } as any);
const buf = await wb.xlsx.writeBuffer();
if (OUT) fs.writeFileSync(OUT, Buffer.from(buf));

// check the cell text in the sheet
const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(buf);
const sh = wb2.getWorksheet("Stages")!;
let cellText = "";
sh.eachRow((row, rn) => { if (rn > 2 && row.getCell(1).value === api.name && row.getCell(2).value === st.stageName) cellText = String(row.getCell(12).value); });
const expected = `${pool[0]}/${ids[5]}/${ids[6]},${pool[1]},${pool[2]}`;
check(cellText === expected, `Stages sheet equipment cell = "${cellText}" (expected "${expected}")`);
let rows = 0; sh.eachRow((_, rn) => { if (rn > 2) rows++; });
const stageCount = apis.reduce((n, a) => n + a.stages.length, 0);
check(rows === stageCount, `one row per stage (${rows} rows, ${stageCount} stages)`);

const file = new File([buf], "x.xlsx");
const res = await parseExcelFile(file);
const api2 = res.apis.find(a => a.name === api.name)!;
const st2 = api2.stages.find(s => s.stageName === st.stageName)!;
check(JSON.stringify(st2.reactorPool) === JSON.stringify(pool), `re-imported pool ${st2.reactorPool}`);
check(JSON.stringify(st2.reactorSubstitutes) === JSON.stringify(st.reactorSubstitutes), `re-imported substitutes ${JSON.stringify(st2.reactorSubstitutes)}`);
check(st2.processHours === st.processHours, `process hours ${st2.processHours}`);
check(st2.stageKind === "IM", "stage type kept");
const r0 = res.reactors.find(r => r.id === reactors[0].id)!;
check(r0.pmDurationDays === 5 && r0.buildingMaintenanceFirstDateMs === Date.UTC(2026,5,1) && r0.name === "Reactor-A" && r0.reactorClass === "CL", "equipment PM duration, building maintenance, name, class kept");
// whole-model comparison of stage params + flow
let same = true;
for (const a of apis) {
  const b = res.apis.find(x => x.name === a.name);
  if (!b) { same = false; console.log("missing api", a.name); continue; }
  for (const s of a.stages) {
    const t = b.stages.find(x => x.stageNo === s.stageNo);
    const nm = (ap: any, idList: string[]) => idList.map(id => ap.stages.find((x: any) => x.id === id)?.stageName).sort().join();
    const keys = ["stageName","batchSizeKg","inputKgPerBatch","bcfHours","bctHours","processHours","analysisHours","pcoHours","plannedBatches"] as const;
    if (!t || keys.some(k => (s as any)[k] !== (t as any)[k]) || JSON.stringify(s.reactorPool) !== JSON.stringify(t.reactorPool) || nm(a, s.inputStageIds) !== nm(b, t.inputStageIds)) {
      same = false; console.log("diff", a.name, s.stageNo, keys.filter(k => t && (s as any)[k] !== (t as any)[k]));
    }
  }
}
check(same, `all ${stageCount} stages: parameters, reactor pools and stage flow identical after re-import`);
console.log("warnings:", res.warnings.slice(0, 5));
process.exit(fail ? 1 : 0);

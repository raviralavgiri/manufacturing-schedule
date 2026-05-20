/**
 * Excel import parser for the standard three-sheet template:
 *   "API"              — API list with topology spec (data from row 6, cols B–Y)
 *                        B(2)=Sl.No  C(3)=Name  D(4)=TargetKg  E(5)=Start  F(6)=End
 *                        G(7)=Topology  H(8)=TotalStages  I(9)=MainStages
 *                        Side chains:  J/K/L  M/N/O  P/Q/R  (merge / factor / length)
 *                        Parallel:     S/T/U sub-chain lengths, V/W/X merge & factors
 *                        Y(25)=PlannedBatches (optional override; cascade still runs)
 *   "Stages"           — Per-stage operational params (data from row 3, cols A–N)
 *                        A=API  B=Stage  C=Input/Batch  D=Output/Batch
 *                        E=BCF  F=BCT  G=Analysis  H=PCO
 *                        I=Nos  J=Main  K–N=Substitutes P1–P4
 *                        O(15)=ProcessHours (optional; falls back to BCT)
 *                        Stage numbers are assigned by encounter order per API,
 *                        so names like "DT1", "DT2C", "AX7" work without regex.
 *   "Master Equipment" — Reactor registry (data from row 3, cols A–I)
 *                        A=Sl.No  B=Unit  C=Block  D=Class (CL/INT)  E=Name
 *                        F=MOC  G=Agitator  H=Capacity (L)  I=PM First Date
 *
 * ExcelJS is dynamically imported so it stays out of the main bundle.
 */
import type { API, Reactor } from "../types";
import { migrateMoc, migrateAgitator } from "./storage";
import {
  applyTopologyPresetToApi,
  type TopologyPresetSpec,
} from "./topologyPresets";
import { cascadePlannedBatches } from "../scheduler/cascade";
import { refreshPaletteColors } from "../data/seed";
import { FY_END_MS, FY_START_MS } from "./dates";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ImportResult {
  apis: API[];
  reactors: Reactor[];
  warnings: string[];
  stats: { apiCount: number; stageCount: number; reactorCount: number };
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

// ─── Cell value helpers ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCell = any;

function cellStr(cell: AnyCell): string | null {
  const v = cell?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return v.toISOString();
  // Rich text
  if (v && typeof v === "object" && Array.isArray(v.richText)) {
    return (v.richText as Array<{ text: string }>)
      .map((r) => r.text)
      .join("")
      .trim() || null;
  }
  // Formula result
  if (v && typeof v === "object" && "result" in v) {
    const r = v.result;
    if (r === null || r === undefined) return null;
    return typeof r === "string" ? r.trim() || null : String(r);
  }
  return String(v).trim() || null;
}

function cellNum(cell: AnyCell): number | null {
  const v = cell?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in v) {
    const r = v.result;
    return typeof r === "number" ? r : null;
  }
  const p = parseFloat(String(v));
  return isNaN(p) ? null : p;
}

function cellDate(cell: AnyCell): number | null {
  const v = cell?.value;
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  if (typeof v === "number") {
    // Excel serial (days since 1899-12-30, with leap-year bug)
    const d = new Date((v - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
}

function isNA(cell: AnyCell): boolean {
  const s = cellStr(cell);
  if (s === null) return true;
  return s.toUpperCase() === "NA" || s === "" || s === "-";
}

/** Lower-cased, trimmed key for case-insensitive API name matching across sheets. */
function normalizeKey(s: string): string {
  return s.toLowerCase();
}

/** Strip internal whitespace so "GLR 102" (Equipment) matches "GLR102" (Stages). */
function normalizeReactorId(s: string | null): string | null {
  if (s === null) return null;
  const cleaned = s.replace(/\s+/g, "");
  return cleaned === "" ? null : cleaned;
}

// ─── Internal stage data structure ───────────────────────────────────────────

interface ParsedStageData {
  stageName: string;
  inputKgPerBatch: number;
  batchSizeKg: number;
  bcfHours: number;
  bctHours: number;
  processHours: number;
  analysisHours: number;
  pcoHours: number;
  reactorPool: string[];
  reactorSubstitutes: Record<string, string[]>;
}

// ─── Main parse function ──────────────────────────────────────────────────────

export async function parseExcelFile(file: File): Promise<ImportResult> {
  const warnings: string[] = [];

  // Dynamic import — keeps ExcelJS out of the main bundle.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

  // Validate required sheets
  const apiSheet = wb.getWorksheet("API");
  const stagesSheet = wb.getWorksheet("Stages");
  const equipSheet = wb.getWorksheet("Master Equipment");
  const missing = (
    [
      !apiSheet && "API",
      !stagesSheet && "Stages",
      !equipSheet && "Master Equipment",
    ] as (string | false)[]
  ).filter(Boolean) as string[];
  if (missing.length > 0) {
    throw new ImportError(
      `Missing required sheet${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`
    );
  }

  // ── 1. Master Equipment → Reactor[] ────────────────────────────────────────
  const reactors: Reactor[] = [];
  const reactorIds = new Set<string>();
  equipSheet!.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn <= 2) return; // rows 1–2 are headers
    const equipId = normalizeReactorId(cellStr(row.getCell(5))); // col E: NAME
    if (!equipId) return;
    if (reactorIds.has(equipId)) {
      warnings.push(`Duplicate equipment ID "${equipId}" at row ${rn} — skipped.`);
      return;
    }
    const prodBlock = cellStr(row.getCell(3));  // col C: BLOCK
    const rawClass = cellStr(row.getCell(4));   // col D: CLASS (CL/INT)
    const moc = cellStr(row.getCell(6));        // col F: MOC
    const agitator = cellStr(row.getCell(7));   // col G: AGITATOR
    const cap = cellNum(row.getCell(8));        // col H: CAP.(L)
    const pmDate = cellDate(row.getCell(9));    // col I: PM FIRST DATE
    // Optional extended-template columns (this template only goes through I,
    // but accept them when present for forwards-compat with richer files).
    const pmDays = cellNum(row.getCell(12));    // col L: PM Duration (days), if present
    const bmDate = cellDate(row.getCell(13));   // col M: Building Maint. First Date, if present

    const rawClassUp = (rawClass ?? "").toUpperCase();
    const reactorClass =
      rawClassUp === "CL" || rawClassUp === "INT"
        ? (rawClassUp as "CL" | "INT")
        : undefined;

    reactorIds.add(equipId);
    reactors.push({
      id: equipId,
      name: equipId,
      moc: migrateMoc(moc),
      agitatorType: migrateAgitator(agitator),
      capacityKg: cap ?? 0,
      ...(reactorClass !== undefined ? { reactorClass } : {}),
      ...(prodBlock ? { productionBlock: prodBlock } : {}),
      ...(pmDate !== null ? { pmFirstDateMs: pmDate } : {}),
      ...(pmDays !== null ? { pmDurationDays: pmDays } : {}),
      ...(bmDate !== null ? { buildingMaintenanceFirstDateMs: bmDate } : {}),
    });
  });

  // ── 2. Stages sheet → Map<apiName, Map<stageNo, ParsedStageData>> ──────────
  //
  // Data starts at row 3 (rows 1–2 are merged group/sub headers).
  // Stage numbers are assigned by encounter order per API — the Excel sheet
  // lists stages in topology order, so the Nth distinct stage name for an API
  // becomes stageNo N. This handles names like "DT1", "DT2C", "DT3I", "AX7"
  // uniformly without trying to extract numbers from the name itself.
  //
  // Multi-reactor rows repeat (or merge) the API + Stage columns:
  //   first row has all cols A–H filled + col I=Nos + col J=reactor1
  //   continuation rows may repeat A/B or leave them blank (merged cells)
  // Substitutes P1–P4 (cols K–N) are per reactor row.
  const stageDataByApi = new Map<string, Map<number, ParsedStageData>>();
  const stageNameToNo = new Map<string, Map<string, number>>(); // per-API: name → stageNo
  const stageNoCounter = new Map<string, number>();             // per-API: next number
  let carryApi = "";
  let carryStageNo: number | null = null;
  let carryStageStr = "";

  stagesSheet!.eachRow({ includeEmpty: true }, (row, rn) => {
    if (rn <= 2) return; // rows 1–2 are headers; data starts row 3

    const rawApi = cellStr(row.getCell(1));   // col A
    const rawStage = cellStr(row.getCell(2)); // col B

    if (rawApi) carryApi = rawApi;
    if (rawStage && carryApi) {
      carryStageStr = rawStage;
      const apiKey = normalizeKey(carryApi);
      let nameMap = stageNameToNo.get(apiKey);
      if (!nameMap) {
        nameMap = new Map();
        stageNameToNo.set(apiKey, nameMap);
      }
      const existing = nameMap.get(rawStage);
      if (existing !== undefined) {
        carryStageNo = existing;
      } else {
        const nextNo = (stageNoCounter.get(apiKey) ?? 0) + 1;
        stageNoCounter.set(apiKey, nextNo);
        nameMap.set(rawStage, nextNo);
        carryStageNo = nextNo;
      }
    }

    if (!carryApi || !carryStageNo) return;

    // Use normalised key so API names that differ only in case still match.
    const apiKey = normalizeKey(carryApi);
    let stageMap = stageDataByApi.get(apiKey);
    if (!stageMap) {
      stageMap = new Map();
      stageDataByApi.set(apiKey, stageMap);
    }

    // First row for this stage: capture stage-level params
    if (!stageMap.has(carryStageNo)) {
      const bct = cellNum(row.getCell(6)) ?? 120;        // col F: BCT
      stageMap.set(carryStageNo, {
        stageName: carryStageStr,
        inputKgPerBatch: cellNum(row.getCell(3)) ?? 100, // col C
        batchSizeKg: cellNum(row.getCell(4)) ?? 100,     // col D
        bcfHours: cellNum(row.getCell(5)) ?? 120,        // col E
        bctHours: bct,
        processHours: cellNum(row.getCell(15)) ?? bct,   // col O (optional; defaults to bct)
        analysisHours: cellNum(row.getCell(7)) ?? 0,     // col G
        pcoHours: cellNum(row.getCell(8)) ?? 8,          // col H
        reactorPool: [],
        reactorSubstitutes: {},
      });
    }

    // Reactor row: col J = Main reactor ID; cols K–N = substitutes P1–P4
    const mainReactor = normalizeReactorId(cellStr(row.getCell(10)));
    if (!mainReactor || isNA(row.getCell(10))) return;

    const data = stageMap.get(carryStageNo)!;
    if (!data.reactorPool.includes(mainReactor)) {
      data.reactorPool.push(mainReactor);
    }
    const subs = [
      row.getCell(11), // P1
      row.getCell(12), // P2
      row.getCell(13), // P3
      row.getCell(14), // P4
    ]
      .map((c) => {
        if (isNA(c)) return null;
        return normalizeReactorId(cellStr(c));
      })
      .filter((s): s is string => s !== null);
    if (subs.length > 0) {
      data.reactorSubstitutes[mainReactor] = subs;
    }
  });

  // ── 3. API sheet → build API objects ───────────────────────────────────────
  //
  // Headers: row 4 (group labels) + row 5 (sub-labels). Data starts at row 6.
  // Col layout (1-based):
  //   B(2)=Sl.No  C(3)=Name  D(4)=TargetKg  E(5)=Start  F(6)=End
  //   G(7)=Topology  H(8)=TotalStages  I(9)=MainStages
  //   Side-chain: J(10)=SC1merge  K(11)=SC1factor  L(12)=SC1length
  //               M(13)=SC2merge  N(14)=SC2factor  O(15)=SC2length
  //               P(16)=SC3merge  Q(17)=SC3factor  R(18)=SC3length
  //   Parallel:   S(19)=chainA  T(20)=chainB  U(21)=chainC
  //               V(22)=mergeStageNo  W(23)=f1  X(24)=f2

  const rawApis: API[] = [];

  apiSheet!.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn <= 5) return; // skip header rows

    const name = cellStr(row.getCell(3)); // col C
    if (!name) return;

    const targetKg = cellNum(row.getCell(4)) ?? 0;
    const startMs = cellDate(row.getCell(5)) ?? FY_START_MS;
    const endMs = cellDate(row.getCell(6)) ?? FY_END_MS;
    const topoStr = (cellStr(row.getCell(7)) ?? "Linear").toLowerCase();
    const mainStages = Math.max(1, cellNum(row.getCell(9)) ?? 1); // col I
    const plannedBatchesOverride = cellNum(row.getCell(25)) ?? null; // col Y

    // Look up Stages sheet data now (normalised key) so it's available to both
    // the linear-length calculation and the per-stage overlay below.
    const stageMap = stageDataByApi.get(normalizeKey(name));

    // Build topology spec
    let topoSpec: TopologyPresetSpec;
    let topology: API["topology"] = "linear";

    if (topoStr.includes("side") || topoStr.includes("chain")) {
      topology = "side_chains";
      const sideChains: Array<{
        mergesIntoStageNo: number;
        factor: number;
        length: number;
      }> = [];
      // SC1: J K L
      if (!isNA(row.getCell(10))) {
        const m = cellNum(row.getCell(10));
        const f = cellNum(row.getCell(11));
        const l = cellNum(row.getCell(12)) ?? 1;
        if (m !== null && f !== null) sideChains.push({ mergesIntoStageNo: m, factor: f, length: l });
      }
      // SC2: M N O
      if (!isNA(row.getCell(13))) {
        const m = cellNum(row.getCell(13));
        const f = cellNum(row.getCell(14));
        const l = cellNum(row.getCell(15)) ?? 1;
        if (m !== null && f !== null) sideChains.push({ mergesIntoStageNo: m, factor: f, length: l });
      }
      // SC3: P Q R
      if (!isNA(row.getCell(16))) {
        const m = cellNum(row.getCell(16));
        const f = cellNum(row.getCell(17));
        const l = cellNum(row.getCell(18)) ?? 1;
        if (m !== null && f !== null) sideChains.push({ mergesIntoStageNo: m, factor: f, length: l });
      }
      topoSpec = {
        kind: "side_chains",
        mainBackboneLength: mainStages,
        sideChains:
          sideChains.length > 0
            ? sideChains
            : [{ mergesIntoStageNo: 2, factor: 0.3, length: 1 }],
      };
    } else if (topoStr.includes("parallel")) {
      topology = "parallel";
      const subA = cellNum(row.getCell(19)) ?? 0; // col S
      const subB = cellNum(row.getCell(20)) ?? 0; // col T
      const subCVal = cellNum(row.getCell(21));    // col U
      const subChainLengths = [subA, subB].filter((n) => n > 0);
      if (subCVal !== null && !isNA(row.getCell(21))) subChainLengths.push(subCVal);
      // postMergeCount = mainStages - 1 (merge stage counts as 1 of mainStages)
      const postMerge = Math.max(0, mainStages - 1);
      topoSpec = {
        kind: "parallel",
        subChainCount: subChainLengths.length,
        subChainLengths: subChainLengths.length > 0 ? subChainLengths : [2, 2],
        mergeStageName: "Merge",
        postMergeCount: postMerge,
      };
    } else {
      topology = "linear";
      // Pass stage count so applyTopologyPresetToApi scaffolds from scratch.
      // Guard against stageMap.size===0 (stage names unreadable) — fall back
      // to mainStages from the API sheet so we at least get the right count.
      const linearLength =
        (stageMap?.size ?? 0) > 0 ? stageMap!.size : Math.max(1, mainStages);
      topoSpec = { kind: "linear", length: linearLength };
    }

    // (stageMap already looked up above)
    const first = stageMap?.get(1);
    const defaults = {
      batchSizeKg: first?.batchSizeKg ?? 100,
      inputKgPerBatch: first?.inputKgPerBatch ?? 100,
      bcfHours: first?.bcfHours ?? 120,
      bctHours: first?.bctHours ?? 120,
      processHours: first?.processHours ?? first?.bctHours ?? 120,
      analysisHours: first?.analysisHours ?? 0,
      pcoHours: first?.pcoHours ?? 8,
      plannedBatches: plannedBatchesOverride ?? 1,
      reactorPool: first?.reactorPool.slice() ?? [],
    };

    const apiId = `IMP-${String(rawApis.length + 1).padStart(2, "0")}`;
    const baseApi: API = {
      id: apiId,
      name,
      color: "#22d3ee",
      targetKg,
      projectionKg: targetKg,
      topology,
      stages: [],
      window: { startMs, endMs },
    };

    // Scaffold stages with correct DAG wiring via topology preset
    const scaffolded = applyTopologyPresetToApi(baseApi, topoSpec, defaults);

    // Overlay per-stage params from Stages sheet (matched by stageNo)
    const stages = scaffolded.stages.map((stage) => {
      const data = stageMap?.get(stage.stageNo);
      if (!data) return stage;
      return {
        ...stage,
        stageName: data.stageName || stage.stageName,
        batchSizeKg: data.batchSizeKg,
        inputKgPerBatch: data.inputKgPerBatch,
        bcfHours: data.bcfHours,
        bctHours: data.bctHours,
        processHours: data.processHours,
        analysisHours: data.analysisHours,
        pcoHours: data.pcoHours,
        reactorPool: data.reactorPool.slice(),
        ...(Object.keys(data.reactorSubstitutes).length > 0
          ? { reactorSubstitutes: { ...data.reactorSubstitutes } }
          : {}),
      };
    });

    rawApis.push({ ...scaffolded, stages });
  });

  if (rawApis.length === 0) {
    throw new ImportError(
      "No API rows found. Data must start at row 6 with an API name in column C."
    );
  }

  // Apply palette colors, then run cascade on each API
  const apis = (refreshPaletteColors(rawApis) as API[]).map(
    cascadePlannedBatches
  );

  // Diagnostic: surface any API whose stages came back with empty reactor
  // pools — that's almost always a sign the Stages sheet wasn't parsed
  // correctly for that API (e.g. name mismatch between API sheet and
  // Stages sheet).
  apis.forEach((api) => {
    const emptyPoolCount = api.stages.filter(
      (s) => !s.reactorPool || s.reactorPool.length === 0
    ).length;
    if (emptyPoolCount === api.stages.length && api.stages.length > 0) {
      warnings.push(
        `API "${api.name}": all ${api.stages.length} stages have empty reactor pools — check the Stages sheet has rows for this API name (case-insensitive match).`
      );
    } else if (emptyPoolCount > 0) {
      warnings.push(
        `API "${api.name}": ${emptyPoolCount} of ${api.stages.length} stages have no reactors assigned.`
      );
    }
  });

  // Warn about reactors referenced in stages but absent from Equipment sheet
  const allRefsInStages = new Set<string>();
  apis.forEach((api) =>
    api.stages.forEach((stage) => {
      stage.reactorPool.forEach((r) => allRefsInStages.add(r));
      Object.values(stage.reactorSubstitutes ?? {})
        .flat()
        .forEach((r) => allRefsInStages.add(r));
    })
  );
  allRefsInStages.forEach((r) => {
    if (!reactorIds.has(r)) {
      warnings.push(
        `Reactor "${r}" is referenced in Stages but not in the Equipment sheet — it will appear as unknown in the scheduler.`
      );
    }
  });

  // Dev-console diagnostic so users can verify exactly what landed in
  // the import — invaluable when a UI shows defaults and the user isn't
  // sure whether parsing failed or the import wasn't applied.
  if (typeof console !== "undefined") {
    // eslint-disable-next-line no-console
    console.info(
      `[Excel import] ${apis.length} APIs · ${apis.reduce(
        (n, a) => n + a.stages.length,
        0
      )} stages · ${reactors.length} reactors`,
      apis.map((a) => ({
        name: a.name,
        topology: a.topology,
        stages: a.stages.map((s) => ({
          n: s.stageNo,
          name: s.stageName,
          pool: s.reactorPool,
          subs: s.reactorSubstitutes ?? {},
        })),
      }))
    );
  }

  const stageCount = apis.reduce((n, a) => n + a.stages.length, 0);
  return {
    apis,
    reactors,
    warnings,
    stats: { apiCount: apis.length, stageCount, reactorCount: reactors.length },
  };
}

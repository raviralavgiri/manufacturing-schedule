/**
 * Excel import parser for the standard three-sheet template:
 *   "API"              — API list (data from row 6). Columns follow the APIs tab
 *                        (positions in excelLayout.ts → API_COLS):
 *                        B=Sl.No  C=API Name  D=Seq  E=Block  F=Camp/yr
 *                        G=Q split  H=Plan start  I=Plan end  J=Stages
 *                        K=Target (kg)  L=Stage flow  M=Main stages
 *                        Side chains: N/O/P  Q/R/S  T/U/V (merge / factor / length)
 *                        Parallel:    W/X/Y sub-chain lengths, Z=f1 AA=f2
 *                        Fork:        AB=shared preamble AC=branches AD=stages/branch
 *                        AE=Q sequence "r1,r2,r3,r4"
 *                        Older files (Target kg in F, API_COLS_LEGACY) still import.
 *   "Stages"           — Per-stage operational params (data from row 3, cols A–P)
 *                        A=API  B=Stage  C=FirstBatchStart  D=ExistingStock(kg)
 *                        E=Input/Batch  F=Output/Batch  G=BCF  H=BCT
 *                        I=Analysis  J=PCO  K=Nos
 *                        Current layout (header L starts "Equipment"), one row
 *                        per stage:
 *                          L=Equipment  "R105/R203/R118,R114,R119" — main
 *                            reactors separated by commas, each followed by its
 *                            optional substitutes separated by slashes
 *                          M=Process (h)  N=Input from stages (names, commas)
 *                          O=Type (IM/API)
 *                        Legacy layout, one row per main reactor:
 *                          L=Main  M–P=Substitutes P1–P4
 *                        Stage numbers are assigned by encounter order per API,
 *                        so names like "DT1", "DT2C", "AX7" work without regex.
 *   "Master Equipment" — Reactor registry (data from row 3, cols A–L)
 *                        A=Sl.No  B=Unit  C=Block  D=Class (CL/INT)  E=Name
 *                        F=MOC  G=Agitator  H=Capacity (L)  I=PM First Date
 *                        J=PM Duration (days)  K=Building Maint. First Date
 *                        L=Display name
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
import { validateApiDag } from "./validation";
import { API_COLS, API_COLS_LEGACY, isCurrentApiLayout } from "./excelLayout";

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
  /** Optional per-stage first-batch start date (ms) — col C. */
  firstBatchStartMs: number | null;
  /** Optional existing on-hand stock (kg) — col D. */
  existingStockKg: number | null;
  /** Current layout only: IM / API classification — col O. */
  stageKind?: "IM" | "API";
  /** Current layout only: predecessor stage NAMES — col N (null = not given). */
  inputFromNames: string[] | null;
}

/**
 * Parse an Equipment cell: main reactors separated by commas, each followed
 * by its optional substitutes separated by slashes (priority order).
 *   "R105/R203/R118,R114,R119" →
 *     pool [R105, R114, R119], substitutes { R105: [R203, R118] }
 * Spaces are ignored; NA / "-" entries are skipped.
 */
export function parseEquipmentCell(text: string | null): {
  pool: string[];
  substitutes: Record<string, string[]>;
} {
  const pool: string[] = [];
  const substitutes: Record<string, string[]> = {};
  if (!text) return { pool, substitutes };
  for (const group of text.split(/[,;\n]/)) {
    const ids = group
      .split("/")
      .map((t) => normalizeReactorId(t))
      .filter((t): t is string => !!t && t.toUpperCase() !== "NA" && t !== "-");
    if (ids.length === 0) continue;
    const [main, ...subs] = ids;
    if (!pool.includes(main)) pool.push(main);
    const uniq = subs.filter((x, i) => x !== main && subs.indexOf(x) === i);
    if (uniq.length > 0) substitutes[main] = [...(substitutes[main] ?? []), ...uniq];
  }
  return { pool, substitutes };
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
  const equipHasNewCols = /^PM\s*Duration/i.test(
    cellStr(equipSheet!.getRow(2).getCell(10)) ?? ""
  );
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
    // Extended columns. Current export: J = PM duration (days), K = building
    // maintenance first date, L = display name. Older richer files put PM
    // duration in L and the building-maintenance date in M — still accepted.
    const pmDays = equipHasNewCols
      ? cellNum(row.getCell(10))
      : cellNum(row.getCell(12));
    const bmDate = equipHasNewCols
      ? cellDate(row.getCell(11))
      : cellDate(row.getCell(13));
    const displayName = equipHasNewCols ? cellStr(row.getCell(12)) : null;

    const rawClassUp = (rawClass ?? "").toUpperCase();
    const reactorClass =
      rawClassUp === "CL" || rawClassUp === "INT"
        ? (rawClassUp as "CL" | "INT")
        : undefined;

    reactorIds.add(equipId);
    reactors.push({
      id: equipId,
      name: displayName || equipId,
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
  // Current layout = one row per stage with an "Equipment …" column L.
  const stagesOneRowLayout = /^Equipment/i.test(
    cellStr(stagesSheet!.getRow(2).getCell(12)) ?? ""
  );

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

    // First row for this stage: capture stage-level params.
    // Column layout (1-based): A=API B=Stage C=FirstBatchStart D=ExistingStock
    //   E=Input/Batch F=Output/Batch G=BCF H=BCT I=Analysis J=PCO K=Nos
    //   L=Main M=P1 N=P2 O=P3 P=P4. (No process-hours column — defaults to BCT.)
    if (!stageMap.has(carryStageNo)) {
      const bct = cellNum(row.getCell(8)) ?? 120;        // col H: BCT
      stageMap.set(carryStageNo, {
        stageName: carryStageStr,
        firstBatchStartMs: cellDate(row.getCell(3)),     // col C (optional)
        existingStockKg: cellNum(row.getCell(4)),        // col D (optional)
        inputKgPerBatch: cellNum(row.getCell(5)) ?? 100, // col E
        batchSizeKg: cellNum(row.getCell(6)) ?? 100,     // col F
        bcfHours: cellNum(row.getCell(7)) ?? 120,        // col G
        bctHours: bct,
        processHours: bct,                                // no column; = BCT
        analysisHours: cellNum(row.getCell(9)) ?? 0,     // col I
        pcoHours: cellNum(row.getCell(10)) ?? 8,         // col J
        reactorPool: [],
        reactorSubstitutes: {},
        inputFromNames: null,
      });
      if (stagesOneRowLayout) {
        const d = stageMap.get(carryStageNo)!;
        const proc = cellNum(row.getCell(13));             // col M: Process (h)
        if (proc !== null && proc > 0) d.processHours = Math.min(proc, d.bctHours);
        const from = cellStr(row.getCell(14));             // col N: Input from
        d.inputFromNames = from
          ? from.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean)
          : [];
        const kind = (cellStr(row.getCell(15)) ?? "").toUpperCase(); // col O
        if (kind === "IM" || kind === "API") d.stageKind = kind;
      }
    }

    if (stagesOneRowLayout) {
      // col L: "R105/R203/R118,R114,R119" (main , optional /). A stage may
      // continue on following rows with more equipment groups.
      const { pool, substitutes } = parseEquipmentCell(cellStr(row.getCell(12)));
      const d = stageMap.get(carryStageNo)!;
      pool.forEach((rid) => {
        if (!d.reactorPool.includes(rid)) d.reactorPool.push(rid);
      });
      Object.entries(substitutes).forEach(([rid, subs]) => {
        d.reactorSubstitutes[rid] = [...(d.reactorSubstitutes[rid] ?? []), ...subs];
      });
      return;
    }

    // Reactor row: col L = Main reactor ID; cols M–P = substitutes P1–P4
    const mainReactor = normalizeReactorId(cellStr(row.getCell(12)));
    if (!mainReactor || isNA(row.getCell(12))) return;

    const data = stageMap.get(carryStageNo)!;
    if (!data.reactorPool.includes(mainReactor)) {
      data.reactorPool.push(mainReactor);
    }
    const subs = [
      row.getCell(13), // P1
      row.getCell(14), // P2
      row.getCell(15), // P3
      row.getCell(16), // P4
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
  // Headers: rows 1–4 (group labels) + row 5 (sub-labels). Data starts row 6.
  // Column positions come from excelLayout.ts (current = APIs-tab order,
  // legacy = previous layout), picked from the column-F header.

  const rawApis: API[] = [];

  // Current layout follows the APIs tab (Camp/yr in column F); older files
  // have Target kg in F. See excelLayout.ts.
  const C = isCurrentApiLayout(cellStr(apiSheet!.getRow(5).getCell(6)))
    ? API_COLS
    : API_COLS_LEGACY;

  apiSheet!.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn <= 5) return; // skip header rows

    const name = cellStr(row.getCell(C.name));
    if (!name) return;

    const sequence = cellNum(row.getCell(C.seq)); // (optional)
    const block = cellStr(row.getCell(C.block)); // (optional)
    const targetKg = cellNum(row.getCell(C.target)) ?? 0;
    const startMs = cellDate(row.getCell(C.start)) ?? FY_START_MS;
    const endMs = cellDate(row.getCell(C.end)) ?? FY_END_MS;
    const topoStr = (cellStr(row.getCell(C.flow)) ?? "Linear").toLowerCase();
    const mainStages = Math.max(1, cellNum(row.getCell(C.mainStages)) ?? 1);
    const plannedBatchesOverride = null; // no API-level override column
    const campaignsRaw = cellNum(row.getCell(C.camp)); // (optional)
    const campaignsPerYear =
      campaignsRaw !== null && Number.isFinite(campaignsRaw) && campaignsRaw > 0
        ? Math.round(campaignsRaw)
        : undefined;
    const splitStr = cellStr(row.getCell(C.split)); // (optional)
    const splitParts = splitStr
      ? splitStr.split(/[\s,;/]+/).filter(Boolean).map(Number)
      : [];
    // Kept as typed even when it doesn't sum to campaigns/yr — the campaign
    // report flags the mismatch instead of silently changing the plan.
    const seqStr = cellStr(row.getCell(C.qSequence)); // (optional)
    const seqParts = seqStr ? seqStr.split(/[,;/]/).map((t) => t.trim()) : [];
    const quarterSequence =
      seqParts.length === 4
        ? seqParts.map((t) => {
            const n = Math.round(Number(t));
            return t !== "" && Number.isFinite(n) && n > 0 ? n : null;
          })
        : undefined;
    const campaignQuarterSplit =
      splitParts.length === 4 && splitParts.every((n) => Number.isInteger(n) && n >= 0)
        ? splitParts
        : undefined;

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
      if (!isNA(row.getCell(C.sc[0]))) {
        const m = cellNum(row.getCell(C.sc[0]));
        const f = cellNum(row.getCell(C.sc[0] + 1));
        const l = cellNum(row.getCell(C.sc[0] + 2)) ?? 1;
        if (m !== null && f !== null) sideChains.push({ mergesIntoStageNo: m, factor: f, length: l });
      }
      if (!isNA(row.getCell(C.sc[1]))) {
        const m = cellNum(row.getCell(C.sc[1]));
        const f = cellNum(row.getCell(C.sc[1] + 1));
        const l = cellNum(row.getCell(C.sc[1] + 2)) ?? 1;
        if (m !== null && f !== null) sideChains.push({ mergesIntoStageNo: m, factor: f, length: l });
      }
      if (!isNA(row.getCell(C.sc[2]))) {
        const m = cellNum(row.getCell(C.sc[2]));
        const f = cellNum(row.getCell(C.sc[2] + 1));
        const l = cellNum(row.getCell(C.sc[2] + 2)) ?? 1;
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
      const subA = cellNum(row.getCell(C.par[0])) ?? 0;
      const subB = cellNum(row.getCell(C.par[1])) ?? 0;
      const subCVal = cellNum(row.getCell(C.par[2]));
      const subChainLengths = [subA, subB].filter((n) => n > 0);
      if (subCVal !== null && !isNA(row.getCell(C.par[2]))) subChainLengths.push(subCVal);
      // Per-branch input (stoichiometric) factors. Branch A is the base (=1);
      // f1 (branch B), f2 (branch C). Blank ⇒ 1.
      const fB = cellNum(row.getCell(C.parFactor[0])); // branch B factor (f1)
      const fC = cellNum(row.getCell(C.parFactor[1])); // branch C factor (f2)
      const lens =
        subChainLengths.length > 0 ? subChainLengths : [2, 2];
      const subChainFactors = lens.map((_, i) =>
        i === 0 ? 1 : i === 1 ? fB ?? 1 : i === 2 ? fC ?? 1 : 1
      );
      // postMergeCount = mainStages - 1 (merge stage counts as 1 of mainStages)
      const postMerge = Math.max(0, mainStages - 1);
      topoSpec = {
        kind: "parallel",
        subChainCount: lens.length,
        subChainLengths: lens,
        mergeStageName: "Merge",
        postMergeCount: postMerge,
        subChainFactors,
      };
    } else if (topoStr.includes("fork") || topoStr.includes("diverge")) {
      topology = "fork";
      const shared = Math.max(1, cellNum(row.getCell(C.forkShared)) ?? 1);
      const branches = Math.max(2, cellNum(row.getCell(C.forkBranches)) ?? 2);
      const perBranch = Math.max(1, cellNum(row.getCell(C.forkPerBranch)) ?? 1);
      topoSpec = {
        kind: "fork",
        sharedStages: shared,
        branches,
        stagesPerBranch: perBranch,
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
      ...(sequence !== null && Number.isFinite(sequence)
        ? { productionSequence: Math.max(0, Math.round(sequence)) }
        : {}),
      ...(block ? { block } : {}),
      ...(campaignsPerYear ? { campaignsPerYear } : {}),
      ...(campaignQuarterSplit ? { campaignQuarterSplit } : {}),
      ...(quarterSequence ? { quarterSequence } : {}),
    };

    // Scaffold stages with correct DAG wiring via topology preset
    let scaffolded = applyTopologyPresetToApi(baseApi, topoSpec, defaults);
    // The detail columns may be blank (the export leaves them empty when they
    // can't reproduce the stages). If the preset doesn't produce the stages
    // listed on the Stages sheet, scaffold those stages and keep the declared
    // Stage flow; the wiring then comes from "Input from stages" below.
    const sheetStageCount = stageMap?.size ?? 0;
    if (sheetStageCount > 0 && scaffolded.stages.length !== sheetStageCount) {
      scaffolded = {
        ...applyTopologyPresetToApi(
          baseApi,
          { kind: "linear", length: sheetStageCount },
          defaults
        ),
        topology,
      };
      const hasFlow = Array.from(stageMap!.values()).some(
        (d) => (d.inputFromNames?.length ?? 0) > 0
      );
      if (hasFlow && topology === "side_chains")
        warnings.push(
          `API "${name}": side-chain columns don't match the Stages sheet — stage flow taken from "Input from stages", but side-chain sizing factors were not restored; re-apply them in the Stage Flow panel.`
        );
      if (!hasFlow && topology !== "linear")
        warnings.push(
          `API "${name}": the ${topology.replace("_", " ")} columns don't match the ${sheetStageCount} stages on the Stages sheet and no "Input from stages" is given — stages were chained linearly.`
        );
    }

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
        ...(data.firstBatchStartMs !== null
          ? { firstBatchStartMs: data.firstBatchStartMs }
          : {}),
        ...(data.existingStockKg !== null && data.existingStockKg > 0
          ? { existingStockKg: data.existingStockKg }
          : {}),
        ...(data.stageKind ? { stageKind: data.stageKind } : {}),
      };
    });

    // Stage flow from "Input from stages" (current layout). When ANY stage of
    // the API lists inputs, the column defines the whole graph (blank = no
    // inputs); otherwise the topology scaffold's wiring is kept. Unknown names
    // or an invalid graph fall back to the scaffold with a warning.
    const flowGiven = stages.some(
      (st) => (stageMap?.get(st.stageNo)?.inputFromNames?.length ?? 0) > 0
    );
    let finalStages = stages;
    if (flowGiven) {
      const idByName = new Map(stages.map((st) => [normalizeKey(st.stageName), st.id]));
      const unknown: string[] = [];
      const wired = stages.map((st) => {
        const names = stageMap?.get(st.stageNo)?.inputFromNames ?? [];
        const ids = names
          .map((n) => {
            const id = idByName.get(normalizeKey(n));
            if (!id) unknown.push(n);
            return id;
          })
          .filter((id): id is string => !!id && id !== st.id);
        return { ...st, inputStageIds: ids };
      });
      const candidate = { ...scaffolded, stages: wired };
      const errors = validateApiDag(candidate).filter((i) => i.level === "error");
      if (unknown.length > 0) {
        warnings.push(
          `API "${name}": "Input from stages" names ${unknown.map((n) => `"${n}"`).join(", ")} are not stages of this API — stage flow from the Stage flow preset kept.`
        );
      } else if (errors.length > 0) {
        warnings.push(
          `API "${name}": "Input from stages" gives an invalid stage flow (${errors[0].msg}) — stage flow from the Stage flow preset kept.`
        );
      } else {
        finalStages = wired;
      }
    }

    rawApis.push({ ...scaffolded, stages: finalStages });
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

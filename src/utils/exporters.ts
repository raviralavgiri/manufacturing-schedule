import { toPng } from "html-to-image";
import type { API, Reactor, ScheduleResult, StageMaster } from "../types";
import type { WeekBucket } from "./dates";
import { fmtDateTime } from "./dates";

/** Trigger a CSV download given headers + rows. */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number)[][]
): void {
  const escape = (cell: string | number) => {
    const s = String(cell ?? "");
    // Wrap in quotes if contains comma / quote / newline; double-up internal quotes
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = [
    headers.map(escape).join(","),
    ...rows.map((r) => r.map(escape).join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, filename);
}

/** Capture a DOM node as a PNG and trigger download. */
export async function downloadElementAsPng(
  el: HTMLElement | null,
  filename: string,
  opts: { backgroundColor?: string; pixelRatio?: number } = {}
): Promise<void> {
  if (!el) throw new Error("No element to capture");
  const dataUrl = await toPng(el, {
    pixelRatio: opts.pixelRatio ?? 2,
    backgroundColor: opts.backgroundColor ?? "#04081a",
    cacheBust: true,
    style: {
      // Help html-to-image reproduce the page's dark theme
      backgroundColor: opts.backgroundColor ?? "#04081a",
    },
    filter: (node) => {
      // Skip elements explicitly marked "do not export" (e.g. floating UI)
      if (node instanceof HTMLElement && node.dataset.exportSkip === "true") {
        return false;
      }
      return true;
    },
  });
  const blob = dataUrlToBlob(dataUrl);
  triggerDownload(blob, filename);
}

/** Open the browser's print dialog. The print-only CSS in index.css trims chrome. */
export function printPage(): void {
  window.print();
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, base64] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(meta)?.[1] ?? "image/png";
  const bin = atob(base64);
  const len = bin.length;
  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick so the download has time to start
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Sortable timestamp string for filenames: 20260502T1051. */
export function fileStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "T" +
    pad(d.getHours()) +
    pad(d.getMinutes())
  );
}

// ─── Gantt grid → Excel (real .xlsx via exceljs) ────────────────────────────
//
// Produces a real OOXML workbook with proper cell fills, merged headers,
// frozen first row/column, and column widths. Opens in Excel / Numbers /
// LibreOffice without a "wrong format" warning.

export interface GanttGridRow {
  /** Row label — usually a reactor name or stage label. */
  label: string;
  /** Optional secondary label (e.g. MOC code) shown in lighter ink. */
  secondary?: string;
  /**
   * One entry per week. null means the row is idle that week.
   * `color` is the API colour (any CSS hex like "#dd3c3c"); `text` is what
   * to render inside the cell (kept short — usually the API id).
   */
  weeks: Array<{ color: string; text?: string; title?: string } | null>;
}

export interface GanttGridSpec {
  /** Sheet tab label inside the workbook (e.g. "By Reactor"). */
  sheetName: string;
  /** Header label for the leftmost column (e.g. "Reactor", "Stage"). */
  rowHeader: string;
  /** Quarter-band header. e.g. ["Q1 · Apr-Jun", "Q2 · Jul-Sep", ...] */
  quarterLabels: string[];
  /** Number of week columns each quarter spans, in order. */
  quarterSpans: number[];
  /** Per-week label for the second header row (e.g. "01 Apr"). */
  weekLabels: string[];
  /** Body rows (one per reactor / stage / api). */
  rows: GanttGridRow[];
}

export interface GanttGridWorkbookSpec {
  /** Workbook description shown in File → Info. */
  subtitle?: string;
  /** One sheet per spec, rendered in order as workbook tabs. */
  sheets: GanttGridSpec[];
}

/** Convert any CSS hex like "#dd3c3c" or "#ddd" into the ARGB form ExcelJS
 *  needs ("FFDD3C3C"). Falls back to mid-grey for malformed input. */
function cssHexToArgb(input: string): string {
  let s = (input || "").trim().replace(/^#/, "");
  if (s.length === 3) {
    // expand "abc" → "aabbcc"
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (s.length !== 6 || /[^0-9a-fA-F]/.test(s)) return "FF9CA3AF";
  return ("FF" + s).toUpperCase();
}

/**
 * Render one Gantt-grid sheet inside an already-created workbook.
 * Extracted so a workbook can hold multiple views (by-reactor / by-stage
 * / by-api) as separate tabs.
 */
function renderGanttSheet(
  // Loose type — the import inside downloadGanttGridAsXls already pulled
  // ExcelJS, so the worksheet object's exact type isn't worth threading.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheet: any,
  spec: GanttGridSpec
): void {
  const totalWeeks = spec.weekLabels.length;
  const totalCols = 1 /* label */ + totalWeeks;

  // ─ Row 1: row-header label (col A) + quarter band (merged spans)
  const r1 = sheet.getRow(1);
  r1.getCell(1).value = spec.rowHeader;
  let colCursor = 2;
  spec.quarterLabels.forEach((label, i) => {
    const span = spec.quarterSpans[i] ?? 0;
    if (span <= 0) return;
    const startCol = colCursor;
    const endCol = colCursor + span - 1;
    const cell = r1.getCell(startCol);
    cell.value = label;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.font = { bold: true, color: { argb: "FFE5E7EB" }, size: 11 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    };
    if (endCol > startCol) {
      sheet.mergeCells(1, startCol, 1, endCol);
    }
    colCursor = endCol + 1;
  });

  // Style the row 1 corner cell
  const corner = sheet.getCell(1, 1);
  corner.font = { bold: true, color: { argb: "FFE5E7EB" }, size: 11 };
  corner.alignment = { horizontal: "left", vertical: "middle" };
  corner.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F172A" },
  };
  // Vertically merge the corner across rows 1+2 so it covers both header rows.
  sheet.mergeCells(1, 1, 2, 1);

  // ─ Row 2: per-week labels
  const r2 = sheet.getRow(2);
  spec.weekLabels.forEach((lbl, i) => {
    const cell = r2.getCell(2 + i);
    cell.value = lbl;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.font = { color: { argb: "FF94A3B8" }, size: 9 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0F172A" },
    };
  });

  // ─ Body rows
  spec.rows.forEach((r, rowIdx) => {
    const row = sheet.getRow(3 + rowIdx);
    const labelCell = row.getCell(1);
    labelCell.value = r.secondary ? `${r.label}  (${r.secondary})` : r.label;
    labelCell.font = { bold: true, color: { argb: "FF0F172A" }, size: 11 };
    labelCell.alignment = { horizontal: "left", vertical: "middle" };
    labelCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF8FAFC" },
    };

    r.weeks.forEach((w, i) => {
      const cell = row.getCell(2 + i);
      if (!w) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFFFFF" },
        };
        return;
      }
      cell.value = w.text ?? "";
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: cssHexToArgb(w.color) },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.font = { bold: true, color: { argb: "FF0F172A" }, size: 9 };
      if (w.title) {
        cell.note = { texts: [{ text: w.title }] } as never;
      }
    });
  });

  // ─ Borders
  const lightBorder = { style: "thin" as const, color: { argb: "FFCBD5E1" } };
  const darkBorder = { style: "thin" as const, color: { argb: "FF475569" } };
  const lastRow = 2 + spec.rows.length;
  for (let rIdx = 1; rIdx <= lastRow; rIdx++) {
    for (let cIdx = 1; cIdx <= totalCols; cIdx++) {
      const cell = sheet.getCell(rIdx, cIdx);
      const border = rIdx <= 2 ? darkBorder : lightBorder;
      cell.border = {
        top: border,
        left: border,
        bottom: border,
        right: border,
      };
    }
  }

  // ─ Column widths + header row heights
  // The "By Stage" and "By Reactor" sheets have longer left labels
  // ("API-01 · S2 · Intermediate-2"), so widen the label column there.
  const labelWidth = Math.max(
    22,
    Math.min(40, ...[Math.max(...spec.rows.map((r) => r.label.length + 4), 22)])
  );
  sheet.getColumn(1).width = labelWidth;
  for (let i = 2; i <= totalCols; i++) {
    sheet.getColumn(i).width = 6;
  }
  sheet.getRow(1).height = 22;
  sheet.getRow(2).height = 18;
}

/**
 * Build a multi-sheet .xlsx workbook (one tab per Gantt view) and trigger a
 * download. Each sheet gets its own frozen pane, merged Q1–Q4 header band,
 * and coloured cell grid.
 */
export async function downloadGanttGridAsXls(
  filename: string,
  workbookSpec: GanttGridWorkbookSpec
): Promise<void> {
  // Dynamic import keeps exceljs out of the main bundle until the user
  // actually clicks "Gantt grid (Excel)".
  const ExcelJS = (await import("exceljs")).default;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Pharma Planner";
  wb.created = new Date();
  if (workbookSpec.subtitle) {
    wb.description = workbookSpec.subtitle;
  }

  workbookSpec.sheets.forEach((spec) => {
    const sheet = wb.addWorksheet(spec.sheetName, {
      views: [{ state: "frozen", xSplit: 1, ySplit: 2 }],
    });
    renderGanttSheet(sheet, spec);
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, filename);
}

// ─── Combined "global" workbook ─────────────────────────────────────────────
//
// One .xlsx that bundles, in this order:
//   1. API / Stages / Master Equipment — written in the SAME layout the Excel
//      importer expects, so the exported file can be re-uploaded (round-trip).
//   2. Schedule — the flat per-batch table.
//   3. Gantt grid views (By Reactor / By Stage / By API) — coloured week grid,
//      cell text = "S{stageNo}·#{batchNo}".
//
// The input sheets are reconstructed from the live store state. Topology
// columns are reverse-engineered from each API's stage graph; if that
// reconstruction wouldn't reproduce the exact stage count on re-import we
// fall back to "Linear" (which the importer sizes from the Stages sheet),
// guaranteeing no per-stage data is lost even if the DAG flattens.

export interface GlobalWorkbookData {
  apis: API[];
  reactors: Reactor[];
  schedule: ScheduleResult;
  weeks: WeekBucket[];
}

/** Short cell label for a batch on the Gantt grid: "S2·#5". */
function batchCellText(stageNo: number, batchNo: number): string {
  return `S${stageNo}·#${batchNo}`;
}

/**
 * Build the three Gantt-grid sheet specs (By Reactor / By Stage / By API)
 * from live state. Shared by the standalone Gantt-grid export and the
 * combined global workbook so cell formatting stays in one place.
 */
export function buildGanttGridSheets(
  data: GlobalWorkbookData
): GanttGridSpec[] {
  const { apis, reactors, schedule, weeks } = data;
  const weekMs = 7 * 24 * 3600 * 1000;
  const totalWeeks = weeks.length;
  const fyStartMs = weeks.length > 0 ? weeks[0].startMs : Date.now();

  const apiColorById = new Map<string, string>();
  apis.forEach((a) => apiColorById.set(a.id, a.color));

  const paintBatchOnto = (
    cells: GanttGridRow["weeks"],
    b: ScheduleResult["batches"][number]
  ) => {
    const startWk = Math.max(0, Math.floor((b.startMs - fyStartMs) / weekMs));
    const endWk = Math.min(
      totalWeeks - 1,
      Math.floor((b.endMs - 1 - fyStartMs) / weekMs)
    );
    if (endWk < 0 || startWk > totalWeeks - 1) return;
    const color = apiColorById.get(b.apiId) ?? b.apiColor ?? "#9ca3af";
    const text = batchCellText(b.stageNo, b.batchNo);
    const title = `${b.batchId} · ${b.apiName} · S${b.stageNo} · #${b.batchNo}`;
    for (let i = startWk; i <= endWk; i++) {
      cells[i] = { color, text, title };
    }
  };
  const blankWeeks = (): GanttGridRow["weeks"] =>
    new Array(totalWeeks).fill(null);

  // By Reactor
  const reactorRows: GanttGridRow[] = reactors.map((r) => {
    const cells = blankWeeks();
    schedule.batches.forEach((b) => {
      if (b.reactorIds.includes(r.id)) paintBatchOnto(cells, b);
    });
    return { label: r.name, secondary: r.moc, weeks: cells };
  });

  // By Stage
  const sortedApis = apis.slice().sort((a, b) => a.id.localeCompare(b.id));
  const stageRows: GanttGridRow[] = [];
  sortedApis.forEach((a) => {
    a.stages
      .slice()
      .sort((x, y) => x.stageNo - y.stageNo)
      .forEach((s) => {
        const cells = blankWeeks();
        schedule.batches.forEach((b) => {
          if (b.stageId === s.id) paintBatchOnto(cells, b);
        });
        stageRows.push({
          label: `${a.id} · S${s.stageNo}`,
          secondary: s.stageName,
          weeks: cells,
        });
      });
  });

  // By API
  const apiRows: GanttGridRow[] = sortedApis.map((a) => {
    const cells = blankWeeks();
    schedule.batches.forEach((b) => {
      if (b.apiId === a.id) paintBatchOnto(cells, b);
    });
    return {
      label: a.id,
      secondary: a.name === a.id ? undefined : a.name,
      weeks: cells,
    };
  });

  // Quarter bands + week labels — identical on every sheet.
  const quarterLabels: string[] = [];
  const quarterSpans: number[] = [];
  if (weeks.length > 0) {
    const monthOf = (i: number) =>
      weeks[i].start.toLocaleString("en-US", { month: "short" });
    const sliceSize = Math.max(1, Math.ceil(weeks.length / 4));
    for (let q = 0; q < 4; q++) {
      const a = q * sliceSize;
      const b = Math.min(weeks.length, a + sliceSize);
      if (a >= weeks.length) break;
      quarterSpans.push(b - a);
      quarterLabels.push(`Q${q + 1} · ${monthOf(a)}-${monthOf(b - 1)}`);
    }
  }
  const weekLabels = weeks.map((w) =>
    w.start.toLocaleString("en-US", { day: "2-digit", month: "short" })
  );

  const mk = (
    sheetName: string,
    rowHeader: string,
    rows: GanttGridRow[]
  ): GanttGridSpec => ({
    sheetName,
    rowHeader,
    quarterLabels,
    quarterSpans,
    weekLabels,
    rows,
  });

  return [
    mk("Gantt · By Reactor", "Reactor", reactorRows),
    mk("Gantt · By Stage", "Stage", stageRows),
    mk("Gantt · By API", "API", apiRows),
  ];
}

// ── Plain table sheet (Schedule + reused for any headered grid) ─────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderTableSheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheet: any,
  headers: string[],
  rows: (string | number)[][]
): void {
  const head = sheet.getRow(1);
  headers.forEach((h, i) => {
    const cell = head.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFE5E7EB" }, size: 11 };
    cell.alignment = { horizontal: "left", vertical: "middle" };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    };
  });
  rows.forEach((r, ri) => {
    const row = sheet.getRow(2 + ri);
    r.forEach((v, ci) => {
      row.getCell(ci + 1).value = v;
    });
  });
  headers.forEach((h, i) => {
    const maxLen = Math.max(
      h.length,
      ...rows.map((r) => String(r[i] ?? "").length)
    );
    sheet.getColumn(i + 1).width = Math.min(40, Math.max(10, maxLen + 2));
  });
  sheet.getRow(1).height = 20;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Topology-column reconstruction for the round-trippable API sheet ────────

interface ApiTopoCells {
  topology: string;
  mainStages: number;
  sideChains: { merge: number; factor: number; length: number }[];
  parallelSubLengths: number[];
}

/**
 * Reverse the stage graph into the API-sheet topology columns. Returns a
 * spec that, when re-imported, reproduces the SAME number of stages. Falls
 * back to Linear (sized by the Stages sheet) whenever the reconstruction
 * can't be verified to match the stage count.
 */
function reconstructTopologyCells(api: API): ApiTopoCells {
  const stages = api.stages.slice().sort((a, b) => a.stageNo - b.stageNo);
  const total = stages.length;
  const linearFallback: ApiTopoCells = {
    topology: "Linear",
    mainStages: total,
    sideChains: [],
    parallelSubLengths: [],
  };
  const stageNoById = new Map<string, number>();
  stages.forEach((s) => stageNoById.set(s.id, s.stageNo));

  if (api.topology === "side_chains") {
    const anchors = stages
      .filter((s) => s.cascadePolicy?.kind === "side-chain")
      .sort((a, b) => a.stageNo - b.stageNo);
    if (anchors.length === 0) return linearFallback;
    const firstAnchorNo = anchors[0].stageNo;
    const mainBackboneLength = firstAnchorNo - 1;
    if (mainBackboneLength < 1) return linearFallback;
    const sideChains = anchors.map((anchor, idx) => {
      const next = anchors[idx + 1];
      const endNo = next ? next.stageNo : total + 1;
      const length = endNo - anchor.stageNo;
      const policy = anchor.cascadePolicy as Extract<
        StageMaster["cascadePolicy"],
        { kind: "side-chain" }
      >;
      const baseNo = stageNoById.get(policy.baseStageId) ?? mainBackboneLength;
      return { merge: baseNo + 1, factor: policy.factor, length };
    });
    const reconstructedTotal =
      mainBackboneLength + sideChains.reduce((n, sc) => n + sc.length, 0);
    if (reconstructedTotal !== total || sideChains.length > 3)
      return linearFallback;
    return {
      topology: "Side chains",
      mainStages: mainBackboneLength,
      sideChains,
      parallelSubLengths: [],
    };
  }

  if (api.topology === "parallel") {
    // Merge = the (single) stage that pulls from ≥2 predecessors and is not
    // itself a side-chain anchor. Sub-chains occupy stageNos 1..merge-1.
    const merge = stages.find(
      (s) => !s.cascadePolicy && s.inputStageIds.length >= 2
    );
    if (!merge) return linearFallback;
    const subSum = merge.stageNo - 1;
    if (subSum < 2) return linearFallback;
    const lastNos = merge.inputStageIds
      .map((id) => stageNoById.get(id))
      .filter((n): n is number => typeof n === "number")
      .sort((a, b) => a - b);
    if (lastNos.length < 2 || lastNos[lastNos.length - 1] !== subSum)
      return linearFallback;
    const subLengths: number[] = [];
    let prev = 0;
    for (const n of lastNos) {
      subLengths.push(n - prev);
      prev = n;
    }
    const postMergeCount = total - subSum - 1;
    if (postMergeCount < 0 || subLengths.length > 3) return linearFallback;
    return {
      topology: "Parallel",
      mainStages: postMergeCount + 1,
      sideChains: [],
      parallelSubLengths: subLengths,
    };
  }

  return linearFallback;
}

// ── Import-template sheet renderers (round-trip) ────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderApiSheet(sheet: any, apis: API[]): void {
  // Headers live in rows 4–5; the importer skips rows ≤ 5 and reads from row 6.
  sheet.getCell(4, 2).value = "API list — re-importable (data from row 6)";
  sheet.getCell(4, 2).font = { bold: true, color: { argb: "FFE5E7EB" } };
  const subLabels: [number, string][] = [
    [2, "Sl.No"],
    [3, "Name"],
    [4, "Target kg"],
    [5, "Start"],
    [6, "End"],
    [7, "Topology"],
    [8, "Total Stages"],
    [9, "Main Stages"],
    [10, "SC1 merge"],
    [11, "SC1 factor"],
    [12, "SC1 len"],
    [13, "SC2 merge"],
    [14, "SC2 factor"],
    [15, "SC2 len"],
    [16, "SC3 merge"],
    [17, "SC3 factor"],
    [18, "SC3 len"],
    [19, "Par subA"],
    [20, "Par subB"],
    [21, "Par subC"],
    [25, "Planned batches"],
  ];
  subLabels.forEach(([col, lbl]) => {
    const cell = sheet.getRow(5).getCell(col);
    cell.value = lbl;
    cell.font = { bold: true, color: { argb: "FF94A3B8" }, size: 9 };
  });

  apis.forEach((api, idx) => {
    const row = sheet.getRow(6 + idx);
    const topo = reconstructTopologyCells(api);
    row.getCell(2).value = idx + 1;
    row.getCell(3).value = api.name;
    row.getCell(4).value = api.targetKg;
    row.getCell(5).value = new Date(api.window.startMs);
    row.getCell(5).numFmt = "yyyy-mm-dd";
    row.getCell(6).value = new Date(api.window.endMs);
    row.getCell(6).numFmt = "yyyy-mm-dd";
    row.getCell(7).value = topo.topology;
    row.getCell(8).value = api.stages.length;
    row.getCell(9).value = topo.mainStages;
    topo.sideChains.slice(0, 3).forEach((sc, i) => {
      const base = 10 + i * 3; // J/M/P
      row.getCell(base).value = sc.merge;
      row.getCell(base + 1).value = sc.factor;
      row.getCell(base + 2).value = sc.length;
    });
    topo.parallelSubLengths.slice(0, 3).forEach((len, i) => {
      row.getCell(19 + i).value = len; // S/T/U
    });
  });

  sheet.getColumn(3).width = 26;
  sheet.getColumn(5).width = 12;
  sheet.getColumn(6).width = 12;
  sheet.getColumn(7).width = 14;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderStagesSheet(sheet: any, apis: API[]): void {
  // Headers rows 1–2; data from row 3.
  const cols: [number, string][] = [
    [1, "API"],
    [2, "Stage"],
    [3, "Input/Batch"],
    [4, "Output/Batch"],
    [5, "BCF (h)"],
    [6, "BCT (h)"],
    [7, "Analysis (h)"],
    [8, "PCO (h)"],
    [9, "Nos"],
    [10, "Main"],
    [11, "P1"],
    [12, "P2"],
    [13, "P3"],
    [14, "P4"],
    [15, "Process (h)"],
  ];
  cols.forEach(([col, lbl]) => {
    const cell = sheet.getRow(2).getCell(col);
    cell.value = lbl;
    cell.font = { bold: true, color: { argb: "FF94A3B8" }, size: 9 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    };
  });
  sheet.getCell(1, 1).value = "Stages — re-importable (data from row 3)";
  sheet.getCell(1, 1).font = { bold: true, color: { argb: "FFE5E7EB" } };

  let rn = 3;
  apis
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach((api) => {
      api.stages
        .slice()
        .sort((a, b) => a.stageNo - b.stageNo)
        .forEach((s) => {
          const pool = s.reactorPool.length > 0 ? s.reactorPool : [""];
          pool.forEach((reactorId, pi) => {
            const row = sheet.getRow(rn++);
            row.getCell(1).value = api.name; // API on every row (carry-safe)
            row.getCell(2).value = s.stageName; // Stage on every row of stage
            if (pi === 0) {
              // Stage-level params captured by importer on the first row only.
              row.getCell(3).value = s.inputKgPerBatch;
              row.getCell(4).value = s.batchSizeKg;
              row.getCell(5).value = s.bcfHours;
              row.getCell(6).value = s.bctHours;
              row.getCell(7).value = s.analysisHours;
              row.getCell(8).value = s.pcoHours;
              row.getCell(9).value = s.reactorPool.length;
              row.getCell(15).value = s.processHours;
            }
            if (reactorId) {
              row.getCell(10).value = reactorId;
              const subs = s.reactorSubstitutes?.[reactorId] ?? [];
              subs.slice(0, 4).forEach((sub, si) => {
                row.getCell(11 + si).value = sub;
              });
            }
          });
        });
    });

  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 20;
  for (let c = 3; c <= 15; c++) sheet.getColumn(c).width = 12;
  sheet.views = [{ state: "frozen", ySplit: 2 }];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderEquipmentSheet(sheet: any, reactors: Reactor[]): void {
  // Headers rows 1–2; data from row 3.
  const cols: [number, string][] = [
    [1, "Sl.No"],
    [2, "Unit"],
    [3, "Block"],
    [4, "Class"],
    [5, "Name"],
    [6, "MOC"],
    [7, "Agitator"],
    [8, "Cap.(L)"],
    [9, "PM First Date"],
  ];
  cols.forEach(([col, lbl]) => {
    const cell = sheet.getRow(2).getCell(col);
    cell.value = lbl;
    cell.font = { bold: true, color: { argb: "FF94A3B8" }, size: 9 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    };
  });
  sheet.getCell(1, 1).value = "Master Equipment — re-importable (data row 3)";
  sheet.getCell(1, 1).font = { bold: true, color: { argb: "FFE5E7EB" } };

  reactors.forEach((r, idx) => {
    const row = sheet.getRow(3 + idx);
    row.getCell(1).value = idx + 1;
    row.getCell(3).value = r.productionBlock ?? "";
    row.getCell(4).value = r.reactorClass ?? "";
    row.getCell(5).value = r.id;
    row.getCell(6).value = r.moc;
    row.getCell(7).value = r.agitatorType;
    row.getCell(8).value = r.capacityKg;
    if (r.pmFirstDateMs !== undefined) {
      row.getCell(9).value = new Date(r.pmFirstDateMs);
      row.getCell(9).numFmt = "yyyy-mm-dd";
    }
  });

  sheet.getColumn(5).width = 16;
  sheet.getColumn(7).width = 12;
  sheet.getColumn(9).width = 14;
  sheet.views = [{ state: "frozen", ySplit: 2 }];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderScheduleSheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheet: any,
  schedule: ScheduleResult,
  reactors: Reactor[]
): void {
  const headers = [
    "Batch ID",
    "API ID",
    "API Name",
    "Stage No",
    "Stage Name",
    "Batch #",
    "Reactor ID",
    "Reactor Name",
    "Start",
    "End (Cycle)",
    "Analysis End",
    "Cleaning Before (h)",
    "Cleaning Type",
    "FY",
    "Input kg",
    "Output kg",
  ];
  const rows = schedule.batches.map((b) => [
    b.batchId,
    b.apiId,
    b.apiName,
    b.stageNo,
    b.stageName,
    b.batchNo,
    b.reactorIds.join(" + "),
    b.reactorIds
      .map((id) => reactors.find((x) => x.id === id)?.name ?? id)
      .join(" + "),
    fmtDateTime(b.startMs),
    fmtDateTime(b.endMs),
    fmtDateTime(b.analysisEndMs),
    ((b.cleaningBeforeMs ?? 0) / 3600 / 1000).toFixed(2),
    b.cleaningType ?? "none",
    b.inFY ? "FY" : "Ovr",
    Math.round(b.inputKg),
    Math.round(b.outputKg),
  ]);
  renderTableSheet(sheet, headers, rows);
}

/**
 * Build and download the combined "global" workbook (input sheets + schedule
 * + Gantt grids) as a single .xlsx.
 */
export async function downloadGlobalWorkbookAsXls(
  filename: string,
  data: GlobalWorkbookData
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pharma Planner";
  wb.created = new Date();
  wb.description = `${data.apis.length} APIs · ${data.reactors.length} reactors · ${data.schedule.batches.length} batches`;

  // 1. Re-importable input sheets — names MUST match the importer exactly.
  renderApiSheet(wb.addWorksheet("API"), data.apis);
  renderStagesSheet(wb.addWorksheet("Stages"), data.apis);
  renderEquipmentSheet(wb.addWorksheet("Master Equipment"), data.reactors);

  // 2. Schedule
  renderScheduleSheet(
    wb.addWorksheet("Schedule"),
    data.schedule,
    data.reactors
  );

  // 3. Gantt grid views
  buildGanttGridSheets(data).forEach((spec) => {
    const sheet = wb.addWorksheet(spec.sheetName, {
      views: [{ state: "frozen", xSplit: 1, ySplit: 2 }],
    });
    renderGanttSheet(sheet, spec);
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, filename);
}

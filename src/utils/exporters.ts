import { toPng } from "html-to-image";

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

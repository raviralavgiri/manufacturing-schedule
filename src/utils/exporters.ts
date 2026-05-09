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

// ─── Gantt grid → Excel ─────────────────────────────────────────────────────
//
// Excel happily opens an HTML table saved with a .xls extension and
// preserves cell colours, row/column spans, and basic formatting. That lets
// us produce a Gantt-grid view (rows = reactors, columns = weeks, cells
// coloured with API.color) without pulling in a heavy XLSX library.

export interface GanttGridRow {
  /** Row label — usually a reactor name or stage label. */
  label: string;
  /** Optional secondary label (e.g. MOC code) shown in lighter ink. */
  secondary?: string;
  /**
   * One entry per week. Empty / null means the row is idle that week.
   * `color` is the API colour (any CSS-recognisable value); `text` is what
   * to render inside the cell (kept short — usually the API id or empty).
   */
  weeks: Array<{ color: string; text?: string; title?: string } | null>;
}

export interface GanttGridSpec {
  title: string;            // first H1 above the table
  subtitle?: string;        // small line below the title
  /** Quarter-band header. e.g. ["Q1 · Apr-Jun", "Q2 · Jul-Sep", ...] */
  quarterLabels: string[];
  /** Number of week columns each quarter spans, in order. */
  quarterSpans: number[];
  /** Per-week label for the second header row (e.g. "01 Apr"). */
  weekLabels: string[];
  /** Body rows (one per reactor / stage / api). */
  rows: GanttGridRow[];
}

/**
 * Build the HTML table for the Gantt grid. Inline styles only — Excel
 * doesn't honour <style> blocks well across versions.
 */
export function buildGanttGridHtml(spec: GanttGridSpec): string {
  const escapeHtml = (s: string) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const totalWeeks = spec.weekLabels.length;

  // ─ Header row 1: quarter bands
  const quarterCells = spec.quarterLabels
    .map((q, i) => {
      const span = spec.quarterSpans[i] ?? 0;
      if (span <= 0) return "";
      return `<td colspan="${span}" style="background:#1f2937;color:#e5e7eb;font-weight:700;font-size:11px;text-align:center;padding:4px;border:1px solid #475569;">${escapeHtml(q)}</td>`;
    })
    .join("");

  // ─ Header row 2: per-week labels (every Nth shown for readability)
  const weekCells = spec.weekLabels
    .map(
      (lbl) =>
        `<td style="background:#0f172a;color:#94a3b8;font-size:9px;text-align:center;padding:2px;border:1px solid #334155;width:32px;">${escapeHtml(
          lbl
        )}</td>`
    )
    .join("");

  // ─ Body rows
  const bodyRows = spec.rows
    .map((r) => {
      const cells = r.weeks
        .map((w) => {
          if (!w) {
            return `<td style="background:#ffffff;border:1px solid #e2e8f0;height:22px;width:32px;">&nbsp;</td>`;
          }
          // Coloured busy cell. Excel honours bgcolor and inline color.
          return `<td bgcolor="${escapeHtml(w.color)}" title="${escapeHtml(
            w.title ?? ""
          )}" style="background:${escapeHtml(
            w.color
          )};color:#0f172a;font-size:9px;font-weight:700;text-align:center;padding:1px;border:1px solid #94a3b8;height:22px;width:32px;">${escapeHtml(
            w.text ?? ""
          )}</td>`;
        })
        .join("");
      const labelCell = `<td style="background:#f8fafc;color:#0f172a;font-weight:700;font-size:11px;padding:4px 8px;border:1px solid #cbd5e1;white-space:nowrap;">${escapeHtml(
        r.label
      )}${
        r.secondary
          ? ` <span style="color:#64748b;font-weight:400;font-size:9px;">${escapeHtml(
              r.secondary
            )}</span>`
          : ""
      }</td>`;
      return `<tr>${labelCell}${cells}</tr>`;
    })
    .join("");

  // Top-left corner cell of the header (label column)
  const corner = `<td rowspan="2" style="background:#0f172a;color:#e5e7eb;font-weight:700;font-size:11px;padding:6px 8px;border:1px solid #334155;">Reactor</td>`;

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(spec.title)}</title>
  <!--[if gte mso 9]>
    <xml>
      <x:ExcelWorkbook>
        <x:ExcelWorksheets>
          <x:ExcelWorksheet>
            <x:Name>Gantt</x:Name>
            <x:WorksheetOptions>
              <x:DisplayGridlines />
            </x:WorksheetOptions>
          </x:ExcelWorksheet>
        </x:ExcelWorksheets>
      </x:ExcelWorkbook>
    </xml>
  <![endif]-->
</head>
<body style="font-family:Arial,sans-serif;color:#0f172a;">
  <h2 style="margin:8px 0 0 0;font-size:16px;">${escapeHtml(spec.title)}</h2>
  ${
    spec.subtitle
      ? `<div style="font-size:11px;color:#475569;margin-bottom:8px;">${escapeHtml(spec.subtitle)}</div>`
      : ""
  }
  <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-family:Arial,sans-serif;">
    <thead>
      <tr>${corner}${quarterCells}</tr>
      <tr><!-- corner already rowspan=2 -->${weekCells}</tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>
  <div style="font-size:10px;color:#64748b;margin-top:6px;">
    Total weeks: ${totalWeeks} · Generated by Pharma Planner
  </div>
</body>
</html>`;
}

/** Trigger a download of an HTML-shaped XLS file. */
export function downloadGanttGridAsXls(filename: string, spec: GanttGridSpec): void {
  const html = buildGanttGridHtml(spec);
  // application/vnd.ms-excel + .xls extension makes Excel open the HTML
  // as a worksheet directly. Other tools (Numbers, LibreOffice) handle it
  // similarly. The `\ufeff` BOM helps with non-ASCII characters.
  const blob = new Blob(["\ufeff", html], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  triggerDownload(blob, filename);
}

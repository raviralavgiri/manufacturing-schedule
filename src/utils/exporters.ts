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

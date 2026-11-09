import { Zip, ZipPassThrough, strToU8 } from "fflate";
import { isAppsScript } from "../platform";
import { modelFile } from "./api";
import type { PrintRecord } from "../types";
import { EXPORT_MAX_BYTES } from "../../shared/printing.js";
export async function exportPrints(
  records: PrintRecord[],
  onProgress: (done: number, total: number) => void,
  suffix = "",
) {
  if (!records.length) return;
  const filename =
    "BNTS-prints-" +
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Australia/Melbourne",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()) +
    (suffix ? "-" + suffix : "") +
    ".zip";
  if (records.reduce((n, r) => n + r.bytes, 0) > EXPORT_MAX_BYTES)
    throw new Error("Download these files in smaller ZIPs.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let zipError: Error | undefined;
  const zip = new Zip((error, chunk) => {
    if (error) {
      zipError = error;
      return;
    }
    chunks.push(new Uint8Array(chunk));
  });
  const manifest: string[][] = [];
  const paths = new Set<string>(),
    part = (s: string) => s.replace(/[\\/\x00-\x1f]/g, "-").replace(/^\.+$/, "_");
  try {
    for (let i = 0; i < records.length; i++) {
      const r = records[i],
        folder = [part(r.school), r.date, r.classroom ? part(r.classroom) : ""].filter(Boolean).join("/");
      let path = folder + "/" + r.filename;
      if (paths.has(path)) path = folder + "/" + r.id + "/" + r.filename;
      paths.add(path);
      manifest.push([
        path,
        r.originalName,
        r.school,
        r.firstName,
        r.classroom,
        String(r.scalePercent ?? 100),
        r.dimensionsMm ? r.dimensionsMm.map((v) => v.toFixed(1)).join(" x ") : "",
        r.colourMapping
          .map(
            (m, i) =>
              (m.partName || "Part " + (i + 1)) +
              ": " +
              (m.target === "Custom" ? "Custom: " + r.customColour : m.target),
          )
          .join("; "),
        r.advancedFilamentNote || "",
        r.supports,
        r.printer,
        r.quality,
        String(r.copies),
        r.staff,
        r.notes,
        r.designLink,
      ]);
      const entry = new ZipPassThrough(path);
      zip.add(entry);
      const response = isAppsScript
        ? new Response(await modelFile(r.id, r.filename))
        : await fetch(`/api/admin/submissions/${r.id}/download`);
      if (!response.ok || !response.body)
        throw new Error(`Could not download ${r.firstName}’s file. It may have expired.`);
      const reader = response.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          entry.push(value, false);
          if (zipError) throw zipError;
        }
      } finally {
        reader.releaseLock();
      }
      entry.push(new Uint8Array(), true);
      onProgress(i + 1, records.length);
    }
    const csvCell = (value: string) => {
      const safe = /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    const csv = [
      [
        "File",
        "Original name",
        "School",
        "First name",
        "Class",
        "Scale (%)",
        "Dimensions (mm)",
        "Colour preferences",
        "Advanced filament request",
        "Supports",
        "Printer",
        "Quality",
        "Copies",
        "Staff",
        "Notes",
        "Design link",
      ],
      ...manifest,
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    const instructions = new ZipPassThrough("Print settings.csv");
    zip.add(instructions);
    instructions.push(strToU8("\ufeff" + csv), true);
    zip.end();
    if (zipError) throw zipError;
    const url = URL.createObjectURL(new Blob(chunks, { type: "application/zip" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    zip.terminate();
    throw error;
  }
}

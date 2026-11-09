import { ADVANCED_FILAMENT, ADVANCED_HEX, BAMBU_COLOURS } from "./catalog.js";
export const normalizeClassCode = (value) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export const scaleLabel = (value) => `${Number(value ?? 100)}% scale`;
export function resolveClass(settings, schoolId, code = "") {
  if (typeof code !== "string" || code.length > 80)
    throw Object.assign(new Error("Enter a class code of up to 80 characters."), { status: 400 });
  if (!code.trim()) return { classId: "", classroom: "" };
  const match = settings.classes.find(
    (c) => c.schoolId === schoolId && c.code && normalizeClassCode(c.code) === normalizeClassCode(code),
  );
  if (!match)
    throw Object.assign(new Error("Class code not found for this school. Check the code or leave it blank."), {
      status: 400,
    });
  return { classId: match.id, classroom: match.name };
}
export const publicClasses = (settings) => settings.classes.map(({ id, name, schoolId }) => ({ id, name, schoolId }));
export const simpleColours = {
  "Jade White": "WHITE",
  Black: "BLACK",
  Silver: "SILVER",
  Gray: "GRAY",
  "Light Gray": "GRAY",
  Red: "RED",
  "Maroon Red": "RED",
  Pink: "PINK",
  "Hot Pink": "PINK",
  Magenta: "MAGENTA",
  Orange: "ORANGE",
  "Pumpkin Orange": "ORANGE",
  Yellow: "YELLOW",
  Gold: "GOLD",
  Beige: "BEIGE",
  Brown: "BROWN",
  "Cocoa Brown": "BROWN",
  "Bambu Green": "GREEN",
  "Bright Green": "GREEN",
  "Mistletoe Green": "GREEN",
  Turquoise: "TURQUOISE",
  Cyan: "CYAN",
  Blue: "BLUE",
  "Cobalt Blue": "BLUE",
  "Ice Blue": "BLUE",
  Purple: "PURPLE",
  "Indigo Purple": "PURPLE",
  Lavender: "PURPLE",
  Custom: "CUSTOM",
};
export function filenameColour(value) {
  const targets = value.colourMapping?.length ? value.colourMapping.map((m) => m.target) : [value.colour];
  const names = [
    ...new Set(
      targets.map((target) => (target === ADVANCED_FILAMENT ? "ADVANCED" : simpleColours[target] || "CUSTOM")),
    ),
  ];
  return names.join("_");
}
export function previewStyle(record) {
  return {
    scalePercent: record.scalePercent ?? 100,
    mapping: Object.fromEntries(
      (record.colourMapping || []).map((m) => [
        m.source,
        m.target === ADVANCED_FILAMENT
          ? ADVANCED_HEX
          : BAMBU_COLOURS.find((c) => c.name === m.target)?.hex || "#cfc2e0",
      ]),
    ),
    advancedSources: (record.colourMapping || []).filter((m) => m.target === ADVANCED_FILAMENT).map((m) => m.source),
  };
}
export const EXPORT_MAX_BYTES = 150 * 1024 * 1024;
export function exportBatches(records) {
  const batches = [];
  let batch = [],
    bytes = 0;
  for (const record of records) {
    if (record.bytes > EXPORT_MAX_BYTES) throw new Error("This file is too large to export. Download it individually.");
    if (bytes + record.bytes > EXPORT_MAX_BYTES && batch.length) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(record);
    bytes += record.bytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

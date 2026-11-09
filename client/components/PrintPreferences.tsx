import { useState } from "react";
import { PREFERENCES, displayLabel } from "../../shared/catalog.js";
import type { Details } from "../types";
import { Field } from "./Layout";
export type FilePrintOptions = Pick<Details, "supports" | "printer" | "quality" | "copies" | "notes" | "designLink">;
export function printOptions(details: Details): FilePrintOptions {
  const { supports, printer, quality, copies, notes, designLink } = details;
  return { supports, printer, quality, copies, notes, designLink };
}
const LABELS = { supports: "Supports", printer: "Printer", quality: "Quality" } as const;
export default function PrintPreferences({
  value,
  onChange,
}: {
  value: Details;
  onChange: (patch: Partial<Details>) => void;
}) {
  // Open "More options" only if something in it was already changed. Read once so it never snaps shut.
  const [startOpen] = useState(
    () =>
      (["supports", "printer", "quality"] as const).some((key) => value[key] !== PREFERENCES[key][0]) ||
      !!value.designLink,
  );
  const usesOther = [value.supports, value.printer, value.quality].some((option) => option.startsWith("Custom"));
  return (
    <div className="form-stack">
      <div className="form-grid">
        <label className="field">
          Copies
          <select value={value.copies} onChange={(e) => onChange({ copies: Number(e.target.value) })}>
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <Field
          full
          optional
          label="Notes for your teacher"
          hint={
            <>
              {usesOther ? "Explain what you chose under Other." : "Mention anything your teacher should know."}{" "}
              <span className="counter">{value.notes.length}/800</span>
            </>
          }
        >
          <textarea
            maxLength={800}
            rows={3}
            value={value.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            placeholder="For example: please keep the base flat."
          />
        </Field>
      </div>
      <details className="more-options" open={startOpen}>
        <summary>More options</summary>
        <p className="hint">Most people can leave these as they are.</p>
        <div className="form-grid">
          {(["supports", "printer", "quality"] as const).map((key) => (
            <label className="field" key={key}>
              {LABELS[key]}
              <select value={value[key]} onChange={(e) => onChange({ [key]: e.target.value })}>
                {PREFERENCES[key].map((option) => (
                  <option key={option} value={option}>
                    {displayLabel(option)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <Field
            full
            optional
            label="Link to your design"
            hint="A share link from Tinkercad, Onshape or Fusion that starts with https://"
          >
            <input
              type="url"
              pattern="https://.*"
              maxLength={500}
              value={value.designLink}
              onChange={(e) => onChange({ designLink: e.target.value })}
              placeholder="https://www.tinkercad.com/things/…"
            />
          </Field>
        </div>
      </details>
    </div>
  );
}

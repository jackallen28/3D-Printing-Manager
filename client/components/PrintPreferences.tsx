import { useEffect, useState } from "react";
import { PREFERENCES, displayLabel } from "../../shared/catalog.js";
import type { Details } from "../types";
import { Field } from "./Layout";
export type FilePrintOptions = Pick<Details, "supports" | "printer" | "quality" | "copies" | "notes" | "designLink">;
export function printOptions(details: Details): FilePrintOptions {
  const { supports, printer, quality, copies, notes, designLink } = details;
  return { supports, printer, quality, copies, notes, designLink };
}
const SETTINGS = ["supports", "printer", "quality"] as const;
const LABELS = { supports: "Supports", printer: "Printer", quality: "Quality" } as const;
/** True when any Advanced-only print setting has been changed from its default. */
export const usesAdvancedSettings = (value: Details) =>
  SETTINGS.some((key) => value[key] !== PREFERENCES[key][0]) || !!value.designLink;
export default function PrintPreferences({
  value,
  onChange,
  expert = true,
  onShowAdvanced,
}: {
  value: Details;
  onChange: (patch: Partial<Details>) => void;
  /** Advanced mode shows supports, printer, quality and the design link. */
  expert?: boolean;
  onShowAdvanced?: () => void;
}) {
  // In Beginner mode, settings that are already in use stay visible so nothing hidden is ever active.
  // Once shown they stay shown, so they never vanish while being edited.
  const inUse = usesAdvancedSettings(value);
  const [keepShown, setKeepShown] = useState(inUse);
  useEffect(() => {
    if (inUse) setKeepShown(true);
  }, [inUse]);
  const showSettings = expert || keepShown;
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
        {showSettings &&
          SETTINGS.map((key) => (
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
        {showSettings && (
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
        )}
      </div>
      {!showSettings && onShowAdvanced && (
        <p className="hint">
          Your teacher picks the printer and settings for you.{" "}
          <button type="button" className="inline-link" onClick={onShowAdvanced}>
            Choose them yourself in Advanced mode
          </button>
        </p>
      )}
    </div>
  );
}

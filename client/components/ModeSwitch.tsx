import { useId } from "react";
export type Mode = "beginner" | "advanced";
const OPTIONS: { id: Mode; label: string; detail: string }[] = [
  { id: "beginner", label: "Beginner", detail: "Just the main steps. Best for your first prints." },
  { id: "advanced", label: "Advanced", detail: "Colour each part, split files, special filaments and print settings." },
];
const STORAGE_KEY = "bnts-print-mode";
/** The last mode chosen on this device. Storage can be unavailable, so fall back to Beginner. */
export function savedMode(): Mode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "advanced" ? "advanced" : "beginner";
  } catch {
    return "beginner";
  }
}
export function saveMode(mode: Mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Not saved; the choice still applies for this visit.
  }
}
export default function ModeSwitch({
  mode,
  onChange,
  compact = false,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
  compact?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className={"mode-switch" + (compact ? " compact" : "")}>
      <legend className={compact ? "visually-hidden" : undefined}>Choose your level</legend>
      <div className="mode-options">
        {OPTIONS.map((option) => (
          <label key={option.id} className={"mode-option" + (mode === option.id ? " selected" : "")}>
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={mode === option.id}
              onChange={() => onChange(option.id)}
            />
            <span>
              <b>{option.label}</b>
              {!compact && <small>{option.detail}</small>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

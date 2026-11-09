import { useId } from "react";
import { Check } from "lucide-react";
import { ADVANCED_FILAMENT, ADVANCED_HEX, displayLabel } from "../../shared/catalog.js";
import { areaName, type LoadedModel } from "../lib/model";
import type { Colour } from "../types";
import { Field } from "./Layout";
type Mapping = { source: string; target: string };
export default function ColourEditor({
  model,
  mapping,
  colours,
  customEnabled,
  selectedPart,
  onSelect,
  onMapping,
  customColour,
  advancedNote,
  onCustom,
  onAdvanced,
  sections = false,
  expert = true,
}: {
  model: LoadedModel | null;
  mapping: Mapping[];
  colours: Colour[];
  customEnabled: boolean;
  selectedPart: string;
  onSelect: (v: string) => void;
  onMapping: (v: Mapping[]) => void;
  customColour: string;
  advancedNote: string;
  onCustom: (v: string) => void;
  onAdvanced: (v: string) => void;
  sections?: boolean;
  /** Advanced mode: colour each part, plus Other colour and Special filament. */
  expert?: boolean;
}) {
  const groupName = useId();
  const selected = mapping.find((m) => m.source === selectedPart) || mapping[0];
  const entity = sections ? "section" : "part";
  // Beginners choose one colour for the whole model; Advanced colours each part.
  const several = expert && mapping.length > 1;
  const mixed = !expert && new Set(mapping.map((m) => m.target)).size > 1;
  const partName = (source: string) =>
    areaName(
      model,
      source,
      Math.max(
        0,
        mapping.findIndex((m) => m.source === source),
      ),
      sections,
    );
  const colourHex = (name: string) =>
    name === ADVANCED_FILAMENT ? ADVANCED_HEX : colours.find((c) => c.name === name)?.hex || "#9aa5ab";
  const swatchClass = (name: string) =>
    "swatch " + (name === ADVANCED_FILAMENT ? "special-swatch" : name === "Custom" ? "custom-swatch" : "");
  const assign = (target: string) => {
    if (!expert) onMapping(mapping.map((m) => ({ ...m, target })));
    else if (selected) onMapping(mapping.map((m) => (m.source === selected.source ? { ...m, target } : m)));
  };
  const advanced = mapping.some((m) => m.target === ADVANCED_FILAMENT),
    custom = mapping.some((m) => m.target === "Custom");
  const option = (name: string) => {
    const checked = expert ? selected?.target === name : !mixed && mapping[0]?.target === name;
    return (
      <label key={name} className={"colour-option " + (checked ? "selected" : "")}>
        <input
          className="colour-radio"
          type="radio"
          name={groupName}
          value={name}
          checked={checked}
          onChange={() => assign(name)}
        />
        <span className={swatchClass(name)} style={{ backgroundColor: colourHex(name) }}>
          {checked && <Check size={12} strokeWidth={3} />}
        </span>
        {displayLabel(name)}
      </label>
    );
  };
  return (
    <section className="panel" aria-labelledby="colour-heading">
      <h2 id="colour-heading">Colour</h2>
      <p className="hint">
        {several
          ? `Select a ${entity}, then choose its colour. You can also click a ${entity} on the model. Most prints use one colour, so ask your teacher before using more.`
          : mixed
            ? "Your model’s parts have different colours. Choosing a colour here uses it for the whole model."
            : "Most prints use one colour."}
      </p>
      {several && (
        <div className="part-list" role="group" aria-label={sections ? "Model sections" : "Model parts"}>
          {mapping.map((m) => (
            <button
              type="button"
              key={m.source}
              className={"part-button " + (selected?.source === m.source ? "selected" : "")}
              onClick={() => onSelect(m.source)}
              aria-pressed={selected?.source === m.source}
            >
              <i className={swatchClass(m.target)} style={{ backgroundColor: colourHex(m.target) }} />
              <span>
                {partName(m.source)}
                <small>{displayLabel(m.target)}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {several && <p className="field-label">Colour for {selected ? partName(selected.source) : `this ${entity}`}</p>}
      <div className="swatches" role="radiogroup" aria-label="Available print colours">
        {colours.map((c) => option(c.name))}
        {/* Beginners only see these when they are already in use, so nothing hidden is ever selected. */}
        {customEnabled && (expert || custom) && option("Custom")}
        {(expert || advanced) && option(ADVANCED_FILAMENT)}
      </div>
      <p className="hint">Colours on screen are approximate.</p>
      {custom && (
        <label className="field">
          Which colour would you like?
          <input
            maxLength={80}
            value={customColour}
            onChange={(e) => onCustom(e.target.value)}
            placeholder="For example: light blue"
          />
        </label>
      )}
      {advanced && (
        <Field
          label="Which special filament do you need?"
          hint="Special filaments need your teacher’s approval. The preview shows them as speckled purple."
        >
          <textarea
            maxLength={800}
            rows={3}
            value={advancedNote}
            onChange={(e) => onAdvanced(e.target.value)}
            placeholder="For example: glow-in-the-dark or silk PLA"
          />
        </Field>
      )}
    </section>
  );
}

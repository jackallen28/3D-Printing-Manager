/** Short, advisory results for the trial layer preview. */
export function printTestResult(analysis, warnings) {
  const codes = new Set(warnings.map((w) => w.code)),
    fixes = [];
  if (codes.has("floating")) fixes.push("Move floating parts so they touch the model.");
  if (codes.has("thin") || codes.has("thin-features")) fixes.push("Make the amber areas thicker.");
  if (codes.has("parts")) fixes.push("Join parts that should print as one object.");
  if (codes.has("mesh") || codes.has("degenerate")) fixes.push("Export a solid model from your CAD program.");
  if (codes.has("size")) fixes.push("Make the model smaller to fit the printer.");
  if (codes.has("units")) fixes.push("Check the size shown in mm.");
  if (!analysis.complete) fixes.push("Ask staff to check this detailed model.");
  const failed = ["floating", "thin", "thin-features", "mesh", "degenerate", "size"].some((code) => codes.has(code));
  return {
    state: failed ? "failed" : fixes.length ? "check" : "finished",
    title: failed ? "Your print may fail." : fixes.length ? "Check before printing." : "Preview finished.",
    fixes: fixes.length ? [...fixes.slice(0, 2), "Ask your teacher to check your model."] : [],
  };
}

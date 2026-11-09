import { analyseGeometry } from "../../shared/geometry.js";
self.onmessage = (event: MessageEvent<{ positions: Float32Array; format: string }>) => {
  try {
    const result = analyseGeometry(event.data.positions, { format: event.data.format });
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Model checks failed." });
  }
};

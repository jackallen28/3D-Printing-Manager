import { analyseGeometry } from '../../shared/geometry.js';
self.onmessage = (event: MessageEvent<Float32Array>) => {
  try { const result = analyseGeometry(event.data); self.postMessage({ result }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Model checks failed.' }); }
};

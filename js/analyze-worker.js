// Runs melody analysis off the main thread. Receives {id, samples: Float32Array, sr}.
import { analyseSamples } from './analyze.js';

self.onmessage = (e) => {
  const { id, samples, sr } = e.data;
  try {
    self.postMessage({ id, result: analyseSamples(samples, sr) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};

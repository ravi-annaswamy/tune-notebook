// Main-thread side of analysis: decode the clip (needs Web Audio, which workers
// don't have), then hand the samples to a worker. Falls back to the main thread
// if module workers aren't available.
import { analyseSamples } from './analyze.js';

const SR = 48000;
let worker = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map();
export const analysisStats = { worker: 0, inline: 0 }; // for debugging (window.tuneNotebook)

function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./analyze-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result);
    };
    worker.onerror = (e) => {
      // Module workers unsupported or the script failed to load: run inline from now on.
      e.preventDefault?.();
      workerBroken = true;
      worker = null;
      for (const [id, p] of pending) { pending.delete(id); p.retry(); }
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

export async function decodeMono(arrayBuffer) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(1, 1, SR);
  // decodeAudioData detaches the buffer, so pass a copy.
  const audio = await new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
  if (audio.numberOfChannels === 1) return { samples: audio.getChannelData(0).slice(), sr: audio.sampleRate };
  const out = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / audio.numberOfChannels;
  }
  return { samples: out, sr: audio.sampleRate };
}

function runInline(samples, sr) {
  analysisStats.inline++;
  return new Promise((resolve, reject) => {
    setTimeout(() => { try { resolve(analyseSamples(samples, sr)); } catch (e) { reject(e); } }, 0);
  });
}

export async function analyseAudio(arrayBuffer) {
  const { samples, sr } = await decodeMono(arrayBuffer);
  const w = getWorker();
  if (!w) return runInline(samples, sr);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    analysisStats.worker++;
    pending.set(id, { resolve, reject, retry: () => runInline(samples, sr).then(resolve, reject) });
    // Copied, not transferred: the inline retry still needs the samples if the worker dies.
    w.postMessage({ id, samples, sr });
  });
}

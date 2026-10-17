// Pitch helpers: YIN pitch detection + note naming.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function midiToName(m) {
  const r = Math.round(m);
  return { name: NOTE_NAMES[((r % 12) + 12) % 12], octave: Math.floor(r / 12) - 1 };
}

// YIN (de Cheveigné & Kawahara 2002). Returns {freq, clarity, rms} or null when
// the frame is too quiet or has no clear periodicity.
export function yin(buf, sampleRate, { minFreq = 60, maxFreq = 1600, threshold = 0.15, minRms = 0.008 } = {}) {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < minRms) return null;

  const W = Math.floor(n / 2);
  const maxTau = Math.min(W - 1, Math.ceil(sampleRate / minFreq));
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const d = new Float32Array(maxTau + 1);

  // difference function
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const x = buf[i] - buf[i + tau];
      s += x * x;
    }
    d[tau] = s;
  }
  // cumulative mean normalized difference
  d[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    run += d[tau];
    d[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  // absolute threshold, then walk down to the local minimum
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= maxTau && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;

  // parabolic interpolation for sub-sample accuracy
  let better = tau;
  if (tau > 1 && tau < maxTau) {
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a + c - 2 * b;
    if (den !== 0) better = tau + (a - c) / (2 * den);
  }
  return { freq: sampleRate / better, clarity: 1 - d[tau], rms };
}

// Turn a list of per-frame MIDI estimates into one snapped note.
export function summarizePitch(midis) {
  if (midis.length < 8) return { ok: false, reason: 'quiet' };
  const sorted = [...midis].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const close = midis.filter((m) => Math.abs(m - median) < 0.6);
  if (close.length / midis.length < 0.5) return { ok: false, reason: 'unsteady' };
  const mean = close.reduce((a, b) => a + b, 0) / close.length;
  const midi = Math.round(mean);
  const { name, octave } = midiToName(midi);
  return { ok: true, midi, name, octave, freq: midiToFreq(midi), cents: Math.round((mean - midi) * 100) };
}

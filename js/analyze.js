// Melody analysis shared by the app (in a Web Worker) and tools/analyze-tune.mjs:
// hand clicks -> tempo (and meter when beat 1 is louder); whistle/voice -> tuning,
// Sa candidates, scale (thaat / pentatonic raga) and a sargam sketch.
// Pure functions on a mono Float32Array; no DOM or Node APIs.

import { yin, freqToMidi, midiToFreq, NOTE_NAMES } from './pitch.js';

export const ANALYSIS_VERSION = 1;
export const SWARA = ['S', 'r', 'R', 'g', 'G', 'm', 'M', 'P', 'd', 'D', 'n', 'N']; // r = komal Re, M = tivra Ma …
export const SCALES = [
  ['Bilaval', 'major', [0, 2, 4, 5, 7, 9, 11]],
  ['Khamaj', 'Mixolydian', [0, 2, 4, 5, 7, 9, 10]],
  ['Kafi', 'Dorian', [0, 2, 3, 5, 7, 9, 10]],
  ['Asavari', 'natural minor', [0, 2, 3, 5, 7, 8, 10]],
  ['Bhairavi', 'Phrygian', [0, 1, 3, 5, 7, 8, 10]],
  ['Kalyan', 'Lydian', [0, 2, 4, 6, 7, 9, 11]],
  ['Bhairav', 'double harmonic', [0, 1, 4, 5, 7, 8, 11]],
  ['Poorvi', '', [0, 1, 4, 6, 7, 8, 11]],
  ['Marwa', '', [0, 1, 4, 6, 7, 9, 11]],
  ['Todi', '', [0, 1, 3, 6, 7, 8, 11]],
  ['Kiravani', 'harmonic minor', [0, 2, 3, 5, 7, 8, 11]],
  ['Bhupali / Mohanam', 'major pentatonic', [0, 2, 4, 7, 9]],
  ['Durga / Shuddha Saveri', 'pentatonic', [0, 2, 5, 7, 9]],
  ['Malkauns / Hindolam', 'pentatonic', [0, 3, 5, 8, 10]],
  ['Dhani', 'minor pentatonic', [0, 3, 5, 7, 10]],
  ['Megh / Madhyamavati', 'pentatonic', [0, 2, 5, 7, 10]],
];

export const median = (a) => {
  const s = [...a].sort((p, q) => p - q);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
export const noteName = (m) => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

// ---------- clicks ----------
// Clicks are broadband transients; a whistle is a near-pure tone. A second
// difference (strong high-pass) makes clicks stand far above the whistle.
export function detectClicks(x, sr) {
  const hop = Math.round(sr * 0.005);
  const env = [];
  for (let s = 2; s + hop < x.length; s += hop) {
    let e = 0;
    for (let i = s; i < s + hop; i++) { const d = x[i] - 2 * x[i - 1] + x[i - 2]; e += d * d; }
    env.push(e / hop);
  }
  const floor = median(env) || 1e-12;
  const thr = Math.max(floor * 40, 1e-5);
  const minGap = Math.round(0.12 / 0.005);
  const clicks = [];
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] < thr || env[i] < env[i - 1] || env[i] < env[i + 1]) continue;
    const prev = clicks[clicks.length - 1];
    if (prev && i - prev.i < minGap) { if (env[i] > prev.e) Object.assign(prev, { i, e: env[i] }); continue; }
    clicks.push({ i, e: env[i] });
  }
  return clicks.map((c) => ({ t: c.i * 0.005 + 0.0025, strength: 10 * Math.log10(c.e / floor) }));
}

// Hand clicks drift, so follow the beat click by click instead of forcing one grid.
export function followBeats(times, startPeriod) {
  if (times.length < 4) return null;
  let P = startPeriod;
  const beats = [times[0]];
  const extras = [];
  let missed = 0;
  for (const t of times.slice(1)) {
    const last = beats[beats.length - 1];
    const k = Math.max(1, Math.round((t - last) / P));
    const err = (t - last) - k * P;
    if ((t - last) < 0.6 * P || Math.abs(err) > 0.25 * P || k > 4) { extras.push(t); continue; }
    missed += k - 1;
    P = 0.75 * P + 0.25 * ((t - last) / k);
    beats.push(t);
  }
  if (beats.length < 4) return null;
  const ioi = [];
  for (let i = 1; i < beats.length; i++) {
    const k = Math.max(1, Math.round((beats[i] - beats[i - 1]) / startPeriod));
    ioi.push({ t: beats[i], period: (beats[i] - beats[i - 1]) / k });
  }
  const periods = ioi.map((x) => x.period);
  const medP = median(periods);
  const q = (arr, f) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(f * (s.length - 1))]; };
  return {
    bpm: 60 / medP, beats, extras, missed,
    bpmLow: 60 / q(periods, 0.9), bpmHigh: 60 / q(periods, 0.1),
    steadinessMs: 1000 * Math.sqrt(periods.reduce((a, p) => a + (p - medP) ** 2, 0) / periods.length),
    curve: ioi.map((x) => ({ t: x.t, bpm: 60 / x.period })),
  };
}

// Is every Nth click louder? (Only readable when the user accents beat 1.)
export function meterFromAccents(clicks, follow) {
  if (!follow || follow.beats.length < 8) return null;
  const period = 60 / follow.bpm;
  const strengthAt = new Map(clicks.map((c) => [c.t, c.strength]));
  const byBeat = new Map();
  let idx = 0;
  follow.beats.forEach((t, i) => {
    if (i) idx += Math.max(1, Math.round((t - follow.beats[i - 1]) / period));
    byBeat.set(idx, strengthAt.get(t));
  });
  const accents = [2, 3, 4].map((m) => {
    let best = -Infinity;
    for (let ph = 0; ph < m; ph++) {
      const on = [], off = [];
      for (const [i, s] of byBeat) ((((i - ph) % m) + m) % m === 0 ? on : off).push(s);
      if (!on.length || !off.length) continue;
      best = Math.max(best, on.reduce((a, b) => a + b, 0) / on.length - off.reduce((a, b) => a + b, 0) / off.length);
    }
    return { beatsPerBar: m, accentDb: best };
  });
  const top = [...accents].sort((a, b) => b.accentDb - a.accentDb)[0];
  const guess = top.accentDb >= 3 ? (top.beatsPerBar === 3 ? '3/4' : '4/4') : null;
  return { guess, accents };
}

// ---------- pitch ----------
export function pitchTrack(x, sr, clickTimes) {
  const win = 2048, hop = Math.round(sr * 0.01);
  const frames = [];
  let ci = 0;
  for (let s = 0; s + win <= x.length; s += hop) {
    const t = (s + win / 2) / sr;
    while (ci < clickTimes.length && clickTimes[ci] < t - 0.03) ci++;
    if (ci < clickTimes.length && Math.abs(clickTimes[ci] - t) < 0.03) { frames.push({ t, midi: null }); continue; }
    const r = yin(x.subarray(s, s + win), sr, { minFreq: 150, maxFreq: 4200, minRms: 0.004 });
    frames.push({ t, midi: r && r.clarity > 0.85 ? freqToMidi(r.freq) : null });
  }
  return frames;
}

// Whistles rarely sit on A440 equal temperament. Find the global offset (cents)
// that best centres the stable pitches on semitones (circular mean).
export function tuningOffset(midis) {
  let c = 0, s = 0;
  for (const m of midis) { const a = 2 * Math.PI * (m - Math.round(m)); c += Math.cos(a); s += Math.sin(a); }
  return (Math.atan2(s, c) / (2 * Math.PI)) * 100;
}

// Group frames into steady notes (glides and wobbles are dropped).
export function segmentNotes(frames, offsetCents) {
  const notes = [];
  let cur = [];
  const flush = () => {
    if (cur.length >= 8) { // >= 80 ms
      const ms = cur.map((f) => f.m);
      const med = median(ms);
      const steady = ms.filter((m) => Math.abs(m - med) < 0.5);
      if (steady.length / ms.length > 0.7) {
        notes.push({ start: cur[0].t, end: cur[cur.length - 1].t + 0.01, midi: Math.round(med) });
      }
    }
    cur = [];
  };
  let gap = 0;
  for (const f of frames) {
    if (f.midi == null) { if (++gap > 3) flush(); continue; }
    gap = 0;
    const m = f.midi - offsetCents / 100;
    if (cur.length) {
      const ref = median(cur.slice(-6).map((c) => c.m));
      if (Math.abs(m - ref) > 0.6) flush();
    }
    cur.push({ t: f.t, m });
  }
  flush();
  const merged = [];
  for (const n of notes) {
    const prev = merged[merged.length - 1];
    if (prev && prev.midi === n.midi && n.start - prev.end < 0.15) prev.end = n.end;
    else merged.push({ ...n });
  }
  return merged.map((n) => ({ ...n, dur: n.end - n.start }));
}

// Score every pitch class as Sa: time on Sa and Pa, how well the notes fit a
// known scale from there, a bonus if the tune ends there, a penalty if Pa never sounds.
export function rankSa(notes) {
  const w = new Array(12).fill(0);
  let total = 0;
  for (const n of notes) {
    if (n.dur < 0.12) continue; // passing notes and glide fragments don't define the scale
    const pc = ((n.midi % 12) + 12) % 12;
    w[pc] += n.dur;
    total += n.dur;
  }
  const hist = w.map((v) => v / (total || 1));
  const lastLong = [...notes].reverse().find((n) => n.dur > 0.25);
  const cands = [];
  for (let sa = 0; sa < 12; sa++) {
    const rel = (k) => hist[(sa + k) % 12];
    let best = null;
    for (const [name, western, pcs] of SCALES) {
      const inside = pcs.reduce((s, k) => s + rel(k), 0);
      const fit = inside - 0.015 * pcs.length; // favour simpler scales when equal
      if (!best || fit > best.fit) best = { name, western, pcs, inside, fit };
    }
    const ends = !!lastLong && ((((lastLong.midi - sa) % 12) + 12) % 12) === 0;
    const noPa = rel(7) < 0.03 ? 0.15 : 0;
    const score = 0.9 * rel(0) + 0.5 * rel(7) + best.inside + (ends ? 0.12 : 0) - noPa;
    cands.push({
      pc: sa, name: NOTE_NAMES[sa], score, ends, saShare: rel(0), paShare: rel(7),
      scale: best.name, western: best.western, scalePcs: best.pcs, coverage: best.inside,
    });
  }
  cands.sort((a, b) => b.score - a.score);
  return { hist, cands };
}

// Octave for Sa: the Sa at or below the tune's median note (where the tune "lives").
export function saMidiFor(notes, pc) {
  if (!notes.length) return 60 + pc;
  const med = median(notes.map((n) => n.midi));
  return med - ((((med - pc) % 12) + 12) % 12);
}

// notes: [{midi, dur}] -> "S R G— m …" ('/. = upper/lower octave, — = each extra held beat)
export function sargamString(notes, saMidi, bpm) {
  return notes.map((n) => {
    const rel = n.midi - saMidi;
    const oct = Math.floor(rel / 12);
    const mark = oct > 0 ? "'".repeat(oct) : oct < 0 ? '.'.repeat(-oct) : '';
    const beats = bpm ? n.dur / (60 / bpm) : 0;
    const hold = beats >= 1.5 ? '—'.repeat(Math.min(3, Math.round(beats) - 1)) : '';
    return SWARA[((rel % 12) + 12) % 12] + mark + hold;
  }).join(' ');
}

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

// Full analysis. Returns a compact, JSON-safe object suitable for storing with the tune.
export function analyseSamples(x, sr) {
  const duration = x.length / sr;
  const clicks = detectClicks(x, sr);
  const ct = clicks.map((c) => c.t);
  const gaps = ct.slice(1).map((t, i) => t - ct[i]).filter((g) => g > 0.25 && g < 1.5);
  const follow = gaps.length >= 3 ? followBeats(ct, median(gaps)) : null;
  const meter = meterFromAccents(clicks, follow);

  const frames = pitchTrack(x, sr, ct);
  const voiced = frames.filter((f) => f.midi != null).map((f) => f.midi);
  const tuningCents = voiced.length ? tuningOffset(voiced) : 0;
  const notes = segmentNotes(frames, tuningCents);
  const { hist, cands } = notes.length >= 4 ? rankSa(notes) : { hist: new Array(12).fill(0), cands: [] };
  const top = cands[0] || null;
  const saMidi = top ? saMidiFor(notes, top.pc) : null;

  return {
    version: ANALYSIS_VERSION,
    duration: r1(duration),
    clicks: ct.map(r3),
    tempo: follow ? {
      bpm: r1(follow.bpm), low: Math.round(follow.bpmLow), high: Math.round(follow.bpmHigh),
      wobbleMs: Math.round(follow.steadinessMs), beats: follow.beats.length, extras: follow.extras.length, missed: follow.missed,
      curve: follow.curve.map((c) => [r3(c.t), r1(c.bpm)]),
    } : null,
    meter,
    tuningCents: Math.round(tuningCents),
    voicedSeconds: r1(voiced.length * 0.01),
    hist: hist.map(r3),
    candidates: cands.slice(0, 4).map((c) => ({
      pc: c.pc, name: c.name, score: r3(c.score), ends: c.ends, saShare: r3(c.saShare), paShare: r3(c.paShare),
      scale: c.scale, western: c.western, scalePcs: c.scalePcs, coverage: r3(c.coverage),
    })),
    saMidi,
    saFreq: saMidi != null ? r1(midiToFreq(saMidi + tuningCents / 100)) : null,
    notes: notes.map((n) => [r3(n.start), r3(n.dur), n.midi]),
    range: notes.length ? [Math.min(...notes.map((n) => n.midi)), Math.max(...notes.map((n) => n.midi))] : null,
  };
}

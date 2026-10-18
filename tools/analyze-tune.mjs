// Offline analysis of a Tune Notebook recording: clicks -> tempo/meter, whistle/voice -> Sa, scale, sargam.
// Usage: node tools/analyze-tune.mjs <file.m4a|file.wav> [--json]
// Non-WAV input is decoded with macOS `afconvert`.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { yin, freqToMidi, NOTE_NAMES } from '../js/pitch.js';

// ---------- decode ----------
export function readWav(path) {
  const buf = readFileSync(path);
  let p = 12, sr = 0, ch = 1, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), sz = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') { ch = buf.readUInt16LE(p + 10); sr = buf.readUInt32LE(p + 12); }
    if (id === 'data') data = buf.subarray(p + 8, p + 8 + sz);
    p += 8 + sz + (sz & 1);
  }
  const n = Math.floor(data.length / 2 / ch);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = data.readInt16LE(i * 2 * ch) / 32768;
  return { x, sr };
}

function load(path) {
  if (/\.wav$/i.test(path)) return readWav(path);
  const dir = mkdtempSync(join(tmpdir(), 'tune-'));
  try {
    const out = join(dir, 'a.wav');
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@48000', '-c', '1', path, out]);
    return readWav(out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const median = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : 0; };

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
  const floor = median(env);
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

// Fit a steady beat grid to the click times.
export function fitTempo(times) {
  if (times.length < 4) return null;
  // Score = clicks explained x share of grid beats that actually got a click.
  // The occupancy term stops half-beat grids (which also "explain" every click) from winning.
  const span = times[times.length - 1] - times[0];
  let best = null;
  for (let period = 0.25; period <= 1.5; period += 0.001) {
    for (let k = 0; k < 40; k++) {
      const phase = times[0] + ((k / 40) - 0.5) * period * 0.2;
      let matched = 0;
      const hit = new Set();
      for (const t of times) {
        const idx = Math.round((t - phase) / period);
        const dev = (t - (phase + idx * period)) / 0.035;
        const w = Math.exp(-(dev ** 2));
        matched += w;
        if (w > 0.5) hit.add(idx);
      }
      const slots = Math.floor(span / period) + 1;
      const score = matched * Math.min(1, hit.size / slots);
      if (!best || score > best.score) best = { period, phase, score };
    }
  }
  // Refine with least squares on (beat index, time) for on-grid clicks.
  const pts = [];
  for (const t of times) {
    const idx = Math.round((t - best.phase) / best.period);
    const dev = t - (best.phase + idx * best.period);
    if (Math.abs(dev) < 0.08) pts.push([idx, t]);
  }
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0;
  for (const [a, b] of pts) { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; }
  const period = sxy / sxx, t0 = my - period * mx;
  const resid = pts.map(([a, b]) => (b - (t0 + a * period)) * 1000);
  const jitter = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / n);
  // Local tempo over time from consecutive on-grid clicks
  const local = [];
  for (let i = 1; i < pts.length; i++) {
    const beats = pts[i][0] - pts[i - 1][0];
    if (beats >= 1 && beats <= 2) local.push({ t: pts[i][1], bpm: 60 / ((pts[i][1] - pts[i - 1][1]) / beats) });
  }
  return { bpm: 60 / period, period, t0, onGrid: n, total: times.length, jitterMs: jitter, local, beats: pts.map((p) => p[0]) };
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

// Phrases = runs of notes separated by rests; their lengths in beats hint at the meter.
export function phrases(notes, period) {
  const out = [];
  let cur = null;
  for (const n of notes) {
    if (!cur || n.start - cur.end > 0.35) { cur = { start: n.start, end: n.end, notes: 1 }; out.push(cur); }
    else { cur.end = n.end; cur.notes++; }
  }
  return out.filter((p) => p.notes >= 3).map((p) => ({ ...p, beats: (p.end - p.start) / period }));
}

// ---------- pitch ----------
export function pitchTrack(x, sr, clickTimes) {
  const win = 2048, hop = Math.round(sr * 0.01);
  const frames = [];
  for (let s = 0; s + win <= x.length; s += hop) {
    const t = (s + win / 2) / sr;
    if (clickTimes.some((c) => Math.abs(c - t) < 0.03)) { frames.push({ t, midi: null }); continue; }
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
        notes.push({ start: cur[0].t, end: cur[cur.length - 1].t + 0.01, midi: Math.round(med), cents: Math.round((med - Math.round(med)) * 100) });
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

// ---------- Sa and scale ----------
const SWARA = ['S', 'r', 'R', 'g', 'G', 'm', 'M', 'P', 'd', 'D', 'n', 'N']; // r=komal Re, M=tivra Ma ...
const SCALES = [
  ['Bilaval thaat (major)', [0, 2, 4, 5, 7, 9, 11]],
  ['Khamaj thaat (Mixolydian)', [0, 2, 4, 5, 7, 9, 10]],
  ['Kafi thaat (Dorian)', [0, 2, 3, 5, 7, 9, 10]],
  ['Asavari thaat (natural minor)', [0, 2, 3, 5, 7, 8, 10]],
  ['Bhairavi thaat (Phrygian)', [0, 1, 3, 5, 7, 8, 10]],
  ['Kalyan thaat (Lydian)', [0, 2, 4, 6, 7, 9, 11]],
  ['Bhairav thaat', [0, 1, 4, 5, 7, 8, 11]],
  ['Poorvi thaat', [0, 1, 4, 6, 7, 8, 11]],
  ['Marwa thaat', [0, 1, 4, 6, 7, 9, 11]],
  ['Todi thaat', [0, 1, 3, 6, 7, 8, 11]],
  ['Harmonic minor (Kiravani)', [0, 2, 3, 5, 7, 8, 11]],
  ['Bhupali / Mohanam (major pentatonic)', [0, 2, 4, 7, 9]],
  ['Durga / Shuddha Saveri', [0, 2, 5, 7, 9]],
  ['Malkauns / Hindolam', [0, 3, 5, 8, 10]],
  ['Dhani / minor pentatonic', [0, 3, 5, 7, 10]],
  ['Megh / Madhyamavati', [0, 2, 5, 7, 10]],
];

export function analysePitch(notes) {
  const w = new Array(12).fill(0);
  let total = 0;
  for (const n of notes) {
    if (n.dur < 0.12) continue; // passing notes and glide fragments don't define the scale
    const pc = ((n.midi % 12) + 12) % 12; w[pc] += n.dur; total += n.dur;
  }
  const hist = w.map((v) => v / (total || 1));
  const longNotes = [...notes].sort((a, b) => b.dur - a.dur);
  const lastLong = [...notes].reverse().find((n) => n.dur > 0.25);
  const lowest = notes.length ? Math.min(...notes.map((n) => n.midi)) : null;

  // Score every pitch class as Sa: time spent on Sa and Pa, how well the notes
  // fit a known scale from there, and whether the phrase ends there.
  const cands = [];
  for (let sa = 0; sa < 12; sa++) {
    const rel = (k) => hist[(sa + k) % 12];
    let bestScale = null;
    for (const [name, pcs] of SCALES) {
      const inside = pcs.reduce((s, k) => s + rel(k), 0);
      const fit = inside - 0.015 * pcs.length; // favour simpler scales when equal
      if (!bestScale || fit > bestScale.fit) bestScale = { name, pcs, inside, fit };
    }
    const ends = lastLong && ((lastLong.midi - sa) % 12 + 12) % 12 === 0 ? 0.12 : 0;
    const noPa = rel(7) < 0.03 ? 0.15 : 0; // a Sa whose Pa never sounds is unlikely
    const score = 0.9 * rel(0) + 0.5 * rel(7) + bestScale.inside + ends - noPa;
    cands.push({ sa, name: NOTE_NAMES[sa], score, scale: bestScale, ends: !!ends, saShare: rel(0), paShare: rel(7) });
  }
  cands.sort((a, b) => b.score - a.score);
  return { hist, cands, longNotes, lastLong, lowest };
}

const noteName = (m) => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

export function sargam(notes, sa, tempo) {
  return notes.map((n) => {
    const rel = n.midi - sa;
    const sw = SWARA[((rel % 12) + 12) % 12];
    const oct = Math.floor(rel / 12);
    const mark = oct > 0 ? "'".repeat(oct) : oct < 0 ? '.'.repeat(-oct) : '';
    const beats = tempo ? n.dur / tempo.period : null;
    return { ...n, swara: sw + mark, beats };
  });
}

// ---------- report ----------
export function analyse(path) {
  const { x, sr } = load(path);
  const duration = x.length / sr;
  const clicks = detectClicks(x, sr);
  const ct = clicks.map((c) => c.t);
  const gaps = ct.slice(1).map((t, i) => t - ct[i]).filter((g) => g > 0.25 && g < 1.5);
  const follow = gaps.length >= 3 ? followBeats(ct, median(gaps)) : null;
  const tempo = follow ? { period: 60 / follow.bpm } : null;
  const frames = pitchTrack(x, sr, clicks.map((c) => c.t));
  const voiced = frames.filter((f) => f.midi != null).map((f) => f.midi);
  const offset = tuningOffset(voiced);
  const notes = segmentNotes(frames, offset);
  const pa = analysePitch(notes);
  const top = pa.cands[0];
  const med = median(notes.map((n) => n.midi));
  const saMidiBase = notes.length ? med - ((((med - top.sa) % 12) + 12) % 12) : top.sa + 60;
  const sg = sargam(notes, saMidiBase, tempo);

  // Meter: accent pattern of click strengths by beat position.
  let meter = null;
  if (follow && follow.beats.length >= 8) {
    const strengthAt = new Map(clicks.map((c) => [c.t, c.strength]));
    const byBeat = new Map();
    let idx = 0;
    follow.beats.forEach((t, i) => {
      if (i) idx += Math.max(1, Math.round((t - follow.beats[i - 1]) / tempo.period));
      byBeat.set(idx, strengthAt.get(t));
    });
    meter = [2, 3, 4].map((m) => {
      let bestContrast = -Infinity, bestPhase = 0;
      for (let ph = 0; ph < m; ph++) {
        const on = [], off = [];
        for (const [i, s] of byBeat) (((i - ph) % m + m) % m === 0 ? on : off).push(s);
        const contrast = (on.reduce((a, b) => a + b, 0) / on.length) - (off.reduce((a, b) => a + b, 0) / off.length);
        if (contrast > bestContrast) { bestContrast = contrast; bestPhase = ph; }
      }
      return { beatsPerBar: m, accentDb: bestContrast, phase: bestPhase };
    });
  }
  const phr = tempo ? phrases(sg, tempo.period) : [];
  return { path, duration, sr, clicks, tempo, follow, phrases: phr, meter, tuningOffsetCents: offset, voicedSeconds: voiced.length * 0.01, notes: sg, pitch: pa, saMidi: saMidiBase };
}

function printReport(r) {
  const f1 = (v) => v.toFixed(1);
  console.log(`\n=== ${r.path.split('/').pop()}  (${f1(r.duration)} s)`);
  console.log(`Clicks found: ${r.clicks.length}${r.clicks.length ? ` (first at ${f1(r.clicks[0].t)} s, last at ${f1(r.clicks[r.clicks.length - 1].t)} s)` : ''}`);
  if (r.follow) {
    const f = r.follow;
    const c = f.curve.map((x) => x.bpm);
    const part = (a, b) => Math.round(median(c.slice(Math.floor(a * c.length), Math.ceil(b * c.length))));
    console.log(`Tempo: ≈ ${Math.round(f.bpm)} BPM (beat ≈ ${Math.round(60000 / f.bpm)} ms). ${f.beats.length} clicks follow the beat, ${f.extras.length} extra, ${f.missed} beats skipped.`);
    console.log(`  Most beats between ${Math.round(f.bpmLow)} and ${Math.round(f.bpmHigh)} BPM (beat-to-beat wobble ±${Math.round(f.steadinessMs)} ms). By thirds of the take: ${part(0, 1 / 3)} → ${part(1 / 3, 2 / 3)} → ${part(2 / 3, 1)} BPM.`);
    if (f.extras.length) console.log(`  Extra clicks at: ${f.extras.map((t) => f1(t)).join(', ')} s`);
  } else console.log('Tempo: not enough clicks.');
  if (r.meter) {
    const best = [...r.meter].sort((a, b) => b.accentDb - a.accentDb)[0];
    const verdict = best.accentDb >= 3 ? `clicks are louder every ${best.beatsPerBar} beats → likely ${best.beatsPerBar === 3 ? '3/4' : best.beatsPerBar === 2 ? '2/4 or 4/4' : '4/4'}` : 'clicks are evenly strong → meter not readable from them';
    console.log(`Meter: ${verdict} (${r.meter.map((m) => `every ${m.beatsPerBar}: +${m.accentDb.toFixed(1)} dB`).join(', ')})`);
  }
  console.log(`Voiced (pitched) audio: ${f1(r.voicedSeconds)} s. Your tuning sits ${Math.round(r.tuningOffsetCents)} cents from A440.`);
  console.log('Time on each pitch class (steady notes only):');
  const order = [...r.pitch.hist.keys()].sort((a, b) => r.pitch.hist[b] - r.pitch.hist[a]);
  console.log('  ' + order.filter((k) => r.pitch.hist[k] > 0.005).map((k) => `${NOTE_NAMES[k]} ${Math.round(r.pitch.hist[k] * 100)}%`).join('  '));
  console.log('Sa candidates:');
  for (const c of r.pitch.cands.slice(0, 3)) {
    console.log(`  ${c.name.padEnd(2)} score ${c.score.toFixed(2)}  Sa ${Math.round(c.saShare * 100)}%, Pa ${Math.round(c.paShare * 100)}%${c.ends ? ', last long note' : ''} → ${c.scale.name} covers ${Math.round(c.scale.inside * 100)}%`);
  }
  const top = r.pitch.cands[0];
  const used = top.scale.pcs.map((k) => SWARA[k]).join(' ');
  const heard = SWARA.filter((_, k) => r.pitch.hist[(top.sa + k) % 12] >= 0.03);
  console.log(`Best guess: Sa = ${top.name} (${noteName(r.saMidi)}), scale ${top.scale.name}: ${used}. Swaras with ≥3% of the time: ${heard.join(' ')}`);
  console.log(`Range: ${noteName(Math.min(...r.notes.map((n) => n.midi)))} – ${noteName(Math.max(...r.notes.map((n) => n.midi)))}`);
  const line = r.notes.map((n) => `${n.swara}${n.beats != null ? (n.beats >= 1.5 ? '—'.repeat(Math.min(3, Math.round(n.beats) - 1)) : '') : ''}`);
  console.log('Sargam (steady notes, in order; dashes = held beats):');
  for (let i = 0; i < line.length; i += 16) console.log('  ' + line.slice(i, i + 16).join(' '));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const json = process.argv.includes('--json');
  for (const f of files) {
    const r = analyse(f);
    if (json) console.log(JSON.stringify({ ...r, clicks: r.clicks.map((c) => +c.t.toFixed(3)) }, null, 1));
    else printReport(r);
  }
}

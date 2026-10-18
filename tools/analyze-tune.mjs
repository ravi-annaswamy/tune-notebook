// Command-line analysis of Tune Notebook recordings (same code the app runs: js/analyze.js).
// Usage: node tools/analyze-tune.mjs <file.m4a|file.wav> [...] [--json]
// Non-WAV input is decoded with macOS `afconvert`.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyseSamples, sargamString, noteName, median, SWARA } from '../js/analyze.js';
import { NOTE_NAMES } from '../js/pitch.js';

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

export function load(path) {
  if (/\.wav$/i.test(path)) return readWav(path);
  const dir = mkdtempSync(join(tmpdir(), 'tune-'));
  try {
    const out = join(dir, 'a.wav');
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@48000', '-c', '1', path, out]);
    return readWav(out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function printReport(name, r) {
  const f1 = (v) => v.toFixed(1);
  console.log(`\n=== ${name}  (${f1(r.duration)} s)`);
  console.log(`Clicks found: ${r.clicks.length}${r.clicks.length ? ` (first at ${f1(r.clicks[0])} s, last at ${f1(r.clicks[r.clicks.length - 1])} s)` : ''}`);
  if (r.tempo) {
    const t = r.tempo;
    const c = t.curve.map((x) => x[1]);
    const part = (a, b) => Math.round(median(c.slice(Math.floor(a * c.length), Math.ceil(b * c.length))));
    console.log(`Tempo: ≈ ${Math.round(t.bpm)} BPM (beat ≈ ${Math.round(60000 / t.bpm)} ms). ${t.beats} clicks follow the beat, ${t.extras} extra, ${t.missed} beats skipped.`);
    console.log(`  Most beats between ${t.low} and ${t.high} BPM (beat-to-beat wobble ±${t.wobbleMs} ms). By thirds of the take: ${part(0, 1 / 3)} → ${part(1 / 3, 2 / 3)} → ${part(2 / 3, 1)} BPM.`);
  } else console.log('Tempo: not enough clicks.');
  if (r.meter) {
    const verdict = r.meter.guess ? `accented beats → likely ${r.meter.guess}` : 'clicks are evenly strong → meter not readable from them';
    console.log(`Meter: ${verdict} (${r.meter.accents.map((m) => `every ${m.beatsPerBar}: +${m.accentDb.toFixed(1)} dB`).join(', ')})`);
  }
  console.log(`Voiced (pitched) audio: ${f1(r.voicedSeconds)} s. Your tuning sits ${r.tuningCents} cents from A440.`);
  console.log('Time on each pitch class (steady notes only):');
  const order = [...r.hist.keys()].sort((a, b) => r.hist[b] - r.hist[a]);
  console.log('  ' + order.filter((k) => r.hist[k] > 0.005).map((k) => `${NOTE_NAMES[k]} ${Math.round(r.hist[k] * 100)}%`).join('  '));
  if (!r.candidates.length) { console.log('Not enough steady notes to name Sa.'); return; }
  console.log('Sa candidates:');
  for (const c of r.candidates.slice(0, 3)) {
    console.log(`  ${c.name.padEnd(2)} score ${c.score.toFixed(2)}  Sa ${Math.round(c.saShare * 100)}%, Pa ${Math.round(c.paShare * 100)}%${c.ends ? ', last long note' : ''} → ${c.scale}${c.western ? ` (${c.western})` : ''} covers ${Math.round(c.coverage * 100)}%`);
  }
  const top = r.candidates[0];
  const heard = SWARA.filter((_, k) => r.hist[(top.pc + k) % 12] >= 0.03);
  console.log(`Best guess: Sa = ${top.name} (${noteName(r.saMidi)}, ≈ ${r.saFreq} Hz), ${top.scale}: ${top.scalePcs.map((k) => SWARA[k]).join(' ')}. Swaras with ≥3% of the time: ${heard.join(' ')}`);
  console.log(`Range: ${noteName(r.range[0])} – ${noteName(r.range[1])}`);
  const notes = r.notes.map(([, dur, midi]) => ({ dur, midi }));
  const words = sargamString(notes, r.saMidi, r.tempo?.bpm).split(' ');
  console.log('Sargam (steady notes, in order; dashes = held beats):');
  for (let i = 0; i < words.length; i += 16) console.log('  ' + words.slice(i, i + 16).join(' '));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const json = process.argv.includes('--json');
  for (const f of files) {
    const { x, sr } = load(f);
    const r = analyseSamples(x, sr);
    if (json) console.log(JSON.stringify(r));
    else printReport(f.split('/').pop(), r);
  }
}

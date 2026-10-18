// Tests for js/analyze.js: synthetic takes with known answers, plus a regression
// check on the user's confirmed recordings when samples/ is present (it is git-ignored).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyseSamples, sargamString, saMidiFor } from '../js/analyze.js';
import { readZip } from '../js/zip.js';

const SR = 48000;
let seed = 1;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;

// A whistle-like melody (near-pure tone) with a short noise click on every beat.
function synthTake({ saMidi, cents = 0, bpm, melody, clicks = true }) {
  const beat = 60 / bpm;
  const total = melody.reduce((s, [, b]) => s + b, 0) * beat + 1.5;
  const x = new Float32Array(Math.ceil(total * SR));
  let t = 0.75;
  for (const [deg, beats] of melody) {
    const f = 440 * 2 ** ((saMidi + deg + cents / 100 - 69) / 12);
    const n0 = Math.round(t * SR), len = Math.round((beats * beat - 0.06) * SR);
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / 480, (len - i) / 480);
      const ph = (2 * Math.PI * f * i) / SR;
      x[n0 + i] += env * (0.25 * Math.sin(ph) + 0.02 * Math.sin(2 * ph));
    }
    t += beats * beat;
  }
  if (clicks) {
    for (let bt = 0.75; bt < total - 0.5; bt += beat) {
      const n0 = Math.round(bt * SR);
      for (let i = 0; i < 150; i++) x[n0 + i] += 0.5 * rand() * Math.exp(-i / 40);
    }
  }
  return x;
}

// S R G m P | D N S' — S' N D P | m G R S — (a Bilaval phrase that settles on Sa)
const MELODY = [[0, 2], [2, 1], [4, 1], [5, 1], [7, 2], [9, 1], [11, 1], [12, 2], [11, 1], [9, 1], [7, 2],
  [5, 1], [4, 1], [2, 1], [0, 3], [4, 1], [7, 2], [4, 1], [0, 3]];

test('synthetic take: tempo, tuning offset, Sa and scale', () => {
  const x = synthTake({ saMidi: 86, cents: -30, bpm: 90, melody: MELODY }); // Sa = D6, whistled 30 cents flat
  const a = analyseSamples(x, SR);
  assert.ok(a.tempo, 'tempo found');
  assert.ok(Math.abs(a.tempo.bpm - 90) <= 1.5, `bpm ${a.tempo.bpm}`);
  assert.ok(Math.abs(a.tuningCents + 30) <= 8, `tuning ${a.tuningCents}`);
  assert.equal(a.candidates[0].name, 'D');
  assert.equal(a.candidates[0].scale, 'Bilaval');
  assert.equal(a.saMidi % 12, 2);
  assert.equal(a.meter.guess, null, 'even clicks give no meter');
  const s = sargamString(a.notes.map(([, dur, midi]) => ({ dur, midi })), a.saMidi, a.tempo.bpm);
  assert.match(s, /^S— R G m P— D N S'— N D P— m G R S——/);
});

test('accented beat 1 every 3 clicks reads as 3/4', () => {
  const bpm = 100, beat = 60 / bpm;
  const x = new Float32Array(SR * 16);
  let k = 0;
  for (let bt = 0.5; bt < 15.5; bt += beat, k++) {
    const amp = k % 3 === 0 ? 0.8 : 0.2;
    const n0 = Math.round(bt * SR);
    for (let i = 0; i < 150; i++) x[n0 + i] += amp * rand() * Math.exp(-i / 40);
  }
  const a = analyseSamples(x, SR);
  assert.ok(Math.abs(a.tempo.bpm - bpm) <= 1.5);
  assert.equal(a.meter.guess, '3/4');
});

test('no clicks: no tempo, Sa still found', () => {
  const x = synthTake({ saMidi: 79, bpm: 80, melody: MELODY, clicks: false }); // Sa = G5
  const a = analyseSamples(x, SR);
  assert.equal(a.tempo, null);
  assert.equal(a.candidates[0].name, 'G');
});

test('silence: nothing to report, no crash', () => {
  const a = analyseSamples(new Float32Array(SR * 3), SR);
  assert.equal(a.tempo, null);
  assert.equal(a.candidates.length, 0);
  assert.equal(a.saMidi, null);
});

test('Sa octave is the one the tune lives in', () => {
  assert.equal(saMidiFor([{ midi: 70 }, { midi: 74 }, { midi: 77 }], 10), 70);
  assert.equal(saMidiFor([{ midi: 80 }, { midi: 82 }, { midi: 84 }], 10), 82);
});

// The user's own takes, Sa confirmed by ear on 2026-10-18.
const BACKUP = new URL('../samples/tune-notebook-backup-2026-10-18.zip', import.meta.url).pathname;
test('user takes: tempo and confirmed Sa', { skip: !existsSync(BACKUP) || process.platform !== 'darwin' }, async () => {
  const { readFileSync } = await import('node:fs');
  const { load } = await import('../tools/analyze-tune.mjs');
  const entries = await readZip(readFileSync(BACKUP).buffer.slice(0));
  const expected = { '12-23': [85, 'A#'], '12-40': [86, 'C#'], '12-41': [96, 'D#'] };
  const dir = mkdtempSync(join(tmpdir(), 'tn-test-'));
  try {
    for (const e of entries.filter((e) => e.name.endsWith('.m4a'))) {
      const key = Object.keys(expected).find((k) => e.name.includes(k));
      const f = join(dir, 'a.m4a');
      writeFileSync(f, e.data);
      const { x, sr } = load(f);
      const a = analyseSamples(x, sr);
      const [bpm, sa] = expected[key];
      assert.ok(Math.abs(a.tempo.bpm - bpm) <= 1.5, `${key}: bpm ${a.tempo.bpm}`);
      assert.equal(a.candidates[0].name, sa, `${key}: Sa`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

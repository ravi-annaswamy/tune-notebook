import test from 'node:test';
import assert from 'node:assert/strict';
import {
  randomPrompt, rerollPart, describePrompt, voiceChord, pluckSamples, stringsFor, STYLES, PROGRESSIONS,
} from '../js/prompt.js';
import { yin, freqToMidi } from '../js/pitch.js';

let seed = 42;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test('random prompts are always playable', () => {
  for (let i = 0; i < 500; i++) {
    const p = randomPrompt(rand);
    assert.ok(p.bpm >= 70 && p.bpm <= 126, `bpm ${p.bpm}`);
    assert.ok(p.meter === 3 || p.meter === 4);
    assert.ok(p.keyPc >= 0 && p.keyPc < 12);
    assert.ok(STYLES[p.meter].some((s) => s.id === p.styleId), 'style matches meter');
    const d = describePrompt(p);
    assert.ok(d.chords.length >= 2 && d.bars >= 3);
  }
});

test('shuffle never repeats the same progression twice in a row', () => {
  let prev = randomPrompt(rand);
  for (let i = 0; i < 200; i++) {
    const next = randomPrompt(rand, prev);
    assert.notEqual(next.progressionId, prev.progressionId);
    prev = next;
  }
});

test('rerolling one part keeps the others', () => {
  const p = { bpm: 92, meter: 4, keyPc: 2, progressionId: 'pop', styleId: 'folk' };
  const t = rerollPart(p, 'tempo', rand);
  assert.ok(Math.abs(t.bpm - 92) >= 6);
  assert.deepEqual({ ...t, bpm: 92 }, p);
  const k = rerollPart(p, 'key', rand);
  assert.notEqual(k.keyPc, 2);
  assert.deepEqual({ ...k, keyPc: 2 }, p);
  const c = rerollPart(p, 'chords', rand);
  assert.notEqual(c.progressionId, 'pop');
  const f = rerollPart(p, 'feel', rand);
  assert.equal(f.meter, 3);
  assert.ok(STYLES[3].some((s) => s.id === f.styleId));
});

test('progressions are spelled in the right key', () => {
  const d = describePrompt({ bpm: 92, meter: 4, keyPc: 2, progressionId: 'pop', styleId: 'folk' });
  assert.deepEqual(d.chords.map((c) => c.name), ['D', 'A', 'Bm', 'G']);
  assert.deepEqual(d.chords.map((c) => c.roman), ['I', 'V', 'vi', 'IV']);
  assert.equal(d.keyName, 'D');
  const m = describePrompt({ bpm: 80, meter: 3, keyPc: 9, progressionId: 'andalusian', styleId: 'waltz' });
  assert.deepEqual(m.chords.map((c) => c.name), ['Am', 'G', 'F', 'E']);
  assert.equal(m.meterName, '3/4');
});

test('guitar voicings: real shapes, right notes, playable range', () => {
  assert.deepEqual(voiceChord(4, ''), [40, 47, 52, 56, 59, 64]); // open-position E shape
  assert.deepEqual(voiceChord(11, 'm'), [47, 54, 59, 62, 66]); // Bm barre, A shape
  for (let pc = 0; pc < 12; pc++) {
    for (const q of ['', 'm', '5']) {
      const v = voiceChord(pc, q);
      assert.equal(v[0] % 12, pc, 'root in the bass');
      assert.ok(v[0] >= 40 && v[v.length - 1] <= 76, `range ${v}`);
      const pcs = new Set(v.map((m) => (m - pc + 120) % 12));
      if (q === '') assert.ok(pcs.has(4) && pcs.has(7) && !pcs.has(3));
      if (q === 'm') assert.ok(pcs.has(3) && pcs.has(7) && !pcs.has(4));
      if (q === '5') assert.deepEqual([...pcs].sort(), [0, 7]);
    }
  }
  for (const p of PROGRESSIONS) for (const [, q] of p.chords) assert.ok(['', 'm', '5'].includes(q));
});

test('string choice is clamped for 3-note power chords', () => {
  const power = voiceChord(7, '5');
  assert.deepEqual(stringsFor(4, power), [2]);
  assert.deepEqual(stringsFor('top', power), [0, 1, 2]);
  assert.deepEqual(stringsFor('upper', voiceChord(4, '')), [2, 3, 4, 5]);
});

test('plucked strings sound at the right pitch and decay', () => {
  const sr = 48000;
  for (const midi of [40, 45, 52, 59, 64, 69, 76]) {
    const f = 440 * 2 ** ((midi - 69) / 12);
    const x = pluckSamples(f, sr, { rand });
    const r = yin(x.subarray(Math.round(0.3 * sr), Math.round(0.3 * sr) + 2048), sr, { minFreq: 60, maxFreq: 2000 });
    assert.ok(r, `pitch found for ${midi}`);
    const cents = (freqToMidi(r.freq) - midi) * 100;
    assert.ok(Math.abs(cents) < 8, `midi ${midi}: ${cents.toFixed(1)} cents off`);
    const rms = (a, b) => Math.sqrt(x.subarray(a * sr, b * sr).reduce((s, v) => s + v * v, 0) / ((b - a) * sr));
    assert.ok(rms(2, 2.5) < rms(0.1, 0.6) * 0.5, 'decays');
  }
});

// Minimal stand-in for an AudioContext that records when clicks and plucks are scheduled.
function fakeAudioContext() {
  const events = [];
  const param = () => ({
    value: 0,
    setValueAtTime(v) { if (this.first == null) this.first = v; this.value = v; },
    exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {},
  });
  const node = (extra = {}) => ({ connect: (n) => n, disconnect() {}, ...extra });
  const ctx = {
    currentTime: 0, sampleRate: 48000, events,
    createGain: () => node({ gain: param() }),
    createBiquadFilter: () => node({ frequency: param(), Q: param(), gain: param() }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => node({ start(t) { events.push({ kind: 'pluck', t }); }, stop() {} }),
    createOscillator() {
      const o = node({ frequency: param(), start(t) { events.push({ kind: 'click', t, accent: o.frequency.first > 1300 }); }, stop() {} });
      return o;
    },
  };
  return ctx;
}

async function runPlayer(prompt, countInBars, until) {
  const { PromptPlayer } = await import('../js/prompt.js');
  const ctx = fakeAudioContext();
  const player = new PromptPlayer(ctx, prompt);
  player.start(0.2, { countInBars });
  clearInterval(player._timer); // drive the scheduler by hand
  const ui = [];
  for (let t = 0; t <= until; t += 0.02) {
    ctx.currentTime = t;
    player._tick();
    const pos = player.position();
    if (!ui.length || ui[ui.length - 1] !== pos) ui.push(pos);
  }
  player.stop();
  return { ctx, player, ui };
}

test('count-in: 2 bars of clicks only, then the groove and chord 1 on the downbeat (4/4)', async () => {
  const { ctx, player, ui } = await runPlayer({ bpm: 120, meter: 4, keyPc: 2, progressionId: 'pop', styleId: 'quarter' }, 2, 7);
  assert.equal(player.musicStart, 0.2 + 8 * 0.5);
  const clicks = ctx.events.filter((e) => e.kind === 'click');
  const plucks = ctx.events.filter((e) => e.kind === 'pluck');
  clicks.slice(0, 12).forEach((c, k) => {
    assert.ok(Math.abs(c.t - (0.2 + k * 0.5)) < 1e-9, `click ${k} at ${c.t}`);
    assert.equal(c.accent, k % 4 === 0, `accent on beat 1 only (click ${k})`);
  });
  assert.ok(plucks.length > 0, 'guitar plays after the count-in');
  const first = Math.min(...plucks.map((e) => e.t));
  assert.ok(first >= player.musicStart - 1e-9 && first < player.musicStart + 0.1, `first strum at ${first}`);
  const countIn = ui.filter((p) => p.countIn);
  assert.deepEqual(countIn.map((p) => `${p.bar}:${p.beatInBar}`), ['0:0', '0:1', '0:2', '0:3', '1:0', '1:1', '1:2', '1:3']);
  const firstMusic = ui.find((p) => p.t >= player.musicStart - 1e-9 && !p.countIn);
  assert.equal(firstMusic.chordIdx, 0);
  assert.equal(firstMusic.beatInBar, 0);
});

test('count-in in 3/4 is 6 clicks', async () => {
  const { ctx, player } = await runPlayer({ bpm: 90, meter: 3, keyPc: 9, progressionId: 'epic', styleId: 'waltz' }, 2, 5.5);
  const spb = 60 / 90;
  assert.ok(Math.abs(player.musicStart - (0.2 + 6 * spb)) < 1e-9);
  const before = ctx.events.filter((e) => e.t < player.musicStart - 1e-9);
  assert.equal(before.filter((e) => e.kind === 'click').length, 6);
  assert.equal(before.filter((e) => e.kind === 'pluck').length, 0);
});

test('no count-in: the groove starts right away (preview)', async () => {
  const { ctx, player } = await runPlayer({ bpm: 100, meter: 4, keyPc: 0, progressionId: 'folk', styleId: 'ring' }, 0, 1);
  assert.equal(player.musicStart, 0.2);
  assert.ok(ctx.events.some((e) => e.kind === 'pluck' && Math.abs(e.t - 0.2) < 0.1));
});

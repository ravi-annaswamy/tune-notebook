import test from 'node:test';
import assert from 'node:assert/strict';
import {
  randomPrompt, rerollPart, describePrompt, normalizePrompt, buildPlan, eventsForBeat, voiceChord, pluckSamples,
  stringsFor, bassRoot, padVoicing, PROGRESSIONS, GENRES, FEELS, GUITAR, BASS, DRUMS, ARP,
} from '../js/prompt.js';
import { yin, freqToMidi } from '../js/pitch.js';

let seed = 42;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test('random prompts are always playable', () => {
  for (let i = 0; i < 500; i++) {
    const p = randomPrompt(rand);
    const g = GENRES.find((x) => x.id === p.genre);
    assert.ok(p.bpm >= g.bpm[0] && p.bpm <= g.bpm[1], `bpm ${p.bpm} for ${p.genre}`);
    const feel = FEELS.find((f) => f.id === p.feelId);
    assert.equal(feel.genre, p.genre);
    assert.equal(p.meter, feel.meter);
    assert.ok(p.keyPc >= 0 && p.keyPc < 12);
    assert.equal(describePrompt(p).bars, 16);
  }
});

test('every feel refers to patterns that exist and fit its meter', () => {
  for (const g of GENRES) assert.ok(FEELS.some((f) => f.genre === g.id), `${g.id} has feels`);
  for (const f of FEELS) {
    if (f.guitar) {
      assert.ok(GUITAR[f.guitar], `${f.id}: guitar ${f.guitar}`);
      for (const e of GUITAR[f.guitar]) assert.ok(e.at >= 0 && e.at < f.meter, `${f.id} guitar at ${e.at}`);
    }
    if (f.bass) for (const e of BASS[f.bass](f.meter)) assert.ok(e.at < f.meter && e.at + e.dur <= f.meter + 0.01, `${f.id} bass`);
    if (f.drums) { assert.ok(DRUMS[f.drums]); assert.equal(f.meter, 4, 'drum patterns are 4/4'); }
    if (f.arp) assert.ok(ARP[f.arp]);
    assert.ok(f.guitar || f.pad || f.arp, `${f.id} has something harmonic`);
  }
});

test('shuffle keeps the style and never repeats the progression', () => {
  let prev = randomPrompt(rand, null, { genre: 'rock' });
  for (let i = 0; i < 200; i++) {
    const next = randomPrompt(rand, prev, { genre: 'rock' });
    assert.equal(next.genre, 'rock');
    assert.notEqual(next.progressionId, prev.progressionId);
    prev = next;
  }
});

test('rerolling one part keeps the others; style and feel step through their lists', () => {
  const p = normalizePrompt({ v: 2, bpm: 100, keyPc: 2, progressionId: 'pop', genre: 'pop', feelId: 'pop-synco', form: 'ab', colour: 1 });
  const t = rerollPart(p, 'tempo', rand);
  assert.ok(Math.abs(t.bpm - 100) >= 6);
  assert.deepEqual({ ...t, bpm: 100 }, p);
  const k = rerollPart(p, 'key', rand);
  assert.deepEqual({ ...k, keyPc: 2 }, p);
  assert.notEqual(rerollPart(p, 'chords', rand).progressionId, 'pop');
  assert.equal(rerollPart(p, 'feel').feelId, 'pop-drive');
  const s = rerollPart(p, 'style', rand);
  assert.equal(s.genre, 'rock');
  assert.equal(FEELS.find((f) => f.id === s.feelId).genre, 'rock');
  assert.ok(s.bpm >= 92 && s.bpm <= 140);
  assert.equal(rerollPart(p, 'form').form, 'loop');
  // cycling Style visits every genre and comes back
  let c = p;
  const seen = [];
  for (let i = 0; i < GENRES.length; i++) { c = rerollPart(c, 'style', rand); seen.push(c.genre); }
  assert.equal(new Set(seen).size, GENRES.length);
  assert.equal(c.genre, 'pop');
});

test('16-bar form: A is sparse, B moves and brings in exactly one new chord, then turns around', () => {
  for (const prog of PROGRESSIONS) {
    for (let colour = 0; colour < 8; colour++) {
      const d = describePrompt({ v: 2, bpm: 100, keyPc: 7, progressionId: prog.id, genre: 'acoustic', feelId: 'ring', form: 'ab', colour });
      const [A, B] = d.sections;
      assert.equal(A.bars.length, 8);
      assert.equal(B.bars.length, 8);
      const changes = (bars) => bars.reduce((n, c, i) => n + (i && c.key !== bars[i - 1].key ? 1 : 0), 0);
      assert.ok(changes(A.bars) <= 4, `${prog.id}: A changes ${changes(A.bars)}`);
      if (new Set(A.bars.map((c) => c.key)).size > 1) assert.ok(changes(B.bars) > changes(A.bars), `${prog.id}: B moves more`);
      const inA = new Set(A.bars.map((c) => c.key));
      const newInB = [...new Set(B.bars.map((c) => c.key))].filter((k) => !inA.has(k));
      assert.ok(newInB.includes(d.newChord.key), `${prog.id}: the colour chord is new`);
      assert.ok(B.bars.some((c) => c.isNew), 'colour chord is marked');
      const turn = prog.turn;
      assert.equal(B.bars[7].rootPc, (7 + turn[0]) % 12, `${prog.id}: bar 16 is the turnaround`);
    }
  }
});

test('progressions are spelled in the right key; old saved prompts replay as before', () => {
  const loop = describePrompt({ v: 2, bpm: 92, keyPc: 2, progressionId: 'pop', genre: 'acoustic', feelId: 'folk', form: 'loop' });
  assert.deepEqual(loop.sections[0].bars.map((c) => c.name), ['D', 'A', 'Bm', 'G']);
  const ab = describePrompt({ v: 2, bpm: 92, keyPc: 2, progressionId: 'pop', genre: 'pop', feelId: 'pop-synco', form: 'ab', colour: 0 });
  assert.deepEqual(ab.sections[0].bars.map((c) => c.name), ['D', 'D', 'A', 'A', 'Bm', 'Bm', 'G', 'G']);
  assert.deepEqual(ab.sections[1].bars.map((c) => c.name), ['D', 'A', 'Bm', 'G', 'D', 'A', 'Em', 'A']);
  assert.equal(ab.newChord.roman, 'ii');
  // a v1.3 prompt (styleId, no genre) → acoustic, same feel, 4-bar loop
  const old = normalizePrompt({ bpm: 80, meter: 3, keyPc: 9, progressionId: 'andalusian', styleId: 'waltz' });
  assert.equal(old.genre, 'acoustic');
  assert.equal(old.feelId, 'waltz');
  assert.equal(old.form, 'loop');
  assert.deepEqual(describePrompt(old).sections[0].bars.map((c) => c.name), ['Am', 'G', 'F', 'E']);
});

function allEvents(params, bars = 16) {
  const plan = buildPlan(params);
  const out = [];
  for (let b = 0; b < bars * plan.meter; b++) for (const e of eventsForBeat(plan, b)) out.push({ ...e, beat: b + e.at, bar: Math.floor(b / plan.meter) });
  return { plan, out };
}

test('rock: power chords, bass on the roots, crash at each section, fills, busier hats in B', () => {
  const { plan, out } = allEvents({ v: 2, bpm: 120, keyPc: 4, progressionId: 'pop', genre: 'rock', feelId: 'rock-8', form: 'ab', colour: 0 });
  const g = out.filter((e) => e.inst === 'guitar' && e.bar === 0 && e.beat === 0);
  assert.deepEqual(g.map((e) => e.midi), voiceChord(4, '5'), 'E5 power chord on beat 1');
  for (const e of out.filter((x) => x.inst === 'bass')) {
    assert.equal(e.midi, bassRoot(plan.bars[e.bar].chord.rootPc), 'eighth-note roots');
    assert.ok(e.midi >= 28 && e.midi <= 40);
  }
  assert.deepEqual(out.filter((e) => e.inst === 'crash').map((e) => e.bar), [0, 8]);
  const fillSnares = (bar) => out.filter((e) => e.inst === 'snare' && e.bar === bar && e.beat >= bar * 4 + 3).length;
  assert.equal(fillSnares(7), 4);
  assert.equal(fillSnares(15), 4);
  assert.equal(fillSnares(3), 1, 'no fill mid-section (just the backbeat)');
  const hats = (bar) => out.filter((e) => e.inst === 'hat' && e.bar === bar).length;
  assert.ok(hats(9) > hats(1), `B hats ${hats(9)} > A hats ${hats(1)}`);
  assert.ok(out.some((e) => e.inst === 'kick' && e.beat === 0));
});

test('synth pop: pad holds through each chord, 16th arpeggio, synth bass', () => {
  const { plan, out } = allEvents({ v: 2, bpm: 110, keyPc: 9, progressionId: 'epic', genre: 'synthpop', feelId: 'synth-16', form: 'ab', colour: 0 });
  assert.equal(plan.bassKind, 'synth');
  const pads = out.filter((e) => e.inst === 'pad');
  assert.equal(pads[0].dur, 8, 'A holds Am for 2 bars of 4/4');
  assert.deepEqual(pads[0].midis, padVoicing(9, 'm'));
  assert.equal(pads.reduce((s, p) => s + p.dur, 0), 64, 'pads cover all 16 bars');
  assert.equal(out.filter((e) => e.inst === 'arp' && e.bar === 0).length, 16);
  assert.ok(!out.some((e) => e.inst === 'guitar'));
});

test('acoustic without drums has no drum events; island feel adds a shaker', () => {
  const plain = allEvents({ v: 2, bpm: 90, keyPc: 0, progressionId: 'folk', genre: 'acoustic', feelId: 'folk', form: 'ab' }).out;
  assert.ok(!plain.some((e) => ['kick', 'snare', 'hat', 'crash', 'bass'].includes(e.inst)));
  const island = allEvents({ v: 2, bpm: 90, keyPc: 0, progressionId: 'folk', genre: 'acoustic', feelId: 'island', form: 'ab' }).out;
  assert.ok(island.some((e) => e.inst === 'shaker'));
  assert.ok(!island.some((e) => e.inst === 'crash'), 'a shaker gets no crash');
  assert.ok(island.filter((e) => e.inst === 'guitar').every((e) => e.mute > 0), 'offbeat chops are muted');
});

test('guitar voicings: real shapes, right notes, playable range', () => {
  assert.deepEqual(voiceChord(4, ''), [40, 47, 52, 56, 59, 64]);
  assert.deepEqual(voiceChord(11, 'm'), [47, 54, 59, 62, 66]);
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
});

test('string choice is clamped for 3-note power chords', () => {
  const power = voiceChord(7, '5');
  assert.deepEqual(stringsFor(4, power), [2]);
  assert.deepEqual(stringsFor('top', power), [0, 1, 2]);
  assert.deepEqual(stringsFor('upper', voiceChord(4, '')), [2, 3, 4, 5]);
});

// The waveform's repeat period near the expected one (autocorrelation + parabolic peak).
function measuredPeriod(x, start, len, P) {
  const ac = (t) => { let sum = 0; for (let i = start; i < start + len; i++) sum += x[i] * x[i + t]; return sum; };
  let bt = 0, best = -Infinity;
  for (let t = Math.floor(P * 0.9); t <= Math.ceil(P * 1.1); t++) { const v = ac(t); if (v > best) { best = v; bt = t; } }
  const a = ac(bt - 1), c = ac(bt + 1), den = a - 2 * best + c;
  return den ? bt + (0.5 * (a - c)) / den : bt;
}

test('plucked strings are in tune and decay, for any random pluck (guitar and bass range)', () => {
  const sr = 48000;
  for (const midi of [28, 33, 40, 45, 52, 59, 64, 69, 72, 76]) {
    const f = 440 * 2 ** ((midi - 69) / 12);
    for (let k = 0; k < 20; k++) {
      const x = pluckSamples(f, sr, { rand, bright: midi < 40 ? 0.3 : 0.55 });
      const P = measuredPeriod(x, Math.round(0.3 * sr), 4096, sr / f);
      const cents = 1200 * Math.log2((sr / f) / P);
      assert.ok(Math.abs(cents) < 5, `midi ${midi}, pluck ${k}: ${cents.toFixed(1)} cents off`);
      const rms = (a, b) => Math.sqrt(x.subarray(a * sr, b * sr).reduce((s, v) => s + v * v, 0) / ((b - a) * sr));
      assert.ok(rms(2, 2.5) < rms(0.1, 0.6) * 0.6, 'decays');
    }
  }
});

// Minimal stand-in for an AudioContext: enough nodes for the instruments to wire up.
function fakeAudioContext() {
  const param = () => ({
    value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {},
    setTargetAtTime() {}, cancelScheduledValues() {},
  });
  const node = (extra = {}) => ({ connect: (n) => n, disconnect() {}, ...extra });
  const src = () => node({ start() {}, stop() {}, frequency: param(), detune: param() });
  return {
    currentTime: 0, sampleRate: 48000,
    createGain: () => node({ gain: param() }),
    createBiquadFilter: () => node({ frequency: param(), Q: param(), gain: param() }),
    createWaveShaper: () => node({ curve: null }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: src,
    createOscillator: src,
  };
}

async function runPlayer(prompt, countInBars, until) {
  const { PromptPlayer } = await import('../js/prompt-player.js');
  const ctx = fakeAudioContext();
  const trace = [];
  const player = new PromptPlayer(ctx, prompt, { trace });
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
  return { trace, player, ui };
}

test('count-in: 2 bars of clicks only, then the band and bar 1 on the downbeat', async () => {
  const { trace, player, ui } = await runPlayer({ v: 2, bpm: 120, keyPc: 2, progressionId: 'pop', genre: 'pop', feelId: 'pop-synco', form: 'ab' }, 2, 7);
  assert.equal(player.musicStart, 0.2 + 8 * 0.5);
  const before = trace.filter((e) => e.t < player.musicStart - 1e-9);
  assert.equal(before.length, 8, 'only the 8 count-in clicks');
  assert.ok(before.every((e) => e.inst === 'click' && e.countIn));
  assert.deepEqual(before.map((e) => e.accent), [true, false, false, false, true, false, false, false]);
  const atDownbeat = trace.filter((e) => Math.abs(e.t - player.musicStart) < 0.05).map((e) => e.inst);
  for (const inst of ['kick', 'bass', 'guitar', 'crash']) assert.ok(atDownbeat.includes(inst), `${inst} on the downbeat`);
  assert.deepEqual(ui.filter((p) => p.countIn).map((p) => `${p.bar}:${p.beatInBar}`), ['0:0', '0:1', '0:2', '0:3', '1:0', '1:1', '1:2', '1:3']);
  const first = ui.find((p) => !p.countIn && p.t >= player.musicStart - 1e-9);
  assert.equal(first.barIdx, 0);
  assert.equal(first.section, 'A');
});

test('count-in in 3/4 is 6 clicks; a v1.3 prompt still plays (acoustic loop)', async () => {
  const { trace, player } = await runPlayer({ bpm: 90, meter: 3, keyPc: 9, progressionId: 'epic', styleId: 'waltz' }, 2, 5.5);
  assert.ok(Math.abs(player.musicStart - (0.2 + 6 * (60 / 90))) < 1e-9);
  const before = trace.filter((e) => e.t < player.musicStart - 1e-9);
  assert.equal(before.length, 6);
  assert.ok(trace.some((e) => e.inst === 'guitar' && e.t >= player.musicStart - 1e-9));
  assert.equal(player.plan.form, 'loop');
});

test('drums switch the click off by default; acoustic keeps it', async () => {
  const { PromptPlayer } = await import('../js/prompt-player.js');
  assert.equal(new PromptPlayer(fakeAudioContext(), { v: 2, bpm: 100, keyPc: 0, progressionId: 'pop', genre: 'rock', feelId: 'rock-8' }).clickOn, false);
  assert.equal(new PromptPlayer(fakeAudioContext(), { v: 2, bpm: 100, keyPc: 0, progressionId: 'pop', genre: 'acoustic', feelId: 'folk' }).clickOn, true);
});

test('band level: Soft < Medium < Loud, Medium 12 dB under the v1.4 mix, changeable while playing', async () => {
  const { BAND_LEVELS, bandLevel } = await import('../js/prompt.js');
  const { PromptPlayer } = await import('../js/prompt-player.js');
  assert.deepEqual(BAND_LEVELS.map((l) => l.id), ['soft', 'medium', 'loud']);
  assert.ok(BAND_LEVELS[0].db < BAND_LEVELS[1].db && BAND_LEVELS[1].db < BAND_LEVELS[2].db);
  assert.equal(bandLevel('nonsense').id, 'medium', 'unknown values fall back to Medium');
  const p = { v: 2, bpm: 100, keyPc: 0, progressionId: 'pop', genre: 'acoustic', feelId: 'folk' };
  const v14 = 0.9 * 2; // v1.4: 0.9 × Acoustic's genre gain
  const medium = new PromptPlayer(fakeAudioContext(), p);
  assert.ok(Math.abs(20 * Math.log10(medium.out.gain.value / v14) + 12) < 0.01, 'medium is -12 dB');
  const soft = new PromptPlayer(fakeAudioContext(), p, { level: 'soft' });
  assert.ok(soft.out.gain.value < medium.out.gain.value);
  soft.setLevel('loud');
  assert.ok(Math.abs(20 * Math.log10(soft.out.gain.value / v14) + 6) < 0.01, 'setLevel applies before playing');
});

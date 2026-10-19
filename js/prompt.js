// Prompt mode: a random pulse + guitar progression to compose over.
// Generation and voicing are pure (unit-tested in node); PromptPlayer uses Web Audio.

import { NOTE_NAMES } from './pitch.js';

// Chords: [semitones above Sa, quality ('' major, 'm' minor, '5' power), roman, bars]
export const PROGRESSIONS = [
  { id: 'pop', name: 'Pop', scale: 'Bilaval', western: 'major', chords: [[0, '', 'I'], [7, '', 'V'], [9, 'm', 'vi'], [5, '', 'IV']] },
  { id: 'doowop', name: '50s', scale: 'Bilaval', western: 'major', chords: [[0, '', 'I'], [9, 'm', 'vi'], [5, '', 'IV'], [7, '', 'V']] },
  { id: 'folk', name: 'Folk', scale: 'Bilaval', western: 'major', chords: [[0, '', 'I'], [5, '', 'IV'], [7, '', 'V'], [5, '', 'IV']] },
  { id: 'sad-pop', name: 'Wistful', scale: 'Bilaval', western: 'major', chords: [[9, 'm', 'vi'], [5, '', 'IV'], [0, '', 'I'], [7, '', 'V']] },
  { id: 'two', name: 'Two-chord', scale: 'Bilaval', western: 'major', chords: [[0, '', 'I', 2], [5, '', 'IV', 2]] },
  { id: 'jazz', name: 'ii–V–I', scale: 'Bilaval', western: 'major', chords: [[2, 'm', 'ii'], [7, '', 'V'], [0, '', 'I', 2]] },
  { id: 'khamaj', name: 'Mixolydian', scale: 'Khamaj', western: 'Mixolydian', chords: [[0, '', 'I'], [10, '', '♭VII'], [5, '', 'IV'], [0, '', 'I']] },
  { id: 'epic', name: 'Epic minor', scale: 'Asavari', western: 'natural minor', chords: [[0, 'm', 'i'], [8, '', '♭VI'], [3, '', '♭III'], [10, '', '♭VII']] },
  { id: 'rock-minor', name: 'Minor rock', scale: 'Asavari', western: 'natural minor', chords: [[0, 'm', 'i'], [10, '', '♭VII'], [8, '', '♭VI'], [10, '', '♭VII']] },
  { id: 'minor-iv', name: 'Minor folk', scale: 'Asavari', western: 'natural minor', chords: [[0, 'm', 'i'], [5, 'm', 'iv'], [7, 'm', 'v'], [0, 'm', 'i']] },
  { id: 'andalusian', name: 'Andalusian', scale: 'Asavari + major V', western: 'Phrygian dominant', chords: [[0, 'm', 'i'], [10, '', '♭VII'], [8, '', '♭VI'], [7, '', 'V']] },
  { id: 'kafi', name: 'Dorian vamp', scale: 'Kafi', western: 'Dorian', chords: [[0, 'm', 'i', 2], [5, '', 'IV', 2]] },
  { id: 'bhairavi', name: 'Bhairavi colour', scale: 'Bhairavi', western: 'Phrygian', chords: [[0, 'm', 'i'], [1, '', '♭II'], [10, 'm', '♭vii'], [0, 'm', 'i']] },
  { id: 'drone', name: 'Sa–Pa drone', scale: 'any', western: 'open fifth', chords: [[0, '5', 'I5', 2], [0, '5', 'I5', 2]] },
];

// Strum/pick patterns per meter. at = beat position within the bar; strings = indices low→high
// ('all', 'upper', 'bass', or explicit list); dir D/U for strums.
export const STYLES = {
  4: [
    { id: 'ring', name: 'Let it ring', events: [{ at: 0, type: 'strum', dir: 'D', strings: 'all', vel: 1 }] },
    { id: 'quarter', name: 'Steady strum', events: [0, 1, 2, 3].map((b) => ({ at: b, type: 'strum', dir: 'D', strings: b ? 'upper' : 'all', vel: b ? 0.7 : 1 })) },
    { id: 'folk', name: 'Folk strum', events: [
      { at: 0, type: 'strum', dir: 'D', strings: 'all', vel: 1 }, { at: 1, type: 'strum', dir: 'D', strings: 'upper', vel: 0.75 },
      { at: 1.5, type: 'strum', dir: 'U', strings: 'top', vel: 0.55 }, { at: 2.5, type: 'strum', dir: 'U', strings: 'top', vel: 0.55 },
      { at: 3, type: 'strum', dir: 'D', strings: 'upper', vel: 0.75 }, { at: 3.5, type: 'strum', dir: 'U', strings: 'top', vel: 0.55 },
    ] },
    { id: 'arp', name: 'Fingerpicked', events: [[0, 'bass'], [0.5, 2], [1, 3], [1.5, 4], [2, 'alt'], [2.5, 2], [3, 3], [3.5, 4]]
      .map(([at, s]) => ({ at, type: 'pick', strings: s, vel: at % 2 === 0 ? 0.9 : 0.6 })) },
  ],
  3: [
    { id: 'waltz', name: 'Waltz', events: [{ at: 0, type: 'pick', strings: 'bass', vel: 1 },
      { at: 1, type: 'strum', dir: 'D', strings: 'upper', vel: 0.6 }, { at: 2, type: 'strum', dir: 'D', strings: 'upper', vel: 0.6 }] },
    { id: 'quarter3', name: 'Steady strum', events: [0, 1, 2].map((b) => ({ at: b, type: 'strum', dir: 'D', strings: b ? 'upper' : 'all', vel: b ? 0.7 : 1 })) },
    { id: 'arp3', name: 'Fingerpicked', events: [[0, 'bass'], [0.5, 2], [1, 3], [1.5, 4], [2, 3], [2.5, 2]]
      .map(([at, s]) => ({ at, type: 'pick', strings: s, vel: at === 0 ? 1 : 0.6 })) },
  ],
};

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];

// A prompt is a few small choices; everything else is derived from them.
export function randomPrompt(rand = Math.random, prev = null) {
  const meter = rand() < 0.7 ? 4 : 3;
  const p = {
    bpm: 70 + Math.floor(rand() * 57), // 70–126
    meter,
    keyPc: Math.floor(rand() * 12),
    progressionId: pick(PROGRESSIONS, rand).id,
    styleId: pick(STYLES[meter], rand).id,
  };
  // Avoid repeating the exact same progression twice in a row.
  if (prev && prev.progressionId === p.progressionId && PROGRESSIONS.length > 1) return randomPrompt(rand, prev);
  return p;
}

// Re-roll one part ('tempo' | 'key' | 'chords' | 'feel') and keep the rest.
export function rerollPart(p, part, rand = Math.random) {
  const n = { ...p };
  if (part === 'tempo') { do n.bpm = 70 + Math.floor(rand() * 57); while (Math.abs(n.bpm - p.bpm) < 6); }
  if (part === 'key') { do n.keyPc = Math.floor(rand() * 12); while (n.keyPc === p.keyPc); }
  if (part === 'chords') { do n.progressionId = pick(PROGRESSIONS, rand).id; while (n.progressionId === p.progressionId); }
  if (part === 'feel') {
    n.meter = p.meter === 4 ? 3 : 4;
    n.styleId = pick(STYLES[n.meter], rand).id;
  }
  return n;
}

export function chordName(rootPc, quality) {
  return NOTE_NAMES[((rootPc % 12) + 12) % 12] + quality;
}

// Everything the UI and the saved tune need to show, derived from the prompt.
export function describePrompt(p) {
  const prog = PROGRESSIONS.find((x) => x.id === p.progressionId) || PROGRESSIONS[0];
  const style = STYLES[p.meter].find((s) => s.id === p.styleId) || STYLES[p.meter][0];
  const chords = prog.chords.map(([deg, q, roman, bars = 1]) => ({
    rootPc: (p.keyPc + deg) % 12, quality: q, roman, bars, name: chordName(p.keyPc + deg, q),
  }));
  return {
    bpm: p.bpm, meter: p.meter, meterName: `${p.meter}/4`, keyName: NOTE_NAMES[p.keyPc],
    progressionName: prog.name, scale: prog.scale, western: prog.western, styleName: style.name,
    chords, bars: chords.reduce((s, c) => s + c.bars, 0),
  };
}

// Guitar-like voicing: E-shape barre for roots E–G#, A-shape for A–D#.
// Returns MIDI notes low→high (bass first).
export function voiceChord(rootPc, quality) {
  const eString = (rootPc - 4 + 12) % 12; // frets above low E
  const shapes = {
    E: { '': [0, 7, 12, 16, 19, 24], m: [0, 7, 12, 15, 19, 24], 5: [0, 7, 12] },
    A: { '': [0, 7, 12, 16, 19], m: [0, 7, 12, 15, 19], 5: [0, 7, 12] },
  };
  if (eString <= 4) return shapes.E[quality].map((o) => 40 + eString + o);
  const aString = (rootPc - 9 + 12) % 12;
  return shapes.A[quality].map((o) => 45 + aString + o);
}

export function stringsFor(spec, voicing) {
  const n = voicing.length;
  if (spec === 'all') return [...voicing.keys()];
  if (spec === 'upper') return [...voicing.keys()].slice(Math.max(1, n - 4));
  if (spec === 'top') return [...voicing.keys()].slice(n - 3);
  if (spec === 'bass') return [0];
  if (spec === 'alt') return [Math.min(1, n - 1)]; // alternating bass (the fifth)
  return [Math.min(spec, n - 1)]; // a numbered string, clamped for 3-note power chords
}

// Expand the prompt into per-beat events: [{beat, bar, beatInBar, chordIdx, notes:[{t (beats), midi, string, vel}]}]
export function beatPlan(p, desc = describePrompt(p)) {
  const style = STYLES[p.meter].find((s) => s.id === p.styleId) || STYLES[p.meter][0];
  const barChord = [];
  desc.chords.forEach((c, i) => { for (let b = 0; b < c.bars; b++) barChord.push(i); });
  return { barChord, style, voicings: desc.chords.map((c) => voiceChord(c.rootPc, c.quality)) };
}

// Karplus–Strong plucked string with an allpass fractional delay for accurate tuning.
export function pluckSamples(freq, sr, { dur = 3, bright = 0.55, rand = Math.random } = {}) {
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const d = sr / freq - 0.5; // averaging filter adds half a sample
  const L = Math.max(2, Math.floor(d - 0.1));
  const f = d - L;
  const C = (1 - f) / (1 + f);
  const dl = new Float32Array(L);
  let lp = 0, mean = 0;
  for (let i = 0; i < L; i++) { lp += bright * ((rand() * 2 - 1) - lp); dl[i] = lp; mean += lp; }
  mean /= L;
  for (let i = 0; i < L; i++) dl[i] = (dl[i] - mean) * 0.6;
  const t60 = 1.2 + 2.8 * Math.min(1, 110 / freq); // low strings ring longer
  const rho = Math.pow(0.001, 1 / (t60 * freq));
  let p = 0, lastX = 0, apX1 = 0, apY1 = 0;
  for (let i = 0; i < n; i++) {
    const x = dl[p];
    const avg = 0.5 * (x + lastX);
    lastX = x;
    const ap = C * avg + apX1 - C * apY1;
    apX1 = avg;
    apY1 = ap;
    dl[p] = ap * rho;
    p = (p + 1) % L;
    out[i] = x;
  }
  const fade = Math.min(n, Math.floor(sr * 0.05)); // avoid a click at the end
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  return out;
}

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class PromptPlayer {
  constructor(ctx, prompt) {
    this.ctx = ctx;
    this.prompt = prompt;
    this.desc = describePrompt(prompt);
    this.plan = beatPlan(prompt, this.desc);
    this.spb = 60 / prompt.bpm;

    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.pulseBus = ctx.createGain();
    this.pulseBus.gain.value = 0.9;
    this.guitarBus = ctx.createGain();
    this.guitarBus.gain.value = 0.9;
    // A little body: warm low-mids, roll off fizz.
    const body = ctx.createBiquadFilter();
    body.type = 'peaking'; body.frequency.value = 180; body.Q.value = 1; body.gain.value = 4;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 4500;
    this.guitarBus.connect(body).connect(tone).connect(this.out);
    this.pulseBus.connect(this.out);

    // Pre-render every string note used (fast: a few hundred ms of CPU at most).
    this.buffers = new Map();
    for (const v of this.plan.voicings) {
      for (const m of v) {
        if (this.buffers.has(m)) continue;
        const data = pluckSamples(midiHz(m), ctx.sampleRate, { bright: m < 52 ? 0.45 : 0.6 });
        const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
        b.getChannelData(0).set(data);
        this.buffers.set(m, b);
      }
    }
    this.ringing = []; // per string index: {src, g}
    this.uiQueue = [];
    this.pos = { bar: 0, beatInBar: 0, chordIdx: 0 };
    this.playing = false;
  }

  connect(node) { this.out.connect(node); return this; }

  // countInBars: clicks only for that many bars, then the groove starts from chord 1
  // at this.musicStart (AudioContext time).
  start(at = this.ctx.currentTime + 0.08, { countInBars = 0 } = {}) {
    if (this.playing) return;
    this.playing = true;
    this.t0 = at;
    this.countInBeats = countInBars * this.prompt.meter;
    this.musicStart = at + this.countInBeats * this.spb;
    this.nextBeat = 0;
    this.lastChord = -1;
    this._timer = setInterval(() => this._tick(), 25);
    this._tick();
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this._timer);
    const now = this.ctx.currentTime;
    try {
      this.out.gain.cancelScheduledValues(now);
      this.out.gain.setTargetAtTime(0, now, 0.05);
    } catch {}
    for (const r of this.ringing) { try { r?.src.stop(now + 0.3); } catch {} }
  }

  setPulseOn(on) { this.pulseBus.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.02); }
  setGuitarOn(on) { this.guitarBus.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05); }

  // Latest beat that has actually sounded (for the on-screen chord and beat dots).
  position() {
    const now = this.ctx.currentTime;
    while (this.uiQueue.length && this.uiQueue[0].t <= now) this.pos = this.uiQueue.shift();
    return this.pos;
  }

  _tick() {
    const horizon = this.ctx.currentTime + 0.15;
    while (this.t0 + this.nextBeat * this.spb < horizon) {
      this._scheduleBeat(this.nextBeat);
      this.nextBeat++;
    }
  }

  _scheduleBeat(globalBeat) {
    const { meter } = this.prompt;
    const t = this.t0 + globalBeat * this.spb;
    if (t < this.ctx.currentTime - 0.01) return; // timer stalled: skip rather than pile up
    if (globalBeat < this.countInBeats) {
      const beatInBar = globalBeat % meter;
      this._click(t, beatInBar === 0);
      this.uiQueue.push({ t, countIn: true, bar: Math.floor(globalBeat / meter), beatInBar, chordIdx: -1 });
      return;
    }
    const b = globalBeat - this.countInBeats;
    const bar = Math.floor(b / meter);
    const beatInBar = b % meter;
    const { barChord, style, voicings } = this.plan;
    const chordIdx = barChord[bar % barChord.length];
    this._click(t, beatInBar === 0);
    const voicing = voicings[chordIdx];
    const chordChange = chordIdx !== this.lastChord && beatInBar === 0;
    if (chordChange) { this._dampAll(t); this.lastChord = chordIdx; }
    for (const ev of style.events) {
      if (Math.floor(ev.at) !== beatInBar) continue;
      const te = t + (ev.at - beatInBar) * this.spb;
      const strings = stringsFor(ev.strings, voicing);
      const order = ev.dir === 'U' ? [...strings].reverse() : strings;
      order.forEach((s, k) => {
        const jitter = ev.type === 'strum' ? k * (ev.dir === 'U' ? 0.008 : 0.012) : 0;
        this._pluck(s, voicing[s], te + jitter, ev.vel * (ev.dir === 'U' ? 0.8 : 1) * (1 - k * 0.04));
      });
    }
    this.uiQueue.push({ t, bar, beatInBar, chordIdx });
  }

  _dampAll(t) {
    this.ringing.forEach((r, i) => { if (r) this._damp(i, t); });
  }

  _damp(stringIdx, t) {
    const r = this.ringing[stringIdx];
    if (!r) return;
    try {
      r.g.gain.setTargetAtTime(0, t, 0.025);
      r.src.stop(t + 0.25);
    } catch {}
    this.ringing[stringIdx] = null;
  }

  _pluck(stringIdx, midi, t, vel) {
    const buf = this.buffers.get(midi);
    if (!buf) return;
    this._damp(stringIdx, t);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 0.32 * vel;
    src.connect(g).connect(this.guitarBus);
    src.start(t);
    this.ringing[stringIdx] = { src, g };
  }

  _click(t, accent) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(accent ? 1600 : 1100, t);
    o.frequency.exponentialRampToValueAtTime(accent ? 900 : 700, t + 0.03);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.18, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.pulseBus);
    o.start(t);
    o.stop(t + 0.06);
  }
}

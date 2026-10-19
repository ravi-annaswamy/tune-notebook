// Synthesized band for Prompt mode (all Web Audio, works offline):
// clean/overdriven Karplus–Strong guitar, finger/synth bass, drum kit, pad, arpeggio, click.
// Each part has its own bus so it can be muted while recording.

import { pluckSamples } from './prompt.js';

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Instruments {
  constructor(ctx) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    const bus = (gain) => { const g = ctx.createGain(); g.gain.value = gain; g.connect(this.out); return g; };
    // Balanced by measuring each part alone (drums ≈ 1.5× chords, bass ≈ chords).
    this.levels = { click: 0.7, count: 0.8, drums: 0.45, bass: 0.8, chords: 0.7 };
    this.buses = Object.fromEntries(Object.entries(this.levels).map(([k, v]) => [k, bus(v)]));

    // Clean guitar: a little body, fizz rolled off.
    this.cleanIn = ctx.createGain();
    const body = ctx.createBiquadFilter();
    body.type = 'peaking'; body.frequency.value = 180; body.Q.value = 1; body.gain.value = 4;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 4500;
    this.cleanIn.connect(body).connect(tone).connect(this.buses.chords);

    // Overdriven guitar: soft clipping, then a speaker-cabinet-ish band limit.
    this.driveIn = ctx.createGain();
    this.driveIn.gain.value = 3;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(2.5 * x); }
    shaper.curve = curve;
    const cabLow = ctx.createBiquadFilter();
    cabLow.type = 'highpass'; cabLow.frequency.value = 90;
    const cabHigh = ctx.createBiquadFilter();
    cabHigh.type = 'lowpass'; cabHigh.frequency.value = 3200;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 900; mid.Q.value = 0.8; mid.gain.value = 3;
    const driveOut = ctx.createGain();
    driveOut.gain.value = 0.35;
    this.driveIn.connect(shaper).connect(cabLow).connect(mid).connect(cabHigh).connect(driveOut).connect(this.buses.chords);

    // Bass: low-passed so it sits under everything.
    this.bassIn = ctx.createGain();
    const bassTone = ctx.createBiquadFilter();
    bassTone.type = 'lowpass'; bassTone.frequency.value = 1100;
    this.bassIn.connect(bassTone).connect(this.buses.bass);

    // White noise for the drums.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.bufs = new Map();
  }

  setOn(part, on) {
    const b = this.buses[part];
    if (b) b.gain.setTargetAtTime(on ? this.levels[part] : 0, this.ctx.currentTime, 0.03);
  }

  // Karplus–Strong buffers are rendered once per note and reused.
  stringBuffer(midi, bright, dur) {
    const key = `${midi}:${bright}:${dur}`;
    if (!this.bufs.has(key)) {
      const data = pluckSamples(hz(midi), this.ctx.sampleRate, { bright, dur });
      const b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      b.getChannelData(0).set(data);
      this.bufs.set(key, b);
    }
    return this.bufs.get(key);
  }

  _env(t, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  _noise(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
    return src;
  }

  click(t, accent, countIn = false) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(accent ? 1600 : 1100, t);
    o.frequency.exponentialRampToValueAtTime(accent ? 900 : 700, t + 0.03);
    const g = this._env(t, accent ? 0.35 : 0.18, 0.002, 0.05);
    o.connect(g).connect(countIn ? this.buses.count : this.buses.click);
    o.start(t);
    o.stop(t + 0.06);
  }

  // Returns {src, g} so the caller can damp the string.
  guitar(midi, t, vel, kind = 'clean', mute = 0) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.stringBuffer(midi, midi < 52 ? 0.45 : 0.6, 3);
    const g = this.ctx.createGain();
    g.gain.value = 0.32 * vel;
    src.connect(g).connect(kind === 'drive' ? this.driveIn : this.cleanIn);
    src.start(t);
    if (mute) {
      g.gain.setTargetAtTime(0, t + mute, 0.015);
      src.stop(t + mute + 0.2);
    }
    return { src, g };
  }

  bass(midi, t, dur, vel, kind = 'finger') {
    const ctx = this.ctx;
    const end = t + dur;
    if (kind === 'synth') {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.13 * vel, t + 0.005);
      g.gain.setTargetAtTime(0.08 * vel, t + 0.02, 0.08);
      g.gain.setTargetAtTime(0, end, 0.02);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 6;
      f.frequency.setValueAtTime(1400, t);
      f.frequency.exponentialRampToValueAtTime(260, t + 0.18);
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth'; saw.frequency.value = hz(midi);
      const sub = ctx.createOscillator();
      sub.type = 'sine'; sub.frequency.value = hz(midi - 12);
      const subG = ctx.createGain();
      subG.gain.value = 0.6;
      saw.connect(f);
      sub.connect(subG).connect(f);
      f.connect(g).connect(this.bassIn);
      for (const o of [saw, sub]) { o.start(t); o.stop(end + 0.15); }
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.stringBuffer(midi, 0.3, 2.5);
    const g = ctx.createGain();
    g.gain.value = 0.9 * vel;
    g.gain.setTargetAtTime(0, end, 0.03);
    src.connect(g).connect(this.bassIn);
    src.start(t);
    src.stop(end + 0.3);
  }

  kick(t, vel) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = this._env(t, 0.9 * vel, 0.003, 0.35);
    o.connect(g).connect(this.buses.drums);
    o.start(t);
    o.stop(t + 0.4);
  }

  snare(t, vel) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
    this._noise(t, 0.2).connect(f).connect(this._env(t, 0.5 * vel, 0.002, 0.16)).connect(this.buses.drums);
    const o = this.ctx.createOscillator();
    o.type = 'triangle'; o.frequency.value = 190;
    o.connect(this._env(t, 0.3 * vel, 0.002, 0.08)).connect(this.buses.drums);
    o.start(t);
    o.stop(t + 0.12);
  }

  clap(t, vel) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 1.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for (const dt of [0, 0.011, 0.022]) { // three quick hand slaps
      g.gain.setValueAtTime(0.5 * vel, t + dt);
      g.gain.exponentialRampToValueAtTime(0.05 * vel, t + dt + 0.009);
    }
    g.gain.setValueAtTime(0.45 * vel, t + 0.033);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    this._noise(t, 0.22).connect(f).connect(g).connect(this.buses.drums);
  }

  hat(t, vel, open = false) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7000;
    this._noise(t, open ? 0.35 : 0.06).connect(f).connect(this._env(t, 0.22 * vel, 0.001, open ? 0.3 : 0.045)).connect(this.buses.drums);
  }

  ohat(t, vel) { this.hat(t, vel, true); }

  shaker(t, vel) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 6000; f.Q.value = 1.5;
    this._noise(t, 0.1).connect(f).connect(this._env(t, 0.18 * vel, 0.012, 0.07)).connect(this.buses.drums);
  }

  crash(t, vel) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 4500;
    this._noise(t, 1.5).connect(f).connect(this._env(t, 0.22 * vel, 0.002, 1.3)).connect(this.buses.drums);
  }

  // Soft, slowly breathing chord: two detuned saws per note through a low-pass.
  pad(midis, t, dur) {
    const ctx = this.ctx;
    const end = t + dur;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1300; f.Q.value = 0.5;
    const g = ctx.createGain();
    const level = 0.12 / midis.length;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.35);
    g.gain.setValueAtTime(level, end);
    g.gain.linearRampToValueAtTime(0.0001, end + 0.4);
    f.connect(g).connect(this.buses.chords);
    for (const m of midis) {
      for (const cents of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(m);
        o.detune.value = cents;
        o.connect(f);
        o.start(t);
        o.stop(end + 0.5);
      }
    }
  }

  arp(midi, t, dur, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = hz(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(700, t + Math.max(0.05, dur));
    o.connect(f).connect(this._env(t, 0.07 * vel, 0.004, Math.max(0.06, dur))).connect(this.buses.chords);
    o.start(t);
    o.stop(t + dur + 0.1);
  }
}

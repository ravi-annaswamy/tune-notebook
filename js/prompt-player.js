// Plays a prompt: optional count-in, then the arrangement from eventsForBeat on a
// 25 ms lookahead scheduler. position() reports the beat/bar that is sounding now.

import { buildPlan, eventsForBeat, partsOf } from './prompt.js';
import { Instruments } from './instruments.js';

export class PromptPlayer {
  // trace: optional array; every scheduled event is pushed to it (used by tests).
  constructor(ctx, prompt, { trace = null } = {}) {
    this.ctx = ctx;
    this.plan = buildPlan(prompt);
    this.prompt = this.plan.p;
    this.desc = this.plan.d;
    this.spb = 60 / this.prompt.bpm;
    this.parts = partsOf(this.plan);
    this.inst = new Instruments(ctx);
    this.out = this.inst.out;
    this.out.gain.value = 0.9 * (this.plan.genre.gain || 1);
    for (const [part, m] of Object.entries(this.plan.genre.mix || {})) {
      this.inst.levels[part] *= m;
      this.inst.buses[part].gain.value = this.inst.levels[part];
    }
    this.trace = trace;
    // With drums playing, the click is off by default (the drums keep time).
    this.clickOn = this.plan.click;
    this.inst.setOn('click', this.clickOn);
    this.ringing = []; // per guitar string: {src, g}
    this.uiQueue = [];
    this.pos = { bar: 0, barIdx: 0, beatInBar: 0, section: '', countIn: false };
    this.playing = false;
  }

  connect(node) { this.out.connect(node); return this; }

  // countInBars: clicks only for that many bars, then the groove starts at bar 1 at
  // this.musicStart (AudioContext time).
  start(at = this.ctx.currentTime + 0.08, { countInBars = 0 } = {}) {
    if (this.playing) return;
    this.playing = true;
    this.t0 = at;
    this.countInBeats = countInBars * this.prompt.meter;
    this.musicStart = at + this.countInBeats * this.spb;
    this.nextBeat = 0;
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

  setOn(part, on) {
    if (part === 'click') this.clickOn = on;
    this.inst.setOn(part, on);
  }

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
      this.inst.click(t, beatInBar === 0, true);
      this.trace?.push({ inst: 'click', countIn: true, accent: beatInBar === 0, t });
      this.uiQueue.push({ t, countIn: true, bar: Math.floor(globalBeat / meter), beatInBar, barIdx: -1, section: '' });
      return;
    }
    const b = globalBeat - this.countInBeats;
    const barNo = Math.floor(b / meter);
    const barIdx = barNo % this.plan.bars.length;
    const bar = this.plan.bars[barIdx];
    for (const e of eventsForBeat(this.plan, b)) {
      const te = t + e.at * this.spb + (e.delaySec || 0);
      this.trace?.push({ ...e, t: te });
      switch (e.inst) {
        case 'click': this.inst.click(te, e.accent); break;
        case 'damp': this._dampAll(te); break;
        case 'guitar': this._guitar(e, te); break;
        case 'bass': this.inst.bass(e.midi, te, e.dur * this.spb, e.vel, this.plan.bassKind); break;
        case 'pad': this.inst.pad(e.midis, te, e.dur * this.spb); break;
        case 'arp': this.inst.arp(e.midi, te, e.dur * this.spb, e.vel); break;
        default: this.inst[e.inst]?.(te, e.vel); // drums
      }
    }
    this.uiQueue.push({
      t, countIn: false, bar: barNo, barIdx, beatInBar: b % meter,
      section: bar.section, barInSection: bar.barInSection, sectionLen: bar.sectionLen, chordName: bar.chord.name,
    });
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

  _guitar(e, t) {
    this._damp(e.string, t);
    const voice = this.inst.guitar(e.midi, t, e.vel, this.plan.guitarKind, e.mute);
    this.ringing[e.string] = e.mute ? null : voice;
  }
}

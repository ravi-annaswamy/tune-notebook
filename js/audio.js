// Audio engine for one recording session.
//
//   mic ──► micGain ─────────────────────────────┐
//    └───► analyser (level meter, Sa detection)  ▼
//   click ─► clickBus ─┐                      recDest ──► MediaRecorder
//   drone ─► droneDuck ─► droneBus ─► music ─► comp ─┬──► speakers
//                                                    └──► musicToRec ─► recDest
//
// The click and drone are mixed digitally into the recording, so the clip
// sounds the same whether the user wears headphones or not.

import { yin, freqToMidi, midiToName, summarizePitch } from './pitch.js';

const MIME_CANDIDATES = [
  'audio/mp4;codecs=mp4a.40.2', // AAC in MP4: iPhone Safari, plays everywhere
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
];

export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  if (!MediaRecorder.isTypeSupported) return '';
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

// Tanpura cycle: Pa, upper Sa, upper Sa, Sa (held longer). Ratios are just intonation.
const PATTERN = [
  { ratio: 1.5, dur: 1.2, gain: 0.13 },
  { ratio: 2, dur: 1.2, gain: 0.11 },
  { ratio: 2, dur: 1.2, gain: 0.11 },
  { ratio: 1, dur: 2.4, gain: 0.16 },
];
const LOOKAHEAD = 0.15; // seconds scheduled ahead of currentTime

function makeTanpuraWave(ctx) {
  // Bright, buzzy harmonic spectrum (the jawari bridge makes upper partials strong).
  const N = 28;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  const amps = [0, 1, 0.8, 0.62, 0.55, 0.46, 0.36, 0.32, 0.28, 0.22, 0.2];
  for (let n = 1; n < N; n++) imag[n] = n < amps.length ? amps[n] : 0.17 * Math.pow(0.88, n - amps.length);
  return ctx.createPeriodicWave(real, imag);
}

export class Engine extends EventTarget {
  // Must be constructed synchronously inside a user gesture (iOS autoplay rules).
  constructor() {
    super();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Web Audio is not supported');
    this.ctx = new AC({ latencyHint: 'interactive' });
    // Unlock output on iOS by playing one silent sample inside the gesture.
    const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.connect(this.ctx.destination);
    s.start(0);
    this.ctx.resume?.().catch(() => {});

    this.bpm = null;
    this.nextClick = 0;
    this._clicks = [];
    this.beatQueue = [];
    this.saFreq = null;
    this.droneBase = null;
    this.nextPluck = 0;
    this.pluckIdx = 0;
    this._voices = [];
    this.pad = null;
    this._interrupted = false;
    this._closing = false;
    this._levelBuf = null;
  }

  async openMic() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // Echo cancellation keeps the speaker's drone from leaking back into the mic.
        echoCancellation: true,
        // Noise suppression and AGC fight sustained hums and whistles, so turn them off.
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    this._buildGraph();
  }

  _buildGraph() {
    const ctx = this.ctx;
    this.micSrc = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.micSrc.connect(this.analyser);

    this.recDest = ctx.createMediaStreamDestination();
    this.micGain = ctx.createGain();
    this.micGain.gain.value = 1;
    this.micSrc.connect(this.micGain).connect(this.recDest);

    this.music = ctx.createGain();
    this.music.gain.value = 0.9;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.music.connect(this.comp);
    this.comp.connect(ctx.destination);
    this.musicToRec = ctx.createGain();
    this.musicToRec.gain.value = 0.7;
    this.comp.connect(this.musicToRec).connect(this.recDest);

    this.clickBus = ctx.createGain();
    this.clickBus.connect(this.music);
    this.droneBus = ctx.createGain();
    this.droneBus.connect(this.music);
    this.droneDuck = ctx.createGain();
    this.droneDuck.connect(this.droneBus);

    this.wave = makeTanpuraWave(ctx);
  }

  // ---------- recording ----------
  startRecorder(mimeType) {
    const opts = mimeType ? { mimeType, audioBitsPerSecond: 128000 } : {};
    const attempt = (stream, mixed) => {
      const r = new MediaRecorder(stream, opts);
      r.ondataavailable = (e) => {
        if (e.data && e.data.size) this.dispatchEvent(new CustomEvent('chunk', { detail: e.data }));
      };
      r.onerror = (e) => this._fire(`Recorder error${e.error ? ': ' + e.error.message : ''}`);
      r.start(1000); // 1 s chunks so an interruption loses at most ~1 s
      this.recorder = r;
      this.mixed = mixed;
    };
    try {
      attempt(this.recDest.stream, true);
    } catch (err) {
      // Some browsers can't record a Web Audio stream: fall back to the raw mic.
      console.warn('Mixed recording failed, recording mic only', err);
      attempt(this.stream, false);
    }
    this.mimeType = this.recorder.mimeType || mimeType || '';
    this.startedAt = performance.now();
    this._timer = setInterval(() => this._tick(), 25);
    this._watchInterruptions();
  }

  stopRecorder() {
    return new Promise((resolve) => {
      const r = this.recorder;
      if (!r || r.state === 'inactive') return resolve();
      const timeout = setTimeout(resolve, 4000);
      r.addEventListener('stop', () => { clearTimeout(timeout); setTimeout(resolve, 0); }, { once: true });
      try { r.stop(); } catch { clearTimeout(timeout); resolve(); }
    });
  }

  _fire(msg) {
    if (this._interrupted || this._closing) return;
    this._interrupted = true;
    this.dispatchEvent(new CustomEvent('interrupted', { detail: msg }));
  }

  _watchInterruptions() {
    const track = this.stream.getAudioTracks()[0];
    if (track) {
      track.addEventListener('ended', () => this._fire('Microphone was disconnected'));
      track.addEventListener('mute', () => {
        clearTimeout(this._muteT);
        this._muteT = setTimeout(() => {
          if (track.muted) this._fire('Interrupted: a call or another app took the microphone');
        }, 1200);
      });
      track.addEventListener('unmute', () => clearTimeout(this._muteT));
    }
    // iOS moves the context to 'interrupted' (or 'suspended') during calls, Siri and alarms.
    this.ctx.addEventListener('statechange', () => {
      const s = this.ctx.state;
      if (s === 'interrupted' || s === 'suspended') this._fire('Interrupted by a call, Siri or an alarm');
    });
  }

  dispose() {
    this._closing = true;
    clearInterval(this._timer);
    clearTimeout(this._muteT);
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { this.ctx.close(); } catch {}
  }

  level() {
    if (!this.analyser) return 0;
    if (!this._levelBuf) this._levelBuf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(this._levelBuf);
    let s = 0;
    for (const v of this._levelBuf) s += v * v;
    return Math.sqrt(s / this._levelBuf.length);
  }

  // Returns true once per metronome beat that has sounded (for UI pulses).
  consumeBeat() {
    const now = this.ctx.currentTime;
    let hit = false;
    while (this.beatQueue.length && this.beatQueue[0] <= now) { this.beatQueue.shift(); hit = true; }
    return hit;
  }

  // ---------- scheduler ----------
  _tick() {
    const now = this.ctx.currentTime;
    const horizon = now + LOOKAHEAD;
    if (this.bpm) {
      const step = 60 / this.bpm;
      while (this.nextClick < horizon) {
        if (this.nextClick >= now - 0.005) { this._click(this.nextClick); this.beatQueue.push(this.nextClick); }
        this.nextClick += step;
      }
    }
    if (this.droneBase) {
      while (this.nextPluck < horizon) {
        const p = PATTERN[this.pluckIdx % PATTERN.length];
        if (this.nextPluck >= now - 0.005) this._pluck(this.droneBase * p.ratio, this.nextPluck, p.gain);
        this.nextPluck += p.dur;
        this.pluckIdx++;
      }
    }
  }

  // ---------- metronome ----------
  setTempo(bpm, anchorTime) {
    this._cancelFutureClicks();
    this.bpm = bpm;
    const step = 60 / bpm;
    // Put the next click one beat after the user's last tap, compensating for output latency.
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    let next = anchorTime + step - latency;
    while (next < this.ctx.currentTime + 0.01) next += step;
    this.nextClick = next;
  }

  stopTempo() {
    this._cancelFutureClicks();
    this.bpm = null;
  }

  _cancelFutureClicks() {
    const now = this.ctx.currentTime;
    for (const c of this._clicks) if (c.t > now) { try { c.o.stop(0); } catch {} }
    this._clicks = [];
    this.beatQueue = [];
  }

  _click(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    o.connect(g).connect(this.clickBus);
    o.start(t);
    o.stop(t + 0.06);
    this._clicks.push({ o, t });
    if (this._clicks.length > 16) this._clicks = this._clicks.filter((c) => c.t > ctx.currentTime - 0.5);
  }

  setClickOn(on) {
    this.clickBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
  }

  // ---------- tanpura drone ----------
  setSa(freq) {
    this.saFreq = freq;
    // Keep the drone in a comfortable register whatever octave the user sang in.
    let base = freq;
    while (base >= 280) base /= 2;
    while (base < 90) base *= 2;
    this.droneBase = base;
    this._killVoices();
    this.nextPluck = this.ctx.currentTime + 0.1;
    this.pluckIdx = 0;
    this._startPad(base);
    this.duckDrone(false);
  }

  duckDrone(on) {
    if (!this.droneDuck) return;
    this.droneDuck.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, on ? 0.05 : 0.3);
  }

  setDroneOn(on) {
    this.droneBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.1);
  }

  _pluck(freq, t, gain) {
    const ctx = this.ctx;
    const end = t + 7;
    const nyq = ctx.sampleRate / 2 - 200;
    const cap = (x) => Math.min(x, nyq);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.9;
    // "jawari bloom": brightness swells just after the pluck then mellows
    f.frequency.setValueAtTime(cap(freq * 3), t);
    f.frequency.linearRampToValueAtTime(cap(freq * 14), t + 0.25);
    f.frequency.exponentialRampToValueAtTime(cap(freq * 4), t + 3.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(gain * 0.45, t + 1.4);
    g.gain.exponentialRampToValueAtTime(0.0005, end);
    const oscs = [-4, 4].map((cents) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.wave);
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(f);
      o.start(t);
      o.stop(end + 0.05);
      return o;
    });
    f.connect(g).connect(this.droneDuck);
    const voice = { g, oscs };
    this._voices.push(voice);
    oscs[0].onended = () => {
      this._voices = this._voices.filter((v) => v !== voice);
      try { g.disconnect(); } catch {}
    };
  }

  _killVoices() {
    const now = this.ctx.currentTime;
    for (const v of this._voices) {
      try {
        v.g.gain.cancelScheduledValues(now);
        v.g.gain.setTargetAtTime(0, now, 0.04);
        v.oscs.forEach((o) => o.stop(now + 0.25));
      } catch {}
    }
    this._voices = [];
  }

  // Soft sustained bed (Sa + Pa) under the plucks.
  _startPad(base) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (!this.pad) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.value = base;
      const o2 = ctx.createOscillator();
      o2.type = 'triangle';
      o2.frequency.value = base * 1.5;
      const g2 = ctx.createGain();
      g2.gain.value = 0.3;
      o1.connect(lp);
      o2.connect(g2).connect(lp);
      lp.connect(g).connect(this.droneDuck);
      o1.start();
      o2.start();
      this.pad = { g, o1, o2 };
    }
    this.pad.o1.frequency.setTargetAtTime(base, now, 0.03);
    this.pad.o2.frequency.setTargetAtTime(base * 1.5, now, 0.03);
    this.pad.g.gain.cancelScheduledValues(now);
    this.pad.g.gain.setTargetAtTime(0.045, now, 0.8);
  }

  // ---------- Sa detection ----------
  // Listens until ~1.5 s of voiced audio is heard (or 5 s pass).
  listenForSa({ onFrame, minVoiced = 1.5, maxTime = 5 } = {}) {
    const buf = new Float32Array(this.analyser.fftSize);
    const sr = this.ctx.sampleRate;
    const step = 50;
    const midis = [];
    const t0 = performance.now();
    let cancelled = false;
    const promise = new Promise((resolve) => {
      const iv = setInterval(() => {
        if (cancelled || this._closing) { clearInterval(iv); return resolve({ ok: false, reason: 'cancelled' }); }
        this.analyser.getFloatTimeDomainData(buf);
        const r = yin(buf, sr);
        let est = null;
        if (r && r.clarity > 0.8) {
          const m = freqToMidi(r.freq);
          midis.push(m);
          est = midiToName(m);
        }
        const voiced = (midis.length * step) / 1000;
        onFrame?.(est, Math.min(1, voiced / minVoiced));
        if (voiced >= minVoiced || performance.now() - t0 > maxTime * 1000) {
          clearInterval(iv);
          resolve(summarizePitch(midis));
        }
      }, step);
    });
    return { promise, cancel: () => { cancelled = true; } };
  }
}

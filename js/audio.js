// Audio engine for one recording session.
//
// Plain capture records the raw microphone as is:
//   mic stream ──► MediaRecorder              (the recording)
//        └──────► AudioContext ► analyser     (level meter + interruption detection)
//
// With a backing (Prompt mode) the pulse/guitar are mixed into the take:
//   mic ──► micGain ─────────────────────► recDest ──► MediaRecorder
//   backing ──► speakers
//          └──► backingIn ► delay (latency compensation) ─┘

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

export class Engine extends EventTarget {
  // Constructed synchronously inside the Record tap so the AudioContext may start.
  // opts.ctx reuses a running context (the Prompt preview); opts.backing mixes it in.
  constructor(opts = {}) {
    super();
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = opts.ctx || (AC ? new AC() : null);
    this.withBacking = !!opts.backing && !!this.ctx;
    this.ctx?.resume?.().catch(() => {});
    this._interrupted = false;
    this._closing = false;
    this._levelBuf = null;
  }

  async openMic() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // Capture the sound as is: these "voice call" filters squash hums and whistles.
        // With a backing playing on the speaker, echo cancellation keeps it out of the mic
        // (it's already mixed in digitally).
        echoCancellation: this.withBacking,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    if (this.ctx) {
      try {
        if (this.ctx.state !== 'running') await this.ctx.resume();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        const src = this.ctx.createMediaStreamSource(this.stream);
        src.connect(this.analyser);
        if (this.withBacking) {
          this.recDest = this.ctx.createMediaStreamDestination();
          src.connect(this.recDest);
          // You hear the backing late by the output latency and the mic hears you late by the
          // input latency, so delay the backing's copy in the recording to line up with you.
          const track = this.stream.getAudioTracks()[0];
          const inLat = track?.getSettings?.().latency || 0.01;
          const outLat = this.ctx.outputLatency || this.ctx.baseLatency || 0.01;
          this.backingIn = this.ctx.createGain();
          this.backingDelay = this.ctx.createDelay(1);
          this.backingDelay.delayTime.value = Math.min(0.9, inLat + outLat);
          this.backingIn.connect(this.backingDelay).connect(this.recDest);
        }
      } catch (e) {
        console.warn('Level meter unavailable', e); // recording still works without it
      }
    }
  }

  startRecorder(mimeType) {
    const opts = mimeType ? { mimeType, audioBitsPerSecond: 128000 } : {};
    const begin = (stream) => {
      const r = new MediaRecorder(stream, opts);
      r.ondataavailable = (e) => {
        if (e.data && e.data.size) this.dispatchEvent(new CustomEvent('chunk', { detail: e.data }));
      };
      r.onerror = (e) => this._fire(`Recorder error${e.error ? ': ' + e.error.message : ''}`);
      r.start(1000); // 1 s chunks so an interruption loses at most ~1 s
      return r;
    };
    let r = null;
    this.mixed = false;
    if (this.recDest) {
      // Some browsers can't record a Web Audio stream (at construction or at start).
      try { r = begin(this.recDest.stream); this.mixed = true; } catch (e) {
        console.warn('Mixed recording unsupported, recording the mic only', e);
      }
    }
    r = r || begin(this.stream);
    this.recorder = r;
    this.mimeType = r.mimeType || mimeType || '';
    this.startedAt = performance.now();
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
    this.ctx?.addEventListener('statechange', () => {
      const s = this.ctx.state;
      if (s === 'interrupted' || s === 'suspended') this._fire('Interrupted by a call, Siri or an alarm');
    });
  }

  dispose() {
    this._closing = true;
    clearTimeout(this._muteT);
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { this.ctx?.close(); } catch {}
  }

  level() {
    if (!this.analyser) return 0;
    if (!this._levelBuf) this._levelBuf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(this._levelBuf);
    let s = 0;
    for (const v of this._levelBuf) s += v * v;
    return Math.sqrt(s / this._levelBuf.length);
  }
}

// Audio engine for one recording session: records the raw microphone as is.
//
//   mic stream ──► MediaRecorder              (the recording)
//        └──────► AudioContext ► analyser     (level meter + interruption detection)

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
  constructor() {
    super();
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = AC ? new AC() : null;
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
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    if (this.ctx) {
      try {
        if (this.ctx.state !== 'running') await this.ctx.resume();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
      } catch (e) {
        console.warn('Level meter unavailable', e); // recording still works without it
      }
    }
  }

  startRecorder(mimeType) {
    const opts = mimeType ? { mimeType, audioBitsPerSecond: 128000 } : {};
    const r = new MediaRecorder(this.stream, opts);
    r.ondataavailable = (e) => {
      if (e.data && e.data.size) this.dispatchEvent(new CustomEvent('chunk', { detail: e.data }));
    };
    r.onerror = (e) => this._fire(`Recorder error${e.error ? ': ' + e.error.message : ''}`);
    r.start(1000); // 1 s chunks so an interruption loses at most ~1 s
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

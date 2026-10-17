import * as db from './db.js';
import { Engine, pickMimeType } from './audio.js';
import { makeZip, readZip } from './zip.js';

const APP_VERSION = '1.0.0';
const MIN_DURATION = 1.0; // seconds; shorter clips are discarded
const MIN_BYTES = 800;

const $ = (s) => document.querySelector(s);
const els = {
  recordBtn: $('#recordBtn'), list: $('#list'), empty: $('#empty'), storageInfo: $('#storageInfo'),
  rowTpl: $('#rowTpl'), recPanel: $('#recPanel'), recTime: $('#recTime'), awakeInfo: $('#awakeInfo'),
  meterFill: $('#meterFill'), tapBtn: $('#tapBtn'), bpmValue: $('#bpmValue'), tapInfo: $('#tapInfo'),
  saBtn: $('#saBtn'), saValue: $('#saValue'), saInfo: $('#saInfo'), clickToggle: $('#clickToggle'),
  droneToggle: $('#droneToggle'), stopBtn: $('#stopBtn'), toast: $('#toast'),
  confirmDlg: $('#confirmDlg'), confirmCancel: $('#confirmCancel'), confirmTitle: $('#confirmTitle'), confirmBody: $('#confirmBody'), confirmOk: $('#confirmOk'),
  menuBtn: $('#menuBtn'), menuDlg: $('#menuDlg'), exportZipBtn: $('#exportZipBtn'), exportSeqBtn: $('#exportSeqBtn'),
  importBtn: $('#importBtn'), importInput: $('#importInput'), persistInfo: $('#persistInfo'), persistBtn: $('#persistBtn'),
  versionInfo: $('#versionInfo'), seqDlg: $('#seqDlg'), seqInfo: $('#seqInfo'), seqShareBtn: $('#seqShareBtn'),
  seqSkipBtn: $('#seqSkipBtn'), seqDoneBtn: $('#seqDoneBtn'), micDlg: $('#micDlg'), micTitle: $('#micTitle'),
  micBody: $('#micBody'), installHint: $('#installHint'), hintClose: $('#hintClose'),
};

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

let tunes = [];
const state = { mode: 'idle', engine: null, session: null };

// ---------- small utils ----------
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const warn = (e) => console.warn(e);

function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
const defaultName = (d) => d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const baseMime = (m) => (m || '').split(';')[0].trim() || 'audio/mp4';

function extFor(mime) {
  const m = baseMime(mime);
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  return 'audio';
}
function mimeFromName(name) {
  const ext = name.split('.').pop().toLowerCase();
  return { m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', webm: 'audio/webm', ogg: 'audio/ogg', oga: 'audio/ogg',
    mp3: 'audio/mpeg', wav: 'audio/wav', caf: 'audio/x-caf' }[ext] || '';
}
function fileNameFor(t) {
  const safe = (t.name || 'Tune').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
  const parts = [safe];
  if (t.sa) parts.push(`Sa ${t.sa.name}`);
  if (t.bpm) parts.push(`${t.bpm}bpm`);
  return `${parts.join(' - ')}.${extFor(t.mimeType)}`;
}

function setAudioSession(type) {
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {}
}

// ---------- toast ----------
let toastTimer;
function toast(msg, { action, onAction, ms = 3500 } = {}) {
  const t = els.toast;
  t.replaceChildren();
  const span = document.createElement('span');
  span.textContent = msg;
  t.append(span);
  if (action) {
    const b = document.createElement('button');
    b.textContent = action;
    b.addEventListener('click', () => { t.classList.remove('show'); onAction?.(); });
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 9000 : ms);
}

// ---------- dialogs ----------
function openDialog(dlg) {
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}
function closeDialog(dlg) {
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
}
function confirmDialog({ title, body, ok = 'Delete' }) {
  if (typeof els.confirmDlg.showModal !== 'function') return Promise.resolve(window.confirm(`${title}\n${body}`));
  els.confirmTitle.textContent = title;
  els.confirmBody.textContent = body;
  els.confirmOk.textContent = ok;
  openDialog(els.confirmDlg);
  // Resolve from the button clicks themselves: the dialog 'close' event isn't
  // delivered reliably in every WebView, so it's only a fallback (Escape key).
  return new Promise((resolve) => {
    const dlg = els.confirmDlg;
    const finish = (answer) => {
      els.confirmOk.removeEventListener('click', onOk);
      els.confirmCancel.removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onCancel);
      dlg.removeEventListener('cancel', onCancel);
      if (dlg.open) closeDialog(dlg);
      resolve(answer);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    els.confirmOk.addEventListener('click', onOk);
    els.confirmCancel.addEventListener('click', onCancel);
    dlg.addEventListener('close', onCancel);
    dlg.addEventListener('cancel', onCancel);
  });
}

// ---------- list rendering ----------
function render() {
  els.list.replaceChildren();
  for (const t of tunes) els.list.append(buildRow(t));
  els.empty.hidden = tunes.length > 0;
  syncPlayUI();
  updateStorageInfo();
}

function buildRow(t) {
  const li = els.rowTpl.content.firstElementChild.cloneNode(true);
  li.dataset.id = t.id;
  fillRow(li, t);
  return li;
}

function fillRow(li, t) {
  li.querySelector('.name').textContent = t.name;
  li.querySelector('.m-bpm').textContent = t.bpm ? `${t.bpm} BPM` : '';
  li.querySelector('.m-sa').textContent = t.sa ? `Sa ${t.sa.name}` : '';
  li.querySelector('.m-dur').textContent = fmtDur(t.duration);
  li.querySelector('.play').setAttribute('aria-label', `Play ${t.name}`);
}

const rowFor = (id) => els.list.querySelector(`li[data-id="${CSS.escape(id)}"]`);
const tuneById = (id) => tunes.find((t) => t.id === id);

async function updateStorageInfo() {
  const total = tunes.reduce((s, t) => s + (t.size || 0), 0);
  let txt = tunes.length ? `${tunes.length} tune${tunes.length === 1 ? '' : 's'} · ${fmtBytes(total)}` : '';
  try {
    if (navigator.storage?.persisted) {
      const p = await navigator.storage.persisted();
      txt += `${txt ? ' · ' : ''}${p ? 'storage protected' : 'storage not yet protected'}`;
    }
  } catch {}
  els.storageInfo.textContent = txt;
}

// ---------- blob cache (keeps Share/Play inside the iOS user-gesture window) ----------
const blobCache = new Map(); // id -> {p: Promise<Blob>, blob: Blob|null}
function getBlob(id) {
  let e = blobCache.get(id);
  if (e) {
    blobCache.delete(id);
    blobCache.set(id, e);
    return e.p;
  }
  e = { blob: null, p: null };
  e.p = db.getAudio(id).then((r) => {
    if (!r) throw new Error('Audio data missing');
    e.blob = new Blob([r.data], { type: r.type || 'audio/mp4' });
    return e.blob;
  });
  e.p.catch(() => blobCache.delete(id));
  blobCache.set(id, e);
  while (blobCache.size > 6) blobCache.delete(blobCache.keys().next().value);
  return e.p;
}
const peekBlob = (id) => blobCache.get(id)?.blob || null;

// ---------- playback ----------
const player = new Audio();
player.preload = 'auto';
player.setAttribute('playsinline', '');
const playing = { id: null, url: null };
// 0.1 s of silence: playing it inside a tap "unlocks" the element on iOS so the
// real clip can start after the async IndexedDB read.
const SILENT_WAV = (() => {
  const n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
})();

async function togglePlay(id) {
  if (state.mode !== 'idle') return;
  if (playing.id === id) {
    if (player.paused) { setAudioSession('playback'); player.play().catch(onPlayError); }
    else player.pause();
    return;
  }
  stopPlayback();
  playing.id = id;
  syncPlayUI();
  let blob = peekBlob(id);
  if (!blob) {
    try { player.src = SILENT_WAV; player.play().catch(() => {}); } catch {}
    try { blob = await getBlob(id); } catch (e) { toast(`Can't load this tune: ${e.message}`); stopPlayback(); return; }
    if (playing.id !== id) return;
  }
  playing.url = URL.createObjectURL(blob);
  player.src = playing.url;
  setAudioSession('playback');
  try {
    await player.play();
  } catch (e) {
    onPlayError(e);
  }
  syncPlayUI();
}

function onPlayError(e) {
  if (e?.name === 'AbortError') return; // superseded by another play/pause
  if (e?.name === 'NotAllowedError') toast('Tap play again');
  else toast("This clip can't be played in this browser");
  stopPlayback();
}

function stopPlayback() {
  player.pause();
  if (playing.url) URL.revokeObjectURL(playing.url);
  player.removeAttribute('src');
  try { player.load(); } catch {}
  playing.id = null;
  playing.url = null;
  syncPlayUI();
}

function syncPlayUI() {
  for (const li of els.list.children) {
    const isThis = li.dataset.id === playing.id;
    li.classList.toggle('playing', isThis && !player.paused);
    li.classList.toggle('paused', isThis && player.paused);
    if (!isThis) li.querySelector('.bar')?.style.setProperty('--p', '0%');
    const t = tuneById(li.dataset.id);
    li.querySelector('.play').setAttribute('aria-label', `${isThis && !player.paused ? 'Pause' : 'Play'} ${t?.name || ''}`);
  }
}

function playDuration() {
  const t = tuneById(playing.id);
  return Number.isFinite(player.duration) && player.duration > 0 ? player.duration : t?.duration || 0;
}

player.addEventListener('play', syncPlayUI);
player.addEventListener('pause', syncPlayUI);
player.addEventListener('ended', () => { player.currentTime = 0; stopPlayback(); });
player.addEventListener('timeupdate', () => {
  if (!playing.id) return;
  const pct = clamp((player.currentTime / (playDuration() || 1)) * 100, 0, 100);
  rowFor(playing.id)?.querySelector('.bar')?.style.setProperty('--p', `${pct}%`);
});
player.addEventListener('loadedmetadata', () => {
  // Correct the stored duration with the decoder's value when it's known.
  const t = tuneById(playing.id);
  if (t && Number.isFinite(player.duration) && player.duration > 0 && Math.abs(player.duration - t.duration) > 0.5) {
    t.duration = player.duration;
    db.updateTune(t).catch(warn);
    const li = rowFor(t.id);
    if (li) li.querySelector('.m-dur').textContent = fmtDur(t.duration);
  }
});

// ---------- share / download ----------
function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

async function shareOrDownload(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      if (e.name === 'NotAllowedError') { toast('Ready. Tap Share again'); return 'retry'; }
      console.warn('share failed, downloading instead', e);
    }
  }
  downloadFile(file);
  return 'downloaded';
}

async function shareTune(t) {
  let blob = peekBlob(t.id);
  try { if (!blob) blob = await getBlob(t.id); } catch (e) { toast(`Can't load this tune: ${e.message}`); return; }
  const file = new File([blob], fileNameFor(t), { type: baseMime(blob.type || t.mimeType) });
  await shareOrDownload(file);
}

// ---------- rename / delete ----------
function startRename(li, t) {
  const nameBtn = li.querySelector('.name');
  const input = document.createElement('input');
  input.className = 'name-input';
  input.value = t.name;
  input.maxLength = 80;
  input.enterKeyHint = 'done';
  input.setAttribute('aria-label', 'Tune name');
  nameBtn.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (save && v && v !== t.name) {
      t.name = v;
      try { await db.updateTune(t); } catch (e) { toast(`Rename failed: ${e.message}`); }
    }
    input.replaceWith(nameBtn);
    fillRow(li, t);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

async function deleteTune(t) {
  const ok = await confirmDialog({ title: 'Delete this tune?', body: `"${t.name}" will be removed from this phone. This can't be undone.` });
  if (!ok) return;
  if (playing.id === t.id) stopPlayback();
  try {
    await db.deleteTune(t.id);
  } catch (e) {
    toast(`Delete failed: ${e.message}`);
    return;
  }
  blobCache.delete(t.id);
  tunes = tunes.filter((x) => x.id !== t.id);
  render();
  toast('Deleted');
}

// List event delegation
els.list.addEventListener('pointerdown', (e) => {
  // Start loading audio as the finger lands, so Share/Play are ready by the time "click" fires.
  const btn = e.target.closest('.play, .share');
  const li = e.target.closest('li.tune');
  if (btn && li) getBlob(li.dataset.id).catch(() => {});
});
els.list.addEventListener('click', (e) => {
  const li = e.target.closest('li.tune');
  if (!li) return;
  const t = tuneById(li.dataset.id);
  if (!t) return;
  if (e.target.closest('.play')) togglePlay(t.id);
  else if (e.target.closest('.share')) shareTune(t);
  else if (e.target.closest('.del')) deleteTune(t);
  else if (e.target.closest('.name')) startRename(li, t);
  else if (e.target.closest('.progress') && playing.id === t.id) {
    const r = e.target.closest('.progress').getBoundingClientRect();
    const dur = playDuration();
    if (dur) player.currentTime = clamp((e.clientX - r.left) / r.width, 0, 1) * dur;
  }
});

// ---------- wake lock ----------
let wakeLock = null;
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) { els.awakeInfo.textContent = 'Keep the screen on'; return; }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    els.awakeInfo.textContent = 'Screen stays on';
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    els.awakeInfo.textContent = 'Screen may auto-lock';
  }
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// ---------- storage persistence ----------
async function requestPersist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {}
  updateStorageInfo();
}

// ---------- mic help ----------
function showMicHelp(kind, err) {
  let title = 'Microphone needed';
  let html;
  if (kind === 'NotAllowedError' || kind === 'SecurityError' || kind === 'PermissionDeniedError') {
    title = 'Microphone is blocked';
    html = `<p>Tune Notebook needs the mic to record. To allow it on iPhone:</p>
      <ol>
        <li><b>In Safari:</b> tap <b>ᴀA</b> in the address bar → <b>Website Settings</b> → <b>Microphone</b> → <b>Allow</b>.</li>
        <li><b>Home Screen app:</b> open <b>Settings</b> → <b>Apps</b> → <b>Safari</b> → <b>Microphone</b> → <b>Ask</b> or <b>Allow</b>. Then close and reopen Tune Notebook.</li>
        <li>Check <b>Settings</b> → <b>Screen Time</b> → <b>Content &amp; Privacy</b> doesn't block the microphone.</li>
      </ol>
      <p>Then tap Record again.</p>`;
  } else if (kind === 'NotFoundError' || kind === 'OverconstrainedError') {
    title = 'No microphone found';
    html = '<p>No microphone is available. Connect one (or unplug a broken headset) and try again.</p>';
  } else if (kind === 'NotReadableError' || kind === 'AbortError') {
    title = 'Microphone is busy';
    html = '<p>Another app is using the microphone (a call, FaceTime, Voice Memos or Siri). Finish that, then tap Record again.</p>';
  } else if (kind === 'unsupported') {
    title = "Recording isn't available";
    html = '<p>This browser can\'t record audio here. Open the app over <b>https://</b> in Safari on iOS 14.5 or later.</p>';
  } else {
    html = `<p>Couldn't start the microphone${err?.message ? `: ${err.message}` : ''}.</p><p>Try again, or restart the app.</p>`;
  }
  els.micTitle.textContent = title;
  els.micBody.innerHTML = html;
  openDialog(els.micDlg);
}

// ---------- recording ----------
function elapsedSec() {
  return state.engine ? (performance.now() - state.engine.startedAt) / 1000 : 0;
}

function sessionMeta(s) {
  return { id: s.id, name: s.name, startedAt: s.startedAt, bpm: s.bpm, sa: s.sa, mimeType: s.mimeType };
}
function persistSessionMeta() {
  const s = state.session;
  if (!s) return;
  s.writes = s.writes.then(() => db.putSession(sessionMeta(s))).catch(warn);
}

async function startRecording() {
  if (state.mode !== 'idle') return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    showMicHelp('unsupported');
    return;
  }
  state.mode = 'starting';
  els.recordBtn.disabled = true;
  stopPlayback();
  setAudioSession('play-and-record');

  let engine;
  try {
    engine = new Engine(); // synchronous, inside the tap
  } catch (e) {
    return abortStart(() => toast(`Audio unavailable: ${e.message}`));
  }
  try {
    await engine.openMic();
  } catch (e) {
    engine.dispose();
    return abortStart(() => showMicHelp(e.name, e));
  }

  const startedAt = Date.now();
  const s = {
    id: newId(), startedAt, name: defaultName(new Date(startedAt)), bpm: null, sa: null,
    mimeType: '', seq: 0, chunks: [], writes: Promise.resolve(),
  };
  engine.addEventListener('chunk', (e) => onChunk(s, e.detail));
  engine.addEventListener('interrupted', (e) => stopRecording(e.detail));
  try {
    engine.startRecorder(pickMimeType());
  } catch (e) {
    engine.dispose();
    return abortStart(() => toast(`Couldn't start recording: ${e.message}`));
  }
  s.mimeType = engine.mimeType;
  state.engine = engine;
  state.session = s;
  state.mode = 'recording';
  persistSessionMeta();

  resetRecUI();
  els.recPanel.hidden = false;
  document.body.classList.add('rec-active');
  els.recordBtn.disabled = false;
  acquireWakeLock();
  meterLoop();
  requestPersist();
  if (!engine.mixed) toast("Recording the mic only: this browser can't mix in the click and drone");
}

function abortStart(report) {
  state.mode = 'idle';
  els.recordBtn.disabled = false;
  setAudioSession('auto');
  report();
}

function onChunk(s, blob) {
  s.chunks.push(blob);
  const seq = s.seq++;
  const elapsed = elapsedSec();
  // Persist each chunk so a crash, kill or phone call never loses the take.
  s.writes = s.writes
    .then(() => blob.arrayBuffer())
    .then((data) => db.addChunk({ session: s.id, seq, elapsed, data }))
    .catch(warn);
}

async function stopRecording(reason) {
  if (state.mode !== 'recording') return;
  state.mode = 'stopping';
  const { engine, session: s } = state;
  const duration = elapsedSec();
  els.stopBtn.disabled = true;
  saListen?.cancel();
  cancelAnimationFrame(meterRaf);
  clearTimeout(tap.restoreT);

  await engine.stopRecorder();
  engine.dispose();
  releaseWakeLock();
  setAudioSession('auto');
  await s.writes.catch(() => {});

  els.recPanel.hidden = true;
  document.body.classList.remove('rec-active');
  els.stopBtn.disabled = false;
  state.engine = null;
  state.session = null;
  state.mode = 'idle';

  const type = baseMime(s.mimeType || s.chunks[0]?.type);
  const blob = new Blob(s.chunks, { type });
  const prefix = reason ? `${reason}. ` : '';
  if (duration < MIN_DURATION || blob.size < MIN_BYTES) {
    await db.deleteSession(s.id).catch(warn);
    toast(`${prefix}Too short to keep. Record for at least a second.`);
    return;
  }
  const meta = {
    id: s.id, name: s.name, createdAt: s.startedAt, bpm: s.bpm, sa: s.sa,
    duration: Math.round(duration * 10) / 10, mimeType: type, size: blob.size,
  };
  try {
    await db.saveTune(meta, await blob.arrayBuffer());
  } catch (e) {
    // Chunks are still in the sessions store; they'll be recovered on next launch.
    toast(`Couldn't save (${e.message}). It will be recovered on next launch.`);
    return;
  }
  await db.deleteSession(s.id).catch(warn);
  tunes.unshift(meta);
  render();
  rowFor(meta.id)?.classList.add('fresh');
  toast(`${prefix}Saved ${fmtDur(duration)}`);
}

// Recording panel UI
let meterRaf = 0;
function meterLoop() {
  const eng = state.engine;
  if (!eng || state.mode !== 'recording') return;
  const rms = eng.level();
  const dbfs = 20 * Math.log10(rms + 1e-6);
  els.meterFill.style.transform = `scaleX(${clamp((dbfs + 60) / 60, 0, 1)})`;
  els.recTime.textContent = fmtDur(elapsedSec());
  if (eng.consumeBeat()) {
    els.bpmValue.classList.remove('beat');
    void els.bpmValue.offsetWidth;
    els.bpmValue.classList.add('beat');
  }
  meterRaf = requestAnimationFrame(meterLoop);
}

function resetRecUI() {
  tap.times = [];
  tap.prevBpm = null;
  els.recTime.textContent = '0:00';
  els.bpmValue.textContent = '—';
  els.tapInfo.textContent = 'Tap 4+ times on the beat';
  els.saValue.textContent = '—';
  els.saInfo.textContent = 'Tap, then sing your root ~2 s';
  els.saBtn.classList.remove('listening');
  els.awakeInfo.textContent = '';
  for (const [b, label] of [[els.clickToggle, 'Click'], [els.droneToggle, 'Drone']]) {
    b.setAttribute('aria-pressed', 'true');
    b.textContent = `${label} on`;
  }
}

// ---------- tap tempo ----------
const tap = { times: [], prevBpm: null, restoreT: 0 };
const TAP_RESET_GAP = 2.0; // seconds of silence starts a new tap sequence

function onTap() {
  const eng = state.engine;
  const s = state.session;
  if (!eng || state.mode !== 'recording') return;
  const now = eng.ctx.currentTime;

  els.tapBtn.classList.add('flash');
  setTimeout(() => els.tapBtn.classList.remove('flash'), 90);

  const last = tap.times[tap.times.length - 1];
  if (last !== undefined && now - last > TAP_RESET_GAP) tap.times = [];
  if (tap.times.length === 0 && s.bpm) {
    // Re-tapping: silence the old click so it doesn't fight the new beat.
    tap.prevBpm = s.bpm;
    eng.stopTempo();
  }
  tap.times.push(now);
  if (tap.times.length > 8) tap.times.shift();
  clearTimeout(tap.restoreT);

  if (tap.times.length >= 4) {
    const t = tap.times;
    const avg = (t[t.length - 1] - t[0]) / (t.length - 1);
    const bpm = clamp(Math.round(60 / avg), 30, 300);
    s.bpm = bpm;
    tap.prevBpm = null;
    eng.setTempo(bpm, now);
    els.bpmValue.textContent = bpm;
    els.tapInfo.textContent = 'Tap again any time to change';
    persistSessionMeta();
  } else {
    els.tapInfo.textContent = `Tap ${tap.times.length} of 4…`;
    tap.restoreT = setTimeout(() => {
      if (tap.times.length >= 4 || !state.engine) return;
      tap.times = [];
      if (tap.prevBpm) {
        state.engine.setTempo(tap.prevBpm, state.engine.ctx.currentTime);
        tap.prevBpm = null;
      }
      els.tapInfo.textContent = s.bpm ? 'Tap again any time to change' : 'Tap 4+ times on the beat';
    }, (TAP_RESET_GAP + 0.3) * 1000);
  }
}

// pointerdown gives the most accurate tap timing; click covers keyboard activation.
els.tapBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(); });
els.tapBtn.addEventListener('click', (e) => { if (e.detail === 0) onTap(); });

// ---------- Set Sa ----------
let saListen = null;
async function onSetSa() {
  const eng = state.engine;
  const s = state.session;
  if (!eng || saListen || state.mode !== 'recording') return;
  els.saBtn.classList.add('listening');
  els.saValue.textContent = '…';
  els.saInfo.textContent = 'Listening. Sing and hold Sa';
  eng.duckDrone(true);
  let shown = null;
  saListen = eng.listenForSa({
    onFrame: (est, progress) => {
      if (est) shown = est.name;
      els.saValue.textContent = shown || '…';
      els.saInfo.textContent = `Listening… ${Math.round(progress * 100)}%`;
    },
  });
  const res = await saListen.promise;
  saListen = null;
  els.saBtn.classList.remove('listening');
  if (state.engine !== eng || res.reason === 'cancelled') return;
  if (!res.ok) {
    eng.duckDrone(false);
    els.saValue.textContent = s.sa ? s.sa.name : '—';
    els.saInfo.textContent = res.reason === 'quiet'
      ? "Couldn't hear a note. Tap and sing louder or closer"
      : 'Pitch wandered. Tap and hold one steady note';
    return;
  }
  s.sa = { name: res.name, octave: res.octave, midi: res.midi, freq: Math.round(res.freq * 100) / 100 };
  eng.setSa(res.freq);
  els.saValue.textContent = res.name;
  els.saInfo.textContent = `${res.name}${res.octave} · tap to set again`;
  persistSessionMeta();
}
els.saBtn.addEventListener('click', onSetSa);

function toggleChip(btn, label, apply) {
  const on = btn.getAttribute('aria-pressed') !== 'true';
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = `${label} ${on ? 'on' : 'off'}`;
  apply(on);
}
els.clickToggle.addEventListener('click', () => toggleChip(els.clickToggle, 'Click', (on) => state.engine?.setClickOn(on)));
els.droneToggle.addEventListener('click', () => toggleChip(els.droneToggle, 'Drone', (on) => state.engine?.setDroneOn(on)));
els.stopBtn.addEventListener('click', () => stopRecording());
els.recordBtn.addEventListener('click', startRecording);

// iOS stops the mic when the app leaves the screen: save what we have.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode === 'recording' && isIOS) {
    stopRecording('Recording stopped when the app left the screen');
  } else if (!document.hidden && state.mode === 'recording' && !wakeLock) {
    acquireWakeLock();
  }
});

// ---------- recovery of interrupted sessions ----------
async function recoverSessions() {
  let sessions;
  try { sessions = await db.getSessions(); } catch (e) { warn(e); return; }
  let recovered = 0;
  for (const s of sessions || []) {
    try {
      if (tunes.some((t) => t.id === s.id)) { await db.deleteSession(s.id); continue; }
      const chunks = await db.getChunks(s.id);
      const size = chunks.reduce((n, c) => n + c.data.byteLength, 0);
      const duration = chunks.reduce((m, c) => Math.max(m, c.elapsed || 0), 0);
      if (size >= MIN_BYTES && duration >= MIN_DURATION) {
        const type = baseMime(s.mimeType);
        const data = await new Blob(chunks.map((c) => c.data), { type }).arrayBuffer();
        const meta = {
          id: s.id, name: `${s.name} (recovered)`, createdAt: s.startedAt, bpm: s.bpm, sa: s.sa,
          duration: Math.round(duration * 10) / 10, mimeType: type, size: data.byteLength, recovered: true,
        };
        await db.saveTune(meta, data);
        tunes.push(meta);
        recovered++;
      }
      await db.deleteSession(s.id);
    } catch (e) { warn(e); }
  }
  if (recovered) {
    tunes.sort((a, b) => b.createdAt - a.createdAt);
    render();
    toast(`Recovered ${recovered} interrupted recording${recovered > 1 ? 's' : ''}`);
  }
}

// ---------- backup: export / import ----------
let preparedZip = null;
function resetExportBtn() {
  preparedZip = null;
  els.exportZipBtn.textContent = 'Export all as .zip';
  els.exportZipBtn.classList.remove('primary');
  els.exportZipBtn.disabled = false;
}

async function buildZip() {
  const entries = [];
  const used = new Set();
  const manifest = [];
  for (const t of [...tunes].reverse()) {
    const r = await db.getAudio(t.id);
    if (!r) continue;
    const d = new Date(t.createdAt);
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    let name = `${stamp} ${fileNameFor(t)}`;
    for (let i = 2; used.has(name); i++) name = `${stamp} (${i}) ${fileNameFor(t)}`;
    used.add(name);
    entries.push({ name, data: new Uint8Array(r.data), date: d });
    manifest.push({ ...t, file: name });
  }
  const json = JSON.stringify({ app: 'tune-notebook', format: 1, exportedAt: new Date().toISOString(), tunes: manifest }, null, 2);
  entries.push({ name: 'tunes.json', data: new TextEncoder().encode(json), date: new Date() });
  const blob = makeZip(entries);
  const day = new Date().toISOString().slice(0, 10);
  return new File([blob], `tune-notebook-backup-${day}.zip`, { type: 'application/zip' });
}

// Two taps: the first builds the zip, the second shares it (sharing must happen
// right after a tap, and building can take longer than iOS allows).
els.exportZipBtn.addEventListener('click', async () => {
  if (preparedZip) {
    const res = await shareOrDownload(preparedZip);
    if (res !== 'retry') resetExportBtn();
    return;
  }
  if (!tunes.length) { toast('Nothing to export yet'); return; }
  els.exportZipBtn.disabled = true;
  els.exportZipBtn.textContent = 'Preparing…';
  try {
    preparedZip = await buildZip();
    els.exportZipBtn.textContent = `Share backup (${fmtBytes(preparedZip.size)})`;
    els.exportZipBtn.classList.add('primary');
  } catch (e) {
    toast(`Export failed: ${e.message}`);
    resetExportBtn();
  } finally {
    els.exportZipBtn.disabled = false;
  }
});

// Sequential shares: one tune per tap.
const seq = { list: [], i: 0, file: null };
async function seqPrepare() {
  seq.file = null;
  if (seq.i >= seq.list.length) {
    closeDialog(els.seqDlg);
    toast('All tunes shared');
    return;
  }
  const t = seq.list[seq.i];
  els.seqInfo.textContent = `${seq.i + 1} of ${seq.list.length}: ${t.name}`;
  els.seqShareBtn.disabled = true;
  els.seqShareBtn.textContent = 'Loading…';
  try {
    const blob = await getBlob(t.id);
    seq.file = new File([blob], fileNameFor(t), { type: baseMime(blob.type || t.mimeType) });
    els.seqShareBtn.textContent = 'Share';
  } catch (e) {
    els.seqShareBtn.textContent = `Can't load (${e.message})`;
  }
  els.seqShareBtn.disabled = !seq.file;
}
els.exportSeqBtn.addEventListener('click', () => {
  if (!tunes.length) { toast('Nothing to share yet'); return; }
  closeDialog(els.menuDlg);
  seq.list = [...tunes];
  seq.i = 0;
  openDialog(els.seqDlg);
  seqPrepare();
});
els.seqShareBtn.addEventListener('click', async () => {
  if (!seq.file) return;
  const res = await shareOrDownload(seq.file);
  if (res === 'shared' || res === 'downloaded') { seq.i++; seqPrepare(); }
});
els.seqSkipBtn.addEventListener('click', () => { seq.i++; seqPrepare(); });
els.seqDoneBtn.addEventListener('click', () => closeDialog(els.seqDlg));

function probeDuration(blob) {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(blob);
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; URL.revokeObjectURL(url); resolve(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 4000);
    a.src = url;
  });
}

const isAudioName = (n) => /\.(m4a|mp4|aac|webm|ogg|oga|mp3|wav|caf)$/i.test(n);

async function importFiles(files) {
  let added = 0, skipped = 0, failed = 0;
  const existing = new Set((await db.listTunes()).map((t) => t.id));
  const addAudio = async (name, data, m) => {
    if (m?.id && existing.has(m.id)) { skipped++; return; }
    const type = m?.mimeType || mimeFromName(name) || 'audio/mp4';
    const meta = m
      ? { ...m }
      : {
          name: name.replace(/\.[^.]+$/, ''), createdAt: Date.now(), bpm: null, sa: null,
          duration: await probeDuration(new Blob([data], { type })),
        };
    delete meta.file;
    meta.id = m?.id || newId();
    meta.mimeType = type;
    meta.size = data.byteLength;
    await db.saveTune(meta, data);
    existing.add(meta.id);
    added++;
  };
  for (const f of files) {
    try {
      if (/\.zip$/i.test(f.name) || f.type.includes('zip')) {
        const entries = await readZip(await f.arrayBuffer());
        const man = {};
        const mEntry = entries.find((e) => e.data && /(^|\/)tunes\.json$/.test(e.name));
        if (mEntry) {
          const j = JSON.parse(new TextDecoder().decode(mEntry.data));
          for (const t of j.tunes || []) man[t.file] = t;
        }
        for (const e of entries) {
          const base = e.name.split('/').pop();
          if (e.name.startsWith('__MACOSX/') || base.startsWith('._') || !isAudioName(base)) continue;
          if (e.unsupported) { failed++; continue; }
          await addAudio(base, e.data.slice().buffer, man[e.name] || man[base]);
        }
      } else if (f.type.startsWith('audio/') || isAudioName(f.name)) {
        await addAudio(f.name, await f.arrayBuffer(), null);
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
      warn(e);
    }
  }
  tunes = await db.listTunes();
  render();
  const parts = [`Imported ${added}`];
  if (skipped) parts.push(`${skipped} already here`);
  if (failed) parts.push(`${failed} couldn't be read`);
  toast(parts.join(' · '));
}

els.importBtn.addEventListener('click', () => els.importInput.click());
els.importInput.addEventListener('change', () => {
  const files = [...els.importInput.files];
  els.importInput.value = '';
  if (files.length) { closeDialog(els.menuDlg); importFiles(files); }
});

// ---------- menu ----------
els.menuBtn.addEventListener('click', async () => {
  resetExportBtn();
  els.versionInfo.textContent = `Version ${APP_VERSION} · ${isStandalone ? 'installed app' : 'in browser'}`;
  let persisted = false;
  try { persisted = (await navigator.storage?.persisted?.()) || false; } catch {}
  if (persisted) {
    els.persistInfo.textContent = 'Storage is protected: the browser won\'t clear your tunes to free space.';
  } else {
    els.persistInfo.textContent = isIOS && !isStandalone
      ? 'Storage isn\'t protected yet. Add the app to your Home Screen: Safari may clear data for sites you haven\'t opened in a while.'
      : 'Storage isn\'t protected yet. The browser may clear it under storage pressure. Export backups regularly.';
  }
  els.persistBtn.hidden = persisted || !navigator.storage?.persist;
  openDialog(els.menuDlg);
});
els.persistBtn.addEventListener('click', async () => {
  let ok = false;
  try { ok = await navigator.storage.persist(); } catch {}
  toast(ok ? 'Storage protected' : 'The browser declined. Install to Home Screen and keep backups.');
  els.persistBtn.hidden = ok;
  updateStorageInfo();
});

// ---------- install hint ----------
function setupInstallHint() {
  let dismissed = false;
  try { dismissed = localStorage.getItem('hintDismissed') === '1'; } catch {}
  els.installHint.hidden = !(isIOS && !isStandalone && !dismissed);
  els.hintClose.addEventListener('click', () => {
    els.installHint.hidden = true;
    try { localStorage.setItem('hintDismissed', '1'); } catch {}
  });
}

// ---------- service worker ----------
function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  let userAskedReload = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!userAskedReload || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const offer = (worker) => {
      toast('A new version is ready', {
        action: 'Update',
        onAction: () => {
          if (state.mode !== 'idle') { toast('Finish recording first'); return; }
          userAskedReload = true;
          worker.postMessage('skipWaiting');
        },
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch(warn);
}

// ---------- boot ----------
async function boot() {
  setupInstallHint();
  setupServiceWorker();
  try {
    tunes = await db.listTunes();
  } catch (e) {
    toast(`Storage unavailable: ${e.message}`);
    tunes = [];
  }
  render();
  await recoverSessions();
  if (isStandalone) requestPersist();
}

boot();

// Exposed for debugging in the console.
window.tuneNotebook = { state, db, get tunes() { return tunes; } };

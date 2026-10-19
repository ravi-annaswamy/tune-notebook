import * as db from './db.js';
import { Engine, pickMimeType } from './audio.js';
import { makeZip, readZip } from './zip.js';
import { ANALYSIS_VERSION, SWARA, saMidiFor, sargamString } from './analyze.js';
import { analyseAudio, analysisStats } from './analysis-client.js';
import { midiToFreq } from './pitch.js';
import { randomPrompt, rerollPart, describePrompt, normalizePrompt, buildPlan, partsOf, BAND_LEVELS, bandLevel } from './prompt.js';
import { PromptPlayer } from './prompt-player.js';

const APP_VERSION = '1.4.1';
const MIN_DURATION = 1.0; // seconds; shorter clips are discarded
const MIN_BYTES = 800;

const $ = (s) => document.querySelector(s);
const els = {
  recordBtn: $('#recordBtn'), list: $('#list'), empty: $('#empty'), storageInfo: $('#storageInfo'),
  rowTpl: $('#rowTpl'), recPanel: $('#recPanel'), recTime: $('#recTime'), awakeInfo: $('#awakeInfo'),
  meterFill: $('#meterFill'), stopBtn: $('#stopBtn'), toast: $('#toast'),
  confirmDlg: $('#confirmDlg'), confirmCancel: $('#confirmCancel'), confirmTitle: $('#confirmTitle'), confirmBody: $('#confirmBody'), confirmOk: $('#confirmOk'),
  menuBtn: $('#menuBtn'), menuDlg: $('#menuDlg'), exportZipBtn: $('#exportZipBtn'), exportSeqBtn: $('#exportSeqBtn'),
  importBtn: $('#importBtn'), importInput: $('#importInput'), persistInfo: $('#persistInfo'), persistBtn: $('#persistBtn'),
  versionInfo: $('#versionInfo'), seqDlg: $('#seqDlg'), seqInfo: $('#seqInfo'), seqShareBtn: $('#seqShareBtn'),
  seqSkipBtn: $('#seqSkipBtn'), seqDoneBtn: $('#seqDoneBtn'), micDlg: $('#micDlg'), micTitle: $('#micTitle'),
  micBody: $('#micBody'), recLabel: $('#recLabel'), stopLabel: $('#stopLabel'), installHint: $('#installHint'), hintClose: $('#hintClose'),
  updateBar: $('#updateBar'), updateBtn: $('#updateBtn'),
  promptBtn: $('#promptBtn'), promptDlg: $('#promptDlg'), prTempo: $('#prTempo'), prTempoV: $('#prTempoV'),
  prStyle: $('#prStyle'), prStyleV: $('#prStyleV'), prForm: $('#prForm'), prFormV: $('#prFormV'),
  prBand: $('#prBand'), prBandV: $('#prBandV'),
  prKey: $('#prKey'), prKeyV: $('#prKeyV'), prChords: $('#prChords'), prChordsV: $('#prChordsV'),
  prFeel: $('#prFeel'), prFeelV: $('#prFeelV'), prShuffle: $('#prShuffle'), prListen: $('#prListen'),
  prRecord: $('#prRecord'), prClose: $('#prClose'), recPrompt: $('#recPrompt'), rpInfo: $('#rpInfo'),
  rpGrid: $('#rpGrid'), rpSection: $('#rpSection'), rpBeats: $('#rpBeats'),
  rpClick: $('#rpClick'), rpDrums: $('#rpDrums'), rpBass: $('#rpBass'), rpChords: $('#rpChords'),
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
  li.querySelector('.m-scale').textContent = t.prompt ? t.prompt.chords.map((c) => c.name).join('–') : t.sa?.scale || '';
  li.querySelector('.m-dur').textContent = fmtDur(t.duration);
  li.querySelector('.m-status').textContent = analysisStatus(t);
  li.querySelector('.play').setAttribute('aria-label', `Play ${t.name}`);
  const open = openDetails.has(t.id);
  li.classList.toggle('open', open);
  li.querySelector('.meta').setAttribute('aria-expanded', String(open));
  const details = li.querySelector('.details');
  details.hidden = !open;
  if (open) renderDetails(details, t);
}

function refreshRow(id) {
  const li = rowFor(id);
  const t = tuneById(id);
  if (li && t) fillRow(li, t);
}

// ---------- analysis (tempo from clicks, Sa, scale, sargam) ----------
const openDetails = new Set();
const analysing = new Set();
const analysisQueue = [];
let pumping = false;
let idleWaiters = [];

const needsAnalysis = (t) => !t.prompt && (!t.analysis || (t.analysis.version || 0) < ANALYSIS_VERSION);
const whenIdle = () => (state.mode === 'idle' ? Promise.resolve() : new Promise((r) => idleWaiters.push(r)));
function notifyIdle() {
  const w = idleWaiters;
  idleWaiters = [];
  w.forEach((f) => f());
}

function analysisStatus(t) {
  if (analysing.has(t.id)) return 'Analysing…';
  if (analysisQueue.includes(t.id)) return 'Waiting to analyse';
  if (t.analysis?.error) return 'Analysis failed';
  return '';
}

function queueAnalysis(id, { front = false } = {}) {
  if (analysing.has(id) || analysisQueue.includes(id)) return;
  if (front) analysisQueue.unshift(id);
  else analysisQueue.push(id);
  refreshRow(id);
  pump();
}

// One clip at a time, and never while recording, so capture is never disturbed.
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (analysisQueue.length) {
      await whenIdle();
      const id = analysisQueue.shift();
      if (!tuneById(id)) continue;
      analysing.add(id);
      refreshRow(id);
      let result;
      try {
        const rec = await db.getAudio(id);
        if (!rec) throw new Error('audio missing');
        result = await analyseAudio(rec.data);
      } catch (e) {
        warn(e);
        result = { version: ANALYSIS_VERSION, error: e.message || 'failed' };
      }
      analysing.delete(id);
      const t = tuneById(id); // re-read: it may have been deleted meanwhile
      if (!t) continue;
      applyAnalysis(t, result);
      try { await db.updateTune(t); } catch (e) { warn(e); }
      refreshRow(id);
    }
  } finally {
    pumping = false;
  }
}

function saFromCandidate(a, c, source) {
  const midi = saMidiFor(a.notes.map(([, , m]) => ({ midi: m })), c.pc);
  return {
    name: c.name, octave: Math.floor(midi / 12) - 1, midi,
    freq: Math.round(midiToFreq(midi + (a.tuningCents || 0) / 100) * 10) / 10,
    scale: c.scale, western: c.western, source,
  };
}

// Fill BPM and Sa from the analysis, but never overwrite values the user chose
// (or set with tap tempo / Set Sa in v1.0).
function applyAnalysis(t, a) {
  t.analysis = a;
  if (a.error) return;
  if (t.bpm == null || t.bpmSource === 'auto') {
    t.bpm = a.tempo ? Math.round(a.tempo.bpm) : null;
    t.bpmSource = 'auto';
  }
  if (!t.sa || t.sa.source === 'auto') {
    t.sa = a.candidates.length ? saFromCandidate(a, a.candidates[0], 'auto') : null;
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderPromptDetails(box, t) {
  const pr = t.prompt;
  const row = (label, value) => {
    const r = el('div', 'd-row');
    r.append(el('span', 'd-label', label), el('span', 'd-value', value));
    box.append(r);
  };
  row('Prompt', `${pr.genreName || 'Acoustic'} · ${t.bpm} BPM · ${pr.meterName} · ${pr.feelName || pr.styleName}`);
  row('Sa', `${pr.keyName} · ${pr.scale}${pr.western ? ` (${pr.western})` : ''}`);
  if (pr.sections) {
    for (const sec of pr.sections) row(sec.name === 'Loop' ? 'Chords' : `Part ${sec.name}`, sec.bars.join(' '));
    if (pr.newChord) row('New chord', `${pr.newChord.name} (${pr.newChord.roman}) in part B`);
  } else {
    row('Chords', `${pr.chords.map((c) => c.name).join(' – ')}  (${pr.chords.map((c) => c.roman).join(' ')})`);
  }
  box.append(el('button', 'btn reuse-prompt', 'Use this prompt again'));
}

function renderDetails(box, t) {
  box.replaceChildren();
  if (t.prompt) { renderPromptDetails(box, t); return; }
  const a = t.analysis;
  const reBtn = el('button', 'btn reanalyse', analysing.has(t.id) ? 'Analysing…' : 'Analyse again');
  reBtn.disabled = analysing.has(t.id) || analysisQueue.includes(t.id);
  if (!a || a.error) {
    box.append(el('p', 'd-note', a?.error ? `Analysis failed: ${a.error}` : analysisStatus(t) || 'Not analysed yet.'), reBtn);
    return;
  }
  const row = (label, value) => {
    const r = el('div', 'd-row');
    r.append(el('span', 'd-label', label), el('span', 'd-value', value));
    box.append(r);
  };

  if (a.tempo) {
    row('Tempo', `${Math.round(a.tempo.bpm)} BPM · mostly ${a.tempo.low}–${a.tempo.high} · from ${a.tempo.beats} clicks`);
    row('Time sig.', a.meter?.guess ? `${a.meter.guess} (beat 1 accented)` : 'Not readable. Make beat 1 louder (clap on 1) or say "one".');
  } else {
    row('Tempo', 'No steady clicks found. Click the beat while you record.');
  }

  if (a.candidates.length) {
    box.append(el('div', 'd-label d-block', 'Sa: best guess first, tap to choose'));
    const choices = el('div', 'sa-choices');
    for (const c of a.candidates.slice(0, 4)) {
      const b = el('button', 'sa-choice');
      b.dataset.pc = c.pc;
      b.setAttribute('aria-pressed', String(t.sa?.name === c.name));
      b.append(el('span', 'sa-note', c.name), el('span', 'sa-scale', c.scale));
      choices.append(b);
    }
    box.append(choices);
    if (t.sa?.midi != null) {
      const cents = a.tuningCents || 0;
      const tuning = Math.abs(cents) < 5 ? 'in tune with A440' : `${Math.abs(cents)}¢ ${cents < 0 ? 'flat' : 'sharp'} of A440`;
      row('Scale', `${t.sa.scale || '—'}${t.sa.western ? ` (${t.sa.western})` : ''}`);
      const heard = SWARA.filter((_, k) => (a.hist[(t.sa.midi % 12 + k) % 12] || 0) >= 0.03);
      row('Swaras', heard.join(' '));
      row('Pitch', `Sa ≈ ${t.sa.freq} Hz · you're ${tuning}`);
      const notes = a.notes.map(([, dur, midi]) => ({ dur, midi }));
      box.append(el('div', 'd-label d-block', "Sargam sketch (' upper, . lower octave, — held beat)"));
      box.append(el('p', 'sargam', sargamString(notes, t.sa.midi, t.bpm)));
    }
  } else {
    row('Sa', 'Not enough steady notes to tell.');
  }
  box.append(reBtn);
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

let shareRetryKey = null;
async function shareOrDownload(file) {
  const key = `${file.name}|${file.size}`;
  if (navigator.canShare?.({ files: [file] })) {
    // Read before share() consumes it: was this call still inside a fresh tap?
    const hadActivation = navigator.userActivation ? navigator.userActivation.isActive : false;
    try {
      await navigator.share({ files: [file] });
      shareRetryKey = null;
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      // NotAllowedError right after a tap means this browser won't share this file
      // type (desktop Chrome does this). Only ask for another tap once, and only when
      // the tap had expired (iOS, after a slow load).
      if (e.name === 'NotAllowedError' && !hadActivation && shareRetryKey !== key) {
        shareRetryKey = key;
        toast('Ready. Tap Share again');
        return 'retry';
      }
      console.warn('share failed, downloading instead', e);
    }
  }
  shareRetryKey = null;
  downloadFile(file);
  toast(`Saved to Downloads: ${file.name}`);
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
  openDetails.delete(t.id);
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
  if (e.target.closest('.meta')) {
    if (openDetails.has(t.id)) openDetails.delete(t.id);
    else openDetails.add(t.id);
    fillRow(li, t);
    return;
  }
  const choice = e.target.closest('.sa-choice');
  if (choice && t.analysis?.candidates) {
    const c = t.analysis.candidates.find((x) => String(x.pc) === choice.dataset.pc);
    if (c) {
      t.sa = saFromCandidate(t.analysis, c, 'user');
      db.updateTune(t).catch(warn);
      fillRow(li, t);
    }
    return;
  }
  if (e.target.closest('.reanalyse')) { queueAnalysis(t.id, { front: true }); return; }
  if (e.target.closest('.reuse-prompt')) { openPrompt(t.prompt.params); return; }
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
  return { id: s.id, name: s.name, startedAt: s.startedAt, bpm: s.bpm, sa: s.sa, mimeType: s.mimeType, prompt: s.prompt || null };
}
function persistSessionMeta() {
  const s = state.session;
  if (!s) return;
  s.writes = s.writes.then(() => db.putSession(sessionMeta(s))).catch(warn);
}

const COUNT_IN_BARS = 2;

// opts.prompt: compose over a pulse + guitar, after a COUNT_IN_BARS count-in.
// opts.ctx: the prompt preview's AudioContext (already unlocked by a tap).
async function startRecording(opts = {}) {
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
    engine = new Engine(opts.prompt ? { ctx: opts.ctx, backing: true } : {}); // synchronous, inside the tap
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
    mimeType: '', seq: 0, chunks: [], writes: Promise.resolve(), prompt: opts.prompt || null,
  };
  engine.addEventListener('chunk', (e) => onChunk(s, e.detail));
  engine.addEventListener('interrupted', (e) => stopRecording(e.detail));
  state.engine = engine;
  state.session = s;
  state.player = null;

  resetRecUI(opts.prompt);
  els.recPanel.hidden = false;
  document.body.classList.add('rec-active');
  els.recordBtn.disabled = false;
  acquireWakeLock();

  if (opts.prompt) {
    // Count-in: clicks only, then the groove starts at chord 1 and recording starts with it.
    const player = new PromptPlayer(engine.ctx, opts.prompt, { level: promptLevel }).connect(engine.ctx.destination);
    if (engine.backingIn) player.connect(engine.backingIn);
    player.start(engine.ctx.currentTime + 0.2, { countInBars: COUNT_IN_BARS });
    state.player = player;
    state.mode = 'countin';
    setCountInUI(true);
    meterLoop();
    // Start the recorder just before the downbeat. Both the groove and your voice
    // go into the same file, so a few ms of timer slop can't put them out of sync.
    await waitForAudioTime(engine.ctx, player.musicStart - 0.06, () => state.mode === 'countin' && state.engine === engine);
    if (state.mode !== 'countin' || state.engine !== engine) return; // cancelled
    if (engine.ctx.state !== 'running') { cancelCountIn('Interrupted during the count-in. Nothing was recorded'); return; }
    setCountInUI(false);
  }

  try {
    engine.startRecorder(pickMimeType());
  } catch (e) {
    cancelAnimationFrame(meterRaf);
    state.player?.stop();
    state.player = null;
    engine.dispose();
    state.engine = null;
    state.session = null;
    releaseWakeLock();
    hideRecPanel();
    return abortStart(() => toast(`Couldn't start recording: ${e.message}`));
  }
  s.mimeType = engine.mimeType;
  state.mode = 'recording';
  persistSessionMeta();
  if (!opts.prompt) meterLoop();
  requestPersist();
  if (opts.prompt && !engine.mixed) toast("This browser can't record the backing: only your voice is saved");
}

// Resolves when the AudioContext clock reaches t, or as soon as stillWanted() turns false.
function waitForAudioTime(ctx, t, stillWanted) {
  return new Promise((resolve) => {
    const tick = () => {
      const left = t - ctx.currentTime;
      if (left <= 0 || !stillWanted() || ctx.state !== 'running') return resolve();
      setTimeout(tick, Math.max(4, Math.min(50, left * 1000 - 4)));
    };
    tick();
  });
}

function hideRecPanel() {
  els.recPanel.hidden = true;
  document.body.classList.remove('rec-active');
  setCountInUI(false);
}

function setCountInUI(on) {
  els.recPanel.classList.toggle('counting', on);
  els.recLabel.textContent = on ? 'Count-in' : 'Recording';
  els.stopLabel.textContent = on ? 'Cancel' : 'Stop & save';
}

// Cancelling during the count-in: nothing was recorded, so nothing is saved.
function cancelCountIn(message) {
  if (state.mode !== 'countin') return;
  cancelAnimationFrame(meterRaf);
  state.player?.stop();
  state.player = null;
  state.engine?.dispose();
  state.engine = null;
  state.session = null;
  releaseWakeLock();
  setAudioSession('auto');
  hideRecPanel();
  state.mode = 'idle';
  notifyIdle();
  if (message) toast(message);
}

function abortStart(report) {
  state.mode = 'idle';
  notifyIdle();
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
  cancelAnimationFrame(meterRaf);

  await engine.stopRecorder();
  state.player?.stop();
  state.player = null;
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
  notifyIdle();

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
    ...(s.prompt ? promptFields(s.prompt) : {}),
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
  if (needsAnalysis(meta)) queueAnalysis(meta.id, { front: true });
  toast(`${prefix}Saved ${fmtDur(duration)}`);
}

// Recording panel UI
let meterRaf = 0;
function meterLoop() {
  const eng = state.engine;
  if (!eng || (state.mode !== 'recording' && state.mode !== 'countin')) return;
  const rms = eng.level();
  const dbfs = 20 * Math.log10(rms + 1e-6);
  els.meterFill.style.transform = `scaleX(${clamp((dbfs + 60) / 60, 0, 1)})`;
  const pos = state.player ? state.player.position() : null;
  if (state.mode === 'countin') {
    // Big beat number: 1 2 3 4, 1 2 3 4 …
    els.recTime.textContent = pos?.countIn ? String(pos.beatInBar + 1) : '·';
    els.recLabel.textContent = pos?.countIn ? `Count-in ${pos.bar + 1}/${COUNT_IN_BARS}` : 'Count-in';
  } else {
    els.recTime.textContent = fmtDur(elapsedSec());
  }
  if (pos) showPromptPosition(pos);
  meterRaf = requestAnimationFrame(meterLoop);
}

let shownPos = '';
function showPromptPosition(pos) {
  const key = `${pos.barIdx}:${pos.beatInBar}:${pos.countIn}`;
  if (key === shownPos) return;
  shownPos = key;
  els.rpGrid.querySelectorAll('.rp-bar').forEach((c) => c.classList.toggle('now', Number(c.dataset.i) === pos.barIdx));
  [...els.rpBeats.children].forEach((b, i) => b.classList.toggle('on', i === pos.beatInBar));
  if (pos.countIn) els.rpSection.textContent = 'Get ready: the groove starts at bar 1';
  else if (pos.section) {
    els.rpSection.textContent = pos.section === 'Loop'
      ? `Bar ${pos.barInSection + 1} of ${pos.sectionLen}`
      : `Part ${pos.section} · bar ${pos.barInSection + 1} of ${pos.sectionLen}${pos.section === 'B' ? ' · moves more' : ''}`;
  }
}

const PART_CHIPS = () => [['click', els.rpClick], ['drums', els.rpDrums], ['bass', els.rpBass], ['chords', els.rpChords]];

function resetRecUI(prompt = null) {
  els.recTime.textContent = '0:00';
  els.meterFill.style.transform = 'scaleX(0)';
  els.awakeInfo.textContent = '';
  els.recPanel.classList.toggle('with-prompt', !!prompt);
  els.recPrompt.hidden = !prompt;
  shownPos = '';
  if (!prompt) return;
  const plan = buildPlan(prompt);
  const d = plan.d;
  els.rpInfo.textContent = `${d.genreName} · ${d.bpm} BPM · ${d.meterName} · Sa ${d.keyName} · ${d.feelName}`;
  els.rpSection.textContent = '';
  // One chip per bar, a row per section, so you can see where the changes come.
  let i = 0;
  els.rpGrid.replaceChildren(...d.sections.map((sec) => {
    const row = el('div', 'rp-row');
    if (d.sections.length > 1) row.append(el('span', 'rp-label', sec.name));
    for (const c of sec.bars) {
      const chip = el('span', `rp-bar${c.isNew ? ' new' : ''}`, c.name);
      chip.dataset.i = i++;
      row.append(chip);
    }
    return row;
  }));
  els.rpBeats.replaceChildren(...Array.from({ length: d.meter }, (_, k) => el('span', k ? 'rp-beat' : 'rp-beat one')));
  const parts = { ...partsOf(plan), click: true };
  for (const [part, btn] of PART_CHIPS()) {
    btn.hidden = !parts[part];
    btn.setAttribute('aria-pressed', String(part === 'click' ? plan.click : true));
  }
}

function toggleChip(btn, apply) {
  const on = btn.getAttribute('aria-pressed') !== 'true';
  btn.setAttribute('aria-pressed', String(on));
  apply(on);
}
for (const [part, btn] of PART_CHIPS()) btn.addEventListener('click', () => toggleChip(btn, (on) => state.player?.setOn(part, on)));

// ---------- Prompt: a random groove to compose over ----------
const promptState = { prompt: null, ctx: null, player: null };

function promptFields(params) {
  const p = normalizePrompt(params);
  const d = describePrompt(p);
  return {
    prompt: {
      params: p, genreName: d.genreName, feelName: d.feelName, styleName: d.feelName, formName: d.formName,
      meterName: d.meterName, progressionName: d.progressionName, keyName: d.keyName, scale: d.scale, western: d.western,
      sections: d.sections.map((sec) => ({ name: sec.name, bars: sec.bars.map((c) => c.name) })),
      chords: d.chords.map((c) => ({ name: c.name, roman: c.roman })),
      newChord: d.newChord ? { name: d.newChord.name, roman: d.newChord.roman } : null,
      band: promptLevel,
    },
    bpm: d.bpm,
    bpmSource: 'prompt',
    sa: { name: d.keyName, scale: d.scale, western: d.western, source: 'prompt' },
  };
}

function newAudioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  // 48 kHz is the iPhone mic's own rate: a context at 44.1 kHz (e.g. with Bluetooth
  // output) made Safari resample the voice. 'balanced' gives the synth a bit more buffer.
  let ctx;
  try { ctx = new AC({ latencyHint: 'balanced', sampleRate: 48000 }); } catch {
    try { ctx = new AC({ latencyHint: 'balanced' }); } catch { ctx = new AC(); }
  }
  const b = ctx.createBuffer(1, 1, ctx.sampleRate); // unlock output on iOS inside the tap
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.connect(ctx.destination);
  src.start(0);
  ctx.resume?.().catch(() => {});
  return ctx;
}

function setPromptLine(target, main, sub) {
  target.replaceChildren(document.createTextNode(main));
  if (sub) target.append(el('small', '', sub));
}

// "D D A A" → "D ×2 – A ×2"
function compressBars(bars) {
  const out = [];
  for (const c of bars) {
    const last = out[out.length - 1];
    if (last && last.name === c.name) last.n++;
    else out.push({ name: c.name, n: 1 });
  }
  return out.map((x) => (x.n > 1 ? `${x.name} ×${x.n}` : x.name)).join(' – ');
}

function renderPromptCard() {
  const d = describePrompt(promptState.prompt);
  setPromptLine(els.prStyleV, d.genreName, d.genreParts);
  setPromptLine(els.prTempoV, `${d.bpm} BPM`);
  setPromptLine(els.prKeyV, d.keyName, d.scale === 'any' ? 'drone, no fixed scale' : `${d.scale}${d.western ? ` · ${d.western}` : ''}`);
  if (d.form === 'ab') {
    const [A, B] = d.sections;
    setPromptLine(els.prChordsV, `A: ${compressBars(A.bars)}`,
      `B: ${B.bars.map((c) => c.name).join(' ')} · new: ${d.newChord.name} (${d.newChord.roman}) · ${d.progressionName}`);
  } else {
    setPromptLine(els.prChordsV, compressBars(d.sections[0].bars), `${d.progressionName} · ${d.chords.map((c) => c.roman).join(' ')}`);
  }
  setPromptLine(els.prFeelV, `${d.meterName} · ${d.feelName}`);
  renderBandLine();
  setPromptLine(els.prFormV, d.formName, d.form === 'ab' ? 'A holds each chord 2 bars; B moves every bar and adds one chord' : 'the progression on repeat');
}

// How loud the band is in your ear and in the take; remembered between sessions.
let promptLevel = 'medium';
try { promptLevel = bandLevel(localStorage.getItem('promptLevel')).id; } catch {}
function renderBandLine() {
  setPromptLine(els.prBandV, bandLevel(promptLevel).name, 'how loud the band is in the take · phone volume only changes what you hear');
}
els.prBand.addEventListener('click', () => {
  const i = BAND_LEVELS.findIndex((l) => l.id === promptLevel);
  promptLevel = BAND_LEVELS[(i + 1) % BAND_LEVELS.length].id;
  try { localStorage.setItem('promptLevel', promptLevel); } catch {}
  renderBandLine();
  promptState.player?.setLevel(promptLevel);
});

let lastGenre = null;
try { lastGenre = localStorage.getItem('promptGenre'); } catch {}
function rememberGenre(g) {
  lastGenre = g;
  try { localStorage.setItem('promptGenre', g); } catch {}
}

function stopPreview() {
  promptState.player?.stop();
  promptState.player = null;
  try { promptState.ctx?.close(); } catch {}
  promptState.ctx = null;
  els.prListen.textContent = 'Listen';
}

function startPreview() {
  if (!promptState.ctx) promptState.ctx = newAudioContext();
  setAudioSession('playback');
  promptState.player = new PromptPlayer(promptState.ctx, promptState.prompt, { level: promptLevel }).connect(promptState.ctx.destination);
  promptState.player.start();
  els.prListen.textContent = 'Stop';
}

function changePrompt(next) {
  promptState.prompt = next;
  rememberGenre(next.genre);
  renderPromptCard();
  if (promptState.player) { // keep listening, now to the new prompt
    promptState.player.stop();
    startPreview();
  }
}

function openPrompt(params = null) {
  if (state.mode !== 'idle') return;
  stopPlayback();
  // A new prompt keeps the style you used last; "Use this prompt again" restores one exactly.
  promptState.prompt = params ? normalizePrompt(params) : randomPrompt(Math.random, promptState.prompt, { genre: lastGenre });
  renderPromptCard();
  els.prListen.textContent = 'Listen';
  openDialog(els.promptDlg);
}

function closePrompt() {
  stopPreview();
  setAudioSession('auto');
  if (els.promptDlg.open) closeDialog(els.promptDlg);
}

els.promptBtn.addEventListener('click', () => openPrompt());
els.prTempo.addEventListener('click', () => changePrompt(rerollPart(promptState.prompt, 'tempo')));
els.prKey.addEventListener('click', () => changePrompt(rerollPart(promptState.prompt, 'key')));
els.prChords.addEventListener('click', () => changePrompt(rerollPart(promptState.prompt, 'chords')));
els.prFeel.addEventListener('click', () => changePrompt(rerollPart(promptState.prompt, 'feel')));
els.prStyle.addEventListener('click', () => changePrompt(rerollPart(promptState.prompt, 'style')));
els.prForm.addEventListener('click', () => changePrompt(rerollPart(promptState.prompt, 'form')));
// Shuffle keeps the style; tap Style to change it.
els.prShuffle.addEventListener('click', () => changePrompt(randomPrompt(Math.random, promptState.prompt, { genre: promptState.prompt.genre })));
els.prListen.addEventListener('click', () => {
  if (promptState.player) stopPreview();
  else startPreview();
});
els.prClose.addEventListener('click', closePrompt);
els.promptDlg.addEventListener('cancel', () => stopPreview());
els.prRecord.addEventListener('click', () => {
  // Stop the preview but keep its (already unlocked) AudioContext for the recording;
  // the take starts cleanly at chord 1 after the count-in.
  const ctx = promptState.ctx || newAudioContext();
  promptState.player?.stop();
  promptState.ctx = null;
  promptState.player = null;
  closeDialog(els.promptDlg);
  startRecording({ prompt: promptState.prompt, ctx });
});

els.stopBtn.addEventListener('click', () => (state.mode === 'countin' ? cancelCountIn('Cancelled. Nothing was recorded') : stopRecording()));
els.recordBtn.addEventListener('click', () => startRecording());

// iOS stops the mic when the app leaves the screen: save what we have.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode === 'countin') { cancelCountIn(); return; }
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
          ...(s.prompt ? promptFields(s.prompt) : {}),
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
  tunes.filter(needsAnalysis).forEach((t) => queueAnalysis(t.id));
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
    // A bar (not a toast) so it stays until tapped and other messages can't replace it.
    let waitingWorker = null;
    els.updateBtn.addEventListener('click', () => {
      if (!waitingWorker) return;
      if (state.mode !== 'idle') { toast('Finish recording first'); return; }
      userAskedReload = true;
      els.updateBtn.disabled = true;
      els.updateBtn.textContent = 'Updating…';
      waitingWorker.postMessage('skipWaiting');
    });
    const offer = (worker) => {
      waitingWorker = worker;
      els.updateBar.hidden = false;
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
  tunes.filter(needsAnalysis).forEach((t) => queueAnalysis(t.id));
  if (isStandalone) requestPersist();
}

boot();

// Exposed for debugging in the console.
window.tuneNotebook = { state, db, analysisStats, promptState, get tunes() { return tunes; } };

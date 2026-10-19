// Prompt mode, the pure part: random prompts, 16-bar form, genres/feels, voicings,
// and the per-beat arrangement (eventsForBeat). No Web Audio here, so it is unit-tested
// in node. The sound is in instruments.js and the scheduler in prompt-player.js.

import { NOTE_NAMES } from './pitch.js';

// Chords: [semitones above Sa, quality ('' major, 'm' minor, '5' power), roman, bars (loop form)]
// mode picks the colour chords for section B; turn leads from bar 16 back to bar 1.
export const PROGRESSIONS = [
  { id: 'pop', name: 'Pop', scale: 'Bilaval', western: 'major', mode: 'major', chords: [[0, '', 'I'], [7, '', 'V'], [9, 'm', 'vi'], [5, '', 'IV']], turn: [7, '', 'V'] },
  { id: 'doowop', name: '50s', scale: 'Bilaval', western: 'major', mode: 'major', chords: [[0, '', 'I'], [9, 'm', 'vi'], [5, '', 'IV'], [7, '', 'V']], turn: [7, '', 'V'] },
  { id: 'folk', name: 'Folk', scale: 'Bilaval', western: 'major', mode: 'major', chords: [[0, '', 'I'], [5, '', 'IV'], [7, '', 'V'], [5, '', 'IV']], turn: [7, '', 'V'] },
  { id: 'sad-pop', name: 'Wistful', scale: 'Bilaval', western: 'major', mode: 'major', chords: [[9, 'm', 'vi'], [5, '', 'IV'], [0, '', 'I'], [7, '', 'V']], turn: [4, '', 'III'] },
  { id: 'two', name: 'Two-chord', scale: 'Bilaval', western: 'major', mode: 'major', chords: [[0, '', 'I', 2], [5, '', 'IV', 2]], turn: [7, '', 'V'] },
  { id: 'jazz', name: 'ii–V–I', scale: 'Bilaval', western: 'major', mode: 'major', chords: [[2, 'm', 'ii'], [7, '', 'V'], [0, '', 'I', 2]], turn: [9, '', 'VI'] },
  { id: 'khamaj', name: 'Mixolydian', scale: 'Khamaj', western: 'Mixolydian', mode: 'major', chords: [[0, '', 'I'], [10, '', '♭VII'], [5, '', 'IV'], [0, '', 'I']], turn: [10, '', '♭VII'] },
  { id: 'epic', name: 'Epic minor', scale: 'Asavari', western: 'natural minor', mode: 'minor', chords: [[0, 'm', 'i'], [8, '', '♭VI'], [3, '', '♭III'], [10, '', '♭VII']], turn: [10, '', '♭VII'] },
  { id: 'rock-minor', name: 'Minor rock', scale: 'Asavari', western: 'natural minor', mode: 'minor', chords: [[0, 'm', 'i'], [10, '', '♭VII'], [8, '', '♭VI'], [10, '', '♭VII']], turn: [7, '', 'V'] },
  { id: 'minor-iv', name: 'Minor folk', scale: 'Asavari', western: 'natural minor', mode: 'minor', chords: [[0, 'm', 'i'], [5, 'm', 'iv'], [7, 'm', 'v'], [0, 'm', 'i']], turn: [7, '', 'V'] },
  { id: 'andalusian', name: 'Andalusian', scale: 'Asavari + major V', western: 'Phrygian dominant', mode: 'minor', chords: [[0, 'm', 'i'], [10, '', '♭VII'], [8, '', '♭VI'], [7, '', 'V']], turn: [7, '', 'V'] },
  { id: 'kafi', name: 'Dorian vamp', scale: 'Kafi', western: 'Dorian', mode: 'minor', chords: [[0, 'm', 'i', 2], [5, '', 'IV', 2]], turn: [10, '', '♭VII'] },
  { id: 'bhairavi', name: 'Bhairavi colour', scale: 'Bhairavi', western: 'Phrygian', mode: 'minor', chords: [[0, 'm', 'i'], [1, '', '♭II'], [10, 'm', '♭vii'], [0, 'm', 'i']], turn: [1, '', '♭II'] },
  { id: 'drone', name: 'Sa–Pa drone', scale: 'any', western: 'open fifth', mode: 'drone', chords: [[0, '5', 'I5', 2], [0, '5', 'I5', 2]], turn: [10, '5', '♭VII5'] },
];

// The "one more chord" section B introduces, by mode.
export const COLOURS = {
  major: [[2, 'm', 'ii'], [4, 'm', 'iii'], [9, 'm', 'vi'], [5, '', 'IV'], [10, '', '♭VII'], [5, 'm', 'iv'], [2, '', 'II'], [8, '', '♭VI']],
  minor: [[5, 'm', 'iv'], [8, '', '♭VI'], [3, '', '♭III'], [10, '', '♭VII'], [7, 'm', 'v'], [1, '', '♭II'], [5, '', 'IV'], [7, '', 'V']],
  drone: [[5, '5', 'IV5'], [7, '5', 'V5'], [3, '5', '♭III5'], [10, '5', '♭VII5']],
};

// gain evens out loudness between a lone guitar and a full band; mix nudges one part
// (both from measuring each part alone).
export const GENRES = [
  { id: 'acoustic', name: 'Acoustic', parts: 'acoustic guitar', bpm: [70, 126], click: true, gain: 2 },
  { id: 'pop', name: 'Pop', parts: 'guitar, bass, drums', bpm: [84, 124], click: false, mix: { chords: 1.6 } },
  { id: 'rock', name: 'Rock', parts: 'overdriven guitar, bass, drums', bpm: [92, 140], click: false, guitar: 'drive', power: true },
  { id: 'synthpop', name: 'Synth pop', parts: 'pad, arpeggio, synth bass, drum machine', bpm: [96, 128], click: false, bassKind: 'synth' },
  { id: 'ballad', name: 'Ballad', parts: 'guitar, pad, bass', bpm: [60, 86], click: true, gain: 1.25 },
];

// A feel bundles the patterns every part plays for one genre and meter.
export const FEELS = [
  { id: 'ring', genre: 'acoustic', meter: 4, name: 'Let it ring', guitar: 'ring' },
  { id: 'steady', genre: 'acoustic', meter: 4, name: 'Steady strum', guitar: 'quarter' },
  { id: 'folk', genre: 'acoustic', meter: 4, name: 'Folk strum', guitar: 'folk' },
  { id: 'synco', genre: 'acoustic', meter: 4, name: 'Syncopated strum', guitar: 'synco' },
  { id: 'island', genre: 'acoustic', meter: 4, name: 'Island offbeat', guitar: 'island', drums: 'shaker' },
  { id: 'picked', genre: 'acoustic', meter: 4, name: 'Fingerpicked', guitar: 'arp' },
  { id: 'travis', genre: 'acoustic', meter: 4, name: 'Travis picking', guitar: 'travis' },
  { id: 'waltz', genre: 'acoustic', meter: 3, name: 'Waltz', guitar: 'waltz' },
  { id: 'steady3', genre: 'acoustic', meter: 3, name: 'Steady strum', guitar: 'quarter3' },
  { id: 'folk3', genre: 'acoustic', meter: 3, name: 'Folk 3/4 strum', guitar: 'folk3' },
  { id: 'picked3', genre: 'acoustic', meter: 3, name: 'Fingerpicked', guitar: 'arp3' },
  { id: 'pop-synco', genre: 'pop', meter: 4, name: 'Syncopated pop', guitar: 'synco', bass: 'pop', drums: 'pop' },
  { id: 'pop-drive', genre: 'pop', meter: 4, name: 'Driving 8ths', guitar: 'folk', bass: 'eighths', drums: 'pop8' },
  { id: 'pop-half', genre: 'pop', meter: 4, name: 'Half-time', guitar: 'ring', bass: 'roots', drums: 'halftime' },
  { id: 'pop-skank', genre: 'pop', meter: 4, name: 'Offbeat skank', guitar: 'island', bass: 'rootfive', drums: 'pop' },
  { id: 'rock-8', genre: 'rock', meter: 4, name: 'Palm-muted 8ths', guitar: 'rock8', bass: 'eighths', drums: 'rock' },
  { id: 'rock-open', genre: 'rock', meter: 4, name: 'Big open chords', guitar: 'rockring', bass: 'roots', drums: 'rock' },
  { id: 'rock-gallop', genre: 'rock', meter: 4, name: 'Gallop', guitar: 'gallop', bass: 'gallop', drums: 'rock' },
  { id: 'synth-16', genre: 'synthpop', meter: 4, name: '16th arpeggio', arp: 'up16', pad: true, bass: 'synth8', drums: 'synth' },
  { id: 'synth-floor', genre: 'synthpop', meter: 4, name: 'Four on the floor', arp: 'pulse8', pad: true, bass: 'synth8', drums: 'floor' },
  { id: 'synth-dream', genre: 'synthpop', meter: 4, name: 'Dreamy', arp: 'updown8', pad: true, bass: 'whole', drums: 'lite' },
  { id: 'ballad-pick', genre: 'ballad', meter: 4, name: 'Fingerpicked', guitar: 'arp', pad: true, bass: 'whole' },
  { id: 'ballad-ring', genre: 'ballad', meter: 4, name: 'Let it ring', guitar: 'ring', pad: true, bass: 'roots' },
  { id: 'ballad-waltz', genre: 'ballad', meter: 3, name: 'Waltz', guitar: 'arp3', pad: true, bass: 'whole' },
];

// Guitar patterns: at = beat within the bar; strings low→high ('all', 'upper', 'top', 'bass',
// 'alt' or a string number); dir D/U for strums; mute = seconds before the chord is choked.
const pick8 = (list) => list.map(([at, s, vel]) => ({ at, type: 'pick', strings: s, vel: vel ?? (at % 1 === 0 ? 0.9 : 0.6) }));
export const GUITAR = {
  ring: [{ at: 0, type: 'strum', dir: 'D', strings: 'all', vel: 1 }],
  quarter: [0, 1, 2, 3].map((b) => ({ at: b, type: 'strum', dir: 'D', strings: b ? 'upper' : 'all', vel: b ? 0.7 : 1 })),
  folk: [
    { at: 0, type: 'strum', dir: 'D', strings: 'all', vel: 1 }, { at: 1, type: 'strum', dir: 'D', strings: 'upper', vel: 0.75 },
    { at: 1.5, type: 'strum', dir: 'U', strings: 'top', vel: 0.55 }, { at: 2.5, type: 'strum', dir: 'U', strings: 'top', vel: 0.55 },
    { at: 3, type: 'strum', dir: 'D', strings: 'upper', vel: 0.75 }, { at: 3.5, type: 'strum', dir: 'U', strings: 'top', vel: 0.55 },
  ],
  synco: [
    { at: 0, type: 'strum', dir: 'D', strings: 'all', vel: 1 }, { at: 1.5, type: 'strum', dir: 'D', strings: 'upper', vel: 0.75 },
    { at: 2.5, type: 'strum', dir: 'U', strings: 'top', vel: 0.55 }, { at: 3, type: 'strum', dir: 'D', strings: 'upper', vel: 0.7 },
    { at: 3.5, type: 'strum', dir: 'U', strings: 'top', vel: 0.55 },
  ],
  island: [0.5, 1.5, 2.5, 3.5].map((at) => ({ at, type: 'strum', dir: 'U', strings: 'upper', vel: 0.75, mute: 0.12 })),
  arp: pick8([[0, 'bass'], [0.5, 2], [1, 3], [1.5, 4], [2, 'alt'], [2.5, 2], [3, 3], [3.5, 4]]),
  travis: pick8([[0, 'bass', 0.9], [0, 4, 0.6], [1, 'alt', 0.8], [1.5, 3, 0.55], [2, 'bass', 0.85], [2.5, 4, 0.6], [3, 'alt', 0.8], [3.5, 3, 0.55]]),
  waltz: [{ at: 0, type: 'pick', strings: 'bass', vel: 1 },
    { at: 1, type: 'strum', dir: 'D', strings: 'upper', vel: 0.6 }, { at: 2, type: 'strum', dir: 'D', strings: 'upper', vel: 0.6 }],
  quarter3: [0, 1, 2].map((b) => ({ at: b, type: 'strum', dir: 'D', strings: b ? 'upper' : 'all', vel: b ? 0.7 : 1 })),
  folk3: [{ at: 0, type: 'pick', strings: 'bass', vel: 1 }, { at: 1, type: 'strum', dir: 'D', strings: 'upper', vel: 0.7 },
    { at: 1.5, type: 'strum', dir: 'U', strings: 'top', vel: 0.5 }, { at: 2, type: 'strum', dir: 'D', strings: 'upper', vel: 0.7 },
    { at: 2.5, type: 'strum', dir: 'U', strings: 'top', vel: 0.5 }],
  arp3: pick8([[0, 'bass', 1], [0.5, 2], [1, 3], [1.5, 4], [2, 3], [2.5, 2]]),
  rock8: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((at) => ({ at, type: 'strum', dir: 'D', strings: 'all', vel: at % 1 ? 0.7 : 0.95, mute: 0.11 })),
  rockring: [{ at: 0, type: 'strum', dir: 'D', strings: 'all', vel: 1 }, { at: 2.5, type: 'strum', dir: 'D', strings: 'all', vel: 0.85 },
    { at: 3.5, type: 'strum', dir: 'D', strings: 'all', vel: 0.7, mute: 0.2 }],
  gallop: [0, 1, 2, 3].flatMap((b) => [
    { at: b, type: 'strum', dir: 'D', strings: 'all', vel: 0.95, mute: 0.12 },
    { at: b + 0.5, type: 'strum', dir: 'D', strings: 'all', vel: 0.7, mute: 0.08 },
    { at: b + 0.75, type: 'strum', dir: 'D', strings: 'all', vel: 0.7, mute: 0.08 },
  ]),
};

// Bass: n = R root, 5 fifth, 8 octave, A approach (a semitone below the next bar's root). dur in beats.
export const BASS = {
  whole: (meter) => [{ at: 0, n: 'R', dur: meter - 0.1 }],
  roots: (meter) => (meter === 4 ? [{ at: 0, n: 'R', dur: 1.9 }, { at: 2, n: 'R', dur: 1.9 }] : [{ at: 0, n: 'R', dur: 2.9 }]),
  rootfive: () => [{ at: 0, n: 'R', dur: 1.8 }, { at: 2, n: '5', dur: 1.8 }],
  eighths: () => [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((at) => ({ at, n: 'R', dur: 0.42 })),
  pop: () => [{ at: 0, n: 'R', dur: 1.4 }, { at: 1.5, n: 'R', dur: 0.4 }, { at: 2, n: 'R', dur: 0.9 }, { at: 3, n: '8', dur: 0.45 }, { at: 3.5, n: 'A', dur: 0.45 }],
  synth8: () => [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((at, i) => ({ at, n: i % 2 ? '8' : 'R', dur: 0.38 })),
  gallop: () => [0, 1, 2, 3].flatMap((b) => [{ at: b, n: 'R', dur: 0.4 }, { at: b + 0.5, n: 'R', dur: 0.2 }, { at: b + 0.75, n: 'R', dur: 0.2 }]),
};

// Drums: one character per 16th in a 4/4 bar.
export const DRUMS = {
  rock: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
  pop: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
  pop8: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx' },
  halftime: { kick: 'x.........x.....', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.' },
  synth: { kick: 'x.......x.......', clap: '....x.......x...', hat: 'xx.xxx.xxx.xxx.x', ohat: '..x...x...x...x.' },
  floor: { kick: 'x...x...x...x...', clap: '....x.......x...', hat: 'x...x...x...x...', ohat: '..x...x...x...x.' },
  lite: { kick: 'x.........x.....', clap: '........x.......', hat: '..x...x...x...x.' },
  shaker: { shaker: 'x.xxx.xxx.xxx.xx' },
};

// Arpeggio: one tone index (0 root, 1 third, 2 fifth, 3 octave) per step.
export const ARP = {
  up16: { step: 0.25, tones: [0, 1, 2, 3] },
  pulse8: { step: 0.5, tones: [0, 0, 3, 0, 0, 3, 0, 3] },
  updown8: { step: 0.5, tones: [0, 1, 2, 3, 2, 1, 0, 1] },
};

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];
const genreOf = (id) => GENRES.find((g) => g.id === id) || GENRES[0];
const feelsOf = (genre) => FEELS.filter((f) => f.genre === genre);
const randBpm = (genre, rand) => genre.bpm[0] + Math.floor(rand() * (genre.bpm[1] - genre.bpm[0] + 1));

// Prompts saved before v1.4 had {bpm, meter, keyPc, progressionId, styleId}: map them
// to the acoustic genre and the 4-bar loop they were recorded with.
const OLD_STYLE = { ring: 'ring', quarter: 'steady', folk: 'folk', arp: 'picked', waltz: 'waltz', quarter3: 'steady3', arp3: 'picked3' };
export function normalizePrompt(p) {
  const n = { ...p };
  if (!n.genre) {
    n.genre = 'acoustic';
    n.feelId = OLD_STYLE[n.styleId] || (n.meter === 3 ? 'waltz' : 'ring');
    n.form = 'loop';
    n.colour = 0;
  }
  const feel = FEELS.find((f) => f.id === n.feelId && f.genre === n.genre) || feelsOf(n.genre)[0];
  n.feelId = feel.id;
  n.meter = feel.meter;
  n.form = n.form === 'loop' ? 'loop' : 'ab';
  n.colour = n.colour || 0;
  delete n.styleId;
  return n;
}

export function randomPrompt(rand = Math.random, prev = null, { genre = null } = {}) {
  const g = genre ? genreOf(genre) : pick(GENRES, rand);
  const feel = pick(feelsOf(g.id), rand);
  let progressionId;
  do progressionId = pick(PROGRESSIONS, rand).id;
  while (prev && prev.progressionId === progressionId);
  return {
    v: 2, bpm: randBpm(g, rand), meter: feel.meter, keyPc: Math.floor(rand() * 12), progressionId,
    genre: g.id, feelId: feel.id, form: 'ab', colour: Math.floor(rand() * 8),
  };
}

// Change one part. Tempo/key/chords re-roll at random; style and feel step through
// the list so you can browse them; form toggles 16-bar ↔ 4-bar loop.
export function rerollPart(p0, part, rand = Math.random) {
  const p = normalizePrompt(p0);
  const n = { ...p };
  const g = genreOf(p.genre);
  if (part === 'tempo') {
    for (let i = 0; i < 20 && Math.abs(n.bpm - p.bpm) < 6; i++) n.bpm = randBpm(g, rand);
  } else if (part === 'key') {
    do n.keyPc = Math.floor(rand() * 12); while (n.keyPc === p.keyPc);
  } else if (part === 'chords') {
    do n.progressionId = pick(PROGRESSIONS, rand).id; while (n.progressionId === p.progressionId);
    n.colour = Math.floor(rand() * 8);
  } else if (part === 'feel') {
    const list = feelsOf(p.genre);
    const next = list[(list.findIndex((f) => f.id === p.feelId) + 1) % list.length];
    n.feelId = next.id;
    n.meter = next.meter;
  } else if (part === 'style') {
    const ng = GENRES[(GENRES.findIndex((x) => x.id === p.genre) + 1) % GENRES.length];
    const list = feelsOf(ng.id);
    const feel = list.find((f) => f.meter === p.meter) || list[0];
    n.genre = ng.id;
    n.feelId = feel.id;
    n.meter = feel.meter;
    if (n.bpm < ng.bpm[0] || n.bpm > ng.bpm[1]) n.bpm = randBpm(ng, rand);
  } else if (part === 'form') {
    n.form = p.form === 'ab' ? 'loop' : 'ab';
  }
  return n;
}

export function chordName(rootPc, quality) {
  return NOTE_NAMES[((rootPc % 12) + 12) % 12] + quality;
}

function chordObj(keyPc, [deg, q, roman], isNew = false) {
  const rootPc = (keyPc + deg) % 12;
  return { rootPc, quality: q, roman, name: chordName(rootPc, q), key: `${rootPc}${q}`, isNew };
}

// The form: 'ab' = A (8 bars, each chord held 2 bars) + B (8 bars, a chord per bar, a new
// colour chord at bar 7, a turnaround at bar 8). 'loop' = the progression as written.
export function buildForm(prog, keyPc, form, colour = 0) {
  if (form === 'loop') {
    const bars = prog.chords.flatMap((c) => Array(c[3] || 1).fill(chordObj(keyPc, c)));
    return { sections: [{ name: 'Loop', bars }], newChord: null };
  }
  const U = [];
  for (const c of prog.chords) {
    const last = U[U.length - 1];
    if (!last || last[0] !== c[0] || last[1] !== c[1]) U.push(c);
  }
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const candidates = COLOURS[prog.mode].filter((c) => !U.some((u) => same(u, c)) && !same(c, prog.turn));
  const colourSpec = candidates[colour % candidates.length];
  let A;
  if (U.length === 1) A = Array(8).fill(U[0]);
  else if (U.length === 2) A = [U[0], U[0], U[1], U[1], U[0], U[0], U[1], U[1]];
  else if (U.length === 3) A = [U[0], U[0], U[1], U[1], U[2], U[2], U[2], U[2]];
  else A = U.slice(0, 4).flatMap((c) => [c, c]);
  const B = U.length === 1
    ? [U[0], U[0], colourSpec, colourSpec, U[0], U[0], colourSpec, prog.turn]
    : [...Array.from({ length: 6 }, (_, i) => U[i % U.length]), colourSpec, prog.turn];
  const newChord = chordObj(keyPc, colourSpec, true);
  return {
    sections: [
      { name: 'A', bars: A.map((c) => chordObj(keyPc, c)) },
      { name: 'B', bars: B.map((c) => (c === colourSpec ? newChord : chordObj(keyPc, c))) },
    ],
    newChord,
  };
}

// Everything the UI and the saved tune need to show, derived from the prompt.
export function describePrompt(p0) {
  const p = normalizePrompt(p0);
  const prog = PROGRESSIONS.find((x) => x.id === p.progressionId) || PROGRESSIONS[0];
  const genre = genreOf(p.genre);
  const feel = FEELS.find((f) => f.id === p.feelId);
  const { sections, newChord } = buildForm(prog, p.keyPc, p.form, p.colour);
  const chords = [];
  for (const s of sections) for (const c of s.bars) if (!chords.some((x) => x.key === c.key)) chords.push(c);
  return {
    bpm: p.bpm, meter: p.meter, meterName: `${p.meter}/4`, keyName: NOTE_NAMES[p.keyPc],
    progressionName: prog.name, scale: prog.scale, western: prog.western,
    genreName: genre.name, genreParts: genre.parts, feelName: feel.name, styleName: feel.name,
    form: p.form, formName: p.form === 'ab' ? '16 bars: A + B' : `${sections[0].bars.length}-bar loop`,
    sections, chords, newChord, bars: sections.reduce((s, x) => s + x.bars.length, 0),
  };
}

// Guitar-like voicing: E-shape barre for roots E–G#, A-shape for A–D#. MIDI notes, bass first.
export function voiceChord(rootPc, quality) {
  const eString = (rootPc - 4 + 12) % 12;
  const shapes = {
    E: { '': [0, 7, 12, 16, 19, 24], m: [0, 7, 12, 15, 19, 24], 5: [0, 7, 12] },
    A: { '': [0, 7, 12, 16, 19], m: [0, 7, 12, 15, 19], 5: [0, 7, 12] },
  };
  if (eString <= 4) return shapes.E[quality].map((o) => 40 + eString + o);
  const aString = (rootPc - 9 + 12) % 12;
  return shapes.A[quality].map((o) => 45 + aString + o);
}

// Pad: close triad from G3–F#4; arpeggio tones an octave above it.
export function padVoicing(rootPc, quality) {
  const r = 55 + ((rootPc - 7 + 12) % 12);
  const third = quality === 'm' ? 3 : 4;
  return quality === '5' ? [r, r + 7, r + 12] : [r, r + third, r + 7];
}
export function arpTones(rootPc, quality) {
  const [a, b, c] = padVoicing(rootPc, quality);
  return [a + 12, b + 12, c + 12, a + 24];
}
// Bass roots sit in E1–D#2.
export const bassRoot = (rootPc) => 28 + ((rootPc - 4 + 12) % 12);

export function stringsFor(spec, voicing) {
  const n = voicing.length;
  if (spec === 'all') return [...voicing.keys()];
  if (spec === 'upper') return [...voicing.keys()].slice(Math.max(1, n - 4));
  if (spec === 'top') return [...voicing.keys()].slice(n - 3);
  if (spec === 'bass') return [0];
  if (spec === 'alt') return [Math.min(1, n - 1)]; // alternating bass (the fifth)
  return [Math.min(spec, n - 1)]; // a numbered string, clamped for 3-note power chords
}

// The arrangement, resolved once per prompt.
export function buildPlan(params) {
  const p = normalizePrompt(params);
  const d = describePrompt(p);
  const genre = genreOf(p.genre);
  const feel = FEELS.find((f) => f.id === p.feelId);
  const bars = d.sections.flatMap((sec, si) => sec.bars.map((chord, i) => ({
    chord, section: sec.name, sectionIdx: si, barInSection: i, sectionLen: sec.bars.length,
  })));
  return {
    p, d, genre, feel, bars, meter: p.meter, form: p.form,
    guitar: feel.guitar ? GUITAR[feel.guitar] : null,
    guitarKind: genre.guitar || 'clean',
    power: !!genre.power,
    bass: feel.bass ? BASS[feel.bass](p.meter) : null,
    bassKind: genre.bassKind || 'finger',
    drums: feel.drums ? DRUMS[feel.drums] : null,
    arp: feel.arp ? ARP[feel.arp] : null,
    pad: !!feel.pad,
    click: genre.click,
  };
}

export function partsOf(plan) {
  return { drums: !!plan.drums, bass: !!plan.bass, chords: !!(plan.guitar || plan.pad || plan.arp) };
}

// All notes for one beat of the groove (b counts from bar 1, beat 1; count-in excluded).
// at is in beats from the start of this beat. Pure, so the arrangement is unit-tested.
export function eventsForBeat(plan, b) {
  const { meter, bars } = plan;
  const barNo = Math.floor(b / meter);
  const beat = b % meter;
  const idx = barNo % bars.length;
  const bar = bars[idx];
  const next = bars[(idx + 1) % bars.length];
  const prev = bars[(idx - 1 + bars.length) % bars.length];
  const { chord } = bar;
  const ev = [{ inst: 'click', at: 0, accent: beat === 0 }];
  const changed = beat === 0 && (barNo === 0 || prev.chord.key !== chord.key);

  if (plan.guitar) {
    if (changed) ev.push({ inst: 'damp', at: 0 });
    const voicing = voiceChord(chord.rootPc, plan.power ? '5' : chord.quality);
    for (const e of plan.guitar) {
      if (Math.floor(e.at) !== beat) continue;
      const strings = stringsFor(e.strings, voicing);
      const order = e.dir === 'U' ? [...strings].reverse() : strings;
      order.forEach((s, k) => {
        const strumSec = e.type === 'strum' ? k * (e.dir === 'U' ? 0.008 : 0.012) : 0;
        ev.push({
          inst: 'guitar', at: e.at - beat, delaySec: strumSec, string: s, midi: voicing[s],
          vel: e.vel * (e.dir === 'U' ? 0.8 : 1) * (1 - k * 0.04), mute: e.mute || 0,
        });
      });
    }
  }

  if (plan.bass) {
    const root = bassRoot(chord.rootPc);
    for (const e of plan.bass) {
      if (Math.floor(e.at) !== beat) continue;
      const midi = e.n === 'R' ? root
        : e.n === '5' ? root + 7
        : e.n === '8' ? root + 12
        : bassRoot(next.chord.rootPc) - 1; // 'A': approach the next root from a semitone below
      ev.push({ inst: 'bass', at: e.at - beat, midi, dur: e.dur, vel: e.at % 1 ? 0.7 : 0.95 });
    }
  }

  if (plan.pad && changed) {
    let run = 1;
    while (run < bars.length && bars[(idx + run) % bars.length].chord.key === chord.key) run++;
    ev.push({ inst: 'pad', at: 0, midis: padVoicing(chord.rootPc, chord.quality), dur: run * meter });
  }

  if (plan.arp) {
    const tones = arpTones(chord.rootPc, chord.quality);
    const perBeat = Math.round(1 / plan.arp.step);
    for (let k = 0; k < perBeat; k++) {
      const stepNo = beat * perBeat + k;
      const tone = tones[plan.arp.tones[stepNo % plan.arp.tones.length]];
      ev.push({ inst: 'arp', at: k * plan.arp.step, midi: tone, dur: plan.arp.step * 0.9, vel: k === 0 ? 0.9 : 0.65 });
    }
  }

  if (plan.drums) {
    const d = plan.drums;
    const real = !!(d.kick || d.snare || d.clap);
    const lastBar = bar.barInSection === bar.sectionLen - 1 && (plan.form === 'ab' || bar.sectionLen >= 4);
    const fill = real && lastBar && beat === meter - 1;
    if (real && bar.barInSection === 0 && beat === 0) ev.push({ inst: 'crash', at: 0, vel: 0.8 });
    for (let k = 0; k < 4; k++) {
      const step = beat * 4 + k;
      const at = k * 0.25;
      if (fill) {
        if (k === 0 && d.kick?.[step] === 'x') ev.push({ inst: 'kick', at, vel: 0.9 });
        ev.push({ inst: 'snare', at, vel: 0.45 + k * 0.15 });
        continue;
      }
      const on = (lane) => d[lane]?.[step] === 'x';
      if (on('kick')) ev.push({ inst: 'kick', at, vel: k === 0 ? 1 : 0.85 });
      if (on('snare')) ev.push({ inst: 'snare', at, vel: 0.9 });
      if (on('clap')) ev.push({ inst: 'clap', at, vel: 0.85 });
      if (on('ohat')) ev.push({ inst: 'ohat', at, vel: 0.55 });
      if (on('shaker')) ev.push({ inst: 'shaker', at, vel: k === 0 ? 0.8 : 0.5 });
      if (on('hat')) ev.push({ inst: 'hat', at, vel: k === 0 ? 0.7 : 0.5 });
      // Section B lifts: 8th-note hats become 16ths.
      else if (d.hat && bar.section === 'B' && k % 2 === 1 && !on('ohat')) ev.push({ inst: 'hat', at, vel: 0.35 });
    }
  }
  return ev;
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

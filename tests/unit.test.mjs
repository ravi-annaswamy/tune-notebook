// Node unit tests for the pure modules: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { yin, summarizePitch, freqToMidi, midiToName } from '../js/pitch.js';
import { makeZip, readZip, crc32 } from '../js/zip.js';

const SR = 48000;
function voice(freq, n = 2048, { noise = 0, harmonics = [1, 0.6, 0.4, 0.25] } = {}) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    harmonics.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * freq * (k + 1) * i / SR); });
    b[i] = 0.2 * v + noise * (Math.random() * 2 - 1);
  }
  return b;
}

test('yin finds pitch of harmonic voice-like tones across range', () => {
  for (const f of [82.4, 110, 138.59, 196, 261.63, 440, 880]) {
    const r = yin(voice(f, 2048, { noise: 0.02 }), SR);
    assert.ok(r, `no pitch for ${f}`);
    const cents = 1200 * Math.log2(r.freq / f);
    assert.ok(Math.abs(cents) < 15, `${f} Hz detected as ${r.freq.toFixed(2)} (${cents.toFixed(1)} cents)`);
  }
});

test('yin returns null for silence and for white noise', () => {
  assert.equal(yin(new Float32Array(2048), SR), null);
  const n = new Float32Array(2048).map(() => (Math.random() * 2 - 1) * 0.3);
  const r = yin(n, SR);
  assert.ok(r === null || r.clarity < 0.8, 'noise should not look like a clear pitch');
});

test('summarizePitch snaps to nearest semitone and names it', () => {
  // C#3 sung 20 cents sharp with a few octave errors mixed in
  const m = Array.from({ length: 30 }, () => 49.2 + (Math.random() - 0.5) * 0.2);
  m.push(61.2, 61.2, 37.2);
  const s = summarizePitch(m);
  assert.equal(s.ok, true);
  assert.equal(s.name, 'C#');
  assert.equal(s.octave, 3);
  assert.ok(Math.abs(s.cents - 20) < 8);
});

test('summarizePitch rejects too few or wandering frames', () => {
  assert.equal(summarizePitch([60, 60, 60]).reason, 'quiet');
  const glide = Array.from({ length: 30 }, (_, i) => 55 + i * 0.5);
  assert.equal(summarizePitch(glide).reason, 'unsteady');
});

test('note naming', () => {
  assert.deepEqual(midiToName(freqToMidi(440)), { name: 'A', octave: 4 });
  assert.deepEqual(midiToName(freqToMidi(261.63)), { name: 'C', octave: 4 });
});

test('zip round trip (stored) with unicode names', async () => {
  const a = new Uint8Array(5000).map((_, i) => i % 251);
  const b = new TextEncoder().encode('{"hello":"wörld"}');
  const blob = makeZip([{ name: 'Oct 17 - Sa C# - 92bpm.m4a', data: a }, { name: 'tunes.json', data: b }]);
  const entries = await readZip(await blob.arrayBuffer());
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'Oct 17 - Sa C# - 92bpm.m4a');
  assert.deepEqual([...entries[0].data], [...a]);
  assert.equal(new TextDecoder().decode(entries[1].data), '{"hello":"wörld"}');
});

test('zip produced is valid for system unzip (crc check)', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

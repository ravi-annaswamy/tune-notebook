// Fragmented MP4 -> plain M4A remux (js/mp4.js), on a synthetic file shaped
// like MediaRecorder('audio/mp4') output: empty sample table, mvex/trex, then
// moof+mdat pairs whose tfhd uses default-base-is-moof and trun gives sizes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defragmentMp4 } from '../js/mp4.js';

const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const u32 = (...v) => { const b = new Uint8Array(v.length * 4); v.forEach((x, k) => new DataView(b.buffer).setInt32(k * 4, x)); return b; };
const ascii = (s) => new TextEncoder().encode(s);
const box = (type, ...parts) => { const body = cat(...parts); return cat(u32(8 + body.length), ascii(type), body); };

const PRIMING = 2112;
function fragmentedFile(fragments) {
  const stbl = box('stbl', box('stsd', u32(0, 1), box('mp4a', new Uint8Array(28))),
    box('stts', u32(0, 0)), box('stsc', u32(0, 0)), box('stsz', u32(0, 0, 0)), box('stco', u32(0, 0)));
  const trak = box('trak',
    box('tkhd', u32(0x00000001, 0, 0, 1, 0, 0), new Uint8Array(60)),
    box('edts', box('elst', u32(0, 1, 0, PRIMING, 0x00010000))),
    box('mdia', box('mdhd', u32(0, 0, 0, 48000, 0, 0)), box('hdlr', u32(0, 0), ascii('soun'), new Uint8Array(13)),
      box('minf', box('smhd', u32(0, 0)), stbl)));
  const moov = box('moov', box('mvhd', u32(0, 0, 0, 600, 0), new Uint8Array(80)), trak,
    box('mvex', box('trex', u32(0, 1, 1, 0, 0, 0))));
  let file = cat(box('ftyp', ascii('iso5'), u32(1), ascii('isomiso5hlsfcmfc')), moov);
  let n = 0;
  for (const sizes of fragments) {
    const payload = cat(...sizes.map((s) => new Uint8Array(s).fill(n++ & 0xff)));
    const build = (dataOffset) => box('moof', box('mfhd', u32(0, 1)),
      box('traf', box('tfhd', u32(0x020018, 1, 1024, 0)), box('tfdt', u32(0x01000000, 0, 0)),
        box('trun', u32(0x000201, sizes.length, dataOffset, ...sizes))));
    const moofLen = build(0).length;
    file = cat(file, build(moofLen + 8), box('mdat', payload));
  }
  return file;
}

function boxes(u8, start = 0, end = u8.length) {
  const dv = new DataView(u8.buffer, u8.byteOffset);
  const out = {};
  for (let i = start; i < end;) {
    const size = dv.getUint32(i);
    const type = new TextDecoder().decode(u8.subarray(i + 4, i + 8));
    (out[type] ||= []).push({ at: i, body: i + 8, end: i + size });
    i += size;
  }
  return out;
}
const child = (u8, b, ...path) => path.reduce((cur, t) => boxes(u8, cur.body, cur.end)[t][0], b);

test('defragmentMp4 rebuilds a plain M4A with every packet, in order', () => {
  const fragments = [[5, 7, 6], [9, 4], [8]];
  const input = fragmentedFile(fragments);
  const out = defragmentMp4(input);
  const dv = new DataView(out.buffer);
  const top = boxes(out);
  assert.deepEqual(Object.keys(top), ['ftyp', 'moov', 'mdat']);
  assert.equal(new TextDecoder().decode(out.subarray(8, 12)), 'M4A ');

  const moov = top.moov[0];
  assert.ok(!boxes(out, moov.body, moov.end).mvex, 'mvex removed');
  const stbl = child(out, moov, 'trak', 'mdia', 'minf', 'stbl');
  const sizes = fragments.flat();
  const stsz = boxes(out, stbl.body, stbl.end).stsz[0];
  assert.equal(dv.getUint32(stsz.body + 8), sizes.length);
  assert.deepEqual(sizes.map((_, k) => dv.getUint32(stsz.body + 12 + k * 4)), sizes);
  const stts = boxes(out, stbl.body, stbl.end).stts[0];
  assert.deepEqual([dv.getUint32(stts.body + 4), dv.getUint32(stts.body + 8), dv.getUint32(stts.body + 12)], [1, sizes.length, 1024]);

  // One chunk; its offset points at packet 0, and packets keep their fill byte.
  const stco = boxes(out, stbl.body, stbl.end).stco[0];
  let p = dv.getUint32(stco.body + 8);
  assert.equal(p, top.mdat[0].body);
  sizes.forEach((s, k) => {
    assert.ok(out.subarray(p, p + s).every((b) => b === k), `packet ${k}`);
    p += s;
  });
  assert.equal(p, out.length);

  // Durations: media in 48 kHz, movie and edit list in 600 ths, minus priming.
  const total = sizes.length * 1024;
  const mdhd = child(out, moov, 'trak', 'mdia', 'mdhd');
  assert.equal(dv.getUint32(mdhd.body + 16), total);
  const movie = Math.round(((total - PRIMING) * 600) / 48000);
  assert.equal(dv.getUint32(moov.body + 8 + 16), movie);
  const elst = child(out, moov, 'trak', 'edts', 'elst');
  assert.equal(dv.getUint32(elst.body + 8), movie);
  assert.equal(dv.getInt32(elst.body + 12), PRIMING);
});

test('defragmentMp4 splits long takes into 64-packet chunks', () => {
  const input = fragmentedFile([new Array(100).fill(3), new Array(50).fill(2)]);
  const out = defragmentMp4(input);
  const dv = new DataView(out.buffer);
  const stbl = child(out, boxes(out).moov[0], 'trak', 'mdia', 'minf', 'stbl');
  const b = boxes(out, stbl.body, stbl.end);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((k) => dv.getUint32(b.stsc[0].body + 4 * k)), [2, 1, 64, 1, 3, 22, 1]);
  const offs = [0, 1, 2].map((k) => dv.getUint32(b.stco[0].body + 8 + 4 * k));
  assert.deepEqual(offs.map((o) => o - offs[0]), [0, 64 * 3, 100 * 3 + 28 * 2]);
});

test('defragmentMp4 leaves plain files alone and drops only a cut-off final packet', () => {
  const plain = defragmentMp4(fragmentedFile([[5, 5]]));
  assert.equal(defragmentMp4(plain), plain);
  const notMp4 = new Uint8Array([1, 2, 3, 4]);
  assert.equal(defragmentMp4(notMp4), notMp4);

  const full = fragmentedFile([[5, 5], [6, 6]]);
  const cut = full.subarray(0, full.length - 3);
  const out = defragmentMp4(cut);
  const stbl = child(out, boxes(out).moov[0], 'trak', 'mdia', 'minf', 'stbl');
  assert.equal(new DataView(out.buffer).getUint32(boxes(out, stbl.body, stbl.end).stsz[0].body + 8), 3); // packets 0-2 are whole; 3 is cut
});

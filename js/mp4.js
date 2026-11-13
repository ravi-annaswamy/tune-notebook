// Fragmented MP4 -> plain M4A, without re-encoding.
//
// MediaRecorder('audio/mp4') writes fragmented MP4: an empty sample table in
// moov, then one moof+mdat pair per second. Browsers play that, but Apple's
// Music/iTunes won't. This rebuilds a normal file: ftyp 'M4A ', a moov with the
// full sample table, then a single mdat holding the same AAC packets.
//
// defragmentMp4(Uint8Array) -> Uint8Array. Input that isn't a fragmented
// single-track MP4 is returned unchanged.

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf', 'edts']);
const SAMPLES_PER_CHUNK = 64;

function readBoxes(u8, start = 0, end = u8.length) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = [];
  let i = start;
  while (i + 8 <= end) {
    let size = dv.getUint32(i);
    const type = String.fromCharCode(u8[i + 4], u8[i + 5], u8[i + 6], u8[i + 7]);
    let header = 8;
    if (size === 1) {
      size = Number(dv.getBigUint64(i + 8));
      header = 16;
    } else if (size === 0) {
      size = end - i;
    }
    if (size < header || i + size > end) break; // truncated tail (e.g. interrupted recording)
    const box = { type, start: i, size, body: i + header, end: i + size };
    if (CONTAINERS.has(type)) box.children = readBoxes(u8, box.body, box.end);
    out.push(box);
    i += size;
  }
  return out;
}

const find = (boxes, type) => boxes?.find((b) => b.type === type);
const findAll = (boxes, type) => boxes?.filter((b) => b.type === type) || [];

function box(type, ...parts) {
  const size = 8 + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  for (let k = 0; k < 4; k++) out[4 + k] = type.charCodeAt(k);
  let o = 8;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function u32s(vals) {
  const out = new Uint8Array(vals.length * 4);
  const dv = new DataView(out.buffer);
  vals.forEach((v, k) => dv.setUint32(k * 4, v));
  return out;
}

// Full box with version/flags 0 and a list of u32 fields. Takes an array, not
// spread args: a long take has more packets than Safari allows as arguments.
const fullBox = (type, vals) => box(type, u32s([0, ...vals]));

function setDuration(copy, dv, offsetV0, offsetV1, value) {
  if (copy[0 + 8] === 1) dv.setBigUint64(offsetV1, BigInt(value));
  else dv.setUint32(offsetV0, value);
}

// Copy a box's bytes, so header fields can be patched.
const copyBox = (u8, b) => u8.slice(b.start, b.end);

export function defragmentMp4(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const top = readBoxes(u8);
  const moov = find(top, 'moov');
  if (!moov || !find(top, 'moof')) return u8;
  const traks = findAll(moov.children, 'trak');
  if (traks.length !== 1) return u8;
  const trak = traks[0];
  const tkhd = find(trak.children, 'tkhd');
  const mdia = find(trak.children, 'mdia');
  const mdhd = find(mdia?.children, 'mdhd');
  const minf = find(mdia?.children, 'minf');
  const stbl = find(minf?.children, 'stbl');
  const stsd = find(stbl?.children, 'stsd');
  const mvhd = find(moov.children, 'mvhd');
  if (!tkhd || !mdhd || !stsd || !mvhd) return u8;
  const trackId = dv.getUint32(tkhd.body + (u8[tkhd.body] === 1 ? 20 : 12));

  const trex = findAll(find(moov.children, 'mvex')?.children, 'trex')
    .find((b) => dv.getUint32(b.body + 4) === trackId);
  const trexDuration = trex ? dv.getUint32(trex.body + 12) : 0;
  const trexSize = trex ? dv.getUint32(trex.body + 16) : 0;

  // Gather every sample (offset, size, duration) from the fragments, in order.
  const sizes = [];
  const durations = [];
  const offsets = [];
  for (const moof of findAll(top, 'moof')) {
    for (const traf of findAll(moof.children, 'traf')) {
      const tfhd = find(traf.children, 'tfhd');
      if (!tfhd || dv.getUint32(tfhd.body + 4) !== trackId) continue;
      const tf = dv.getUint32(tfhd.body) & 0xffffff;
      let p = tfhd.body + 8;
      let base = moof.start;
      if (tf & 0x1) { base = Number(dv.getBigUint64(p)); p += 8; }
      if (tf & 0x2) p += 4;
      let defDuration = trexDuration;
      let defSize = trexSize;
      if (tf & 0x8) { defDuration = dv.getUint32(p); p += 4; }
      if (tf & 0x10) { defSize = dv.getUint32(p); p += 4; }

      let next = base;
      for (const trun of findAll(traf.children, 'trun')) {
        const rf = dv.getUint32(trun.body) & 0xffffff;
        const count = dv.getUint32(trun.body + 4);
        let q = trun.body + 8;
        if (rf & 0x1) { next = base + dv.getInt32(q); q += 4; }
        if (rf & 0x4) q += 4;
        for (let n = 0; n < count; n++) {
          let duration = defDuration;
          let size = defSize;
          if (rf & 0x100) { duration = dv.getUint32(q); q += 4; }
          if (rf & 0x200) { size = dv.getUint32(q); q += 4; }
          if (rf & 0x400) q += 4;
          if (rf & 0x800) q += 4;
          if (next + size > u8.length) break; // packet cut off at the end of the file
          offsets.push(next);
          sizes.push(size);
          durations.push(duration);
          next += size;
        }
      }
    }
  }
  if (!sizes.length) return u8;

  const mediaDuration = durations.reduce((s, d) => s + d, 0);
  const mdhdCopy = copyBox(u8, mdhd);
  const mdhdDv = new DataView(mdhdCopy.buffer);
  const mediaScale = mdhdDv.getUint32(mdhdCopy[8] === 1 ? 28 : 20);
  const mvhdCopy = copyBox(u8, mvhd);
  const mvhdDv = new DataView(mvhdCopy.buffer);
  const movieScale = mvhdDv.getUint32(mvhdCopy[8] === 1 ? 28 : 20);
  const toMovie = (d) => Math.round((d * movieScale) / mediaScale);

  // Edit list: keep the encoder-priming skip, but give it a real length.
  let edts = null;
  let presented = mediaDuration;
  const edtsBox = find(trak.children, 'edts');
  const elst = find(edtsBox?.children, 'elst');
  if (elst && dv.getUint32(elst.body + 4) === 1) {
    edts = copyBox(u8, edtsBox);
    const edv = new DataView(edts.buffer);
    const e = elst.start - edtsBox.start + 16; // first entry, relative to the edts copy
    const v1 = u8[elst.body] === 1;
    const mediaTime = v1 ? Number(edv.getBigInt64(e + 8)) : edv.getInt32(e + 4);
    if (mediaTime >= 0) {
      presented = Math.max(0, mediaDuration - mediaTime);
      if (v1) edv.setBigUint64(e, BigInt(toMovie(presented)));
      else edv.setUint32(e, toMovie(presented));
    }
  }

  setDuration(mvhdCopy, mvhdDv, 24, 32, toMovie(presented));
  const tkhdCopy = copyBox(u8, tkhd);
  const tkhdDv = new DataView(tkhdCopy.buffer);
  setDuration(tkhdCopy, tkhdDv, 28, 36, toMovie(presented));
  tkhdDv.setUint32(8, (tkhdDv.getUint32(8) & 0xff000000) | 0x3); // enabled + in movie
  setDuration(mdhdCopy, mdhdDv, 24, 32, mediaDuration);

  // stts: run-length durations.
  const stts = [];
  for (const d of durations) {
    const last = stts[stts.length - 1];
    if (last && last[1] === d) last[0]++;
    else stts.push([1, d]);
  }
  const chunkCount = Math.ceil(sizes.length / SAMPLES_PER_CHUNK);
  const tail = sizes.length - (chunkCount - 1) * SAMPLES_PER_CHUNK;
  const stsc = tail === SAMPLES_PER_CHUNK || chunkCount === 1
    ? [[1, chunkCount === 1 ? sizes.length : SAMPLES_PER_CHUNK, 1]]
    : [[1, SAMPLES_PER_CHUNK, 1], [chunkCount, tail, 1]];

  const sampleBytes = sizes.reduce((s, n) => s + n, 0);
  const buildMoov = (chunkOffsets) => {
    const newStbl = box('stbl',
      copyBox(u8, stsd),
      fullBox('stts', [stts.length].concat(stts.flat())),
      fullBox('stsc', [stsc.length].concat(stsc.flat())),
      fullBox('stsz', [0, sizes.length].concat(sizes)),
      fullBox('stco', [chunkOffsets.length].concat(chunkOffsets)));
    const minfKids = minf.children.filter((b) => b.type !== 'stbl').map((b) => copyBox(u8, b));
    const mdiaKids = mdia.children.filter((b) => b.type !== 'minf' && b.type !== 'mdhd').map((b) => copyBox(u8, b));
    const newTrak = box('trak', tkhdCopy, ...(edts ? [edts] : []),
      box('mdia', mdhdCopy, ...mdiaKids, box('minf', ...minfKids, newStbl)));
    const moovKids = moov.children
      .filter((b) => !['mvhd', 'trak', 'mvex'].includes(b.type))
      .map((b) => copyBox(u8, b));
    return box('moov', mvhdCopy, newTrak, ...moovKids);
  };

  const ftyp = box('ftyp', new TextEncoder().encode('M4A \0\0\0\0M4A mp42isom'));
  // Sizes don't depend on offset values, so build once to measure, then for real.
  const moovSize = buildMoov(new Array(chunkCount).fill(0)).length;
  const dataStart = ftyp.length + moovSize + 8;
  if (dataStart + sampleBytes > 0xffffffff) return u8; // would need co64; not worth it for voice takes
  const chunkOffsets = [];
  let pos = dataStart;
  for (let c = 0; c < chunkCount; c++) {
    chunkOffsets.push(pos);
    const end = Math.min(sizes.length, (c + 1) * SAMPLES_PER_CHUNK);
    for (let s = c * SAMPLES_PER_CHUNK; s < end; s++) pos += sizes[s];
  }
  const newMoov = buildMoov(chunkOffsets);

  const out = new Uint8Array(ftyp.length + newMoov.length + 8 + sampleBytes);
  out.set(ftyp, 0);
  out.set(newMoov, ftyp.length);
  const mdatAt = ftyp.length + newMoov.length;
  new DataView(out.buffer).setUint32(mdatAt, 8 + sampleBytes);
  out.set([0x6d, 0x64, 0x61, 0x74], mdatAt + 4); // 'mdat'
  let w = mdatAt + 8;
  for (let s = 0; s < sizes.length; s++) {
    out.set(u8.subarray(offsets[s], offsets[s] + sizes[s]), w);
    w += sizes[s];
  }
  return out;
}

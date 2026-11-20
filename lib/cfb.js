'use strict';
// cfb.js — OLE2 / Compound File Binary(CFB) 리더. 의존성 없음.
// HWP 5.0 문서는 CFB 컨테이너 안에 FileHeader / DocInfo / BodyText/Section{n} 스트림을 담는다.
// 이 모듈은 컨테이너만 연다 — 스트림의 의미는 hwp5.js가 해석한다.
//
//   const cfb = require('./cfb');
//   const doc = cfb.parse(buffer);
//   doc.list()                       // ['FileHeader', 'DocInfo', 'BodyText/Section0', ...]
//   doc.read('BodyText/Section0')    // Buffer
//
// 규격: [MS-CFB]. 섹터 체인(FAT)·미니 섹터 체인(MiniFAT)·디렉터리 트리(red-black tree, 좌/우/자식)를 따른다.

const ENDOFCHAIN = 0xFFFFFFFE;
const FREESECT = 0xFFFFFFFF;
const MAXREGSECT = 0xFFFFFFFA;

function parse(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xE011CFD0 || buf.readUInt32LE(4) !== 0xE11AB1A1) {
    throw new Error('not a CFB (OLE2) file');
  }
  const sectorShift = buf.readUInt16LE(0x1E);
  const miniShift = buf.readUInt16LE(0x20);
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  const numFat = buf.readUInt32LE(0x2C);
  const firstDir = buf.readUInt32LE(0x30);
  const miniCutoff = buf.readUInt32LE(0x38);
  const firstMiniFat = buf.readUInt32LE(0x3C);
  const numMiniFat = buf.readUInt32LE(0x40);
  const firstDifat = buf.readUInt32LE(0x44);
  const numDifat = buf.readUInt32LE(0x48);
  const perSector = sectorSize / 4;

  const sectorOffset = (n) => (n + 1) * sectorSize;
  const readSector = (n) => {
    const off = sectorOffset(n);
    if (off + sectorSize > buf.length) return buf.subarray(off, buf.length); // 잘린 파일도 최대한 읽는다
    return buf.subarray(off, off + sectorSize);
  };

  // DIFAT → FAT 섹터 목록
  const fatSectors = [];
  for (let i = 0; i < 109 && fatSectors.length < numFat; i++) {
    const s = buf.readUInt32LE(0x4C + i * 4);
    if (s <= MAXREGSECT) fatSectors.push(s);
  }
  let difat = firstDifat, guard = 0;
  while (difat <= MAXREGSECT && guard++ < numDifat + 1) {
    const sec = readSector(difat);
    for (let i = 0; i < perSector - 1 && fatSectors.length < numFat; i++) {
      const s = sec.readUInt32LE(i * 4);
      if (s <= MAXREGSECT) fatSectors.push(s);
    }
    difat = sec.readUInt32LE((perSector - 1) * 4);
  }
  // FAT 전체
  const fat = new Uint32Array(fatSectors.length * perSector);
  fatSectors.forEach((s, i) => {
    const sec = readSector(s);
    for (let j = 0; j < perSector; j++) fat[i * perSector + j] = j * 4 + 4 <= sec.length ? sec.readUInt32LE(j * 4) : FREESECT;
  });

  function chain(start, table) {
    const out = [];
    let s = start, n = 0;
    const seen = new Set();
    while (s <= MAXREGSECT && n++ < table.length + 1) {
      if (seen.has(s)) break; // 순환 방어
      seen.add(s);
      out.push(s);
      s = s < table.length ? table[s] : ENDOFCHAIN;
    }
    return out;
  }
  function readChain(start, size) {
    const secs = chain(start, fat);
    const out = Buffer.alloc(size);
    let pos = 0;
    for (const s of secs) {
      if (pos >= size) break;
      const sec = readSector(s);
      const n = Math.min(sectorSize, size - pos, sec.length);
      sec.copy(out, pos, 0, n);
      pos += n;
    }
    return out;
  }

  // 디렉터리
  const dirSecs = chain(firstDir, fat);
  const entries = [];
  for (const s of dirSecs) {
    const sec = readSector(s);
    for (let off = 0; off + 128 <= sec.length; off += 128) {
      const nameLen = sec.readUInt16LE(off + 64);
      const type = sec[off + 66];
      if (type === 0) { entries.push(null); continue; }
      const name = sec.toString('utf16le', off, off + Math.max(0, Math.min(64, nameLen) - 2));
      entries.push({
        name, type, // 1 storage, 2 stream, 5 root
        left: sec.readUInt32LE(off + 68), right: sec.readUInt32LE(off + 72), child: sec.readUInt32LE(off + 76),
        start: sec.readUInt32LE(off + 116),
        size: sec.readUInt32LE(off + 120), // 상위 32비트는 무시(4GB 미만)
      });
    }
  }
  const root = entries[0];
  if (!root || root.type !== 5) throw new Error('CFB: root entry missing');

  // 미니 스트림 + MiniFAT
  const miniStream = readChain(root.start, root.size);
  const miniFatSecs = chain(firstMiniFat, fat).slice(0, numMiniFat || undefined);
  const miniFat = new Uint32Array(miniFatSecs.length * perSector);
  miniFatSecs.forEach((s, i) => {
    const sec = readSector(s);
    for (let j = 0; j < perSector; j++) miniFat[i * perSector + j] = j * 4 + 4 <= sec.length ? sec.readUInt32LE(j * 4) : FREESECT;
  });
  function readMini(start, size) {
    const secs = chain(start, miniFat);
    const out = Buffer.alloc(size);
    let pos = 0;
    for (const s of secs) {
      if (pos >= size) break;
      const off = s * miniSize;
      const n = Math.min(miniSize, size - pos, Math.max(0, miniStream.length - off));
      if (n > 0) miniStream.copy(out, pos, off, off + n);
      pos += n;
    }
    return out;
  }

  // 트리 → 경로 맵
  const paths = new Map();
  function walk(id, prefix, depth) {
    if (id > MAXREGSECT || id >= entries.length || depth > 64) return;
    const e = entries[id];
    if (!e) return;
    walk(e.left, prefix, depth + 1);
    const full = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.type === 2) paths.set(full, e);
    else if (e.type === 1) { paths.set(full + '/', e); walk(e.child, full, depth + 1); }
    walk(e.right, prefix, depth + 1);
  }
  walk(root.child, '', 0);

  return {
    sectorSize, miniSize,
    list: () => [...paths.keys()].filter((k) => !k.endsWith('/')),
    has: (name) => paths.has(name),
    read(name) {
      const e = paths.get(name);
      if (!e || e.type !== 2) throw new Error(`CFB: stream not found: ${name}`);
      if (e.size === 0) return Buffer.alloc(0);
      return e.size < miniCutoff ? readMini(e.start, e.size) : readChain(e.start, e.size);
    },
  };
}

module.exports = { parse };

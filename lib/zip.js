'use strict';
// zip.js — 최소 ZIP 리더(중앙 디렉터리 → 로컬 헤더 → stored/deflate). 의존성 없음.
// HWPX(OWPML)는 ZIP 컨테이너다: mimetype, version.xml, Contents/header.xml, Contents/section{n}.xml …
const zlib = require('node:zlib');

function parse(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  // End of central directory: 뒤에서부터 시그니처 0x06054b50 탐색(주석 최대 64KB)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP file');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count && off + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20), usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const flags = buf.readUInt16LE(off + 8);
    const raw = buf.subarray(off + 46, off + 46 + nlen);
    let name;     // UTF-8 표시(0x800)가 없으면 윈도에서 만든 한글 이름(CP949)일 수 있다
    if (flags & 0x800) name = raw.toString('utf8');
    else { try { name = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { try { name = new TextDecoder('euc-kr').decode(raw); } catch { name = raw.toString('latin1'); } } }
    entries.set(name, { name, method, csize, usize, local, enc: !!(flags & 1) });
    off += 46 + nlen + elen + clen;
  }
  function read(name) {
    const e = entries.get(name);
    if (!e) throw new Error(`ZIP: entry not found: ${name}`);
    const lh = e.local;
    if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error('ZIP: bad local header');
    const nlen = buf.readUInt16LE(lh + 26), elen = buf.readUInt16LE(lh + 28);
    const start = lh + 30 + nlen + elen;
    const data = buf.subarray(start, start + e.csize);
    if (e.method === 0) return Buffer.from(data);
    if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: Math.max(e.usize, 1) + 1024 });
    throw new Error(`ZIP: unsupported method ${e.method}`);
  }
  return { list: () => [...entries.keys()], has: (n) => entries.has(n), read, info: (n) => entries.get(n) };
}
module.exports = { parse };

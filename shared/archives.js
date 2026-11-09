import { Inflate, strFromU8 } from 'fflate';
import { FILE_FORMATS } from './formats.js';
import { MAX_BYTES } from './catalog.js';

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const damaged = () => { throw new Error('This ZIP archive is damaged. Create a new ZIP and try again.'); };

export function extractCadArchive(buffer, enabledExtensions) {
  if (buffer.byteLength > MAX_BYTES) throw new Error('Choose a ZIP file up to 50 MB.');
  const view = new DataView(buffer), input = new Uint8Array(buffer);
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === buffer.byteLength) { end = i; break; }
  }
  if (end < 0) damaged();
  const entries = view.getUint16(end + 10, true), directoryStart = view.getUint32(end + 16, true);
  const directoryEnd = directoryStart + view.getUint32(end + 12, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== entries) damaged();
  if (entries > 1000) throw new Error('This ZIP has too many files. Include only the CAD files you need.');
  if (directoryEnd > end || directoryStart > directoryEnd) damaged();
  const cad = new Set(FILE_FORMATS.filter(f => !['zip', 'gcode'].includes(f.id)).flatMap(f => f.extensions).filter(e => enabledExtensions.includes(e)));
  const selected = new Map();
  let offset = directoryStart, total = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== 0x02014b50) damaged();
    const length = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    const size = view.getUint32(offset + 24, true), compressed = view.getUint32(offset + 20, true), flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true), checksum = view.getUint32(offset + 16, true), local = view.getUint32(offset + 42, true);
    if (offset + 46 + length + extra + comment > directoryEnd) damaged();
    const name = strFromU8(input.subarray(offset + 46, offset + 46 + length), !(flags & 2048));
    const parts = name.replaceAll('\\', '/').split('/');
    offset += 46 + length + extra + comment;
    if (parts.some(p => p === '..' || p.startsWith('.') || p === '__MACOSX') || /^[\\/]|^[a-z]:/i.test(name) || /[\x00-\x1f]/.test(name)) continue;
    const basename = parts.at(-1) || '', extension = basename.split('.').at(-1).toLowerCase();
    if (!cad.has(extension) || !size || !basename) continue;
    if (flags & 1) throw new Error('Encrypted CAD files are not supported. Create an unencrypted ZIP.');
    if (![0, 8].includes(compression)) throw new Error('This ZIP uses an unsupported compression type. Create a standard ZIP and try again.');
    if (selected.has(name) || local + 30 > directoryStart || view.getUint32(local, true) !== 0x04034b50) damaged();
    if (view.getUint16(local + 6, true) & 1 || view.getUint16(local + 8, true) !== compression) damaged();
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + compressed > directoryStart || (!compression && compressed !== size)) damaged();
    total += size;
    if (total > MAX_BYTES) throw new Error('The CAD files inside the ZIP must total 50 MB or less.');
    selected.set(name, { name: basename, size, compressed, compression, checksum, start });
    if (selected.size > 20) throw new Error('Use a ZIP with no more than 20 CAD files.');
  }
  if (offset !== directoryEnd) damaged();
  if (!selected.size) throw new Error('No supported CAD files were found in this ZIP. Include STL, OBJ, STEP or 3MF files.');

  return [...selected.values()].map(entry => {
    const bytes = new Uint8Array(entry.size);
    let written = 0, crc = 0xffffffff;
    const write = chunk => {
      if (written + chunk.length > entry.size) damaged();
      bytes.set(chunk, written); written += chunk.length;
      for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    };
    try {
      if (!entry.compression) write(input.subarray(entry.start, entry.start + entry.compressed));
      else {
        // Small input chunks bound expansion even when ZIP size metadata is false.
        const inflater = new Inflate(write);
        for (let i = 0; i < entry.compressed; i += 8192) inflater.push(input.subarray(entry.start + i, entry.start + Math.min(i + 8192, entry.compressed)), i + 8192 >= entry.compressed);
      }
    } catch { damaged(); }
    if (written !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.checksum) damaged();
    return { name: entry.name, bytes };
  });
}

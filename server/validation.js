import yauzl from 'yauzl';
import { fileFormat } from '../shared/formats.js';
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
export async function validateModel(buffer, name) {
  const ext = name.toLowerCase().split('.').at(-1);
  const format = fileFormat(name);
  if(ext==='zip')fail('ZIP archives must be extracted before uploading. Upload the CAD files inside.');
  if (!format) fail('This file type is not supported.');
  if (ext === 'step' || ext === 'stp') { const source=buffer.toString('utf8'); if (!/^\s*ISO-10303-21;/i.test(source) || !/END-ISO-10303-21;/i.test(source)) fail('This is not a valid STEP file. Export it again from your CAD program.'); return; }
  if (!format.preview) return; // Stored as an opaque original, never unpacked or executed.
  if (ext === 'obj') { const s=buffer.toString('utf8'); if (!/^v\s+[-+\d.eE]+\s+[-+\d.eE]+\s+[-+\d.eE]+/m.test(s) || !/^f\s+\S+\s+\S+\s+\S+/m.test(s)) fail('This OBJ has no mesh. Export it with faces and vertices.'); return; }
  if (ext === 'ply') { if (!/^ply\r?\n/.test(buffer.toString('utf8',0,100))) fail('This is not a valid PLY file.'); return; }
  if (ext === 'off') { if (!/^OFF\s/.test(buffer.toString('utf8',0,100))) fail('This is not a valid OFF file.'); return; }
  if (ext === 'stl') {
    if (buffer.length >= 84 && 84 + buffer.readUInt32LE(80) * 50 === buffer.length && buffer.readUInt32LE(80) > 0) {
      for (let i = 84; i < buffer.length; i += 50) for (let j = 12; j < 48; j += 4) if (!Number.isFinite(buffer.readFloatLE(i + j))) fail('The STL contains invalid coordinates. Re-export your model.');
      return;
    }
    const s = buffer.toString('utf8');
    if (!/^\s*solid\b/i.test(s) || !/endsolid\b/i.test(s)) fail('This is not a valid STL. Export an STL or 3MF from your CAD program.');
    const vertices = [...s.matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)];
    if (!vertices.length || vertices.length % 3 || vertices.some(v => v.slice(1).some(n => !Number.isFinite(Number(n))))) fail('This STL has incomplete or invalid triangles.');
    return;
  }
  if (ext !== '3mf') fail('Please upload an STL or 3MF file.');
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err) return reject(Object.assign(new Error('This 3MF archive could not be opened.'), { status: 400 }));
      let total = 0, count = 0, hasModel = false, ended = false;
      const bad = message => { if (ended) return; ended = true; zip.close(); reject(Object.assign(new Error(message), { status: 400 })); };
      zip.on('error', () => bad('This 3MF archive is damaged.'));
      zip.on('entry', entry => {
        total += entry.uncompressedSize;
        if (++count > 1000 || total > 100 * 1024 * 1024 || entry.uncompressedSize > 70 * 1024 * 1024 || entry.generalPurposeBitFlag & 1) return bad('This 3MF is too complex or encrypted. Export a smaller unencrypted model.');
        if (entry.fileName.toLowerCase().endsWith('.model')) hasModel = true;
        if (/\/$/.test(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e) return bad('This 3MF archive is damaged.');
          let read = 0;
          stream.on('data', chunk => { read += chunk.length; if (read > entry.uncompressedSize || read > 70 * 1024 * 1024) { stream.destroy(); bad('This 3MF archive exceeds its declared size.'); } });
          stream.on('error', () => bad('This 3MF archive is damaged.'));
          stream.on('end', () => { if (!ended) zip.readEntry(); });
        });
      });
      zip.on('end', () => { if (!ended) { ended = true; hasModel ? resolve() : reject(Object.assign(new Error('No 3D model was found in this 3MF.'), { status: 400 })); } });
      zip.readEntry();
    });
  });
}
export function validatePreview(file) {
  if (!file || file.size > 512 * 1024 || !file.buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail('A valid model preview is required. Return to the preview step.');
}

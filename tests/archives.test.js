import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {extractCadArchive} from '../shared/archives.js';
import {stl} from './fixtures.js';
import {MAX_BYTES} from '../shared/catalog.js';
import {randomBytes} from 'node:crypto';
const bytes=entries=>{const result=zipSync(entries);return result.buffer.slice(result.byteOffset,result.byteOffset+result.byteLength);};
test('ZIP extraction keeps enabled CAD files and ignores images, notes, scripts, hidden files and traversal paths',()=>{const buffer=bytes({'parts/model.STL':stl(),'second.obj':strToU8('v 0 0 0\nf 1 2 3'),'photo.png':strToU8('ignore'),'instructions.txt':strToU8('ignore'),'run.js':strToU8('ignore'),'.hidden.stl':stl(),'__MACOSX/duplicate.stl':stl(),'../outside.stl':stl(),'disabled.ply':strToU8('ply\n')});const files=extractCadArchive(buffer,['stl','obj']);assert.deepEqual(files.map(f=>f.name),['model.STL','second.obj']);assert.deepEqual(Buffer.from(files[0].bytes),stl());});
test('ZIP extraction rejects empty/no-CAD archives, nested ZIP-only archives and expanded payloads over the limit',()=>{assert.throws(()=>extractCadArchive(bytes({'readme.txt':strToU8('notes')}),['stl']),/No supported CAD/);assert.throws(()=>extractCadArchive(bytes({'nested.zip':strToU8('zip')}),['stl','zip']),/No supported CAD/);const buffer=bytes({'model.stl':stl()}),view=new DataView(buffer);for(let i=0;i<buffer.byteLength-46;i++)if(view.getUint32(i,true)===0x02014b50){view.setUint32(i+24,MAX_BYTES+1,true);break;}assert.throws(()=>extractCadArchive(buffer,['stl']),/50 MB/);});
test('ZIP extraction detects corrupt bytes, false expanded sizes and encrypted CAD entries',()=>{
 for(const change of ['size','checksum','encrypted']){const buffer=bytes({'model.stl':stl()}),view=new DataView(buffer);for(let i=0;i<buffer.byteLength-46;i++)if(view.getUint32(i,true)===0x02014b50){if(change==='size')view.setUint32(i+24,1,true);if(change==='checksum')view.setUint32(i+16,view.getUint32(i+16,true)^1,true);if(change==='encrypted')view.setUint16(i+8,1,true);break;}assert.throws(()=>extractCadArchive(buffer,['stl']),change==='encrypted'?/Encrypted/:/damaged/);}
 assert.throws(()=>extractCadArchive(new ArrayBuffer(10),['stl']),/damaged/);
});
test('ZIP extraction limits CAD count, keeps same-named models in different folders and ignores G-code',()=>{
 const many=Object.fromEntries(Array.from({length:21},(_,i)=>[i+'.stl',stl()]));assert.throws(()=>extractCadArchive(bytes(many),['stl']),/20 CAD/);
 const files=extractCadArchive(bytes({'A/model.stl':stl(),'B/model.stl':stl(),'part.step':strToU8('ISO-10303-21;'),'printer.gcode':strToU8('G28'),'mesh.ply':strToU8('ply\n')}),['stl','step','ply','gcode']);assert.deepEqual(files.map(f=>f.name),['model.stl','model.stl','part.step','mesh.ply']);
});
test('ZIP extraction preserves larger CAD payloads across decompression chunks',()=>{const payload=Buffer.concat([randomBytes(64000),Buffer.alloc(1000000,65)]);const files=extractCadArchive(bytes({'large.step':payload}),['step']);assert.deepEqual(Buffer.from(files[0].bytes),payload);});

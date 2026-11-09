import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {cantilever,cube,stl} from './fixtures.js';
import {analyseGeometry} from '../shared/geometry.js';
import {printTestResult} from '../shared/print-test.js';
import {splitGroups,splitIntoFiles} from '../shared/split-files.js';
import {validateModel} from '../server/validation.js';

test('supports are information, with contact points only in the open space below the overhang',()=>{
 const analysis=analyseGeometry(cantilever());assert.equal(analysis.warnings.length,0);assert(analysis.notices.some(note=>note.code==='supports'));assert(analysis.supportContacts.length>0);
 for(const contact of analysis.supportContacts){assert(contact.x>=10);assert.equal(contact.bottom,0);assert.equal(contact.top,20);assert(contact.normal[2]<0);}
 assert.equal(printTestResult(analysis,analysis.warnings).state,'finished');assert.equal(analyseGeometry(cube()).supportContacts.length,0);
});
test('separate STL objects become complete, centred files resting on the print bed',async()=>{
 const positions=new Float32Array([...cube(),...cube(30,0,22,10)]),analysis=analyseGeometry(positions),model={positions,format:'stl',objects:[],palette:['#19c1ca'],colourIndices:new Uint8Array(positions.length/3)};
 const original=new File([stl(positions)],'nut-and-bolt.stl'),files=splitIntoFiles(original,model,analysis);assert.equal(files.length,2);assert.equal(analysis.floating,1);
 for(const file of files){const buffer=Buffer.from(await file.arrayBuffer());await validateModel(buffer,file.name);const count=buffer.readUInt32LE(80),vertices=new Float32Array(count*9);for(let triangle=0;triangle<count;triangle++)for(let i=0;i<9;i++)vertices[triangle*9+i]=buffer.readFloatLE(84+triangle*50+12+i*4);const result=analyseGeometry(vertices);assert.equal(result.components,1);assert.equal(result.floating,0);assert.equal(Math.min(...vertices.filter((_,i)=>i%3===2)),0);assert.equal(count,12);}
 assert.equal(original.size,stl(positions).length);
});
test('explicit OBJ objects keep their names and source colours in separate 3MF files',async()=>{
 const positions=new Float32Array([...cube(),...cube(30,0,0)]),analysis=analyseGeometry(positions,{format:'obj'}),colourIndices=new Uint8Array(positions.length/3);colourIndices.fill(1,36);
 const model={positions,format:'obj',palette:['#123456','#abcdef'],colourIndices,objects:[{name:'Nut',triangles:Uint32Array.from({length:12},(_,i)=>i)},{name:'Bolt',triangles:Uint32Array.from({length:12},(_,i)=>i+12)}]};
 assert.deepEqual(splitGroups(model,analysis).map(group=>group.name),['Nut','Bolt']);const files=splitIntoFiles(new File(['obj'],'assembly.obj'),model,analysis);assert.equal(files.length,2);assert(files[0].name.includes('Nut'));assert(files[1].name.includes('Bolt'));
 for(const file of files){const buffer=new Uint8Array(await file.arrayBuffer());await validateModel(Buffer.from(buffer),file.name);const xml=strFromU8(unzipSync(buffer)['3D/3dmodel.model']);assert(xml.includes('unit="millimeter"'));assert(xml.includes('#123456'));assert(xml.includes('#abcdef'));assert.equal((xml.match(/<triangle /g)||[]).length,12);}
});

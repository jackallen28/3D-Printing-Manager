import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {cantilever,bridge,cube,stl} from './fixtures.js';
import {analyseGeometry} from '../shared/geometry.js';
import {printTestResult} from '../shared/print-test.js';
import {splitGroups,splitIntoFiles} from '../shared/split-files.js';
import {validateModel} from '../server/validation.js';

test('supports are information, with contact points only in the open space below the overhang',()=>{
 const analysis=analyseGeometry(cantilever());assert.equal(analysis.warnings.length,0);assert(analysis.notices.some(note=>note.code==='supports'));assert(analysis.supportContacts.length>0);
 for(const contact of analysis.supportContacts){assert(contact.x>=10);assert.equal(contact.bottom,0);assert.equal(contact.top,20);assert(contact.normal[2]<0);}
 assert.equal(printTestResult(analysis,analysis.warnings).state,'support-check');assert.equal(printTestResult(analysis,analysis.warnings,{supports:true}).state,'supported');assert.equal(analyseGeometry(cube()).supportContacts.length,0);
});
test('a joined overhang bends at the free end while its stem and attachment stay fixed',()=>{
 const original=cantilever(),rotated=Float32Array.from(original,(value,i)=>i%3===0?-original[i+1]+30:i%3===1?original[i-1]+5:value+10);
 for(const positions of [original,rotated]){
  const analysis=analyseGeometry(positions);assert.equal(analysis.components,1);assert.equal(analysis.floating,0);assert.equal(analysis.sagMaxDrop,2.5);
  for(let i=0;i<positions.length/3;i++){const originalX=original[i*3];assert.equal(analysis.sagWeights[i],originalX===20?1:0);}
  assert(analysis.sagWeights.some(weight=>weight===1));
 }
 const plain=analyseGeometry(cube());assert.equal(plain.sagMaxDrop,0);assert(plain.sagWeights.every(weight=>weight===0));
});
test('coarse bridge faces can sag even when all their original corners are attached',()=>{
 const analysis=analyseGeometry(bridge());assert.equal(analysis.components,1);assert.equal(analysis.floating,0);assert.equal(analysis.warnings.length,0);assert(analysis.supportContacts.length>0);assert(analysis.sagMaxDrop>0);assert(analysis.sagWeights.every(weight=>weight===0));assert(analysis.sagTriangleWeights.some(weight=>weight>0));
 assert.equal(printTestResult(analysis,analysis.warnings).state,'support-check');assert.equal(printTestResult(analysis,analysis.warnings,{supports:true}).state,'supported');
});
test('supports hold floating pieces but never join them, and do not hide unrelated print issues',()=>{
 const analysis=analyseGeometry(new Float32Array([...cube(),...cube(3,3,22,5)]));assert.equal(analysis.floating,1);assert.equal(analysis.sagMaxDrop,0);assert(analysis.sagWeights.every(weight=>weight===0));
 const supported=printTestResult(analysis,analysis.warnings,{supports:true});assert.equal(supported.state,'supported');assert.equal(supported.canRemoveSupports,true);assert.match(supported.message,/only works with supports/);assert.match(supported.message,/separate when the supports are removed/);assert(supported.fixes.length<=3);
 const removed=printTestResult(analysis,analysis.warnings,{supports:true,supportsRemoved:true});assert.equal(removed.title,'Loose parts separate.');assert.equal(removed.canRemoveSupports,false);assert.match(removed.message,/fall away/);assert(removed.fixes.some(fix=>fix.includes('teacher')));
 const thin=printTestResult(analysis,[...analysis.warnings,{code:'thin-features'}],{supports:true});assert.equal(thin.state,'failed');assert(thin.fixes.some(fix=>fix.includes('thicker')));
 const roof=analyseGeometry(cantilever()),roofRemoved=printTestResult(roof,roof.warnings,{supports:true,supportsRemoved:true});assert.equal(roofRemoved.state,'finished');assert.match(roofRemoved.message,/stays attached/);assert.doesNotMatch(roofRemoved.message,/fall away|separate/);
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

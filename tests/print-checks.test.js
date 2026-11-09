import test from 'node:test';
import assert from 'node:assert/strict';
import {analyseGeometry} from '../shared/geometry.js';
import {thinFeatures} from '../shared/thickness.js';
import {printTestResult} from '../shared/print-test.js';
import {filenameColour,exportBatches,EXPORT_MAX_BYTES} from '../shared/printing.js';
import {validateSubmission,makeRecord} from '../server/domain.js';
import {BAMBU_COLOURS,ADVANCED_FILAMENT} from '../shared/catalog.js';
import {cube,details} from './fixtures.js';

const settings={schools:[{id:details().schoolId,name:'School A'}],staff:[{id:details().staffId,name:'Alex'}],classes:[],colours:BAMBU_COLOURS.map(c=>c.id),customColourEnabled:true};
const code=analysis=>analysis.warnings.map(w=>w.code);
const box=(x,y,z,w,d,h)=>Float32Array.from(cube(),(value,i)=>value*([w,d,h][i%3]/20)+[x,y,z][i%3]);
test('each part accepts one colour, with distinct parts allowed to share a colour',()=>{
 const input={...details(),colourMapping:[{source:'#abcdef',target:'Blue'},{source:'#ABCDEF',target:'Red'}]};
 assert.throws(()=>validateSubmission(input,settings),/Choose one colour/);
 const valid=validateSubmission({...details(),colourMapping:[{source:'#abcdef',target:'Blue'},{source:'#123456',target:'Blue'}]},settings);assert.equal(valid.colourMapping.length,2);assert.equal(filenameColour(valid),'BLUE');
 assert.throws(()=>validateSubmission({...details(),colourMapping:[]},settings));
});
test('filenames list only current, unique colour names in part order',()=>{
 const input=validateSubmission({...details(),colourMapping:[{source:'#111111',target:'Jade White'},{source:'#222222',target:'Blue'},{source:'#333333',target:'Jade White'}]},settings);
 assert.equal(makeRecord(input,'parts.obj',200,new Date('2026-11-09T00:00:00Z')).filename,'School-A_WHITE_BLUE_2026-11-09_Mia.obj');
 input.colourMapping[1].target='Red';assert.equal(filenameColour(input),'WHITE_RED');
 const large={...input,school:'学校'.repeat(40),firstName:'学'.repeat(40),colourMapping:[...BAMBU_COLOURS.map((c,i)=>({source:'#'+i.toString(16).padStart(6,'0'),target:c.name})),{source:'#eeeeee',target:ADVANCED_FILAMENT},{source:'#ffffff',target:'Custom'}]};
 const filename=makeRecord(large,'many.3mf',200).filename;assert(Buffer.byteLength(filename)<=240);assert(filename.includes('_'+filenameColour(large)+'_'));
});
test('OBJ colour sections and touching shared surfaces are informational',()=>{
 const separated=analyseGeometry(new Float32Array([...cube(),...cube(30,0,0)]),{format:'obj'});assert(!code(separated).includes('parts'));assert(separated.notices.some(n=>n.code==='parts'));
 const touching=analyseGeometry(new Float32Array([...cube(),...cube(20,0,0)]),{format:'obj'});assert(touching.nonManifold>0);assert(!code(touching).includes('mesh'));
 const attached=analyseGeometry(new Float32Array([...cube(),...cube(3,3,20.01,10)]),{format:'obj'});assert.equal(attached.floating,0);assert(!code(attached).includes('overhang'));
});
test('OBJ still warns about clearly detached parts and substantial open surfaces',()=>{
 const floating=analyseGeometry(new Float32Array([...cube(),...cube(30,0,22,3)]),{format:'obj'});assert.equal(floating.floating,1);
 const smallSeam=analyseGeometry(cube().slice(9),{format:'obj'});assert(!code(smallSeam).includes('mesh'));
 const open=analyseGeometry(cube().slice(72),{format:'obj'});assert(code(open).includes('mesh'));
});
test('thin wall detection locates a narrow feature in a larger, connected STL',()=>{
 const positions=new Float32Array([...cube(),...box(0,0,20,0.4,10,10)]),analysis=analyseGeometry(positions);
 assert.equal(analysis.components,1);assert.deepEqual(analysis.dimensions,[20,20,30]);assert(code(analysis).includes('thin-features'));
 const thin=thinFeatures(analysis.thicknessSamples,analysis.partBounds,analysis.triangleParts);assert(thin.triangles.length>0);assert([...thin.triangles].some(t=>t>=12));
 const larger=thinFeatures(analysis.thicknessSamples,analysis.partBounds,analysis.triangleParts,300);assert.equal(larger.triangles.length,0);
});
test('STL floating text and separate pieces retain exact triangle locations',()=>{
 const analysis=analyseGeometry(new Float32Array([...cube(),...box(5,5,22,8,3,3)]));assert.equal(analysis.floating,1);assert.equal(analysis.floatingTriangles.length,12);assert(analysis.floatingTriangles.every(t=>t>=12));assert.deepEqual(analysis.floatingParts,[1]);assert.deepEqual(analysis.partBounds[1].min,[5,5,22]);
 const result=printTestResult(analysis,analysis.warnings);assert.equal(result.state,'failed');assert(result.fixes.length<=3);assert(result.fixes.some(f=>f.includes('teacher')));assert(result.fixes.some(f=>f.includes('floating')));
 const clean=analyseGeometry(cube());assert.equal(printTestResult(clean,clean.warnings).state,'finished');
});
test('large export selections are split without omitting, duplicating or reordering files',()=>{
 const records=Array.from({length:8},(_,id)=>({id,bytes:50*1024*1024})),batches=exportBatches(records);assert.deepEqual(batches.map(b=>b.length),[3,3,2]);assert.deepEqual(batches.flat(),records);assert(batches.every(batch=>batch.reduce((sum,r)=>sum+r.bytes,0)<=EXPORT_MAX_BYTES));assert.deepEqual(exportBatches([]),[]);
});

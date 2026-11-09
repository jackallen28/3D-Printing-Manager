import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { LocalStore, DriveStore } from '../server/storage.js';
import { makeRecord, validateSubmission } from '../server/domain.js';
import { stl, png, details } from './fixtures.js';
import { MAX_BYTES } from '../shared/catalog.js';
import { Readable } from 'node:stream';
const PASSWORD='test-only-teacher-password';
async function setup(t){const dir=await mkdtemp(path.join(tmpdir(),'bnts-api-'));const incoming=await mkdtemp(path.join(tmpdir(),'bnts-incoming-'));const store=new LocalStore(dir);await store.init();const {app,cleanup}=createApp({store,password:PASSWORD,secret:'test-only-session-secret-with-32-characters',cleanupSecret:'test-cleanup-secret',serveClient:false,uploadDirectory:incoming});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});await rm(incoming,{recursive:true,force:true});});const login=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:PASSWORD})});const cookie=login.headers.get('set-cookie').split(';')[0],{csrf}=await login.json();return {store,dir,incoming,base,headers:{Cookie:cookie,'X-CSRF-Token':csrf},cleanup};}
function form(input=details(),file=stl()){const f=new FormData();f.append('model',new Blob([file]),'cube.stl');f.append('preview',new Blob([png]),'preview.png');f.append('details',JSON.stringify(input));return f;}
test('teacher endpoints reject unauthenticated, forged and CSRF-free writes',async t=>{const {base,headers}=await setup(t);assert.equal((await fetch(base+'/api/admin/submissions')).status,401);assert.equal((await fetch(base+'/api/admin/submissions',{headers:{Cookie:'bnts_teacher=forged.signature'}})).status,401);assert.equal((await fetch(base+'/api/admin/logout',{method:'POST',headers:{Cookie:headers.Cookie}})).status,403);assert.equal((await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body:JSON.stringify({password:PASSWORD})})).status,403);const current=await fetch(base+'/api/admin/session',{headers});assert.equal(current.status,200);});
test('real multipart upload, idempotency, private download, status and permanent deletion',async t=>{const {base,headers,dir}=await setup(t);const data=details();const result=await fetch(base+'/api/submissions',{method:'POST',body:form(data)});assert.equal(result.status,201);const receipt=await result.json();assert(receipt.filename.startsWith('BNTS-Demo-School_Blue_'));const duplicate=await fetch(base+'/api/submissions',{method:'POST',body:form(data)});assert.equal((await duplicate.json()).id,receipt.id);assert.equal((await readdir(dir)).length,3);assert.equal((await fetch(base+`/api/admin/submissions/${receipt.id}/model`)).status,401);const download=await fetch(base+`/api/admin/submissions/${receipt.id}/download`,{headers});assert.deepEqual(Buffer.from(await download.arrayBuffer()),stl());const patch=await fetch(base+`/api/admin/submissions/${receipt.id}`,{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({status:'printed'})});assert.equal((await patch.json()).record.status,'printed');assert.equal((await fetch(base+'/api/admin/submissions',{headers}).then(r=>r.json())).records.length,1);assert.equal((await fetch(base+`/api/admin/submissions/${receipt.id}`,{method:'DELETE',headers})).status,200);assert.deepEqual(await readdir(dir),[]);});
test('invalid uploads never enter storage, and no student data is publicly listed',async t=>{const {base,dir}=await setup(t);assert.equal((await fetch(base+'/api/submissions',{method:'POST',body:form({...details(),schoolId:crypto.randomUUID()})})).status,400);assert.equal((await fetch(base+'/api/submissions',{method:'POST',body:form(details(),Buffer.from('bad'))})).status,400);const invalid=form();invalid.set('preview',new Blob(['not PNG']),'p.png');assert.equal((await fetch(base+'/api/submissions',{method:'POST',body:invalid})).status,400);assert.equal((await fetch(base+'/api/submissions')).status,404);assert.deepEqual(await readdir(dir),[]);});
test('settings survive a new store instance; unconfigured school/staff stops submissions',async t=>{const {base,headers,store,dir}=await setup(t);const settings=await store.settings();settings.schools=[];settings.staff=[];settings.classes=[];const response=await fetch(base+'/api/admin/settings',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(settings)});assert.equal(response.status,200);assert.equal((await new LocalStore(dir).settings()).schools.length,0);assert.equal((await fetch(base+'/api/config').then(r=>r.json())).acceptingUploads,false);assert.equal((await fetch(base+'/api/submissions',{method:'POST',body:form()})).status,503);});
test('expired records and their model + preview are deleted; maintenance requires its own secret',async t=>{const {base,headers,store,dir}=await setup(t);const value=validateSubmission(details(),await store.settings());const expired=makeRecord(value,'cube.stl',stl().length,new Date(Date.now()-15*86400000));await store.save(expired,stl(),png);const fresh=makeRecord({...value,requestId:crypto.randomUUID()},'cube.stl',stl().length);await store.save(fresh,stl(),png);assert.equal((await fetch(base+`/api/admin/submissions/${expired.id}/download`,{headers})).status,404);assert.equal((await fetch(base+'/api/admin/submissions',{headers}).then(r=>r.json())).records.length,1);assert.equal((await fetch(base+'/api/maintenance/cleanup',{method:'POST'})).status,401);const cleanup=await fetch(base+'/api/maintenance/cleanup',{method:'POST',headers:{Authorization:'Bearer test-cleanup-secret'}});assert.equal((await cleanup.json()).deletedSubmissions,1);assert.equal((await readdir(dir)).length,3);assert.equal((await store.get(fresh.id)).id,fresh.id);});
test('Drive upload builds school/date/optional class hierarchy and tags every artifact for expiry',async()=>{const store=new DriveStore();const created=[];store.drive={files:{list:async()=>({data:{files:[]}}),create:async options=>{created.push(options.requestBody);return {data:{id:'drive-id-'+created.length}};}}};const baseSettings=await new LocalStore('/nonexistent').settings();const value=validateSubmission({...details(),classId:baseSettings.classes[0].id},baseSettings);const record=makeRecord(value,'cube.3mf',50);await store.save(record,Buffer.from('model'),png,baseSettings);assert.deepEqual(created.slice(0,3).map(x=>x.name),['BNTS-Demo-School',record.date,'Year-8-Design']);assert.equal(created[3].parents[0],'drive-id-3');for(const file of created.slice(3))assert.equal(file.appProperties.expiresAt,record.expiresAt);assert.equal(created[5].appProperties.kind,'record');assert.equal(record.recordFileId,'drive-id-6');});

function streamedUpload(bytes, data=details()) {
 const boundary='bnts-large-upload-boundary';
 async function* body(){
  yield Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="details"\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="preview"; filename="p.png"\r\nContent-Type: image/png\r\n\r\n`);
  yield png;yield Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"; filename="large.step"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const prefix=Buffer.from('ISO-10303-21;\nHEADER;ENDSEC;DATA;\n'),suffix=Buffer.from('\nENDSEC;END-ISO-10303-21;');yield prefix;
  let remaining=bytes-prefix.length-suffix.length;const block=Buffer.alloc(64*1024,32);while(remaining>0){const size=Math.min(remaining,block.length);yield block.subarray(0,size);remaining-=size;}
  yield suffix;yield Buffer.from(`\r\n--${boundary}--\r\n`);
 }
 return {method:'POST',headers:{'Content-Type':'multipart/form-data; boundary='+boundary},body:Readable.from(body()),duplex:'half'};
}
async function temporaryFilesRemoved(directory){for(let i=0;i<100;i++){if(!(await readdir(directory)).length)return;await new Promise(resolve=>setTimeout(resolve,10));}assert.deepEqual(await readdir(directory),[]);}
test('50 MB upload is stored intact and temporary files are removed',async t=>{
 const {base,dir,incoming}=await setup(t);assert.equal((await fetch(base+'/api/config').then(r=>r.json())).maxBytes,50*1024*1024);
 const response=await fetch(base+'/api/submissions',streamedUpload(MAX_BYTES));assert.equal(response.status,201);const receipt=await response.json();
 assert.equal((await stat(path.join(dir,receipt.id+'.model'))).size,MAX_BYTES);
 await temporaryFilesRemoved(incoming);
});
test('one byte over 50 MB is rejected and partial temporary files are removed',async t=>{
 const {base,dir,incoming}=await setup(t);const response=await fetch(base+'/api/submissions',streamedUpload(MAX_BYTES+1));
 assert.equal(response.status,400);assert.match((await response.json()).error,/50 MB/);assert.deepEqual(await readdir(dir),[]);await temporaryFilesRemoved(incoming);
});

test('large Drive uploads use the resumable protocol and stream the temporary file',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'bnts-drive-large-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const filename=path.join(dir,'model.step'),size=6*1024*1024;await writeFile(filename,Buffer.alloc(size,32));
 const store=new DriveStore(),requests=[];let streamed=0;
 store.oauth.request=async options=>{requests.push(options);if(options.method==='POST')return {headers:new Headers({location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=private-test-session'})};for await(const chunk of options.data)streamed+=chunk.length;return {data:{id:'large-model-id'}};};
 store.drive={files:{list:async()=>({data:{files:[]}}),create:async()=>({data:{id:crypto.randomUUID()}})}};
 const settings=await new LocalStore('/nonexistent').settings();const record=makeRecord(validateSubmission(details(),settings),'model.step',size);await store.save(record,filename,png,settings);
 assert.equal(record.modelFileId,'large-model-id');assert.equal(requests.length,2);assert.equal(requests[0].params.uploadType,'resumable');assert.equal(requests[0].data.appProperties.expiresAt,record.expiresAt);assert.equal(requests[1].retry,false);assert.equal(streamed,size);
});

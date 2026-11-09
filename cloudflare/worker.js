import { z } from 'zod';
import { BAMBU_COLOURS, MAX_BYTES } from '../shared/catalog.js';
import { acceptedExtensions } from '../shared/formats.js';
import { cloudflareSettingsSchema, validateSubmission, makeRecord } from '../server/domain.js';
import { initialiseDatabase } from './schema.js';
import { failure, sign, verify, passwordMatches, teacherSession, sessionCookie, sameOrigin, rateLimit, clientKey } from './auth.js';
import { settings, meta, setMeta, usage, reserve, findById, findByRequest, publicRecord, receipt, cleanup, deleteRows, lookupName, STORAGE_LIMIT, PREVIEW_LIMIT } from './storage.js';
const bootstraps = new WeakMap();
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const encoder = new TextEncoder();
async function bootstrap(env) {
  if (!env.DB || !env.PRINTS) failure('Cloudflare storage is not configured. Follow the deployment guide.',503);
  if (!bootstraps.has(env.DB)) {
    const promise=initialiseDatabase(env.DB).catch(error=>{bootstraps.delete(env.DB);throw error;});
    bootstraps.set(env.DB,promise);
  }
  await bootstraps.get(env.DB);
}
function configured(env) { return typeof env.TEACHER_PASSWORD==='string' && env.TEACHER_PASSWORD.length>=12; }
function json(data,status=200,headers={}) { return Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}}); }
function security(response,teacher=false) {
  const headers=new Headers(response.headers);
  headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');headers.set('X-Frame-Options','DENY');
  headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if(teacher)headers.set('X-Robots-Tag','noindex, nofollow');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
async function readJson(request,limit=24000) {
  if(!request.body)failure('The request was empty.');
  const reader=request.body.getReader();const chunks=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();failure('The request is too large.',413);}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{failure('The request could not be read.');}
}
async function publicConfig(env) {
  const s=await settings(env);
  const {results:previousSchools}=await env.DB.prepare("SELECT school_id AS id, json_extract(data,'$.school') AS name FROM submissions WHERE state='ready' AND expires_at>? GROUP BY school_id").bind(Date.now()).all();
  const lookupSchools=[...s.schools,...previousSchools.filter(previous=>!s.schools.some(current=>current.id===previous.id))];
  return {schools:s.schools,lookupSchools,staff:s.staff,classes:s.classes,colours:BAMBU_COLOURS.filter(c=>s.colours.includes(c.id)),customColourEnabled:s.customColourEnabled,acceptedExtensions:acceptedExtensions(s),maxBytes:MAX_BYTES,localDemo:false,acceptingUploads:configured(env)&&!!s.schools.length&&!!s.staff.length,uploadMode:'cloudflare',studentLookupSupported:true};
}
async function initUpload(request,env) {
  sameOrigin(request);
  if(!configured(env))failure('Your teacher is still setting up uploads.',503);
  await rateLimit(env,'uploads:'+await clientKey(request),60,3600);
  await rateLimit(env,'uploads:global',120,3600);
  const body=await readJson(request),s=await settings(env);
  if(!s.schools.length||!s.staff.length)failure('Your teacher is still setting up uploads.',503);
  const details=validateSubmission(body.details,s);
  if(typeof body.name!=='string'||!body.name.trim()||body.name.length>255||!acceptedExtensions(s).includes(body.name.split('.').at(-1).toLowerCase()))failure('This file type is not enabled. Choose an accepted format.');
  if(!Number.isSafeInteger(body.bytes)||body.bytes<1||body.bytes>MAX_BYTES)failure('Files must be 50 MB or smaller.');
  if(!Number.isSafeInteger(body.previewBytes)||body.previewBytes<8||body.previewBytes>PREVIEW_LIMIT)failure('Return to the preview step to prepare a valid thumbnail.');
  let row=await findByRequest(env,details.requestId);
  if(!row){const record=makeRecord(details,body.name,body.bytes);await reserve(env,record,body.previewBytes);row=await findByRequest(env,details.requestId);if(!row)failure('The printing storage is full. Ask a staff member to remove files before trying again.',507);}
  if(row.state==='ready'&&row.expires_at>Date.now())return json({receipt:receipt(row)});
  if(row.state!=='pending'||row.pending_until<=Date.now())failure('This upload has expired. Choose your file again to start a new request.',410);
  const stored=publicRecord(row);
  if(row.model_bytes!==body.bytes||row.preview_bytes!==body.previewBytes||stored.originalName!==body.name)failure('This request has different file details. Choose the file again.',409);
  const token=await sign(env,{kind:'upload',id:row.id,exp:row.pending_until});
  return json({id:row.id,token,modelDone:!!row.model_done,previewDone:!!row.preview_done});
}
async function uploadPart(request,env,id,kind) {
  sameOrigin(request);
  const token=await verify(env,request.headers.get('Authorization')?.replace(/^Bearer /,''),'upload');
  if(!token||token.id!==id)failure('The upload link has expired. Please submit again.',401);
  const row=await findById(env,id),now=Date.now();
  if(!row||row.state!=='pending'||row.pending_until<=now)failure('This upload is no longer available.',410);
  if(row[kind+'_done'])return json({ok:true});
  const size=row[kind+'_bytes'],claimed=now+10*60*1000;
  if(Number(request.headers.get('Content-Length'))!==size)failure('The file size does not match the upload request.',400);
  const lease=await env.DB.prepare(`UPDATE submissions SET ${kind}_lease=? WHERE id=? AND state='pending' AND ${kind}_done=0 AND ${kind}_lease<=?`).bind(claimed,id,now).run();
  if(!lease.meta.changes)failure('This file is already being uploaded. Please wait, then try again.',409);
  const objectKey=row[kind+'_key'];
  try{
    let body=request.body;
    if(kind==='preview'){
      const bytes=new Uint8Array(await request.arrayBuffer());
      if(bytes.length!==size||[137,80,78,71,13,10,26,10].some((v,i)=>bytes[i]!==v))failure('The preview could not be read. Return to the preview step.');
      body=bytes;
    }
    // R2 consumes the known-length request stream directly: no 50 MB buffering.
    // Conditional creation prevents a retry/slow request from overwriting a completed original.
    const object=await env.PRINTS.put(objectKey,body,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:kind==='preview'?'image/png':'application/octet-stream',cacheControl:'private, no-store'},customMetadata:{submissionId:id,expiresAt:new Date(row.expires_at).toISOString()}});
    const stored=object||await env.PRINTS.head(objectKey);
    if(!stored||stored.size!==size)failure('The uploaded file was incomplete. Please try again.');
    const result=await env.DB.prepare(`UPDATE submissions SET ${kind}_done=1,${kind}_lease=0 WHERE id=? AND state='pending' AND ${kind}_lease=?`).bind(id,claimed).run();
    if(!result.meta.changes){
      const current=await findById(env,id);
      if(!current||current.state==='deleting')await env.PRINTS.delete(objectKey);
      failure('This upload has expired. Choose the file again.',410);
    }
    return json({ok:true});
  }finally{await env.DB.prepare(`UPDATE submissions SET ${kind}_lease=0 WHERE id=? AND ${kind}_lease=?`).bind(id,claimed).run();}
}
async function completeUpload(request,env,id) {
  sameOrigin(request);
  const token=await verify(env,request.headers.get('Authorization')?.replace(/^Bearer /,''),'upload');
  if(!token||token.id!==id)failure('The upload link has expired. Please submit again.',401);
  let row=await findById(env,id);
  if(!row||row.expires_at<=Date.now()||row.state==='deleting')failure('This upload has expired.',410);
  if(row.state==='ready')return json(receipt(row));
  if(!row.model_done||!row.preview_done||row.pending_until<=Date.now())failure('The upload is not complete. Please try submitting again.',409);
  const [model,preview]=await Promise.all([env.PRINTS.head(row.model_key),env.PRINTS.head(row.preview_key)]);
  if(model?.size!==row.model_bytes||preview?.size!==row.preview_bytes)failure('The upload is incomplete. Please try again.',409);
  await env.DB.prepare("UPDATE submissions SET state='ready' WHERE id=? AND state='pending'").bind(id).run();
  row=await findById(env,id);
  if(row?.state!=='ready')failure('The upload could not be confirmed. Please try again.',409);
  return json(receipt(row),201);
}
function downloadHeaders(row,kind,student=false) {
  const record=publicRecord(row);
  const headers=new Headers({'Content-Type':kind==='preview'?'image/png':'application/octet-stream','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  if(kind!=='preview'&&!student){const fallback=record.filename.replace(/[^\x20-\x7e]|["\\]/g,'_');headers.set('Content-Disposition',`attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(record.filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`);}
  return headers;
}
async function streamObject(env,row,kind,student=false) {
  if(!row||row.state!=='ready'||row.expires_at<=Date.now())failure(student?'This has been deleted.':'This submission is no longer available.',404);
  const object=await env.PRINTS.get(kind==='preview'?row.preview_key:row.model_key);
  if(!object)failure(student?'This has been deleted.':'This file is no longer available.',404);
  return new Response(object.body,{headers:downloadHeaders(row,kind,student)});
}
async function studentLookup(request,env) {
  sameOrigin(request);await rateLimit(env,'lookup:'+await clientKey(request),10,60);await rateLimit(env,'lookup:global',300,60);
  const body=await readJson(request,1000);
  if(!UUID.test(body.schoolId||'')||typeof body.firstName!=='string'||!body.firstName.trim()||body.firstName.length>40)failure('Choose your school and enter your first name.');
  const offset=body.offset??0;if(!Number.isSafeInteger(offset)||offset<0||offset>100000)failure('Please search for your files again.');
  const name=lookupName(body.firstName),exp=Date.now()+15*60*1000;
  const {results:rows}=await env.DB.prepare("SELECT id,data,expires_at FROM submissions WHERE school_id=? AND lookup_name=? AND state='ready' AND expires_at>? ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET ?").bind(body.schoolId,name,Date.now(),offset).all();
  const token=await sign(env,{kind:'student',schoolId:body.schoolId,name,exp});
  return json({token,nextOffset:rows.length>30?offset+30:null,files:rows.slice(0,30).map(row=>{const record=publicRecord(row);return{id:row.id,name:record.originalName,createdAt:record.createdAt,expiresAt:record.expiresAt};})});
}
async function admin(request,env,path) {
  const session=await teacherSession(env,request),method=request.method;
  if(path==='/api/admin/session'&&method==='GET')return json({csrf:session.csrf});
  if(path==='/api/admin/logout'&&method==='POST'){
    await env.DB.prepare('INSERT OR REPLACE INTO revoked_sessions(id,expires_at) VALUES (?,?)').bind(session.id,session.exp).run();
    return json({ok:true},200,{'Set-Cookie':sessionCookie(request,'',true)});
  }
  if(path==='/api/admin/settings'&&method==='GET'){
    const [s,storage,lastRun,lastSuccess,error]=await Promise.all([settings(env),usage(env),meta(env,'cleanup_last_run'),meta(env,'cleanup_last_success'),meta(env,'cleanup_error')]);
    return json({platform:'cloudflare',settings:s,storage,connected:true,localDemo:false,oauthConfigured:false,tokenPersisted:true,cleanupConfigured:true,cleanup:{lastRun,lastSuccess,error}});
  }
  if(path==='/api/admin/settings'&&method==='PUT'){
    const s=cloudflareSettingsSchema.parse(await readJson(request,90000));await setMeta(env,'settings',s);return json({ok:true});
  }
  if(path==='/api/admin/submissions'&&method==='GET'){
    const {results:rows}=await env.DB.prepare("SELECT data FROM submissions WHERE state='ready' AND expires_at>? ORDER BY created_at DESC LIMIT 1000").bind(Date.now()).all();return json({records:rows.map(publicRecord)});
  }
  if(path==='/api/admin/cleanup'&&method==='POST')return json(await cleanup(env));
  const match=path.match(/^\/api\/admin\/submissions\/([a-f\d-]{36})(?:\/(model|preview|download))?$/i);
  if(match&&UUID.test(match[1])){
    const row=await findById(env,match[1]);
    if(match[2]&&method==='GET')return streamObject(env,row,match[2]);
    if(method==='DELETE'&&!match[2]){if(!row)failure('This submission was already removed.',404);await deleteRows(env,[row]);return json({ok:true});}
    if(method==='PATCH'&&!match[2]){
      if(!row||row.state!=='ready'||row.expires_at<=Date.now())failure('This submission has expired.',404);
      const body=await readJson(request,1000);if(!['queued','printing','printed'].includes(body.status))failure('Choose a valid print status.');
      const record={...publicRecord(row),status:body.status};
      const updated=await env.DB.prepare("UPDATE submissions SET data=? WHERE id=? AND state='ready'").bind(JSON.stringify(record),row.id).run();
      if(!updated.meta.changes)failure('This submission has expired.',404);
      return json({record});
    }
  }
  failure('That page could not be found.',404);
}
async function dispatch(request,env) {
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
  await bootstrap(env);
  if(path==='/api/health'&&method==='GET')return json({ok:true,platform:'cloudflare'});
  if(path==='/api/config'&&method==='GET')return json(await publicConfig(env));
  if(path==='/api/admin/login'&&method==='POST'){
    sameOrigin(request);
    if(!configured(env))failure('Add a TEACHER_PASSWORD of at least 12 characters in Cloudflare settings.',503);
    await rateLimit(env,'login:'+await clientKey(request),8,900);
    const body=await readJson(request,1000);if(!await passwordMatches(env,body.password))failure('That password is not correct.',401);
    const session={kind:'teacher',id:crypto.randomUUID(),csrf:crypto.randomUUID()+crypto.randomUUID(),exp:Date.now()+8*3600000};
    return json({csrf:session.csrf},200,{'Set-Cookie':sessionCookie(request,await sign(env,session))});
  }
  if(path.startsWith('/api/admin/'))return admin(request,env,path);
  if(path==='/api/uploads/init'&&method==='POST')return initUpload(request,env);
  const upload=path.match(/^\/api\/uploads\/([a-f\d-]{36})\/(model|preview|complete)$/i);
  if(upload&&UUID.test(upload[1])){
    if(method==='PUT'&&upload[2]!=='complete')return uploadPart(request,env,upload[1],upload[2]);
    if(method==='POST'&&upload[2]==='complete')return completeUpload(request,env,upload[1]);
  }
  if(path==='/api/student/lookup'&&method==='POST')return studentLookup(request,env);
  const student=path.match(/^\/api\/student\/files\/([a-f\d-]{36})\/(model|preview)$/i);
  if(student&&UUID.test(student[1])&&method==='GET'){
    const token=await verify(env,request.headers.get('Authorization')?.replace(/^Bearer /,''),'student');
    if(!token)failure('Please enter your school and first name again.',401);
    const row=await findById(env,student[1]);
    if(!row||row.school_id!==token.schoolId||row.lookup_name!==token.name)failure('This has been deleted.',404);
    return streamObject(env,row,student[2],true);
  }
  failure('That page could not be found.',404);
}
export default {
  async fetch(request,env) {
    try{return security(await dispatch(request,env),new URL(request.url).pathname.startsWith('/teacher'));}
    catch(error){const status=error instanceof z.ZodError?400:error.status||503;return security(json({error:error instanceof z.ZodError?error.issues[0]?.message:error.status?error.message:'Storage is unavailable. Ask your teacher to check Cloudflare storage, then try again.'},status));}
  },
  async scheduled(controller,env,ctx) { await bootstrap(env);ctx.waitUntil(cleanup(env)); },
};

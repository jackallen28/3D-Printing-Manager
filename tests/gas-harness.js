import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { FILE_FORMATS } from '../shared/formats.js';
import { simpleColours } from '../shared/printing.js';
import { BAMBU_COLOURS, DEFAULT_SETTINGS, PREFERENCES, APP_TAG, ADVANCED_FILAMENT } from '../shared/catalog.js';
export function gasHarness() {
 const properties=new Map([['TEACHER_PASSWORD','local-demo-teacher-password']]),cache=new Map(),files=new Map(),triggers=[];let sequence=0,locked=false;
 const blob=(value,mime='',name='')=>{const buffer=Buffer.isBuffer(value)?value:typeof value==='string'?Buffer.from(value):Buffer.from(value||[]);return {getBytes:()=>[...buffer],getDataAsString:()=>buffer.toString('utf8'),getContentType:()=>mime,getName:()=>name};};
 const propertyApi={getProperty:k=>properties.get(k)||null,setProperty:(k,v)=>properties.set(k,String(v)),deleteProperty:k=>properties.delete(k),getProperties:()=>Object.fromEntries(properties)};
 const cacheApi={get:k=>{const v=cache.get(k);return v&&v.exp>Date.now()?v.value:null;},put:(k,value,ttl)=>cache.set(k,{value,exp:Date.now()+ttl*1000}),remove:k=>cache.delete(k)};
 files.set('root-folder-123456',{id:'root-folder-123456',name:'School printing',mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}});
 const fileApi={
  get:(id)=>{if(!files.has(id))throw new Error('404 not found');return files.get(id);},
  list:options=>{
   let list=[...files.values()];const q=options.q||'';
   for(const match of q.matchAll(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/g)) list=list.filter(f=>f.appProperties?.[match[1]]===match[2]);
   const parent=q.match(/'([^']+)' in parents/);if(parent)list=list.filter(f=>f.parents?.includes(parent[1]));
   if(q.includes("mimeType = 'application/vnd.google-apps.folder'"))list=list.filter(f=>f.mimeType==='application/vnd.google-apps.folder');
   return {files:list};
  },
  create:(metadata,content)=>{const id='mock-drive-id-'+(++sequence);const file={...metadata,id,blob:content};files.set(id,file);return {id};},
  update:(metadata,id,content)=>{const f=fileApi.get(id);Object.assign(f,metadata);if(content)f.blob=content;return f;},
  remove:id=>{if(!files.delete(id))throw new Error('404 not found');},
 };
 const context=vm.createContext({BNTS_CATALOG:{colours:BAMBU_COLOURS,defaults:DEFAULT_SETTINGS,preferences:PREFERENCES,tag:APP_TAG,formats:FILE_FORMATS,simpleColours,advancedFilament:ADVANCED_FILAMENT},PropertiesService:{getScriptProperties:()=>propertyApi},CacheService:{getScriptCache:()=>cacheApi},LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true;},releaseLock:()=>{locked=false;}})},Utilities:{getUuid:randomUUID,newBlob:blob,base64Encode:v=>Buffer.from(v).toString('base64'),base64EncodeWebSafe:v=>Buffer.from(v).toString('base64url'),base64Decode:v=>[...Buffer.from(v,'base64')],base64DecodeWebSafe:v=>[...Buffer.from(v,'base64url')],computeHmacSha256Signature:(v,key)=>[...createHmac('sha256',key).update(v).digest()],formatDate:(date,zone,format)=>{const d=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date);const part=n=>d.find(p=>p.type===n).value;return format==='yyyyMMddHH'?part('year')+part('month')+part('day')+part('hour'):`${part('year')}-${part('month')}-${part('day')}`;}},Drive:{Files:fileApi},ScriptApp:{getOAuthToken:()=> 'mock-server-only-token',getProjectTriggers:()=>triggers,newTrigger:handler=>({timeBased(){return this;},everyHours(hours){if(hours!==1)throw new Error('Expected hourly cleanup');return this;},create(){triggers.push({getHandlerFunction:()=>handler});}}),getService:()=>({getUrl:()=> 'https://script.google.com/macros/s/test/exec'})},UrlFetchApp:{fetch:(url,options)=>{if(options.headers.Authorization!=='Bearer mock-server-only-token')throw new Error('Auth missing');const id=decodeURIComponent(url.match(/\/files\/([^?]+)/)[1]);return {getResponseCode:()=>files.has(id)?200:404,getBlob:()=>fileApi.get(id).blob};}},console});
 vm.runInContext(readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
 return {context,properties,files,triggers,api:request=>JSON.parse(JSON.stringify(context.bntsApi(request)))};
}

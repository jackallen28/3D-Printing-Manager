import {Zip,ZipPassThrough,strToU8} from 'fflate';
import {isAppsScript} from '../platform';
import {modelFile} from './api';
import type {PrintRecord} from '../types';
interface FileSink {write:(data:Uint8Array)=>Promise<void>;close:()=>Promise<void>;abort?:(error:unknown)=>Promise<void>}
export async function exportPrints(records:PrintRecord[],onProgress:(done:number,total:number)=>void) {
 if(!records.length)return;
 const filename='BNTS-prints-'+new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())+'.zip';
 const picker=(window as unknown as {showSaveFilePicker?:(options:unknown)=>Promise<{createWritable:()=>Promise<FileSink>}>}).showSaveFilePicker;
 let sink:FileSink;const chunks:Uint8Array<ArrayBuffer>[]=[];
 if(picker){const handle=await picker.call(window,{suggestedName:filename,types:[{description:'ZIP archive',accept:{'application/zip':['.zip']}}]});sink=await handle.createWritable();}
 else{if(records.reduce((n,r)=>n+r.bytes,0)>150*1024*1024)throw new Error('For exports over 150 MB, use Chrome or Edge, or select fewer files.');sink={async write(chunk){chunks.push(new Uint8Array(chunk));},async close(){const url=URL.createObjectURL(new Blob(chunks,{type:'application/zip'}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}};}
 let writes=Promise.resolve(),zipError:Error|undefined;
 const zip=new Zip((error,chunk)=>{if(error){zipError=error;return;}writes=writes.then(()=>sink.write(chunk));});
 const manifest:string[][]=[];
 const paths=new Set<string>(),part=(s:string)=>s.replace(/[\\/\x00-\x1f]/g,'-').replace(/^\.+$/,'_');
 try{for(let i=0;i<records.length;i++){
  const r=records[i],folder=[part(r.school),r.date,r.classroom?part(r.classroom):''].filter(Boolean).join('/');
  let path=folder+'/'+r.filename;if(paths.has(path))path=folder+'/'+r.id+'/'+r.filename;paths.add(path);manifest.push([path,r.originalName,r.school,r.firstName,r.classroom,String(r.scalePercent??100),r.dimensionsMm?r.dimensionsMm.map(v=>v.toFixed(1)).join(' x '):'',r.colourMapping.map((m,i)=>(m.partName||'Part '+(i+1))+': '+(m.target==='Custom'?'Custom: '+r.customColour:m.target)).join('; '),r.advancedFilamentNote||'',r.supports,r.printer,r.quality,String(r.copies),r.staff,r.notes,r.designLink]);
  const entry=new ZipPassThrough(path);zip.add(entry);await writes;
  const response=isAppsScript?new Response(await modelFile(r.id,r.filename)):await fetch(`/api/admin/submissions/${r.id}/download`);
  if(!response.ok||!response.body)throw new Error(`Could not download ${r.firstName}’s file. It may have expired.`);
  const reader=response.body.getReader();try{while(true){const {value,done}=await reader.read();if(done)break;entry.push(value,false);await writes;if(zipError)throw zipError;}}finally{reader.releaseLock();}
  entry.push(new Uint8Array(),true);await writes;onProgress(i+1,records.length);
 }const csvCell=(value:string)=>{const safe=/^[=+\-@\t\r]/.test(value)?"'"+value:value;return '"'+safe.replaceAll('"','""')+'"';};const csv=[['File','Original name','School','First name','Class','Scale (%)','Dimensions (mm)','Colour preferences','Advanced filament request','Supports','Printer','Quality','Copies','Staff','Notes','Design link'],...manifest].map(row=>row.map(csvCell).join(',')).join('\r\n');const instructions=new ZipPassThrough('Print settings.csv');zip.add(instructions);instructions.push(strToU8('\ufeff'+csv),true);await writes;zip.end();await writes;if(zipError)throw zipError;await sink.close();}
 catch(error){zip.terminate();await sink.abort?.(error).catch(()=>{});throw error;}
}

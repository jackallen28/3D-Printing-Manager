import { isAppsScript } from '../platform';
let csrf = '';
let uploadMode = 'multipart';
export function setUploadMode(value?: string) { uploadMode = value || 'multipart'; }
const sessionKey = 'bnts-teacher:' + (window.BNTS_GAS?.baseUrl || '');
let gasToken = isAppsScript ? sessionStorage.getItem(sessionKey) || '' : '';
async function gasRequest(path: string, options: RequestInit = {}, payload?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = payload ?? (typeof options.body === 'string' ? JSON.parse(options.body) : undefined);
    window.google!.script.run.withSuccessHandler((response: any) => {
      if (!response.ok) {
        if (response.status === 401 && path !== '/admin/login') window.dispatchEvent(new Event('teacher-session-expired'));
        reject(new Error(response.error || 'The request could not be completed.')); return;
      }
      if (response.data?.token) { gasToken = response.data.token; sessionStorage.setItem(sessionKey, gasToken); }
      if (path === '/admin/logout') { gasToken = ''; sessionStorage.removeItem(sessionKey); }
      resolve(response.data);
    }).withFailureHandler(() => reject(new Error('Google could not complete the request. Please try again shortly.')))
      .bntsApi({ path, method: options.method || 'GET', body: body ?? null, token: gasToken, csrf });
  });
}
export function setCsrf(value: string) { csrf = value; }
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  if (isAppsScript) return gasRequest(path, options);
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (csrf) headers.set('X-CSRF-Token', csrf);
  const response = await fetch('/api' + path, { ...options, headers });
  let result;
  try { result = await response.json(); } catch { throw new Error('The server could not be reached. Please try again.'); }
  if (!response.ok) { if(response.status===401&&path!=='/admin/login') window.dispatchEvent(new Event('teacher-session-expired')); throw new Error(result.error || 'Something went wrong. Please try again.'); }
  return result;
}
export function upload(form: FormData, onProgress: (value: number) => void): Promise<any> {
  if (uploadMode === 'cloudflare') return cloudflareUpload(form,onProgress);
  if (isAppsScript) return (async () => {
    onProgress(10);
    const model = form.get('model') as File, preview = form.get('preview') as File;
    const body = { details: JSON.parse(String(form.get('details'))), name: model.name, model: await base64(model), preview: await base64(preview) };
    onProgress(35);
    const result = await gasRequest('/submissions', {method:'POST'}, body);
    onProgress(100); return result;
  })();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/submissions');
    xhr.timeout = 600000;
    xhr.upload.onprogress = event => { if(event.lengthComputable) onProgress(Math.round(event.loaded/event.total*100)); };
    xhr.onload = () => { try { const result=JSON.parse(xhr.responseText); xhr.status>=200&&xhr.status<300 ? resolve(result) : reject(new Error(result.error||'Upload failed.')); } catch { reject(new Error('The upload could not be confirmed. Retry to check the same submission.')); } };
    xhr.onerror = () => reject(new Error('Connection lost. Check your internet, then retry; this will not duplicate your submission.'));
    xhr.ontimeout = () => reject(new Error('The upload timed out. Retry to check the same submission.'));
    xhr.send(form);
  });
}
function base64(blob: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result).split(',')[1]); reader.onerror=()=>reject(new Error('Could not read your file.')); reader.readAsDataURL(blob); }); }
export async function modelFile(id: string, filename: string): Promise<File> {
  if (isAppsScript) { const result=await gasRequest(`/admin/submissions/${id}/model`); return new File([decodeBase64(result.base64)], filename); }
  const response=await fetch(`/api/admin/submissions/${id}/model`);
  if (!response.ok) throw new Error('The model could not be loaded. It may have expired.');
  return new File([await response.blob()], filename);
}
export async function previewUrl(id: string): Promise<string> {
  if (!isAppsScript) return `/api/admin/submissions/${id}/preview`;
  const result=await gasRequest(`/admin/submissions/${id}/preview`);
  return 'data:image/png;base64,' + result.base64;
}
export async function downloadModel(id: string, filename: string) {
  const file=await modelFile(id,filename);const url=URL.createObjectURL(file);const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function decodeBase64(value: string): Uint8Array<ArrayBuffer> { const binary=atob(value);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes; }

async function cloudflareUpload(form: FormData,onProgress:(value:number)=>void) {
 const model=form.get('model') as File,preview=form.get('preview') as File;
 const pending=await api('/uploads/init',{method:'POST',body:JSON.stringify({details:JSON.parse(String(form.get('details'))),name:model.name,bytes:model.size,previewBytes:preview.size})});
 if(pending.receipt)return pending.receipt;
 const total=model.size+preview.size;
 async function part(kind:'model'|'preview',file:File,done:boolean) {
  if(done)return;
  return new Promise<void>((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',`/api/uploads/${pending.id}/${kind}`);xhr.setRequestHeader('Authorization','Bearer '+pending.token);xhr.setRequestHeader('Content-Type',kind==='preview'?'image/png':'application/octet-stream');xhr.timeout=600000;
   xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.min(99,Math.round(((kind==='preview'?model.size:0)+event.loaded)/total*100)));};
   xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300){resolve();return;}try{reject(new Error(JSON.parse(xhr.responseText).error||'The upload failed. Please try again.'));}catch{reject(new Error('The upload could not be confirmed. Please try again.'));}};
   xhr.onerror=()=>reject(new Error('Connection lost. Retry to continue the same submission.'));xhr.ontimeout=()=>reject(new Error('The upload timed out. Retry to continue the same submission.'));xhr.send(file);
  });
 }
 await part('model',model,pending.modelDone);await part('preview',preview,pending.previewDone);
 const result=await api(`/uploads/${pending.id}/complete`,{method:'POST',headers:{Authorization:'Bearer '+pending.token}});onProgress(100);return result;
}

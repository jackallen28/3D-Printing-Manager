import { DEFAULT_SETTINGS } from '../shared/catalog.js';
import { safePart } from '../server/domain.js';
export const STORAGE_LIMIT = 8_000_000_000;
export const PREVIEW_LIMIT = 512*1024;
export const PENDING_MS = 60*60*1000;
export async function settings(env) {
  const row = await env.DB.prepare('SELECT value FROM app_meta WHERE key=?').bind('settings').first();
  return row ? JSON.parse(row.value) : { ...structuredClone(DEFAULT_SETTINGS), folderId:'' };
}
export async function meta(env, key, fallback=null) {
  const row = await env.DB.prepare('SELECT value FROM app_meta WHERE key=?').bind(key).first();
  return row ? JSON.parse(row.value) : fallback;
}
export async function setMeta(env, key, value) {
  await env.DB.prepare('INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value)).run();
}
export function keys(record) {
  const school=safePart(record.school,60)+'--'+record.schoolId.slice(0,8);
  const classroom=record.classroom ? safePart(record.classroom,60)+'--'+record.classId.slice(0,8)+'/' : '';
  const model=`submissions/${school}/${record.date}/${classroom}${record.id}/${record.filename}`;
  return { model, preview:model+'.preview.png' };
}
export function publicRecord(row) { return JSON.parse(row.data); }
export function receipt(row) {
  const record=publicRecord(row);
  return {id:record.id,filename:record.filename,expiresAt:record.expiresAt,firstName:record.firstName};
}
export const findById=(env,id)=>env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(id).first();
export const findByRequest=(env,id)=>env.DB.prepare('SELECT * FROM submissions WHERE request_id=?').bind(id).first();
export async function usage(env) {
  const row=await env.DB.prepare('SELECT COALESCE(SUM(reserved_bytes),0) AS bytes, COUNT(*) AS files FROM submissions').first();
  return {usedBytes:row.bytes,limitBytes:STORAGE_LIMIT,files:row.files};
}
export const lookupName = text => text.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export async function reserve(env, record, previewBytes) {
  const key=keys(record), now=Date.now(), reserved=record.bytes+PREVIEW_LIMIT+16*1024;
  return env.DB.prepare(`INSERT INTO submissions
    (id,request_id,school_id,lookup_name,data,reserved_bytes,model_bytes,preview_bytes,model_key,preview_key,created_at,expires_at,pending_until)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
    WHERE (SELECT COALESCE(SUM(reserved_bytes),0) FROM submissions)+?<=?
    ON CONFLICT(request_id) DO NOTHING`).bind(record.id,record.requestId,record.schoolId,lookupName(record.firstName),JSON.stringify(record),reserved,record.bytes,previewBytes,key.model,key.preview,now,Date.parse(record.expiresAt),now+PENDING_MS,reserved,STORAGE_LIMIT).run();
}
export async function deleteRows(env, rows) {
  if (!rows.length) return 0;
  const ids=rows.map(row=>row.id), marks=ids.map(()=>'?').join(',');
  // Hide rows first, but retain their reservations until every R2 object is removed.
  await env.DB.prepare(`UPDATE submissions SET state='deleting' WHERE id IN (${marks})`).bind(...ids).run();
  await env.PRINTS.delete(rows.flatMap(row=>[row.model_key,row.preview_key]));
  await env.DB.prepare(`DELETE FROM submissions WHERE state='deleting' AND id IN (${marks})`).bind(...ids).run();
  return rows.length;
}
export async function cleanup(env) {
  const now=Date.now();
  await setMeta(env,'cleanup_last_run',new Date(now).toISOString());
  try {
    // Bound each invocation for the Workers free CPU/subrequest limits. The 8 GB
    // storage cap and 10-minute schedule leave capacity to clear expired and incomplete uploads.
    const {results:rows}=await env.DB.prepare(`SELECT id,model_key,preview_key FROM submissions
      WHERE state='deleting' OR (state='ready' AND expires_at<=?)
      OR (state='pending' AND pending_until<=? AND model_lease<=? AND preview_lease<=?)
      ORDER BY created_at LIMIT 50`).bind(now,now,now,now).all();
    const deletedSubmissions=await deleteRows(env,rows);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM revoked_sessions WHERE expires_at<=?').bind(now),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(now),
    ]);
    await setMeta(env,'cleanup_last_success',new Date().toISOString());
    await setMeta(env,'cleanup_error',null);
    return {deletedSubmissions,moreMayRemain:rows.length===50};
  } catch(error) {
    await setMeta(env,'cleanup_error','Cleanup failed. Check Cloudflare storage and try again.');
    throw error;
  }
}

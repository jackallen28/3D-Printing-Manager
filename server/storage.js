import { google } from 'googleapis';
import { Readable } from 'node:stream';
import { mkdir, readFile, writeFile, rename, readdir, unlink, copyFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { APP_TAG, DEFAULT_SETTINGS, BAMBU_COLOURS } from '../shared/catalog.js';
import { isExpired, safePart } from './domain.js';
const cloneDefault = () => structuredClone(DEFAULT_SETTINGS);
const esc = s => s.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
export class LocalStore {
  constructor(directory) { this.directory = directory; }
  async init() { await mkdir(this.directory, { recursive: true }); }
  async settings() {
    try { return JSON.parse(await readFile(path.join(this.directory, 'settings.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; return { ...cloneDefault(), folderId: 'local-demo-folder', schools: [{ id: '11111111-1111-4111-8111-111111111111', name: 'BNTS Demo School' }], staff: [{ id: '22222222-2222-4222-8222-222222222222', name: 'BNTS Team' }], classes: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Year 8 · Design', schoolId: '11111111-1111-4111-8111-111111111111' }], colours: BAMBU_COLOURS.slice(0, 28).map(c => c.id) }; }
  }
  async saveSettings(value) { await this.atomic('settings.json', JSON.stringify(value)); }
  async checkFolder() { return { name: 'Local development storage' }; }
  async atomic(filename, data) { await writeFile(path.join(this.directory, filename + '.tmp'), data); await rename(path.join(this.directory, filename + '.tmp'), path.join(this.directory, filename)); }
  async list() { const names = await readdir(this.directory); return Promise.all(names.filter(n => n.endsWith('.record.json')).map(async n => JSON.parse(await readFile(path.join(this.directory, n), 'utf8')))); }
  async findRequest(requestId) { return (await this.list()).find(r => r.requestId === requestId); }
  async save(record, model, preview) {
    if (typeof model === 'string') {
      const target = path.join(this.directory, record.id + '.model');
      await copyFile(model, target + '.tmp'); await rename(target + '.tmp', target);
    } else await this.atomic(record.id + '.model', model);
    await this.atomic(record.id + '.png', preview);
    await this.atomic(record.id + '.record.json', JSON.stringify(record)); return record;
  }
  async get(id) { try { return JSON.parse(await readFile(path.join(this.directory, id + '.record.json'), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
  async bytes(record, kind) { return readFile(path.join(this.directory, record.id + (kind === 'preview' ? '.png' : '.model'))); }
  async status(record, status) { record.status = status; await this.atomic(record.id + '.record.json', JSON.stringify(record)); return record; }
  async remove(record) { for (const suffix of ['.model', '.png', '.record.json']) await unlink(path.join(this.directory, record.id + suffix)).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  async cleanup(now = new Date()) { const expired = (await this.list()).filter(r => isExpired(r, now)); for (const r of expired) await this.remove(r); return { deletedSubmissions: expired.length }; }
}
export class DriveStore {
  constructor() {
    this.oauth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL.replace(/\/$/, '')}/api/admin/google/callback` : undefined);
    this.envToken = !!process.env.GOOGLE_REFRESH_TOKEN;
    if (this.envToken) this.oauth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    this.drive = google.drive({ version: 'v3', auth: this.oauth });
  }
  get connected() { return !!this.oauth.credentials.refresh_token; }
  async init() {}
  async all(q, fields = 'id,name,appProperties,parents') {
    const files = []; let pageToken;
    do { const result = await this.drive.files.list({ q, spaces: 'drive', fields: `nextPageToken,files(${fields})`, pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true }); files.push(...(result.data.files || [])); pageToken = result.data.nextPageToken; } while (pageToken);
    return files;
  }
  async configFile() {
    const r = await this.drive.files.list({ spaces: 'appDataFolder', q: `trashed = false and name = 'bnts-print-studio-settings.json'`, fields: 'files(id)', pageSize: 10 });
    if ((r.data.files || []).length > 1) throw new Error('More than one BNTS configuration was found. Ask the administrator to resolve the duplicate.');
    return r.data.files?.[0]?.id;
  }
  async json(id) { const r = await this.drive.files.get({ fileId: id, alt: 'media', supportsAllDrives: true }, { responseType: 'text' }); return typeof r.data === 'string' ? JSON.parse(r.data) : r.data; }
  async settings() {
    if (!this.connected) return cloneDefault();
    const id = await this.configFile();
    return id ? this.json(id) : { ...cloneDefault(), folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '' };
  }
  async saveSettings(settings) {
    await this.checkFolder(settings.folderId);
    const id = await this.configFile(); const media = { mimeType: 'application/json', body: Readable.from([JSON.stringify(settings)]) };
    if (id) await this.drive.files.update({ fileId: id, media });
    else await this.drive.files.create({ requestBody: { name: 'bnts-print-studio-settings.json', parents: ['appDataFolder'] }, media });
  }
  async checkFolder(folderId) {
    const r = await this.drive.files.get({ fileId: folderId, fields: 'id,name,mimeType,trashed,capabilities(canAddChildren)', supportsAllDrives: true });
    if (r.data.trashed || r.data.mimeType !== 'application/vnd.google-apps.folder' || !r.data.capabilities?.canAddChildren) throw Object.assign(new Error('Use a Google Drive folder that the connected Google account can add files to.'), { status: 400 });
    return r.data;
  }
  async folder(parent, name, key) {
    const existing = await this.all(`trashed = false and '${esc(parent)}' in parents and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='bntsKey' and value='${esc(key)}' }`);
    if (existing.length) return existing[0].id;
    return (await this.drive.files.create({ requestBody: { name: safePart(name, 100), mimeType: 'application/vnd.google-apps.folder', parents: [parent], appProperties: { bntsApp: APP_TAG, bntsKey: key, kind: 'folder' } }, fields: 'id', supportsAllDrives: true })).data.id;
  }
  async list() {
    if (!this.connected) return [];
    const files = await this.all(`trashed = false and appProperties has { key='bntsApp' and value='${APP_TAG}' } and appProperties has { key='kind' and value='record' }`);
    const records = [];
    // Bound parallelism for school-sized queues and Google API quotas.
    for (let i = 0; i < files.length; i += 5) records.push(...await Promise.all(files.slice(i, i + 5).map(async f => ({ ...await this.json(f.id), recordFileId: f.id }))));
    return records;
  }
  async findRequest(id) {
    const files = await this.all(`trashed = false and appProperties has { key='bntsApp' and value='${APP_TAG}' } and appProperties has { key='kind' and value='record' } and appProperties has { key='requestId' and value='${esc(id)}' }`);
    return files[0] ? { ...await this.json(files[0].id), recordFileId: files[0].id } : null;
  }
  async uploadLargeFile(metadata, filename, mimeType, size) {
    // Use Drive's resumable-upload protocol for files larger than 5 MB.
    // Both requests run on the server; no Google token/session URL goes to students.
    const session = await this.oauth.request({
      url: 'https://www.googleapis.com/upload/drive/v3/files', method: 'POST',
      params: { uploadType: 'resumable', supportsAllDrives: true, fields: 'id' },
      headers: { 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(size) },
      data: metadata,
    });
    const location = session.headers.get('location');
    const endpoint = location ? new URL(location) : null;
    if (!endpoint || endpoint.protocol !== 'https:' || endpoint.hostname !== 'www.googleapis.com') throw new Error('Drive did not return a valid upload session.');
    const response = await this.oauth.request({
      url: endpoint.href, method: 'PUT', retry: false,
      headers: { 'Content-Type': mimeType, 'Content-Length': String(size), 'Content-Range': `bytes 0-${size - 1}/${size}` },
      data: createReadStream(filename),
    });
    if (!response.data?.id) throw new Error('Drive did not confirm the uploaded file.');
    return response.data.id;
  }
  async save(record, model, preview, settings) {
    const school = await this.folder(settings.folderId, record.school, 'school:' + record.schoolId);
    const date = await this.folder(school, record.date, 'date:' + record.date);
    const parent = record.classroom ? await this.folder(date, record.classroom, 'class:' + record.classId) : date;
    const created = [];
    const create = async (name, kind, mimeType, data) => {
      const metadata = { name, parents: [parent], description: kind === 'model' ? JSON.stringify(record) : undefined, appProperties: { bntsApp: APP_TAG, kind, submissionId: record.id, requestId: record.requestId, expiresAt: record.expiresAt } };
      const size = typeof data === 'string' ? (await stat(data)).size : data.length;
      let id;
      if (typeof data === 'string' && size > 5 * 1024 * 1024) id = await this.uploadLargeFile(metadata, data, mimeType, size);
      else id = (await this.drive.files.create({ requestBody: metadata, media: { mimeType, body: typeof data === 'string' ? createReadStream(data) : Readable.from([data]) }, fields: 'id', supportsAllDrives: true })).data.id;
      created.push(id); return id;
    };
    try {
      record.modelFileId = await create(record.filename, 'model', record.filename.endsWith('.3mf') ? 'model/3mf' : record.filename.endsWith('.stl') ? 'model/stl' : 'application/octet-stream', model);
      record.previewFileId = await create(record.filename + '.preview.png', 'preview', 'image/png', preview);
      record.recordFileId = await create(record.filename + '.details.json', 'record', 'application/json', Buffer.from(JSON.stringify(record)));
      return record;
    } catch (e) { await Promise.allSettled(created.map(fileId => this.drive.files.delete({ fileId, supportsAllDrives: true }))); throw e; }
  }
  async get(id) {
    const files = await this.all(`trashed = false and appProperties has { key='bntsApp' and value='${APP_TAG}' } and appProperties has { key='kind' and value='record' } and appProperties has { key='submissionId' and value='${esc(id)}' }`);
    return files[0] ? { ...await this.json(files[0].id), recordFileId: files[0].id } : null;
  }
  async bytes(record, kind) {
    const r = await this.drive.files.get({ fileId: kind === 'preview' ? record.previewFileId : record.modelFileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
    return Buffer.from(r.data);
  }
  async status(record, status) {
    record.status = status;
    await this.drive.files.update({ fileId: record.recordFileId, supportsAllDrives: true, media: { mimeType: 'application/json', body: Readable.from([JSON.stringify(record)]) } });
    return record;
  }
  async remove(record) {
    // Remove the index last, so partial failures remain visible and can be retried.
    for (const fileId of [record.modelFileId, record.previewFileId, record.recordFileId]) if (fileId) await this.drive.files.delete({ fileId, supportsAllDrives: true }).catch(e => { if (e.code !== 404) throw e; });
  }
  async cleanup(now = new Date()) {
    if (!this.connected) throw Object.assign(new Error('Google Drive is not connected.'), { status: 503 });
    const files = await this.all(`trashed = false and appProperties has { key='bntsApp' and value='${APP_TAG}' }`);
    const expired = files.filter(f => f.appProperties?.expiresAt && Date.parse(f.appProperties.expiresAt) <= now.getTime());
    // Includes incomplete uploads; delete the record last for retryability.
    expired.sort((a,b) => Number(a.appProperties.kind === 'record') - Number(b.appProperties.kind === 'record'));
    for (const f of expired) await this.drive.files.delete({ fileId: f.id, supportsAllDrives: true }).catch(e => { if (e.code !== 404) throw e; });
    // Only app-created, empty folders; never remove a school's existing content.
    for (const folder of files.filter(f => f.appProperties?.kind === 'folder').reverse()) {
      const children = await this.drive.files.list({ q: `trashed = false and '${esc(folder.id)}' in parents`, pageSize: 1, fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true });
      if (!children.data.files?.length) await this.drive.files.delete({ fileId: folder.id, supportsAllDrives: true }).catch(e => { if (e.code !== 404) throw e; });
    }
    return { deletedSubmissions: new Set(expired.map(f => f.appProperties.submissionId)).size };
  }
}

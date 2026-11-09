import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { createAuth } from './auth.js';
import { validateModel, validatePreview } from './validation.js';
import { validateSubmission, makeRecord, settingsSchema, extractFolderId, isExpired } from './domain.js';
import { BAMBU_COLOURS, MAX_BYTES } from '../shared/catalog.js';
import { acceptedExtensions } from '../shared/formats.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function createApp({ store, password, secret, production = false, cleanupSecret = '', serveClient = true, uploadDirectory = path.join(tmpdir(), 'bnts-print-studio-uploads') }) {
  const app = express();
  app.disable('x-powered-by');
  if (production) app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"], workerSrc: ["'self'", 'blob:'], objectSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginEmbedderPolicy: false }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Please wait a minute.' } }));
  app.use(express.json({ limit: '100kb' }));
  const auth = createAuth({ password, secret, production });
  const locked = createLock();
  let cleanupState = { lastRun: null, lastSuccess: null, error: null };
  const cleanup = () => locked(async () => {
    cleanupState.lastRun = new Date().toISOString();
    try { const result = await store.cleanup(); cleanupState = { lastRun: cleanupState.lastRun, lastSuccess: new Date().toISOString(), error: null }; return result; }
    catch (e) { cleanupState.error = 'Cleanup failed. Check Google Drive access and retry.'; throw e; }
  });
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/config', async (req, res) => {
    const settings = await store.settings();
    res.json({ schools: settings.schools, staff: settings.staff, classes: settings.classes, colours: BAMBU_COLOURS.filter(c => settings.colours.includes(c.id)), customColourEnabled: settings.customColourEnabled, acceptedExtensions: acceptedExtensions(settings), acceptingUploads: !!settings.folderId && !!settings.schools.length && !!settings.staff.length && (store.connected ?? true), localDemo: store.constructor.name === 'LocalStore', maxBytes: MAX_BYTES });
  });
  app.post('/api/admin/login', rateLimit({ windowMs: 15 * 60000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' } }), (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Open the teacher console on this site.' });
    auth.login(req, res);
  });
  app.use('/api/admin', auth.check);
  app.get('/api/admin/session', (req, res) => res.json({ csrf: req.session.csrf }));
  app.post('/api/admin/logout', auth.logout);
  app.get('/api/admin/settings', async (req, res) => {
    res.json({ settings: await store.settings(), localDemo: store.constructor.name === 'LocalStore', connected: store.connected ?? true, oauthConfigured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.PUBLIC_URL), tokenPersisted: store.envToken ?? true, cleanupConfigured: !!cleanupSecret, cleanup: cleanupState });
  });
  app.put('/api/admin/settings', async (req, res) => locked(async () => {
    if (store.connected === false) return res.status(409).json({ error: 'Connect Google Drive first.' });
    const value = { ...req.body, folderId: extractFolderId(req.body?.folderId || '') };
    const settings = settingsSchema.parse(value);
    const old = await store.settings();
    const rootChanged = old.folderId && old.folderId !== settings.folderId;
    if (rootChanged && (await store.list()).length) return res.status(409).json({ error: 'Remove existing submissions before changing the storage folder. This keeps retention and the queue consistent.' });
    await store.saveSettings(settings); res.json({ ok: true });
  }));
  app.get('/api/admin/google/start', (req, res) => {
    if (!store.oauth || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.PUBLIC_URL) return res.status(409).json({ error: 'Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and PUBLIC_URL to your host settings first.' });
    const nonce = randomBytes(24).toString('hex');
    res.cookie('bnts_google_state', nonce, auth.oauthCookieOptions);
    res.redirect(store.oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.appdata'], state: auth.pack({ kind: 'google', nonce, exp: Date.now() + 600000 }) }));
  });
  app.get('/api/admin/google/callback', async (req, res) => {
    const state = auth.unpack(req.query.state);
    if (!state || state.kind !== 'google' || state.nonce !== req.cookies.bnts_google_state) return res.status(400).send('Google connection expired. Return to the teacher console and try again.');
    res.clearCookie('bnts_google_state', { path: '/' });
    if (req.query.error || typeof req.query.code !== 'string') return res.redirect('/teacher?google=cancelled');
    const { tokens } = await store.oauth.getToken(req.query.code);
    if (!tokens.refresh_token && !store.connected) throw Object.assign(new Error('Google did not return a refresh token. Reconnect and grant access.'), { status: 400 });
    store.oauth.setCredentials({ ...store.oauth.credentials, ...tokens });
    // Never log or persist credentials to the project/Drive. Teacher copies this once to host settings.
    if (tokens.refresh_token) { store.pendingToken = tokens.refresh_token; store.envToken = tokens.refresh_token === process.env.GOOGLE_REFRESH_TOKEN; }
    res.redirect('/teacher?google=connected');
  });
  app.post('/api/admin/google/refresh-token', (req, res) => {
    if (!store.pendingToken) return res.status(404).json({ error: 'No new token. Reconnect Google to generate one.' });
    res.json({ token: store.pendingToken }); delete store.pendingToken;
  });
  app.get('/api/admin/submissions', async (req, res) => res.json({ records: (await store.list()).filter(r => !isExpired(r)).map(publicRecord) }));
  app.get('/api/admin/submissions/:id/:kind', async (req, res) => {
    if (!z.uuid().safeParse(req.params.id).success || !['model', 'preview', 'download'].includes(req.params.kind)) return res.sendStatus(404);
    const record = await store.get(req.params.id);
    if (!record || isExpired(record)) return res.status(404).json({ error: 'This submission is no longer available.' });
    const preview = req.params.kind === 'preview';
    const buffer = await store.bytes(record, preview ? 'preview' : 'model');
    res.type(preview ? 'png' : 'application/octet-stream');
    if (!preview) res.attachment(record.filename);
    res.send(buffer);
  });
  app.patch('/api/admin/submissions/:id', async (req, res) => locked(async () => {
    if (!z.uuid().safeParse(req.params.id).success) return res.sendStatus(404);
    const status = z.enum(['queued', 'printing', 'printed']).parse(req.body.status);
    const record = await store.get(req.params.id);
    if (!record || isExpired(record)) return res.status(404).json({ error: 'This submission has expired.' });
    res.json({ record: publicRecord(await store.status(record, status)) });
  }));
  app.delete('/api/admin/submissions/:id', async (req, res) => locked(async () => {
    if (!z.uuid().safeParse(req.params.id).success) return res.sendStatus(404);
    const record = await store.get(req.params.id);
    if (!record) return res.sendStatus(404);
    await store.remove(record); res.json({ ok: true });
  }));
  app.post('/api/admin/cleanup', async (req, res) => res.json(await cleanup()));
  app.post('/api/maintenance/cleanup', async (req, res) => {
    const token = req.get('Authorization') || ''; const expected = `Bearer ${cleanupSecret}`;
    if (!cleanupSecret || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return res.sendStatus(401);
    res.json(await cleanup());
  });
  // Spool incoming files to temporary disk. Class uploads must not each retain 50 MB
  // in RAM while waiting for the Google Drive write to finish.
  const upload = multer({ dest: uploadDirectory, limits: { fileSize: MAX_BYTES, files: 2, fields: 1, fieldSize: 16000, parts: 3 } }).fields([{ name: 'model', maxCount: 1 }, { name: 'preview', maxCount: 1 }]);
  app.post('/api/submissions', rateLimit({ windowMs: 3600000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'The upload limit for this connection has been reached. Ask your teacher, or try again later.' } }), (req, res, next) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Upload from the BNTS website.' });
    next();
  }, upload, async (req, res) => {
    try { await locked(async () => {
    const settings = await store.settings();
    if (!settings.folderId || store.connected === false || !settings.schools.length || !settings.staff.length) return res.status(503).json({ error: 'Your teacher is still setting up uploads. Please try again shortly.' });
    let data;
    try { data = JSON.parse(req.body.details); } catch { return res.status(400).json({ error: 'The print details could not be read. Please try again.' }); }
    const value = validateSubmission(data, settings);
    const existing = await store.findRequest(value.requestId);
    if (existing) return res.json(receipt(existing));
    const file = req.files?.model?.[0];
    if (!file || !file.size) return res.status(400).json({ error: 'Choose a non-empty file in an accepted format.' });
    if (!acceptedExtensions(settings).includes(file.originalname.split('.').at(-1).toLowerCase())) return res.status(400).json({ error: 'This file type is not enabled. Ask your teacher which formats to use.' });
    const previewFile = req.files?.preview?.[0];
    if (!previewFile || previewFile.size > 512 * 1024) return res.status(400).json({ error: 'A valid model preview is required. Return to the preview step.' });
    const preview = { ...previewFile, buffer: await readFile(previewFile.path) };
    validatePreview(preview);
    await validateModel(await readFile(file.path), file.originalname);
    const record = makeRecord(value, file.originalname, file.size);
    const result = await store.save(record, file.path, preview.buffer, settings);
    res.status(201).json(receipt(result));
    }); } finally {
      await Promise.allSettled(Object.values(req.files || {}).flat().map(file => rm(file.path, { force: true })));
    }
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'That page could not be found.' }));
  if (serveClient) {
    app.use(express.static(path.join(root, 'dist'), { index: false, maxAge: production ? '1h' : 0 }));
    app.get('/{*path}', (req, res) => res.sendFile(path.join(root, 'dist/index.html')));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message || 'Check the form details.' });
    if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? `Files must be ${MAX_BYTES / 1024 / 1024} MB or smaller.` : 'Please upload one model and its preview.' });
    const status = error.status || (error.code === 401 || error.code === 403 ? 503 : 500);
    // Do not log Google errors: request config may contain credentials.
    if (status >= 500) console.error('Request failed:', req.method, req.path, 'status', status);
    res.status(status).json({ error: status >= 500 ? 'Storage is unavailable. Your teacher can check the Google Drive connection; please try again.' : error.message });
  });
  return { app, cleanup, cleanupState: () => cleanupState };
}
function publicRecord(record) { const { modelFileId, previewFileId, recordFileId, ...safe } = record; return safe; }
function receipt(record) { return { id: record.id, filename: record.filename, expiresAt: record.expiresAt, firstName: record.firstName }; }
function sameOrigin(req) { const origin = req.get('Origin'); if (!origin) return true; try { return new URL(origin).host === req.get('host'); } catch { return false; } }
function createLock() { let tail = Promise.resolve(); return fn => { const next = tail.then(fn); tail = next.catch(() => {}); return next; }; }

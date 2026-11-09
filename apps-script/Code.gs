/** BNTS Print Studio — Google Apps Script V8 backend.
 * Deploy as the school account, execute as Me, access Anyone.
 * All helpers end in _ so they cannot be invoked with google.script.run.
 * Never return a Google OAuth token to the browser.
 */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  template.bootJson = JSON.stringify({ baseUrl: ScriptApp.getService().getUrl(), teacher: !!(e && e.parameter && e.parameter.page === 'teacher') }).replace(/</g, '\\u003c');
  return template.evaluate().setTitle('3D Print Studio · BNTS').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function bntsApi(request) {
  try {
    if (!request || typeof request.path !== 'string' || request.path.length > 180) fail_('Invalid request.', 400);
    var path = request.path, method = request.method || 'GET', body = request.body || {};
    if(path === '/classes/resolve' && method === 'POST')return ok_(resolveClass_(settings_(),body.schoolId,body.classCode));
    if (path === '/config' && method === 'GET') return ok_(publicConfig_());
    if (path === '/admin/login' && method === 'POST') return ok_(withLock_(function () { return login_(body.password); }));
    if (path === '/submissions' && method === 'POST') return ok_(withLock_(function () { return submit_(body); }));
    if (path.indexOf('/admin/') !== 0) fail_('That page could not be found.', 404);
    var session = authenticate_(request);
    if (path === '/admin/session' && method === 'GET') return ok_({ csrf: session.csrf });
    if (path === '/admin/logout' && method === 'POST') {
      // Revoke this session until its signed expiry; other staff sessions are unaffected.
      CacheService.getScriptCache().put('revoked:' + session.id, '1', 21600);
      PropertiesService.getScriptProperties().setProperty('revoked:' + session.id, String(session.exp));
      return ok_({ ok: true });
    }
    if (path === '/admin/settings' && method === 'GET') return ok_(adminSettings_());
    if (path === '/admin/settings' && method === 'PUT') return ok_(withLock_(function () { return saveSettings_(body); }));
    if (path === '/admin/submissions' && method === 'GET') return ok_({ records: records_().filter(function (r) { return !expired_(r); }).map(publicRecord_) });
    if (path === '/admin/cleanup' && method === 'POST') return ok_(cleanupExpired_());
    if(path==='/admin/submissions/bulk-status'&&method==='POST')return ok_(withLock_(function(){if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>200||body.ids.some(function(id){return !uuid_(id);})||['queued','printing','printed'].indexOf(body.status)<0)fail_('Choose files and a valid status.',400);var updated=0;body.ids.forEach(function(id){var record=record_(id);if(record&&!expired_(record)){record.status=body.status;Drive.Files.update({},record.recordFileId,jsonBlob_(record,record.filename+'.details.json'),{supportsAllDrives:true});updated++;}});return {updated:updated,skipped:body.ids.length-updated};}));
    var match = path.match(/^\/admin\/submissions\/([a-f0-9-]{36})(?:\/(model|preview|download))?$/i);
    if (!match) fail_('That page could not be found.', 404);
    var id = match[1], kind = match[2];
    if (method === 'GET' && kind) {
      var record = record_(id);
      if (!record || expired_(record)) fail_('This submission has expired or was removed.', 404);
      var blob = downloadBlob_(kind === 'preview' ? record.previewFileId : record.modelFileId);
      return ok_({ base64: Utilities.base64Encode(blob.getBytes()), filename: record.filename });
    }
    if (method === 'PATCH' && !kind) return ok_(withLock_(function () {
      var record = record_(id);
      if (!record || expired_(record)) fail_('This submission has expired or was removed.', 404);
      if (['queued', 'printing', 'printed'].indexOf(body.status) < 0) fail_('Choose a valid print status.', 400);
      record.status = body.status;
      Drive.Files.update({}, record.recordFileId, jsonBlob_(record, record.filename + '.details.json'), { supportsAllDrives: true });
      return { record: publicRecord_(record) };
    }));
    if (method === 'DELETE' && !kind) return ok_(withLock_(function () {
      var record = record_(id); if (!record) fail_('This submission was already removed.', 404);
      removeRecord_(record); return { ok: true };
    }));
    fail_('That page could not be found.', 404);
  } catch (error) {
    // Google errors can contain request/credential details. Return only safe, explicit app messages.
    return { ok: false, status: error.bntsStatus || 503, error: error.bntsStatus ? error.message : 'Google Drive could not complete the request. Check the folder permissions and Apps Script execution history, then try again.' };
  }
}
function ok_(data) { return { ok: true, data: data }; }
function fail_(message, status) { var error = new Error(message); error.bntsStatus = status; throw error; }
function withLock_(fn) { var lock = LockService.getScriptLock(); if (!lock.tryLock(30000)) fail_('The printing team is receiving another file. Please try again shortly.', 503); try { return fn(); } finally { lock.releaseLock(); } }
function props_() { return PropertiesService.getScriptProperties(); }
function secret_() {
  var secret = props_().getProperty('SESSION_SECRET');
  if (!secret) { secret = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid(); props_().setProperty('SESSION_SECRET', secret); }
  return secret;
}
function safeEqual_(a, b) { a = String(a || ''); b = String(b || ''); var n = Math.max(a.length, b.length), diff = a.length ^ b.length; for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return diff === 0; }
function signature_(value) {
  // Changing the teacher password invalidates existing sessions too.
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(value, secret_() + props_().getProperty('TEACHER_PASSWORD'))).replace(/=+$/, '');
}
function pack_(value) { var data = Utilities.base64EncodeWebSafe(JSON.stringify(value)).replace(/=+$/, ''); return data + '.' + signature_(data); }
function unpack_(token) {
  if (typeof token !== 'string' || token.length > 4000) return null;
  try { var parts = token.split('.'); if (parts.length !== 2 || !safeEqual_(signature_(parts[0]), parts[1])) return null; var result = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); return result.exp > Date.now() ? result : null; } catch (e) { return null; }
}
function login_(password) {
  var configured = props_().getProperty('TEACHER_PASSWORD');
  if (!configured || configured.length < 12) fail_('Set a TEACHER_PASSWORD of at least 12 characters in Apps Script Project Settings → Script Properties first.', 503);
  var cache = CacheService.getScriptCache(), attempts = Number(cache.get('teacher-login-attempts') || 0);
  if (attempts >= 12) fail_('Too many sign-in attempts. Please wait 15 minutes.', 429);
  if (typeof password !== 'string' || password.length > 256 || !safeEqual_(signature_(password), signature_(configured))) { cache.put('teacher-login-attempts', String(attempts + 1), 900); fail_('That password is not correct.', 401); }
  cache.remove('teacher-login-attempts');
  var session = { kind: 'teacher', id: Utilities.getUuid(), csrf: Utilities.getUuid() + Utilities.getUuid(), exp: Date.now() + 8 * 3600000 };
  return { token: pack_(session), csrf: session.csrf };
}
function authenticate_(request) {
  var session = unpack_(request.token);
  if (!session || session.kind !== 'teacher' || props_().getProperty('revoked:' + session.id)) fail_('Please sign in to the teacher console.', 401);
  if (['GET', 'HEAD'].indexOf(request.method || 'GET') < 0 && !safeEqual_(request.csrf, session.csrf)) fail_('Session check failed. Refresh this page.', 403);
  return session;
}
function defaults_() { return JSON.parse(JSON.stringify(BNTS_CATALOG.defaults)); }
function settings_() {
  var cache = CacheService.getScriptCache(), cached = cache.get('bnts-settings');
  if (cached) return JSON.parse(cached);
  var id = props_().getProperty('SETTINGS_FILE_ID'), settings = id ? JSON.parse(downloadBlob_(id).getDataAsString()) : defaults_();
  var encoded = JSON.stringify(settings); if (encoded.length < 90000) cache.put('bnts-settings', encoded, 60);
  return settings;
}
function publicConfig_() {
  var settings = settings_();
  return { schools: settings.schools, staff: settings.staff, classes: settings.classes.map(function(c){return {id:c.id,name:c.name,schoolId:c.schoolId};}), colours: BNTS_CATALOG.colours.filter(function (c) { return settings.colours.indexOf(c.id) >= 0; }), customColourEnabled: settings.customColourEnabled, acceptingUploads: !!settings.folderId && !!settings.schools.length && !!settings.staff.length, acceptedExtensions: acceptedExtensions_(settings), maxBytes: 10 * 1024 * 1024, localDemo: false };
}
function adminSettings_() {
  var p = props_();
  return { platform: 'apps-script', settings: settings_(), connected: true, oauthConfigured: false, tokenPersisted: true, localDemo: false, cleanupConfigured: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'cleanupExpired_'; }), cleanup: { lastRun: p.getProperty('CLEANUP_LAST_RUN'), lastSuccess: p.getProperty('CLEANUP_LAST_SUCCESS'), error: p.getProperty('CLEANUP_ERROR') } };
}
function shortText_(value, max, required) {
  if (typeof value !== 'string' || value.length > max) fail_('Check the form text and its length.', 400);
  var result = value.trim(); if (required && !result) fail_('Please complete all required fields.', 400);
  if (/[\x00-\x08\x0b-\x1f]/.test(result)) fail_('Use ordinary text in the form.', 400);
  return result;
}
function uuid_(value) { return typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value); }
function folderId_(value) {
  var s = shortText_(value, 300, true); if (/^[a-zA-Z0-9_-]{10,150}$/.test(s)) return s;
  var match = s.match(/^https:\/\/drive\.google\.com\/drive(?:\/u\/\d+)?\/folders\/([a-zA-Z0-9_-]{10,150})(?:[?/#]|$)/);
  if (!match) fail_('Paste a Google Drive folder link.', 400); return match[1];
}
function validateSettings_(input) {
  var settings = { folderId: folderId_(input.folderId), customColourEnabled: input.customColourEnabled === true };
  ['schools', 'staff', 'classes'].forEach(function (kind) {
    var values = input[kind]; if (!Array.isArray(values) || values.length > (kind === 'classes' ? 300 : 100)) fail_('Too many setup options.', 400);
    var ids = {};
    settings[kind] = values.map(function (item) {
      if (!item || !uuid_(item.id) || ids[item.id]) fail_('Invalid or duplicate setup option.', 400); ids[item.id] = true;
      var value = { id: item.id, name: shortText_(item.name, 80, true) };
      if (kind === 'classes') { if (!uuid_(item.schoolId)) fail_('Choose a school for each class.', 400); value.schoolId = item.schoolId; value.code = shortText_(item.code,80,true); }
      return value;
    });
  });
  var classCodes={};settings.classes.forEach(function(c){var key=c.schoolId+':'+normalizeClassCode_(c.code);if(classCodes[key])fail_('Each class in a school must have a different code.',400);classCodes[key]=true;});
  if (settings.classes.some(function (c) { return !settings.schools.some(function (s) { return s.id === c.schoolId; }); })) fail_('Each class must belong to a school.', 400);
  if (!Array.isArray(input.colours) || input.colours.length > 50 || input.colours.some(function (id) { return !BNTS_CATALOG.colours.some(function (c) { return c.id === id; }); })) fail_('Choose Bambu PLA colours from the list.', 400);
  settings.colours = Array.from(new Set(input.colours));
  if (!settings.colours.length && !settings.customColourEnabled) fail_('Offer at least one colour or custom requests.', 400);
  var optional = BNTS_CATALOG.formats.filter(function (f) { return !f.required||f.id==='zip'; }).map(function (f) { return f.id; });
  var extras = input.extraFormats || [];
  if (!Array.isArray(extras) || extras.length > optional.length || extras.some(function (id) { return optional.indexOf(id) < 0; })) fail_('Choose file types from the list.', 400);
  settings.extraFormats = Array.from(new Set(extras));
  return settings;
}
function acceptedExtensions_(settings) { return BNTS_CATALOG.formats.filter(function (f) { return f.required || (settings.extraFormats || []).indexOf(f.id) >= 0; }).reduce(function (all, f) { return all.concat(f.extensions); }, []); }
function saveSettings_(input) {
  var settings = validateSettings_(input);
  var folder = Drive.Files.get(settings.folderId, { fields: 'id,mimeType,trashed,capabilities(canAddChildren)', supportsAllDrives: true });
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder' || !folder.capabilities.canAddChildren) fail_('The deploying Google account needs permission to add files to this folder.', 400);
  var previous = settings_();
  if (previous.folderId && previous.folderId !== settings.folderId && records_().length) fail_('Remove existing submissions before changing the storage folder.', 409);
  var id = props_().getProperty('SETTINGS_FILE_ID');
  if (id) Drive.Files.update({}, id, jsonBlob_(settings, '.BNTS Print Studio settings.json'), { supportsAllDrives: true });
  else { var file = Drive.Files.create({ name: '.BNTS Print Studio settings.json', parents: [settings.folderId], appProperties: { bntsApp: BNTS_CATALOG.tag, kind: 'settings' } }, jsonBlob_(settings, '.BNTS Print Studio settings.json'), { fields: 'id', supportsAllDrives: true }); props_().setProperty('SETTINGS_FILE_ID', file.id); }
  CacheService.getScriptCache().remove('bnts-settings');
  ensureCleanupTrigger_();
  return { ok: true };
}
function ensureCleanupTrigger_() {
  var triggers = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'cleanupExpired_'; });
  if (!triggers.length) ScriptApp.newTrigger('cleanupExpired_').timeBased().everyHours(1).create();
}
function validateDetails_(input, settings) {
  var value = {};
  ['requestId', 'schoolId', 'staffId'].forEach(function (key) { if (!uuid_(input[key])) fail_('Choose a valid school and staff member.', 400); value[key] = input[key]; });
  value.firstName = shortText_(input.firstName, 40, true);
  if (!/^[\p{L}\p{M} '\-]+$/u.test(value.firstName)) fail_('Use your first name only.', 400);
  value.classCode = shortText_(input.classCode || '',80,false);
  var resolved=resolveClass_(settings,value.schoolId,value.classCode);value.classId=resolved.classId;
  var school = settings.schools.find(function (s) { return s.id === value.schoolId; }), staff = settings.staff.find(function (s) { return s.id === value.staffId; });
  var classroom = value.classId ? settings.classes.find(function (c) { return c.id === value.classId && c.schoolId === value.schoolId; }) : null;
  if (!school || !staff || (value.classId && !classroom)) fail_('Choose a current school, staff member and class.', 400);
  value.colour = shortText_(input.colour, 80, true); value.customColour = shortText_(input.customColour, 80, false);
  var available = BNTS_CATALOG.colours.filter(function (c) { return settings.colours.indexOf(c.id) >= 0; }).map(function (c) { return c.name; });
  if (settings.customColourEnabled) available.push('Custom');
  available.push(BNTS_CATALOG.advancedFilament);
  value.advancedFilamentNote=shortText_(input.advancedFilamentNote||'',800,false);
  if (available.indexOf(value.colour) < 0 || !Array.isArray(input.colourMapping) || !input.colourMapping.length || input.colourMapping.length > 32) fail_('Choose available colour preferences.', 400);
  var assigned=new Set();
  value.colourMapping = input.colourMapping.map(function (m) { if (!m || available.indexOf(m.target) < 0 || !/^#[a-f\d]{6}$/i.test(m.source)) fail_('Choose valid model colour preferences.', 400);var source=m.source.toLowerCase();if(assigned.has(source))fail_('Choose one colour for each model part.',400);assigned.add(source);return { source:source, target: m.target, partName:shortText_(m.partName||'',80,false) }; });
  if ((value.colour === 'Custom' || value.colourMapping.some(function (m) { return m.target === 'Custom'; })) && !value.customColour) fail_('Describe your custom colour request.', 400);
  value.scalePercent=input.scalePercent===undefined?100:input.scalePercent;if(typeof value.scalePercent!=='number'||!Number.isFinite(value.scalePercent)||value.scalePercent<1||value.scalePercent>1000)fail_('Choose a scale between 1% and 1000%.',400);value.size=value.scalePercent+'% scale';
  value.dimensionsMm=input.dimensionsMm||null;if(value.dimensionsMm&&(!Array.isArray(value.dimensionsMm)||value.dimensionsMm.length!==3||value.dimensionsMm.some(function(v){return typeof v!=='number'||!Number.isFinite(v)||v<0||v>1e9;})))fail_('Check the model dimensions in mm.',400);
  if((value.colour===BNTS_CATALOG.advancedFilament||value.colourMapping.some(function(m){return m.target===BNTS_CATALOG.advancedFilament;}))&&!value.advancedFilamentNote)fail_('Describe the advanced filament you need.',400);
  ['supports', 'printer', 'quality'].forEach(function (key) { if (BNTS_CATALOG.preferences[key].indexOf(input[key]) < 0) fail_('Choose preferences from the list.', 400); value[key] = input[key]; });
  if (!Number.isInteger(input.copies) || input.copies < 1 || input.copies > 10) fail_('Choose between 1 and 10 copies.', 400); value.copies = input.copies;
  value.notes = shortText_(input.notes, 800, false); value.designLink = shortText_(input.designLink, 500, false);
  if (value.designLink && !/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#][^\s]*)?$/i.test(value.designLink)) fail_('Use a secure https design link.', 400);
  if (['size', 'supports', 'printer', 'quality'].some(function (key) { return value[key].indexOf('Custom') === 0; }) && !value.notes) fail_('Add a note explaining your custom preferences.', 400);
  if (input.readyConfirmed !== true || input.detailsConfirmed !== true) fail_('Confirm your model and request before submitting.', 400);
  value.readyConfirmed = true; value.detailsConfirmed = true; value.school = school.name; value.staff = staff.name; value.classroom = classroom ? classroom.name : ''; value.colourLabel = value.colour === 'Custom' ? 'Custom ' + value.customColour : value.colour;
  return value;
}
function safePart_(value, max) { return Array.from(String(value).normalize('NFKC').replace(/[^\p{L}\p{N} .-]/gu, '-').replace(/[ .-]+/g, '-').replace(/^-+|-+$/g, '')).slice(0, max || 50).join('') || 'unnamed'; }
function makeRecord_(value, name, bytes) {
  var now = new Date(), date = Utilities.formatDate(now, 'Australia/Melbourne', 'yyyy-MM-dd'), id = Utilities.getUuid();
  var colours=Array.from(new Set((value.colourMapping.length?value.colourMapping.map(function(m){return m.target;}):[value.colour]).map(function(c){return c===BNTS_CATALOG.advancedFilament?'ADVANCED':BNTS_CATALOG.simpleColours[c]||'CUSTOM';})));
  var colour=colours.join('_'),labels=[Array.from(safePart_(value.school,80)),Array.from(safePart_(value.firstName,40))],extension=name.split('.').pop().toLowerCase();
  function filename_(){return [labels[0].join(''),colour,date,labels[1].join('')].join('_')+'.'+extension;}
  while(Utilities.newBlob(filename_()).getBytes().length>240)labels[labels[0].length>labels[1].length?0:1].pop();
  var filename=filename_();
  return Object.assign({}, value, { id: id, filename: filename, originalName: name, bytes: bytes, date: date, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 14 * 86400000).toISOString(), status: 'queued' });
}
function submit_(body) {
  var settings = settings_(); if (!settings.folderId || !settings.schools.length || !settings.staff.length) fail_('Your teacher is still setting up uploads.', 503);
  var details = validateDetails_(body.details || {}, settings), existing = findRecord_('requestId', details.requestId);
  if (existing) return receipt_(existing);
  var cache = CacheService.getScriptCache(), hourKey = 'uploads:' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHH'), uploads = Number(cache.get(hourKey) || 0);
  if (uploads >= 120) fail_('The hourly school upload limit has been reached. Please try again later.', 429);
  var name = shortText_(body.name, 255, true);
  if (acceptedExtensions_(settings).indexOf(name.split('.').pop().toLowerCase()) < 0) fail_('This file type is not enabled. Ask your teacher which formats to use.', 400);
  var bytes = decodeFile_(body.model, 10 * 1024 * 1024), preview = decodeFile_(body.preview, 512 * 1024);
  if (!bytes.length) fail_('Choose a non-empty model.', 400);
  validateModel_(bytes, name);
  if ([137,80,78,71,13,10,26,10].some(function (n,i) { return (preview[i] & 255) !== n; })) fail_('Return to the preview step to capture your model.', 400);
  var record = makeRecord_(details, name, bytes.length), created = [];
  var school = folder_(settings.folderId, record.school, 'school:' + record.schoolId), date = folder_(school, record.date, 'date:' + record.date);
  var parent = record.classroom ? folder_(date, record.classroom, 'class:' + record.classId) : date;
  function create(name, kind, blob) { var file = Drive.Files.create({ name: name, parents: [parent], description: kind === 'model' ? JSON.stringify(record) : undefined, appProperties: { bntsApp: BNTS_CATALOG.tag, kind: kind, submissionId: record.id, requestId: record.requestId, expiresAt: record.expiresAt } }, blob, { fields: 'id', supportsAllDrives: true }); created.push(file.id); return file.id; }
  try {
    record.modelFileId = create(record.filename, 'model', Utilities.newBlob(bytes, /\.3mf$/i.test(name) ? 'model/3mf' : /\.stl$/i.test(name) ? 'model/stl' : 'application/octet-stream', record.filename));
    record.previewFileId = create(record.filename + '.preview.png', 'preview', Utilities.newBlob(preview, 'image/png', record.filename + '.preview.png'));
    record.recordFileId = create(record.filename + '.details.json', 'record', jsonBlob_(record, record.filename + '.details.json'));
    cache.put(hourKey, String(uploads + 1), 3600);
    return receipt_(record);
  } catch (e) { created.reverse().forEach(function (id) { try { removeFile_(id); } catch (ignored) {} }); throw e; }
}
function decodeFile_(value, maxBytes) { if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4 + 4) fail_('The file exceeds this host’s upload limit.', 400); var bytes; try { bytes = Utilities.base64Decode(value); } catch (e) { fail_('The file could not be read.', 400); } if (bytes.length > maxBytes) fail_('The file exceeds this host’s upload limit.', 400); return bytes; }
function u16_(bytes, i) { return (bytes[i] & 255) + (bytes[i+1] & 255) * 256; }
function u32_(bytes, i) { return u16_(bytes, i) + u16_(bytes, i+2) * 65536; }
function validateModel_(bytes, name) {
  var ext = name.split('.').pop().toLowerCase(), format = BNTS_CATALOG.formats.find(function (f) { return f.extensions.indexOf(ext) >= 0; });
  if(ext==='zip')fail_('ZIP archives must be extracted before uploading. Upload the CAD files inside.',400);
  if (!format) fail_('This file type is not supported.', 400);
  if (ext === 'step' || ext === 'stp') { var step = Utilities.newBlob(bytes).getDataAsString(); if (!/^\s*ISO-10303-21;/i.test(step) || !/END-ISO-10303-21;/i.test(step)) fail_('This is not a valid STEP file. Export it again from your CAD program.', 400); return; }
  if (!format.preview) return;
  if (ext === 'obj') { var obj = Utilities.newBlob(bytes).getDataAsString(); if (!/^v\s+[-+\d.eE]+\s+[-+\d.eE]+\s+[-+\d.eE]+/m.test(obj) || !/^f\s+\S+\s+\S+\s+\S+/m.test(obj)) fail_('This OBJ has no mesh. Export it with faces and vertices.', 400); return; }
  if (ext === 'ply') { if (!/^ply\r?\n/.test(Utilities.newBlob(bytes.slice(0, 100)).getDataAsString())) fail_('This is not a valid PLY file.', 400); return; }
  if (/\.stl$/i.test(name)) {
    if (bytes.length >= 84 && u32_(bytes, 80) > 0 && 84 + u32_(bytes, 80) * 50 === bytes.length) return;
    var s = Utilities.newBlob(bytes).getDataAsString();
    if (!/^\s*solid\b/i.test(s) || !/endsolid\b/i.test(s) || !/vertex\s+[-+\d.eE]+\s+[-+\d.eE]+\s+[-+\d.eE]+/.test(s)) fail_('This is not a valid STL. Export the model again.', 400);
    return;
  }
  var end = -1;
  for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (u32_(bytes, i) === 0x06054b50) { end = i; break; }
  if (end < 0) fail_('This 3MF archive is damaged.', 400);
  var count = u16_(bytes, end+10), offset = u32_(bytes, end+16), total = 0, model = false;
  if (count > 1000) fail_('This 3MF has too many parts.', 400);
  for (var n = 0; n < count; n++) {
    if (offset + 46 > bytes.length || u32_(bytes, offset) !== 0x02014b50) fail_('This 3MF archive is damaged.', 400);
    var size = u32_(bytes, offset+24); total += size;
    if (size > 60*1024*1024 || total > 100*1024*1024 || u16_(bytes, offset+8) & 1) fail_('This 3MF is too large or encrypted. Simplify it first.', 400);
    var length = u16_(bytes, offset+28), filename = Utilities.newBlob(bytes.slice(offset+46, offset+46+length)).getDataAsString();
    if (/\.model$/i.test(filename)) model = true;
    offset += 46 + length + u16_(bytes, offset+30) + u16_(bytes, offset+32);
  }
  if (!model) fail_('This 3MF does not contain a model.', 400);
}
function query_(value) { return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function allFiles_(query) {
  var files = [], page;
  do { var result = Drive.Files.list({ q: query, fields: 'nextPageToken,files(id,name,parents,appProperties)', pageSize: 1000, pageToken: page, supportsAllDrives: true, includeItemsFromAllDrives: true }); files = files.concat(result.files || []); page = result.nextPageToken; } while (page);
  return files;
}
function managedQuery_() { return "trashed = false and appProperties has { key='bntsApp' and value='" + BNTS_CATALOG.tag + "' }"; }
function folder_(parent, name, key) {
  var files = allFiles_("trashed = false and '" + query_(parent) + "' in parents and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='bntsKey' and value='" + query_(key) + "' }");
  if (files.length) return files[0].id;
  return Drive.Files.create({ name: safePart_(name, 100), mimeType: 'application/vnd.google-apps.folder', parents: [parent], appProperties: { bntsApp: BNTS_CATALOG.tag, kind: 'folder', bntsKey: key } }, null, { fields: 'id', supportsAllDrives: true }).id;
}
function records_() { return allFiles_(managedQuery_() + " and appProperties has { key='kind' and value='record' }").map(function (file) { var r = JSON.parse(downloadBlob_(file.id).getDataAsString()); r.recordFileId = file.id; return r; }); }
function findRecord_(key, id) { var files = allFiles_(managedQuery_() + " and appProperties has { key='kind' and value='record' } and appProperties has { key='" + key + "' and value='" + query_(id) + "' }"); if (!files.length) return null; var r = JSON.parse(downloadBlob_(files[0].id).getDataAsString()); r.recordFileId = files[0].id; return r; }
function record_(id) { return findRecord_('submissionId', id); }
function downloadBlob_(id) {
  var response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Drive download failed'); return response.getBlob();
}
function jsonBlob_(value, name) { return Utilities.newBlob(JSON.stringify(value), 'application/json', name); }
function removeFile_(id) { try { Drive.Files.remove(id, { supportsAllDrives: true }); } catch (e) { if (!/not found|404/i.test(String(e.message))) throw e; } }
function removeRecord_(record) { [record.modelFileId, record.previewFileId, record.recordFileId].forEach(function (id) { if (id) removeFile_(id); }); }
function publicRecord_(record) { var safe = Object.assign({}, record); delete safe.modelFileId; delete safe.previewFileId; delete safe.recordFileId; return safe; }
function receipt_(record) { return { id: record.id, filename: record.filename, expiresAt: record.expiresAt, firstName: record.firstName }; }
function expired_(record) { return Date.parse(record.expiresAt) <= Date.now(); }
function cleanupExpired_() {
  return withLock_(function () {
    var p = props_(); p.setProperty('CLEANUP_LAST_RUN', new Date().toISOString());
    try {
      var files = allFiles_(managedQuery_()), expired = files.filter(function (f) { return f.appProperties.expiresAt && Date.parse(f.appProperties.expiresAt) <= Date.now(); });
      expired.sort(function (a,b) { return Number(a.appProperties.kind === 'record') - Number(b.appProperties.kind === 'record'); });
      expired.forEach(function (f) { removeFile_(f.id); });
      files.filter(function (f) { return f.appProperties.kind === 'folder'; }).reverse().forEach(function (f) {
        var children = Drive.Files.list({ q: "trashed = false and '" + query_(f.id) + "' in parents", pageSize: 1, fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true });
        if (!children.files || !children.files.length) removeFile_(f.id);
      });
      var properties = p.getProperties(); Object.keys(properties).filter(function (key) { return key.indexOf('revoked:') === 0 && Number(properties[key]) < Date.now(); }).forEach(function (key) { p.deleteProperty(key); });
      p.setProperty('CLEANUP_LAST_SUCCESS', new Date().toISOString()); p.deleteProperty('CLEANUP_ERROR');
      return { deletedSubmissions: Array.from(new Set(expired.map(function (f) { return f.appProperties.submissionId; }))).length };
    } catch (e) { p.setProperty('CLEANUP_ERROR', 'Automatic cleanup failed. Check the deploying Google account’s Drive access and run cleanup again.'); throw e; }
  });
}

function normalizeClassCode_(value){return value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();}
function resolveClass_(settings,schoolId,code){code=shortText_(code||'',80,false);if(!code)return {classId:'',classroom:''};var c=settings.classes.find(function(c){return c.schoolId===schoolId&&c.code&&normalizeClassCode_(c.code)===normalizeClassCode_(code);});if(!c)fail_('Class code not found for this school. Check the code or leave it blank.',400);return {classId:c.id,classroom:c.name};}

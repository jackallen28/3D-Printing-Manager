import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { BAMBU_COLOURS, PREFERENCES, RETENTION_DAYS, ADVANCED_FILAMENT } from '../shared/catalog.js';
import { normalizeClassCode, resolveClass, filenameColour, scaleLabel } from '../shared/printing.js';
import { OPTIONAL_FORMATS } from '../shared/formats.js';
export const text = (max = 100) => z.string().trim().max(max);
const label = text(80).min(1).refine(s => !/[\x00-\x1f]/.test(s), 'Use ordinary text');
const settingsFields = {
  folderId: z.string().regex(/^[a-zA-Z0-9_-]{10,150}$/),
  schools: z.array(z.object({ id: z.uuid(), name: label })).max(100),
  staff: z.array(z.object({ id: z.uuid(), name: label })).max(100),
  classes: z.array(z.object({ id: z.uuid(), name: label, schoolId: z.uuid(), code: label })).max(300),
  colours: z.array(z.enum(BAMBU_COLOURS.map(c => c.id))).max(50),
  customColourEnabled: z.boolean(),
  extraFormats: z.array(z.enum(OPTIONAL_FORMATS)).max(OPTIONAL_FORMATS.length).default([]),
};
function checkSettings(s, ctx) {
  for (const key of ['schools', 'staff', 'classes']) {
    if (new Set(s[key].map(x => x.id)).size !== s[key].length) ctx.addIssue({ code: 'custom', message: `Duplicate ${key} identifiers` });
  }
  const codes=new Set();
  for(const c of s.classes){const key=c.schoolId+':'+normalizeClassCode(c.code);if(codes.has(key))ctx.addIssue({code:'custom',message:'Each class in a school must have a different code.'});codes.add(key);}
  if (s.classes.some(c => !s.schools.some(x => x.id === c.schoolId))) ctx.addIssue({ code: 'custom', message: 'Each class must belong to a school' });
  if (!s.colours.length && !s.customColourEnabled) ctx.addIssue({ code: 'custom', message: 'Offer at least one colour or custom colour requests' });
}
export const settingsSchema = z.object(settingsFields).superRefine(checkSettings);
export const cloudflareSettingsSchema = z.object({ ...settingsFields, folderId: z.literal('').default('') }).superRefine(checkSettings);
export const submissionSchema = z.object({
  requestId: z.uuid(), firstName: text(40).min(1).regex(/^[\p{L}\p{M} '\-]+$/u, 'Use your first name only'),
  schoolId: z.uuid(), staffId: z.uuid(), classId: z.union([z.uuid(), z.literal('')]).default(''), classCode: text(80).default(''),
  colour: text(80).min(1), customColour: text(80), advancedFilamentNote: text(800).default(''),
  colourMapping: z.array(z.object({ source: text(40), target: text(80).min(1), partName: text(80).optional() })).max(32),
  size: text(80).default('100% scale'), scalePercent: z.number().min(1).max(1000).default(100), dimensionsMm: z.tuple([z.number().min(0).max(1e9),z.number().min(0).max(1e9),z.number().min(0).max(1e9)]).nullable().default(null), supports: z.enum(PREFERENCES.supports),
  printer: z.enum(PREFERENCES.printer), quality: z.enum(PREFERENCES.quality),
  copies: z.number().int().min(1).max(10), notes: text(800),
  designLink: z.union([z.literal(''), z.url().max(500).refine(u => {
    const v = new URL(u); return v.protocol === 'https:' && !v.username && !v.password;
  }, 'Use a secure https link')]),
  readyConfirmed: z.literal(true), detailsConfirmed: z.literal(true),
});
export function validateSubmission(data, settings) {
  const value = submissionSchema.parse(data);
  const school = settings.schools.find(x => x.id === value.schoolId);
  const staff = settings.staff.find(x => x.id === value.staffId);
  const classroom = resolveClass(settings,value.schoolId,value.classCode);
  value.classId=classroom.classId;value.size=scaleLabel(value.scalePercent);
  if (!school || !staff) throw Object.assign(new Error('Choose a current school, staff member and class.'), { status: 400 });
  const allowed = new Set(BAMBU_COLOURS.filter(c => settings.colours.includes(c.id)).map(c => c.name));
  if (settings.customColourEnabled) allowed.add('Custom');
  allowed.add(ADVANCED_FILAMENT);
  if (!allowed.has(value.colour) || value.colourMapping.some(m => !allowed.has(m.target))) throw Object.assign(new Error('Please choose an available colour.'), { status: 400 });
  if ((value.colour === 'Custom' || value.colourMapping.some(m => m.target === 'Custom')) && !value.customColour) throw Object.assign(new Error('Describe your custom colour request.'), { status: 400 });
  if((value.colour===ADVANCED_FILAMENT||value.colourMapping.some(m=>m.target===ADVANCED_FILAMENT))&&!value.advancedFilamentNote)throw Object.assign(new Error('Describe the advanced filament you need.'),{status:400});
  if ([value.supports, value.printer, value.quality].some(v => v.startsWith('Custom')) && !value.notes) throw Object.assign(new Error('Add a note for your custom preferences.'), { status: 400 });
  return { ...value, school: school.name, staff: staff.name, classroom: classroom.classroom, colourLabel: value.colour === 'Custom' ? `Custom ${value.customColour}` : value.colour };
}
export function safePart(text, max = 50) {
  return text.normalize('NFKC').replace(/[^\p{L}\p{N} .-]/gu, '-').replace(/[ .-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'unnamed';
}
export function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function makeRecord(value, originalName, bytes, now = new Date()) {
  const id = randomUUID();
  const extension = originalName.split('.').at(-1).toLowerCase();
  const date = localDate(now);
  const name = [safePart(value.school,80),filenameColour(value),date,safePart(value.firstName,40)].join('_')+'.'+extension;
  return { ...value, id, filename: name, originalName, bytes, date, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + RETENTION_DAYS * 86400000).toISOString(), status: 'queued' };
}
export function extractFolderId(input) {
  const s = input.trim();
  if (/^[a-zA-Z0-9_-]{10,150}$/.test(s)) return s;
  try { const url = new URL(s); if (url.hostname !== 'drive.google.com') return ''; return url.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1] || ''; } catch { return ''; }
}
export function isExpired(record, now = new Date()) { return Date.parse(record.expiresAt) <= now.getTime(); }

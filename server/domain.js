import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { BAMBU_COLOURS, PREFERENCES, RETENTION_DAYS } from '../shared/catalog.js';
import { OPTIONAL_FORMATS } from '../shared/formats.js';
export const text = (max = 100) => z.string().trim().max(max);
const label = text(80).min(1).refine(s => !/[\x00-\x1f]/.test(s), 'Use ordinary text');
const settingsFields = {
  folderId: z.string().regex(/^[a-zA-Z0-9_-]{10,150}$/),
  schools: z.array(z.object({ id: z.uuid(), name: label })).max(100),
  staff: z.array(z.object({ id: z.uuid(), name: label })).max(100),
  classes: z.array(z.object({ id: z.uuid(), name: label, schoolId: z.uuid() })).max(300),
  colours: z.array(z.enum(BAMBU_COLOURS.map(c => c.id))).max(50),
  customColourEnabled: z.boolean(),
  extraFormats: z.array(z.enum(OPTIONAL_FORMATS)).max(OPTIONAL_FORMATS.length).default([]),
};
function checkSettings(s, ctx) {
  for (const key of ['schools', 'staff', 'classes']) {
    if (new Set(s[key].map(x => x.id)).size !== s[key].length) ctx.addIssue({ code: 'custom', message: `Duplicate ${key} identifiers` });
  }
  if (s.classes.some(c => !s.schools.some(x => x.id === c.schoolId))) ctx.addIssue({ code: 'custom', message: 'Each class must belong to a school' });
  if (!s.colours.length && !s.customColourEnabled) ctx.addIssue({ code: 'custom', message: 'Offer at least one colour or custom colour requests' });
}
export const settingsSchema = z.object(settingsFields).superRefine(checkSettings);
export const cloudflareSettingsSchema = z.object({ ...settingsFields, folderId: z.literal('').default('') }).superRefine(checkSettings);
export const submissionSchema = z.object({
  requestId: z.uuid(), firstName: text(40).min(1).regex(/^[\p{L}\p{M} '\-]+$/u, 'Use your first name only'),
  schoolId: z.uuid(), staffId: z.uuid(), classId: z.union([z.uuid(), z.literal('')]),
  colour: text(80).min(1), customColour: text(80),
  colourMapping: z.array(z.object({ source: text(40), target: text(80).min(1) })).max(32),
  size: z.enum(PREFERENCES.size), supports: z.enum(PREFERENCES.supports),
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
  const classroom = value.classId ? settings.classes.find(x => x.id === value.classId && x.schoolId === value.schoolId) : null;
  if (!school || !staff || (value.classId && !classroom)) throw Object.assign(new Error('Choose a current school, staff member and class.'), { status: 400 });
  const allowed = new Set(BAMBU_COLOURS.filter(c => settings.colours.includes(c.id)).map(c => c.name));
  if (settings.customColourEnabled) allowed.add('Custom');
  if (!allowed.has(value.colour) || value.colourMapping.some(m => !allowed.has(m.target))) throw Object.assign(new Error('Please choose an available colour.'), { status: 400 });
  if ((value.colour === 'Custom' || value.colourMapping.some(m => m.target === 'Custom')) && !value.customColour) throw Object.assign(new Error('Describe your custom colour request.'), { status: 400 });
  if ([value.size, value.supports, value.printer, value.quality].some(v => v.startsWith('Custom')) && !value.notes) throw Object.assign(new Error('Add a note for your custom preferences.'), { status: 400 });
  return { ...value, school: school.name, staff: staff.name, classroom: classroom?.name || '', colourLabel: value.colour === 'Custom' ? `Custom ${value.customColour}` : value.colour };
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
  const colour = value.colourMapping.length > 1 ? [...new Set(value.colourMapping.map(m => m.target === 'Custom' ? value.colourLabel : m.target))].join('+') : value.colourLabel;
  const name = [safePart(value.school, 30), safePart(colour, 35), date, safePart(value.firstName, 24), safePart(value.staff, 24), value.classroom ? safePart(value.classroom, 24) : '', safePart(`${value.copies}x ${value.size} ${value.supports} ${value.printer} ${value.quality}`, 70), value.notes ? safePart(value.notes, 30) : ''].filter(Boolean).join('_').slice(0, 220) + '_' + id.slice(0, 8) + '.' + extension;
  return { ...value, id, filename: name, originalName, bytes, date, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + RETENTION_DAYS * 86400000).toISOString(), status: 'queued' };
}
export function extractFolderId(input) {
  const s = input.trim();
  if (/^[a-zA-Z0-9_-]{10,150}$/.test(s)) return s;
  try { const url = new URL(s); if (url.hostname !== 'drive.google.com') return ''; return url.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1] || ''; } catch { return ''; }
}
export function isExpired(record, now = new Date()) { return Date.parse(record.expiresAt) <= now.getTime(); }

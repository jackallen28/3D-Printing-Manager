import type { analyseGeometry } from "../shared/geometry.js";
export type Analysis = ReturnType<typeof analyseGeometry>;
export interface Option {
  id: string;
  name: string;
}
export interface ClassOption extends Option {
  schoolId: string;
  code?: string;
}
export interface Colour extends Option {
  hex: string;
}
export interface Settings {
  folderId: string;
  schools: Option[];
  staff: Option[];
  classes: ClassOption[];
  colours: string[];
  customColourEnabled: boolean;
  extraFormats: string[];
  requireClassCode?: boolean;
}
export interface Config {
  uploadMode?: string;
  studentLookupSupported?: boolean;
  lookupSchools?: Option[];
  schools: Option[];
  staff: Option[];
  classes: ClassOption[];
  colours: Colour[];
  customColourEnabled: boolean;
  acceptedExtensions: string[];
  acceptingUploads: boolean;
  uploadsPaused?: boolean;
  requireClassCode?: boolean;
  /** Set when the Turnstile robot check is turned on. */
  turnstileSiteKey?: string;
  localDemo: boolean;
  maxBytes: number;
}
export interface Details {
  requestId: string;
  firstName: string;
  schoolId: string;
  staffId: string;
  classId: string;
  classCode: string;
  classroom?: string;
  scalePercent: number;
  dimensionsMm: number[] | null;
  advancedFilamentNote: string;
  colour: string;
  customColour: string;
  colourMapping: { source: string; target: string; partName?: string }[];
  size: string;
  supports: string;
  printer: string;
  quality: string;
  copies: number;
  notes: string;
  designLink: string;
  readyConfirmed: boolean;
  detailsConfirmed: boolean;
}
export interface PrintRecord extends Details {
  id: string;
  filename: string;
  originalName: string;
  bytes: number;
  date: string;
  createdAt: string;
  expiresAt: string;
  school: string;
  staff: string;
  classroom: string;
  colourLabel: string;
  status: "queued" | "printing" | "printed";
}

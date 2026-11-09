// Bambu PLA Basic swatches. Screen colours are approximate; spool stock is set by staff.
export const BAMBU_COLOURS = [
  ['Jade White', '#f1eee7'], ['Black', '#242424'], ['Silver', '#a6a9aa'], ['Gray', '#8e9089'],
  ['Light Gray', '#d0d1c8'], ['Red', '#c12e1f'], ['Maroon Red', '#9d2235'], ['Pink', '#e8a5b7'],
  ['Hot Pink', '#e52c78'], ['Magenta', '#bf2079'], ['Orange', '#f07818'], ['Pumpkin Orange', '#d66b2e'],
  ['Yellow', '#f4cf25'], ['Gold', '#d7a945'], ['Beige', '#d7c2a3'], ['Brown', '#986b43'],
  ['Cocoa Brown', '#6f5034'], ['Bambu Green', '#00ae42'], ['Bright Green', '#a4d55b'],
  ['Mistletoe Green', '#3f6952'], ['Turquoise', '#00b5a9'], ['Cyan', '#00a6d6'],
  ['Blue', '#0a2989'], ['Cobalt Blue', '#0056b8'], ['Ice Blue', '#a3d8e1'],
  ['Purple', '#633e98'], ['Indigo Purple', '#4a3483'], ['Lavender', '#b6a1cf']
].map(([name, hex]) => ({ id: name.toLowerCase().replaceAll(' ', '-'), name, hex }));
export const PREFERENCES = {
  size: ['Original size', 'Fit to 50 mm', 'Fit to 100 mm', 'Fit to 150 mm', 'Custom — see note'],
  supports: ['Let staff decide', 'Supports are okay', 'Prefer no supports', 'Custom — see note'],
  printer: ['Let staff decide', 'Bambu Lab A1', 'Bambu Lab P1S', 'Bambu Lab X1 Carbon', 'Custom — see note'],
  quality: ['Standard', 'Fine detail', 'Draft / quick print', 'Custom — see note'],
};
export const DEFAULT_SETTINGS = {
  folderId: '', schools: [], staff: [], classes: [],
  colours: ['jade-white', 'black', 'red', 'yellow', 'bambu-green', 'blue', 'purple', 'orange'],
  customColourEnabled: true,
  extraFormats: [],
};
export const RETENTION_DAYS = 14;
export const MAX_BYTES = 50 * 1024 * 1024;
export const APP_TAG = 'bnts-print-studio-v1';
export const ADVANCED_FILAMENT = 'Advanced filament — request only';
export const ADVANCED_HEX = '#9c55d8';

export const FILE_FORMATS = [
  { id: 'stl', name: 'STL', extensions: ['stl'], preview: true, required: true },
  { id: 'obj', name: 'OBJ', extensions: ['obj'], preview: true, required: true },
  { id: 'step', name: 'STEP', extensions: ['step', 'stp'], preview: false, required: true },
  { id: '3mf', name: '3MF', extensions: ['3mf'], preview: true, required: true },
  { id: 'ply', name: 'PLY', extensions: ['ply'], preview: true, required: false },
  { id: 'off', name: 'OFF', extensions: ['off'], preview: false, required: false },
  { id: 'iges', name: 'IGES', extensions: ['iges', 'igs'], preview: false, required: false },
  { id: 'brep', name: 'BREP', extensions: ['brep'], preview: false, required: false },
  { id: 'f3d', name: 'Fusion 360', extensions: ['f3d'], preview: false, required: false },
  { id: 'blend', name: 'Blender', extensions: ['blend'], preview: false, required: false },
  { id: 'zip', name: 'ZIP archive (CAD files only)', extensions: ['zip'], preview: false, required: true },
  { id: 'gcode', name: 'G-code', extensions: ['gcode', 'bgcode'], preview: false, required: false },
];
export const OPTIONAL_FORMATS = FILE_FORMATS.filter(f => !f.required || f.id === 'zip').map(f => f.id);
export const enabledFormats = settings => FILE_FORMATS.filter(f => f.required || (settings.extraFormats || []).includes(f.id));
export const acceptedExtensions = settings => enabledFormats(settings).flatMap(f => f.extensions);
export const fileFormat = name => FILE_FORMATS.find(f => f.extensions.includes(name.split('.').at(-1).toLowerCase()));

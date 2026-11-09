import { readFile, writeFile } from 'node:fs/promises';
import { FILE_FORMATS } from '../shared/formats.js';
import { simpleColours } from '../shared/printing.js';
import { BAMBU_COLOURS, DEFAULT_SETTINGS, PREFERENCES, APP_TAG, ADVANCED_FILAMENT } from '../shared/catalog.js';
const html=await readFile('.apps-script-build/index.html','utf8');
const bootstrap='<base target="_top"><script>window.BNTS_GAS = <?!= bootJson ?>;</script>';
await writeFile('apps-script/Index.html',html.replace('<head>','<head>'+bootstrap).replace(/<link rel="icon"[^>]*>/,''));
await writeFile('apps-script/Catalog.gs','// Generated from shared/catalog.js by npm run build:apps-script\nvar BNTS_CATALOG = '+JSON.stringify({colours:BAMBU_COLOURS,defaults:DEFAULT_SETTINGS,preferences:PREFERENCES,tag:APP_TAG,formats:FILE_FORMATS,simpleColours,advancedFilament:ADVANCED_FILAMENT})+';\n');
console.log('Apps Script package ready: Code.gs, Catalog.gs, Index.html and appsscript.json.');

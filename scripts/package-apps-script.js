import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {zipSync} from 'fflate';
const files={};for(const name of ['Code.gs','Catalog.gs','Index.html','appsscript.json'])files[name]=new Uint8Array(await readFile('apps-script/'+name));
files['SETUP.md']=new Uint8Array(await readFile('README.md'));
files['DEPLOY-RENDER.md']=new Uint8Array(await readFile('DEPLOY-RENDER.md'));
await mkdir('release',{recursive:true});await writeFile('release/bnts-print-studio-apps-script.zip',zipSync(files));console.log('Created release/bnts-print-studio-apps-script.zip');

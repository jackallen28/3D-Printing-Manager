import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { unzipSync, strFromU8 } from 'fflate';
import type {Analysis} from '../types';
export interface LoadedModel { object: THREE.Group; palette: string[]; notices: string[]; positions: Float32Array; colourIndices:Uint8Array; format:string; analysis?:Analysis; parts?: {source:string;name:string}[]; }
const MAX_EXPANDED = 100 * 1024 * 1024;
function checkZip(buffer: ArrayBuffer) {
  const view = new DataView(buffer); let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd=i; break; }
  if (eocd < 0) throw new Error('This 3MF archive is damaged. Export the model again.');
  const count=view.getUint16(eocd+10,true); let p=view.getUint32(eocd+16,true), total=0;
  if(count>1000||count===65535) throw new Error('This 3MF is too complex. Export a smaller model.');
  for(let i=0;i<count;i++) {
    if(p+46>buffer.byteLength||view.getUint32(p,true)!==0x02014b50) throw new Error('This 3MF archive is damaged.');
    const size=view.getUint32(p+24,true); total+=size;
    if(size>70*1024*1024||total>MAX_EXPANDED||view.getUint16(p+8,true)&1) throw new Error('This 3MF is too large or encrypted. Export a smaller model.');
    p+=46+view.getUint16(p+28,true)+view.getUint16(p+30,true)+view.getUint16(p+32,true);
  }
}
const children = (node: Element, tag: string) => [...node.children].filter(x=>x.localName===tag);
const child = (node: Element, tag: string) => children(node,tag)[0];
const hex = (value: string | null, fallback = '#19c1ca') => /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value || '') ? value!.slice(0,7).toLowerCase() : fallback;
function transform(value: string | null) {
  if(!value) return new THREE.Matrix4();
  const v=value.trim().split(/\s+/).map(Number);
  if(v.length!==12||v.some(n=>!Number.isFinite(n))) throw new Error('Invalid 3MF part transform.');
  return new THREE.Matrix4().set(v[0],v[3],v[6],v[9],v[1],v[4],v[7],v[10],v[2],v[5],v[8],v[11],0,0,0,1);
}
function load3mf(buffer: ArrayBuffer) {
  checkZip(buffer);
  const zip = unzipSync(new Uint8Array(buffer));
  const docs = new Map<string, Element>();
  for(const [name, bytes] of Object.entries(zip)) if(name.toLowerCase().endsWith('.model')) {
    const source=strFromU8(bytes);
    if(/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Unsupported XML declarations in this 3MF.');
    const doc=new DOMParser().parseFromString(source,'application/xml');
    if(doc.querySelector('parsererror')) throw new Error('This 3MF contains invalid model data.');
    docs.set(name.replace(/^\//,''), doc.documentElement);
  }
  let mainPath='3D/3dmodel.model';
  const rel=zip['_rels/.rels'];
  if(rel) { const doc=new DOMParser().parseFromString(strFromU8(rel),'application/xml'); const node=[...doc.getElementsByTagName('*')].find(x=>x.localName==='Relationship'&&x.getAttribute('Type')?.endsWith('/3dmodel')); mainPath=node?.getAttribute('Target')?.replace(/^\//,'') || mainPath; }
  const main=docs.get(mainPath); if(!main) throw new Error('No printable model was found in this 3MF.');
  const notices: string[]=[]; const filament: string[]=[]; const extruders=new Map<string,number>();
  const project=zip['Metadata/project_settings.config'];
  if(project) try { const config=JSON.parse(strFromU8(project)); filament.push(...(config.filament_colour||config.filament_color||[]).map((c: string)=>hex(c))); } catch { /* Optional slicer metadata. */ }
  const config=zip['Metadata/model_settings.config'];
  if(config) {
    const doc=new DOMParser().parseFromString(strFromU8(config),'application/xml');
    for(const object of [...doc.getElementsByTagName('object')]) {
      const metadata=children(object,'metadata').find(m=>m.getAttribute('key')==='extruder');
      if(metadata) extruders.set(object.getAttribute('id')!,Number(metadata.getAttribute('value'))-1);
      for(const part of children(object,'part')) { const meta=children(part,'metadata').find(m=>m.getAttribute('key')==='extruder'); if(meta) extruders.set(part.getAttribute('id')!,Number(meta.getAttribute('value'))-1); }
    }
  }
  let renderedTriangles=0,buildCount=0, painted=false,textured=false;
  const palette=new Set<string>();
  function build(modelPath: string, id: string, stack: Set<string>, inherited?: number): THREE.Group {
    const key=modelPath+':'+id;
    if(stack.has(key)||stack.size>32||++buildCount>1000) throw new Error('This 3MF contains too many or circular parts.');
    const model=docs.get(modelPath); if(!model) throw new Error('A linked part is missing from this 3MF. Export the complete model.');
    const resources=child(model,'resources'); if(!resources) throw new Error('No 3MF resources found.');
    const object=children(resources,'object').find(x=>x.getAttribute('id')===id); if(!object) throw new Error('A 3MF object is missing.');
    const group=new THREE.Group(); group.name=object.getAttribute('name') || 'Part';
    const extruder=extruders.get(id) ?? inherited;
    const mesh=child(object,'mesh');
    if(mesh) {
      const vs=child(mesh,'vertices'), ts=child(mesh,'triangles'); if(!vs||!ts) throw new Error('This model has no triangles.');
      const vertices=children(vs,'vertex').map(v=>[Number(v.getAttribute('x')),Number(v.getAttribute('y')),Number(v.getAttribute('z'))]);
      const triangles=children(ts,'triangle'); renderedTriangles+=triangles.length;
      if(renderedTriangles>1000000) throw new Error('Over one million triangles. Simplify the model or export a smaller STL.');
      const positions=new Float32Array(triangles.length*9), colours=new Float32Array(positions.length);
      const materialColour=(pid:string|null,index:string|null) => {
        const resource=[...resources.children].find(n=>n.getAttribute('id')===pid);
        if(!resource) return filament[extruder ?? -1] || '#19c1ca';
        if(resource.localName==='texture2dgroup') textured=true;
        const entry=resource.children[Number(index||0)];
        return hex(entry?.getAttribute('displaycolor') || entry?.getAttribute('color'));
      };
      triangles.forEach((triangle,t)=> {
        if(triangle.hasAttribute('paint_color')) painted=true;
        const pid=triangle.getAttribute('pid') || object.getAttribute('pid');
        for(let i=0;i<3;i++) {
          const vertex=vertices[Number(triangle.getAttribute('v'+(i+1)))];
          if(!vertex||vertex.some(n=>!Number.isFinite(n))) throw new Error('This 3MF has invalid vertices.');
          positions.set(vertex,t*9+i*3);
          const c=materialColour(pid,triangle.getAttribute('p'+(i+1)) || triangle.getAttribute('p1') || object.getAttribute('pindex'));
          palette.add(c); const colour=new THREE.Color(c); colours.set([colour.r,colour.g,colour.b],t*9+i*3);
        }
      });
      const geometry=new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.BufferAttribute(positions,3)); geometry.setAttribute('color',new THREE.BufferAttribute(colours,3)); geometry.computeVertexNormals();
      const material=new THREE.MeshStandardMaterial({ vertexColors:true,roughness:0.55,metalness:0.04,side:THREE.DoubleSide });
      const part=new THREE.Mesh(geometry,material); group.add(part);
    }
    const components=child(object,'components');
    if(components) for(const component of children(components,'component')) {
      const ref=[...component.attributes].find(a=>a.localName==='path')?.value;
      const target=ref ? ref.replace(/^\//,'') : modelPath;
      const part=build(target,component.getAttribute('objectid')!,new Set([...stack,key]),extruder); part.applyMatrix4(transform(component.getAttribute('transform'))); group.add(part);
    }
    return group;
  }
  const group=new THREE.Group(); const buildNode=child(main,'build'); if(!buildNode) throw new Error('This 3MF has no printable objects.');
  for(const item of children(buildNode,'item')) { if(item.getAttribute('printable')==='0') continue; const part=build(mainPath,item.getAttribute('objectid')!,new Set()); part.applyMatrix4(transform(item.getAttribute('transform'))); group.add(part); }
  const units:Record<string,number>={micron:0.001,millimeter:1,centimeter:10,meter:1000,inch:25.4,foot:304.8};
  const unit=main.getAttribute('unit')||'millimeter'; if(!(unit in units)) throw new Error('Unsupported 3MF measurement units.'); group.scale.setScalar(units[unit]);
  if(painted) { notices.push('This file contains slicer-specific painted colours. The original painting is preserved in your file, but cannot be accurately shown here. Choose colour requests for staff to apply in Bambu Studio.'); filament.forEach(c=>palette.add(c)); }
  if(textured) notices.push('Texture images are not shown. Staff will check the original texture in the slicer.');
  if(palette.size>32) throw new Error('This model uses more than 32 colours. Simplify its colours before uploading.');
  return {object:group,palette:[...palette],notices};
}
export async function loadModel(file: File):Promise<LoadedModel> {
  const buffer=await file.arrayBuffer(); let loaded:Pick<LoadedModel,'object'|'palette'|'notices'|'parts'>;
  if(file.name.toLowerCase().endsWith('.3mf')) loaded=load3mf(buffer);
  else if(/\.(obj|ply)$/i.test(file.name)) {
    const object=/\.obj$/i.test(file.name)?new OBJLoader().parse(new TextDecoder().decode(buffer)):new THREE.Group();
    if(/\.ply$/i.test(file.name)) object.add(new THREE.Mesh(new PLYLoader().parse(buffer)));
    if(/\.obj$/i.test(file.name)){
      const grouped:THREE.Mesh[]=[];object.traverse(node=>{if(node instanceof THREE.Mesh&&Array.isArray(node.material)&&node.geometry.groups.length>1)grouped.push(node);});
      for(const mesh of grouped){const geometry=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry;const positions=geometry.getAttribute('position');const groups=new Map<number,number[]>();for(const group of geometry.groups){const vertices=groups.get(group.materialIndex||0)||[];for(let i=group.start;i<group.start+group.count;i++)vertices.push(positions.getX(i),positions.getY(i),positions.getZ(i));groups.set(group.materialIndex||0,vertices);}const wrapper=new THREE.Group();wrapper.position.copy(mesh.position);wrapper.quaternion.copy(mesh.quaternion);wrapper.scale.copy(mesh.scale);for(const[index,vertices]of groups){const partGeometry=new THREE.BufferGeometry();partGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));const part=new THREE.Mesh(partGeometry);const materials=mesh.material as THREE.Material[];part.name=(mesh.name||'Part')+' · '+(materials[index]?.name||'Area '+(index+1));wrapper.add(part);}mesh.parent?.add(wrapper);mesh.parent?.remove(mesh);}
    }
    const palette=new Set<string>();
    object.traverse(node=>{if(node instanceof THREE.Mesh){node.geometry.computeVertexNormals();const colours=node.geometry.getAttribute('color');node.material=new THREE.MeshStandardMaterial({color:colours?'#ffffff':'#19c1ca',vertexColors:!!colours,roughness:0.55,metalness:0.04,side:THREE.DoubleSide});if(colours){for(let i=0;i<colours.count;i++){palette.add('#'+new THREE.Color().setRGB(colours.getX(i),colours.getY(i),colours.getZ(i)).getHexString());if(palette.size>32)throw new Error('This model has more than 32 colours. Export an STL for a single-colour preview.');}}else palette.add('#19c1ca');}});
    let parts:LoadedModel['parts'];
    if(/\.obj$/i.test(file.name)){const meshes:THREE.Mesh[]=[];object.traverse(node=>{if(node instanceof THREE.Mesh)meshes.push(node);});if(meshes.length>1&&meshes.length<=32){palette.clear();parts=meshes.map((mesh,i)=>{const source='#'+new THREE.Color().setHSL((0.48+i*0.6180339)%1,0.55,0.55).getHexString();mesh.geometry.deleteAttribute('color');mesh.material=new THREE.MeshStandardMaterial({color:source,roughness:0.55,metalness:0.04,side:THREE.DoubleSide});mesh.userData.colourSource=source;palette.add(source);return {source,name:mesh.name||'Part '+(i+1)};});}}
    loaded={object,palette:[...palette],parts,notices:['This preview assumes millimetres and a Z-up orientation. OBJ material files and textures are not included.']};
  }
  else {
    const view=new DataView(buffer);
    const binary=buffer.byteLength>=84&&84+view.getUint32(80,true)*50===buffer.byteLength;
    if(!binary){const source=new TextDecoder().decode(buffer);if(buffer.byteLength<84||!/^solid\b/i.test(source)||!/endsolid\b/i.test(source))throw new Error('This is not a valid STL file. Export your model as STL or 3MF.');}
    const geometry=new STLLoader().parse(buffer);
    geometry.computeVertexNormals();
    const material=new THREE.MeshStandardMaterial({ color:'#19c1ca',roughness:0.55,metalness:0.04,side:THREE.DoubleSide });
    const object=new THREE.Group(); object.add(new THREE.Mesh(geometry,material));
    loaded={object,palette:['#19c1ca'],notices:['STL has no measurement units. This preview assumes millimetres.']};
  }
  loaded.object.updateMatrixWorld(true);
  const arrays:Float32Array[]=[],sourceArrays:Uint8Array[]=[];let length=0;const sourceIndex=new Map(loaded.palette.map((source,i)=>[source,i]));
  loaded.object.traverse(node=>{ if(node instanceof THREE.Mesh) { let geometry=node.geometry.clone(); if(geometry.index) geometry=geometry.toNonIndexed(); geometry.applyMatrix4(node.matrixWorld); const array=new Float32Array(geometry.getAttribute('position').array); arrays.push(array);length+=array.length;const colours=geometry.getAttribute('color'),indices=new Uint8Array(array.length/3),colour=new THREE.Color();for(let i=0;i<indices.length;i++){const source=colours?'#'+colour.setRGB(colours.getX(i),colours.getY(i),colours.getZ(i)).getHexString():node.userData.colourSource||loaded.palette[0];indices[i]=sourceIndex.get(source)||0;}sourceArrays.push(indices);geometry.dispose(); } });
  const positions=new Float32Array(length); let offset=0; for(const a of arrays){positions.set(a,offset);offset+=a.length;}
  if(!positions.length||positions.some(n=>!Number.isFinite(n))) throw new Error('This file does not contain a valid 3D model. Export an STL or 3MF from your CAD program.');
  const colourIndices=new Uint8Array(length/3);offset=0;for(const array of sourceArrays){colourIndices.set(array,offset);offset+=array.length;}
  return {...loaded,positions,colourIndices,format:file.name.split('.').at(-1)!.toLowerCase()};
}

export function splitModelParts(model:LoadedModel, triangleParts:Uint32Array, count:number):LoadedModel {
 if(model.parts?.length||!triangleParts.length||count<2||count>32||model.palette.length>1)return model;
 const groups: number[][]=Array.from({length:count},()=>[]);
 triangleParts.forEach((part,t)=>{for(let v=0;v<9;v++)groups[part].push(model.positions[t*9+v]);});
 const object=new THREE.Group();const palette:string[]=[];const parts:{source:string;name:string}[]=[];
 groups.forEach((positions,i)=>{const source='#'+new THREE.Color().setHSL((0.48+i*0.6180339)%1,0.55,0.55).getHexString();const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:source,roughness:0.55,metalness:0.04,side:THREE.DoubleSide}));mesh.name='Part '+(i+1);mesh.userData.colourSource=source;object.add(mesh);palette.push(source);parts.push({source,name:mesh.name});});
 const colourIndices=new Uint8Array(model.positions.length/3);triangleParts.forEach((part,t)=>colourIndices.fill(part,t*3,t*3+3));
 return {...model,object,palette,parts,colourIndices};
}
export async function prepareRequestedParts(model:LoadedModel,sources:string[]):Promise<LoadedModel> {
 if(model.analysis)return model;
 const {default:Worker}=await import('./analysis.worker?worker&inline');
 return new Promise((resolve,reject)=>{const worker=new Worker();worker.onmessage=event=>{worker.terminate();if(event.data.error)reject(new Error(event.data.error));else{const analysis=event.data.result;const prepared=sources.length>1?splitModelParts(model,analysis.triangleParts,analysis.components):model;resolve({...prepared,analysis});}};worker.onerror=()=>{worker.terminate();reject(new Error('The model parts could not be read.'));};const positions=model.positions.slice();worker.postMessage({positions,format:model.format},[positions.buffer]);});
}

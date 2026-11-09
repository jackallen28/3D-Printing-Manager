import {zipSync,strToU8} from 'fflate';

/** @param {import('../client/lib/model').LoadedModel} model @param {import('../client/types').Analysis} analysis */
export function splitGroups(model,analysis) {
 if(model.objects.length>1)return model.objects;
 if(!analysis.complete||analysis.components<2)return [];
 /** @type {number[][]} */ const groups=Array.from({length:analysis.components},()=>[]);
 analysis.triangleParts.forEach((part,triangle)=>groups[part].push(triangle));
 return groups.map((triangles,index)=>({name:'Object '+(index+1),triangles:new Uint32Array(triangles)}));
}
/** @param {File} file @param {import('../client/lib/model').LoadedModel} model @param {import('../client/types').Analysis} analysis */
export function splitIntoFiles(file,model,analysis) {
 const groups=splitGroups(model,analysis);
 if(groups.length<2)throw new Error('No separate objects were found.');
 if(groups.length>20)throw new Error('Split this file into smaller groups in your CAD program. Up to 20 files can be reviewed together.');
 const base=file.name.replace(/\.[^.]+$/,'').slice(0,140)||'model';
 return groups.map((group,index)=>{
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const triangle of group.triangles)for(let i=0;i<9;i++){const axis=i%3,value=model.positions[triangle*9+i];min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);}
  const offset=[(min[0]+max[0])/2,(min[1]+max[1])/2,min[2]],vertices=[];
  for(const triangle of group.triangles)for(let i=0;i<9;i++)vertices.push(model.positions[triangle*9+i]-offset[i%3]);
  const label=group.name.replace(/[^\p{L}\p{N} .-]/gu,'-').trim().slice(0,50)||'object-'+(index+1),name=base+'-'+(index+1)+'-'+label;
  if(model.format==='stl'){
   const buffer=new ArrayBuffer(84+group.triangles.length*50),view=new DataView(buffer);new Uint8Array(buffer).set(strToU8('BNTS separate object'));view.setUint32(80,group.triangles.length,true);
   for(let t=0;t<group.triangles.length;t++){
    const i=t*9,ax=vertices[i+3]-vertices[i],ay=vertices[i+4]-vertices[i+1],az=vertices[i+5]-vertices[i+2],bx=vertices[i+6]-vertices[i],by=vertices[i+7]-vertices[i+1],bz=vertices[i+8]-vertices[i+2],normal=[ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx],length=Math.hypot(...normal)||1;
    normal.forEach((v,axis)=>view.setFloat32(84+t*50+axis*4,v/length,true));for(let v=0;v<9;v++)view.setFloat32(84+t*50+12+v*4,vertices[i+v],true);
   }
   return new File([buffer],name+'.stl',{type:'model/stl'});
  }
  const points=Array.from({length:vertices.length/3},(_,i)=>`<vertex x="${vertices[i*3]}" y="${vertices[i*3+1]}" z="${vertices[i*3+2]}"/>`).join('');
  const triangles=Array.from(group.triangles,(original,t)=>`<triangle v1="${t*3}" v2="${t*3+1}" v3="${t*3+2}" pid="1" p1="${model.colourIndices[original*3]}" p2="${model.colourIndices[original*3+1]}" p3="${model.colourIndices[original*3+2]}"/>`).join('');
  const palette=model.palette.map((colour,i)=>`<base name="Section ${i+1}" displaycolor="${colour}"/>`).join('');
  const xml=`<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><basematerials id="1">${palette}</basematerials><object id="2" type="model"><mesh><vertices>${points}</vertices><triangles>${triangles}</triangles></mesh></object></resources><build><item objectid="2"/></build></model>`;
  const bytes=zipSync({'[Content_Types].xml':strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),'_rels/.rels':strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),'3D/3dmodel.model':strToU8(xml)});
  return new File([new Uint8Array(bytes)],name+'.3mf',{type:'model/3mf'});
 });
}

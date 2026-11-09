import { zipSync, strToU8 } from 'fflate';
export function cube(x=0,y=0,z=0,size=20) {
  const v=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(p=>[p[0]*size+x,p[1]*size+y,p[2]*size+z]);
  const faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]];
  return new Float32Array(faces.flatMap(f=>f.flatMap(i=>v[i])));
}
export function stl(positions=cube()) {
  const b=Buffer.alloc(84+positions.length/9*50);b.write('BNTS test model');b.writeUInt32LE(positions.length/9,80);
  for(let t=0;t<positions.length/9;t++)for(let i=0;i<9;i++)b.writeFloatLE(positions[t*9+i],84+t*50+12+i*4);
  return b;
}
export function cantilever() {
  const profile=[[0,0],[10,0],[10,20],[20,20],[20,23],[0,23]],vertices=[...profile.map(([x,z])=>[x,0,z]),...profile.map(([x,z])=>[x,10,z])];
  const caps=[[0,1,2],[0,2,5],[2,3,4],[2,4,5]],faces=[...caps,...caps.map(face=>face.map(i=>i+6).reverse())];
  for(let i=0;i<6;i++){const next=(i+1)%6;faces.push([i,next+6,next],[i,i+6,next+6]);}
  return new Float32Array(faces.flatMap(face=>face.flatMap(index=>vertices[index])));
}
export function multicolour3mf() {
  const positions=cube();const vertices=Array.from({length:positions.length/3},(_,i)=>`<vertex x="${positions[i*3]}" y="${positions[i*3+1]}" z="${positions[i*3+2]}"/>`).join('');
  const triangles=Array.from({length:positions.length/9},(_,t)=>`<triangle v1="${t*3}" v2="${t*3+1}" v3="${t*3+2}" pid="2" p1="${t%2}"/>`).join('');
  const xml=`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><basematerials id="2"><base name="Teal" displaycolor="#19c1ca"/><base name="Purple" displaycolor="#704988"/></basematerials><object id="1" type="model"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
  return Buffer.from(zipSync({'[Content_Types].xml':strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),'_rels/.rels':strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),'3D/3dmodel.model':strToU8(xml)}));
}
export const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');
export function details(){return {requestId:crypto.randomUUID(),firstName:'Mia',schoolId:'11111111-1111-4111-8111-111111111111',staffId:'22222222-2222-4222-8222-222222222222',classId:'',colour:'Blue',customColour:'',colourMapping:[{source:'#19c1ca',target:'Blue'}],size:'Original size',supports:'Let staff decide',printer:'Let staff decide',quality:'Standard',copies:1,notes:'Please keep the base flat.',designLink:'https://www.tinkercad.com/things/example',readyConfirmed:true,detailsConfirmed:true};}

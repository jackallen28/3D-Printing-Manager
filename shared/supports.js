import {Vector3,Ray,DoubleSide} from 'three';

/** Illustrative vertical supports, stopping at an upward-facing surface below. */
export function sampleSupports(bvh,positions,overhangTriangles,groundZ) {
 const contacts=[],seen=new Set(),a=new Vector3(),b=new Vector3(),c=new Vector3(),normal=new Vector3(),edge=new Vector3(),ray=new Ray();
 let area=0;
 for(const triangle of overhangTriangles){const i=triangle*9;area+=Math.abs((positions[i+3]-positions[i])*(positions[i+7]-positions[i+1])-(positions[i+6]-positions[i])*(positions[i+4]-positions[i+1]))/2;}
 const spacing=Math.max(2,Math.sqrt(area/320)),epsilon=0.001;
 const add=(x,y,top,triangle)=>{
  if(contacts.length>=480||top-groundZ<0.1)return;
  const key=[Math.round(x/spacing*2),Math.round(y/spacing*2),Math.round(top*10)].join(',');if(seen.has(key))return;seen.add(key);
  ray.origin.set(x,y,top-epsilon);ray.direction.set(0,0,-1);
  const hit=bvh.raycastFirst(ray,DoubleSide,epsilon);
  // A downward-facing first hit means the sample starts inside a solid.
  if(hit?.face&&hit.face.normal.z<=0.1)return;
  const bottom=hit?Math.max(groundZ,hit.point.z):groundZ;
  if(top-bottom<0.1)return;
  contacts.push({x,y,top,bottom,triangle,normal:[normal.x,normal.y,normal.z]});
 };
 for(const triangle of overhangTriangles){
  a.fromArray(positions,triangle*9);b.fromArray(positions,triangle*9+3);c.fromArray(positions,triangle*9+6);
  normal.subVectors(b,a).cross(edge.subVectors(c,a));if(normal.lengthSq()<1e-12)continue;normal.normalize();
  const denominator=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(denominator)<1e-10)continue;
  add((a.x+b.x+c.x)/3,(a.y+b.y+c.y)/3,(a.z+b.z+c.z)/3,triangle);
  const minX=Math.min(a.x,b.x,c.x),maxX=Math.max(a.x,b.x,c.x),minY=Math.min(a.y,b.y,c.y),maxY=Math.max(a.y,b.y,c.y);
  for(let x=Math.floor(minX/spacing)*spacing+spacing/2;x<=maxX;x+=spacing)for(let y=Math.floor(minY/spacing)*spacing+spacing/2;y<=maxY;y+=spacing){
   const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/denominator,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/denominator,w=1-u-v;
   if(u>=0&&v>=0&&w>=0)add(x,y,u*a.z+v*b.z+w*c.z,triangle);
  }
  if(contacts.length>=480)break;
 }
 return contacts;
}

/** Locate unsupported, joined overhangs for an illustrative bending animation. */
export function overhangSag(positions,triangleParts,overhangTriangles,floatingParts,partBounds) {
 const weights=new Float32Array(positions.length/3),triangleWeights=new Float32Array(positions.length/9),floating=new Set(floatingParts),regions=[],keys=new Set(),below=new Map(),anchors=new Map();
 const key=(part,x,y)=>part+':'+Math.round(x*1000)+','+Math.round(y*1000);
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,startZ=Infinity;
 for(const triangle of overhangTriangles){
  const part=triangleParts[triangle];if(floating.has(part))continue;
  const vertices=[];for(let v=0;v<3;v++){const i=triangle*9+v*3,p=[positions[i],positions[i+1],positions[i+2]];vertices.push(p);keys.add(key(part,p[0],p[1]));minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);startZ=Math.min(startZ,p[2]);}
  regions.push({part,vertices,minX:Math.min(...vertices.map(p=>p[0])),maxX:Math.max(...vertices.map(p=>p[0])),minY:Math.min(...vertices.map(p=>p[1])),maxY:Math.max(...vertices.map(p=>p[1]))});
 }
 if(!regions.length)return {weights,triangleWeights,maxDrop:0,startZ:0};
 for(let v=0;v<weights.length;v++){const part=triangleParts[Math.floor(v/3)],i=v*3,k=key(part,positions[i],positions[i+1]);if(keys.has(k))below.set(k,Math.min(below.get(k)??Infinity,positions[i+2]));}
 for(const region of regions)for(const p of region.vertices)if((below.get(key(region.part,p[0],p[1]))??p[2])<p[2]-0.1){const list=anchors.get(region.part)||[];list.push(p);anchors.set(region.part,list);}
 for(const region of regions)if(!anchors.has(region.part)){const bounds=partBounds[region.part];anchors.set(region.part,[[(bounds.min[0]+bounds.max[0])/2,(bounds.min[1]+bounds.max[1])/2,bounds.min[2]]]);}
 for(const[part,points]of anchors)anchors.set(part,[...new Map(points.map(p=>[key(part,p[0],p[1]),p])).values()]);
 const distances=new Map(),distance=(part,x,y)=>{const k=key(part,x,y);if(!distances.has(k)){let nearest=Infinity;for(const p of anchors.get(part))nearest=Math.min(nearest,Math.hypot(x-p[0],y-p[1]));distances.set(k,nearest);}return distances.get(k);};
 let reach=0;for(const region of regions){for(const p of region.vertices)reach=Math.max(reach,distance(region.part,p[0],p[1]));reach=Math.max(reach,distance(region.part,region.vertices.reduce((sum,p)=>sum+p[0],0)/3,region.vertices.reduce((sum,p)=>sum+p[1],0)/3));}
 const cell=Math.max(2,(Math.max(maxX-minX,maxY-minY)||1)/24),grid=new Map();
 for(const region of regions)for(let x=Math.floor(region.minX/cell);x<=Math.floor(region.maxX/cell);x++)for(let y=Math.floor(region.minY/cell);y<=Math.floor(region.maxY/cell);y++){const k=x+','+y,list=grid.get(k)||[];list.push(region);grid.set(k,list);}
 const weightAt=(part,x,y,z)=>{
  const candidates=grid.get(Math.floor(x/cell)+','+Math.floor(y/cell));if(!candidates)return 0;
  for(const region of candidates){
   if(region.part!==part||x<region.minX-0.001||x>region.maxX+0.001||y<region.minY-0.001||y>region.maxY+0.001)continue;
   const[a,b,c]=region.vertices,denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(denominator)<1e-10)continue;
   const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/denominator,vv=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/denominator,w=1-u-vv;
   if(u>=-0.0001&&vv>=-0.0001&&w>=-0.0001&&z>=u*a[2]+vv*b[2]+w*c[2]-0.001)return Math.min(1,distance(part,x,y)/(reach||1))**2;
  }
  return 0;
 };
 for(let v=0;v<weights.length;v++){const i=v*3;weights[v]=weightAt(triangleParts[Math.floor(v/3)],positions[i],positions[i+1],positions[i+2]);}
 // A coarse bridge can have every original corner attached. Its face centre can still sag.
 for(let t=0;t<triangleWeights.length;t++){
  const i=t*9;triangleWeights[t]=weightAt(triangleParts[t],(positions[i]+positions[i+3]+positions[i+6])/3,(positions[i+1]+positions[i+4]+positions[i+7])/3,(positions[i+2]+positions[i+5]+positions[i+8])/3);
 }
 return {weights,triangleWeights,maxDrop:weights.some(w=>w>0)||triangleWeights.some(w=>w>0)?Math.min(4,Math.max(1,reach*0.25)):0,startZ};
}

import {Vector3,Ray,DoubleSide} from 'three';

/** Illustrative vertical supports, stopping at an upward-facing surface below. */
export function sampleSupports(bvh,positions,overhangTriangles,groundZ) {
 const contacts=[],seen=new Set(),a=new Vector3(),b=new Vector3(),c=new Vector3(),normal=new Vector3(),edge=new Vector3(),ray=new Ray();
 let area=0;
 for(const triangle of overhangTriangles){const i=triangle*9;area+=Math.abs((positions[i+3]-positions[i])*(positions[i+7]-positions[i+1])-(positions[i+6]-positions[i])*(positions[i+4]-positions[i+1]))/2;}
 const spacing=Math.max(2,Math.sqrt(area/320)),epsilon=0.001;
 const add=(x,y,top,triangle)=>{
  if(contacts.length>=480||top-groundZ<0.4)return;
  const key=[Math.round(x/spacing*2),Math.round(y/spacing*2),Math.round(top*10)].join(',');if(seen.has(key))return;seen.add(key);
  ray.origin.set(x,y,top-epsilon);ray.direction.set(0,0,-1);
  const hit=bvh.raycastFirst(ray,DoubleSide,epsilon);
  // A downward-facing first hit means the sample starts inside a solid.
  if(hit?.face&&hit.face.normal.z<=0.1)return;
  const bottom=hit?Math.max(groundZ,hit.point.z):groundZ;
  if(top-bottom<0.4)return;
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

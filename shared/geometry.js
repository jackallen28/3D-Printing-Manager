import {measurePrintFeatures,thinFeatures} from './thickness.js';
/** Analyse world-space, Z-up, non-indexed triangles. Advisory checks, not a slicer.
 * @param {Float32Array} positions
 * @param {{format?: string}} options
 */
export function analyseGeometry(positions, options = {}) {
  const isObj=options.format==='obj';
  const notices=isObj?[{code:'obj',title:'OBJ colour parts',detail:'Separate colour sections and shared surfaces are common in OBJ files. Staff will check the final model in the slicer.'}]:[];
  const triangles = positions.length / 9;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { const axis = i % 3; if (!Number.isFinite(positions[i])) throw new Error('The model contains invalid coordinates.'); min[axis] = Math.min(min[axis], positions[i]); max[axis] = Math.max(max[axis], positions[i]); }
  const dimensions = max.map((v,i) => v-min[i]);
  if (!triangles || dimensions.every(x => x < 0.001)) throw new Error('No printable geometry was found.');
  const warnings = dimensionWarnings(dimensions);
  if (triangles > 200000) return { dimensions, triangles, components: 0, floating: 0, openEdges: 0, nonManifold: 0, degenerate: 0, overhangs: 0, partBounds:[],thicknessSamples:[],supportContacts:[],floatingParts:[],problemEdges:new Float32Array(),overhangTriangles:new Uint32Array(),floatingTriangles: new Uint32Array(), triangleParts: new Uint32Array(), complete: false, notices, warnings: [...warnings, { code: 'complex', title: 'Detailed checks not completed', detail: 'This model has over 200,000 triangles. The preview works, but staff must check disconnected parts and mesh errors in the slicer.' }] };
  const parents = new Int32Array(triangles); for (let i=0;i<triangles;i++) parents[i]=i;
  const find = x => { while (parents[x] !== x) { parents[x] = parents[parents[x]]; x = parents[x]; } return x; };
  const join = (a,b) => { const x=find(a),y=find(b); if(x!==y) parents[x]=y; };
  const vertices = new Map(), edges = new Map(),coordinates=[],overhangTriangles=[]; let next=0, degenerate=0, overhangs=0;
  for (let t=0;t<triangles;t++) {
    const ids=[];
    for (let v=0;v<3;v++) { const i=t*9+v*3; const key=[positions[i],positions[i+1],positions[i+2]].map(n=>Math.round(n*1000)).join(','); let entry=vertices.get(key); if(!entry) { entry={ id:next++, triangle:t };vertices.set(key,entry);coordinates.push(positions[i],positions[i+1],positions[i+2]); } else join(t,entry.triangle); ids.push(entry.id); }
    for(let k=0;k<3;k++) { const a=ids[k],b=ids[(k+1)%3]; const key=a<b?`${a},${b}`:`${b},${a}`; edges.set(key,(edges.get(key)||0)+1); }
    const o=t*9, ax=positions[o+3]-positions[o],ay=positions[o+4]-positions[o+1],az=positions[o+5]-positions[o+2], bx=positions[o+6]-positions[o],by=positions[o+7]-positions[o+1],bz=positions[o+8]-positions[o+2];
    const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx,length=Math.hypot(nx,ny,nz);
    if(length<1e-8) degenerate++;
    else if(nz/length < -0.707 && Math.min(positions[o+2],positions[o+5],positions[o+8])>min[2]+0.5){overhangs++;overhangTriangles.push(t);}
  }
  const parts = new Map();
  for(let t=0;t<triangles;t++) {
    const id=find(t),part=parts.get(id)||{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    for(let i=0;i<9;i++){const axis=i%3,value=positions[t*9+i];part.min[axis]=Math.min(part.min[axis],value);part.max[axis]=Math.max(part.max[axis],value);}
    parts.set(id,part);
  }
  const partNumbers=new Map([...parts.keys()].map((id,i)=>[id,i]));
  const triangleParts=new Uint32Array(triangles);for(let t=0;t<triangles;t++)triangleParts[t]=partNumbers.get(find(t));
  let floatingIds=new Set([...parts].filter(([,p])=>p.min[2]>min[2]+0.2).map(([id])=>id));
  if(isObj){
    if(parts.size<=512){
      // Colour sections can touch without sharing vertex indices (including T-junctions).
      // Conservatively treat touching/overlapping bounds as possible support.
      const contacts=new Map([...parts.keys()].map(id=>[id,[]]));
      const sorted=[...parts].sort((a,b)=>a[1].min[0]-b[1].min[0]),tolerance=0.05;
      for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++){
        const[aId,a]=sorted[i],[bId,b]=sorted[j];if(b.min[0]>a.max[0]+tolerance)break;
        if(a.min.every((v,axis)=>v<=b.max[axis]+tolerance&&b.min[axis]<=a.max[axis]+tolerance)){contacts.get(aId).push(bId);contacts.get(bId).push(aId);}
      }
      const supported=[...parts.keys()].filter(id=>!floatingIds.has(id));
      for(let i=0;i<supported.length;i++)for(const id of contacts.get(supported[i]))if(floatingIds.delete(id))supported.push(id);
    }else{
      floatingIds=new Set();notices.push({code:'obj-complex',title:'Part positions need a staff check',detail:'This OBJ has many separate sections. Staff will check which parts need supports.'});
    }
  }
  const floatingTriangles=[]; for(let t=0;t<triangles;t++) if(floatingIds.has(find(t))) floatingTriangles.push(t);
  let openEdges=0,nonManifold=0; for(const count of edges.values()) { if(count===1) openEdges++; if(count>2) nonManifold++; }
  if(floatingIds.size) warnings.push({ code:'floating',title:`${floatingIds.size} possibly floating ${floatingIds.size===1?'part':'parts'}`,detail:'Highlighted parts do not touch the lowest build plane. Check they are attached, or ask staff about supports.' });
  if(parts.size>1)(isObj?notices:warnings).push({code:'parts',title:`${parts.size} separate parts`,detail:isObj?'Separate parts can be intentional colour sections. Choose one colour for each part.':'Check these are intentional. Unjoined CAD shapes can fall apart or need separate printing.'});
  const meshWarning=isObj?openEdges>edges.size*0.2:openEdges||nonManifold;
  const problemEdges=[];
  if(meshWarning)for(const[key,count]of edges){if(count!==2&&problemEdges.length<30000){const[a,b]=key.split(',').map(Number);problemEdges.push(...coordinates.slice(a*3,a*3+3),...coordinates.slice(b*3,b*3+3));}}
  if(meshWarning)warnings.push({code:'mesh',title:isObj?'Check the OBJ surfaces':'The mesh may need repairing',detail:isObj?'Many outer edges are open. Ask staff to check that the model is suitable for printing.':`${openEdges.toLocaleString()} open edges and ${nonManifold.toLocaleString()} non-manifold edges found. Re-export a solid, or ask staff to repair it.`});
  if(isObj?degenerate>=Math.max(10,triangles*0.01):degenerate)warnings.push({code:'degenerate',title:'Some triangles have no area',detail:'The CAD export contains degenerate triangles. Re-export or ask staff to check the mesh.'});
  const partBounds=[...parts.values()],{thicknessSamples,supportContacts}=measurePrintFeatures(positions,triangleParts,overhangTriangles,min[2],!isObj);
  if(supportContacts.length)notices.push({code:'supports',title:'About supports',detail:'Supports hold up overhanging areas while they print. They are removed afterwards and may leave a rough underside.'});
  if(!isObj)warnings.push(...thinFeatures(thicknessSamples,partBounds,triangleParts).warnings);
  return {dimensions,triangles,components:parts.size,floating:floatingIds.size,openEdges,nonManifold,degenerate,overhangs,partBounds,thicknessSamples,supportContacts,problemEdges:new Float32Array(problemEdges),overhangTriangles:new Uint32Array([...new Set(supportContacts.map(contact=>contact.triangle))]),floatingParts:[...floatingIds].map(id=>partNumbers.get(id)),floatingTriangles:new Uint32Array(floatingTriangles),triangleParts,complete:true,warnings,notices};
}

/** @param {number[]} dimensions */
export function dimensionWarnings(dimensions) {
 const warnings=[];
 if(Math.max(...dimensions)>256)warnings.push({code:'size',title:'This might be too big',detail:'This size extends past a 256 mm Bambu build volume. Reduce the scale or ask staff.'});
 if(Math.min(...dimensions)<0.8)warnings.push({code:'thin',title:'Very thin model',detail:'One dimension is under 0.8 mm. Thin features may not print reliably.'});
 if(Math.max(...dimensions)<2)warnings.push({code:'units',title:'Check the size',detail:'This model is very small. All dimensions are shown in mm. Check your scale and CAD export.'});
 return warnings;
}

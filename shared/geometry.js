/** Analyse world-space, Z-up, non-indexed triangles. Advisory checks, not a slicer.
 * @param {Float32Array} positions
 */
export function analyseGeometry(positions) {
  const triangles = positions.length / 9;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { const axis = i % 3; if (!Number.isFinite(positions[i])) throw new Error('The model contains invalid coordinates.'); min[axis] = Math.min(min[axis], positions[i]); max[axis] = Math.max(max[axis], positions[i]); }
  const dimensions = max.map((v,i) => v-min[i]);
  if (!triangles || dimensions.every(x => x < 0.001)) throw new Error('No printable geometry was found.');
  const warnings = [];
  if (Math.max(...dimensions) > 256) warnings.push({ code: 'size', title: 'This might be too big', detail: 'At original size, this extends past a 256 mm Bambu build volume. Choose a smaller size or ask staff.' });
  if (Math.min(...dimensions) < 0.8) warnings.push({ code: 'thin', title: 'Very thin model', detail: 'One dimension is under 0.8 mm. Thin features may not print reliably.' });
  if (Math.max(...dimensions) < 2) warnings.push({ code: 'units', title: 'Check your units', detail: 'This model is very small. STL files are interpreted in millimetres; check your CAD export units.' });
  if (triangles > 200000) return { dimensions, triangles, components: 0, floating: 0, openEdges: 0, nonManifold: 0, degenerate: 0, overhangs: 0, floatingTriangles: new Uint32Array(), complete: false, warnings: [...warnings, { code: 'complex', title: 'Detailed checks not completed', detail: 'This model has over 200,000 triangles. The preview works, but staff must check disconnected parts and mesh errors in the slicer.' }] };
  const parents = new Int32Array(triangles); for (let i=0;i<triangles;i++) parents[i]=i;
  const find = x => { while (parents[x] !== x) { parents[x] = parents[parents[x]]; x = parents[x]; } return x; };
  const join = (a,b) => { const x=find(a),y=find(b); if(x!==y) parents[x]=y; };
  const vertices = new Map(), edges = new Map(); let next=0, degenerate=0, overhangs=0;
  for (let t=0;t<triangles;t++) {
    const ids=[];
    for (let v=0;v<3;v++) { const i=t*9+v*3; const key=[positions[i],positions[i+1],positions[i+2]].map(n=>Math.round(n*1000)).join(','); let entry=vertices.get(key); if(!entry) { entry={ id:next++, triangle:t }; vertices.set(key,entry); } else join(t,entry.triangle); ids.push(entry.id); }
    for(let k=0;k<3;k++) { const a=ids[k],b=ids[(k+1)%3]; const key=a<b?`${a},${b}`:`${b},${a}`; edges.set(key,(edges.get(key)||0)+1); }
    const o=t*9, ax=positions[o+3]-positions[o],ay=positions[o+4]-positions[o+1],az=positions[o+5]-positions[o+2], bx=positions[o+6]-positions[o],by=positions[o+7]-positions[o+1],bz=positions[o+8]-positions[o+2];
    const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx,length=Math.hypot(nx,ny,nz);
    if(length<1e-8) degenerate++;
    else if(nz/length < -0.707 && Math.min(positions[o+2],positions[o+5],positions[o+8])>min[2]+0.5) overhangs++;
  }
  const parts = new Map();
  for(let t=0;t<triangles;t++) { const id=find(t); const part=parts.get(id)||{ minZ: Infinity,count:0 }; part.count++; part.minZ=Math.min(part.minZ,positions[t*9+2],positions[t*9+5],positions[t*9+8]); parts.set(id,part); }
  const floatingIds=new Set([...parts].filter(([,p])=>p.minZ>min[2]+0.2).map(([id])=>id));
  const floatingTriangles=[]; for(let t=0;t<triangles;t++) if(floatingIds.has(find(t))) floatingTriangles.push(t);
  let openEdges=0,nonManifold=0; for(const count of edges.values()) { if(count===1) openEdges++; if(count>2) nonManifold++; }
  if(floatingIds.size) warnings.push({ code:'floating',title:`${floatingIds.size} possibly floating ${floatingIds.size===1?'part':'parts'}`,detail:'Highlighted parts do not touch the lowest build plane. Check they are attached, or ask staff about supports.' });
  if(parts.size>1) warnings.push({ code:'parts',title:`${parts.size} separate parts`,detail:'Check these are intentional. Unjoined CAD shapes can fall apart or need separate printing.' });
  if(openEdges||nonManifold) warnings.push({code:'mesh',title:'The mesh may need repairing',detail:`${openEdges.toLocaleString()} open edges and ${nonManifold.toLocaleString()} non-manifold edges found. Re-export a solid, or ask staff to repair it.`});
  if(degenerate) warnings.push({code:'degenerate',title:'Some triangles have no area',detail:'The CAD export contains degenerate triangles. Re-export or ask staff to check the mesh.'});
  if(overhangs) warnings.push({code:'overhang',title:'Some areas may need supports',detail:'Downward-facing surfaces were found above the build plate. Staff will check these in the slicer.'});
  return {dimensions,triangles,components:parts.size,floating:floatingIds.size,openEdges,nonManifold,degenerate,overhangs,floatingTriangles:new Uint32Array(floatingTriangles),complete:true,warnings};
}

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Home, Box, ScanLine, Move } from 'lucide-react';
import { addGlitterShader } from '../lib/glitter';
import type { LoadedModel } from '../lib/model';
import type { Analysis } from '../types';
export interface ViewerHandle { snapshot: () => Promise<Blob>; }
export const Viewer = forwardRef<ViewerHandle, { model: LoadedModel; analysis?: Analysis; mapping?: Record<string,string>; scalePercent?:number; advancedSources?:string[]; onPartSelect?:(source:string)=>void; compact?: boolean }>(({model, analysis, mapping={}, scalePercent=100, advancedSources=[], onPartSelect, compact}, ref) => {
  const partCallback=useRef(onPartSelect);partCallback.current=onPartSelect;
  const scaleRef=useRef(scalePercent);scaleRef.current=scalePercent;
  const [baseDimensions,setBaseDimensions]=useState<number[]>([]);
  const container=useRef<HTMLDivElement>(null);
  const runtime=useRef<{ renderer:THREE.WebGLRenderer; camera:THREE.PerspectiveCamera; scene:THREE.Scene; object:THREE.Group; root:THREE.Group; size:THREE.Vector3; controls:OrbitControls; render:()=>void; reset:()=>void; overlay:THREE.Mesh|null }|null>(null);
  const [error,setError]=useState(''); const [wireframe,setWireframe]=useState(false); const [highlight,setHighlight]=useState(true);
  useImperativeHandle(ref,()=>({snapshot:()=>new Promise((resolve,reject)=> {
    const current=runtime.current; if(!current) return reject(new Error('The 3D viewer is not ready.'));
    // The submission thumbnail represents requested colours without the diagnostic overlay.
    const visible=current.overlay?.visible;
    if(current.overlay) current.overlay.visible=false;
    current.render();
    current.renderer.domElement.toBlob(blob=> { if(current.overlay) current.overlay.visible=!!visible; current.render(); blob?resolve(blob):reject(new Error('The preview could not be captured.')); },'image/png');
  })}));
  useEffect(()=> {
    const host=container.current!; let renderer:THREE.WebGLRenderer;
    try { renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true}); } catch { setError('Your browser could not start the 3D viewer. Enable hardware acceleration or try Chrome / Edge on another computer.'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5)); renderer.setClearColor('#101f2c'); renderer.outputColorSpace=THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement); renderer.domElement.setAttribute('aria-label','3D model. Drag to rotate, scroll or pinch to zoom.'); renderer.domElement.setAttribute('role','img');
    const scene=new THREE.Scene(); const camera=new THREE.PerspectiveCamera(35,1,0.1,100000);
    const controls=new OrbitControls(camera,renderer.domElement); controls.enableDamping=false; controls.maxPolarAngle=Math.PI*0.88;
    const ambient=new THREE.HemisphereLight('#e4faff','#25304a',2.5); scene.add(ambient);
    const light=new THREE.DirectionalLight('#ffffff',3.3);light.position.set(80,140,90);scene.add(light);
    const rim=new THREE.DirectionalLight('#b8a4ed',1.8);rim.position.set(-80,40,-70);scene.add(rim);
    const object=model.object.clone(true);
    object.traverse(n=>{if(n instanceof THREE.Mesh){n.geometry=n.geometry.clone();n.material=Array.isArray(n.material)?n.material.map(m=>m.clone()):n.material.clone();const attr=n.geometry.getAttribute('color');if(attr)n.geometry.userData.originalColours=new Float32Array(attr.array);n.geometry.setAttribute('bntsGlitter',new THREE.BufferAttribute(new Float32Array(n.geometry.getAttribute('position').count),1));(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>{if(m instanceof THREE.MeshStandardMaterial)addGlitterShader(m);});}});
    const bounds=new THREE.Box3().setFromObject(object);const size=bounds.getSize(new THREE.Vector3());const center=bounds.getCenter(new THREE.Vector3());setBaseDimensions([size.x,size.y,size.z]);
    const content=new THREE.Group();content.add(object);content.position.set(-center.x,-center.y,-bounds.min.z);
    const rotate=new THREE.Group();rotate.rotation.x=-Math.PI/2;rotate.add(content);rotate.scale.setScalar(scaleRef.current/100);scene.add(rotate);
    const grid=new THREE.GridHelper(300,30,'#365361','#203743');scene.add(grid);
    const target=new THREE.Vector3(0,size.z*0.5*scaleRef.current/100,0);
    const render=()=>renderer.render(scene,camera);
    const reset=()=>{target.set(0,size.z*0.5*scaleRef.current/100,0);const halfFov=THREE.MathUtils.degToRad(camera.fov/2),angle=Math.min(halfFov,Math.atan(Math.tan(halfFov)*camera.aspect));const distance=Math.max(size.length()/2*scaleRef.current/100,5)/Math.sin(angle)*1.22;camera.position.copy(target).add(new THREE.Vector3(1.3,1,1.6).normalize().multiplyScalar(distance));controls.target.copy(target);controls.update();render();};
    controls.addEventListener('change',render);
    const raycaster=new THREE.Raycaster();let pointerStart={x:0,y:0};
    const down=(event:PointerEvent)=>{pointerStart={x:event.clientX,y:event.clientY};};
    const up=(event:PointerEvent)=>{if(!partCallback.current||event.button!==0||Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>5)return;const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);const hit=raycaster.intersectObject(object,true).find(h=>h.object instanceof THREE.Mesh);if(!hit)return;const mesh=hit.object as THREE.Mesh;let source=mesh.userData.colourSource as string|undefined;const original=mesh.geometry.userData.originalColours as Float32Array|undefined;if(!source&&original&&hit.face){const i=hit.face.a;source='#'+new THREE.Color().setRGB(original[i*3],original[i*3+1],original[i*3+2]).getHexString();}partCallback.current(source||model.palette[0]);};
    renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointerup',up);

    const resize=()=>{const width=host.clientWidth,height=host.clientHeight;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();render();};
    const observer=new ResizeObserver(resize);observer.observe(host);resize();reset();
    runtime.current={renderer,camera,scene,object,root:rotate,size,controls,render,reset,overlay:null};
    // Overlay uses the same world coordinates as analysis, before the preview's centring transform.
    runtime.current.object.userData.content=content;
    return()=>{observer.disconnect();controls.dispose();scene.traverse(n=>{if(n instanceof THREE.Mesh||n instanceof THREE.LineSegments){n.geometry.dispose();const materials=Array.isArray(n.material)?n.material:[n.material];materials.forEach(m=>m.dispose());}});renderer.dispose();renderer.domElement.remove();runtime.current=null;};
  },[model]);
  useEffect(()=>{
    const r=runtime.current;if(!r)return;
    r.object.traverse(n=>{if(n instanceof THREE.Mesh){const attribute=n.geometry.getAttribute('color'),original=n.geometry.userData.originalColours as Float32Array|undefined;
      const glitter=n.geometry.getAttribute('bntsGlitter');let sparkling=false;
      if(attribute&&original){for(let i=0;i<attribute.count;i++){const source=new THREE.Color().setRGB(original[i*3],original[i*3+1],original[i*3+2]);const key='#'+source.getHexString();const active=advancedSources.includes(key);glitter.setX(i,active?1:0);sparkling ||= active;const next=mapping[key]?new THREE.Color(mapping[key]):source;attribute.setXYZ(i,next.r,next.g,next.b);}attribute.needsUpdate=true;}
      const source=n.userData.colourSource||model.palette[0];
      if(!attribute){sparkling=advancedSources.includes(source);for(let i=0;i<glitter.count;i++)glitter.setX(i,sparkling?1:0);}glitter.needsUpdate=true;
      const materials=Array.isArray(n.material)?n.material:[n.material];materials.forEach(m=>{if(m instanceof THREE.MeshStandardMaterial){m.wireframe=wireframe;m.metalness=sparkling?0.3:0.04;m.roughness=sparkling?0.35:0.55;if(!attribute)m.color.set(mapping[source]||source||'#19c1ca');}});
    }});r.render();
  },[mapping,wireframe,model,advancedSources]);
  useEffect(()=>{const r=runtime.current;if(!r)return;r.root.scale.setScalar(scalePercent/100);r.controls.target.set(0,r.size.z*0.5*scalePercent/100,0);r.controls.update();r.render();},[scalePercent,model]);
  useEffect(()=>{
    const r=runtime.current;if(!r)return;
    const content=r.object.userData.content as THREE.Group;
    if(r.overlay){content.remove(r.overlay);r.overlay.geometry.dispose();(r.overlay.material as THREE.Material).dispose();r.overlay=null;}
    if(analysis?.floatingTriangles.length){const positions=new Float32Array(analysis.floatingTriangles.length*9);analysis.floatingTriangles.forEach((t,i)=>positions.set(model.positions.subarray(t*9,t*9+9),i*9));const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));const overlay=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:'#ff716c',transparent:true,opacity:0.8,side:THREE.DoubleSide,depthTest:false}));overlay.visible=highlight;overlay.renderOrder=10;content.add(overlay);r.overlay=overlay;}r.render();
  },[analysis,highlight,model]);
  return <div className={'viewer '+(compact?'compact':'')}>
    <div className="viewer-unit-label">{baseDimensions.map(n=>(n*scalePercent/100).toFixed(1)).join(' × ')} mm</div>
    <div className="viewer-canvas" ref={container}/>
    <div className="viewer-label"><span className="live-dot"/> INTERACTIVE 3D PREVIEW</div>
    {error&&<div className="viewer-error" role="alert">{error}</div>}
    <div className="viewer-bottom"><span><Move size={13}/> Grid: 10 mm · Drag to rotate · scroll to zoom</span><div className="viewer-tools"><button type="button" className="viewer-home" onClick={()=>runtime.current?.reset()} title="Return to the starting view" aria-label="Home view"><Home size={15}/> Home view</button><button type="button" onClick={()=>setWireframe(!wireframe)} aria-pressed={wireframe} title="Wireframe" aria-label="Toggle wireframe"><Box size={17}/></button>{!!analysis?.floating&&<button type="button" onClick={()=>setHighlight(!highlight)} aria-pressed={highlight} title="Highlight floating parts" aria-label="Highlight floating parts"><ScanLine size={17}/></button>}</div></div>
  </div>;
});

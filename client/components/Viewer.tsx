import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RotateCcw, Box, ScanLine, Move } from 'lucide-react';
import type { LoadedModel } from '../lib/model';
import type { Analysis } from '../types';
export interface ViewerHandle { snapshot: () => Promise<Blob>; }
export const Viewer = forwardRef<ViewerHandle, { model: LoadedModel; analysis?: Analysis; mapping?: Record<string,string>; compact?: boolean }>(({model, analysis, mapping={}, compact}, ref) => {
  const container=useRef<HTMLDivElement>(null);
  const runtime=useRef<{ renderer:THREE.WebGLRenderer; camera:THREE.PerspectiveCamera; scene:THREE.Scene; object:THREE.Group; controls:OrbitControls; render:()=>void; reset:()=>void; overlay:THREE.Mesh|null }|null>(null);
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
    object.traverse(n=>{if(n instanceof THREE.Mesh){n.geometry=n.geometry.clone();n.material=Array.isArray(n.material)?n.material.map(m=>m.clone()):n.material.clone();const attr=n.geometry.getAttribute('color');if(attr)n.geometry.userData.originalColours=new Float32Array(attr.array);}});
    const bounds=new THREE.Box3().setFromObject(object);const size=bounds.getSize(new THREE.Vector3());const center=bounds.getCenter(new THREE.Vector3());
    const content=new THREE.Group();content.add(object);content.position.set(-center.x,-center.y,-bounds.min.z);
    const rotate=new THREE.Group();rotate.rotation.x=-Math.PI/2;rotate.add(content);scene.add(rotate);
    const span=Math.max(size.x,size.y,size.z,10),gridSize=Math.max(100,Math.ceil(span*1.6/10)*10);
    const grid=new THREE.GridHelper(gridSize,20,'#365361','#203743');scene.add(grid);
    const target=new THREE.Vector3(0,size.z*0.5,0);
    const render=()=>renderer.render(scene,camera);
    const reset=()=>{const halfFov=THREE.MathUtils.degToRad(camera.fov/2),angle=Math.min(halfFov,Math.atan(Math.tan(halfFov)*camera.aspect));const distance=Math.max(size.length()/2,5)/Math.sin(angle)*1.22;camera.position.copy(target).add(new THREE.Vector3(1.3,1,1.6).normalize().multiplyScalar(distance));controls.target.copy(target);controls.update();render();};
    controls.addEventListener('change',render);
    const resize=()=>{const width=host.clientWidth,height=host.clientHeight;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();render();};
    const observer=new ResizeObserver(resize);observer.observe(host);resize();reset();
    runtime.current={renderer,camera,scene,object,controls,render,reset,overlay:null};
    // Overlay uses the same world coordinates as analysis, before the preview's centring transform.
    runtime.current.object.userData.content=content;
    return()=>{observer.disconnect();controls.dispose();scene.traverse(n=>{if(n instanceof THREE.Mesh||n instanceof THREE.LineSegments){n.geometry.dispose();const materials=Array.isArray(n.material)?n.material:[n.material];materials.forEach(m=>m.dispose());}});renderer.dispose();renderer.domElement.remove();runtime.current=null;};
  },[model]);
  useEffect(()=>{
    const r=runtime.current;if(!r)return;
    r.object.traverse(n=>{if(n instanceof THREE.Mesh){const attribute=n.geometry.getAttribute('color'),original=n.geometry.userData.originalColours as Float32Array|undefined;
      if(attribute&&original){for(let i=0;i<attribute.count;i++){const source=new THREE.Color().setRGB(original[i*3],original[i*3+1],original[i*3+2]);const key='#'+source.getHexString();const next=mapping[key]?new THREE.Color(mapping[key]):source;attribute.setXYZ(i,next.r,next.g,next.b);}attribute.needsUpdate=true;}
      const materials=Array.isArray(n.material)?n.material:[n.material];materials.forEach(m=>{if(m instanceof THREE.MeshStandardMaterial){m.wireframe=wireframe;if(!attribute)m.color.set(mapping[model.palette[0]]||model.palette[0]||'#19c1ca');}});
    }});r.render();
  },[mapping,wireframe,model]);
  useEffect(()=>{
    const r=runtime.current;if(!r)return;
    const content=r.object.userData.content as THREE.Group;
    if(r.overlay){content.remove(r.overlay);r.overlay.geometry.dispose();(r.overlay.material as THREE.Material).dispose();r.overlay=null;}
    if(analysis?.floatingTriangles.length){const positions=new Float32Array(analysis.floatingTriangles.length*9);analysis.floatingTriangles.forEach((t,i)=>positions.set(model.positions.subarray(t*9,t*9+9),i*9));const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));const overlay=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:'#ff716c',transparent:true,opacity:0.8,side:THREE.DoubleSide,depthTest:false}));overlay.visible=highlight;overlay.renderOrder=10;content.add(overlay);r.overlay=overlay;}r.render();
  },[analysis,highlight,model]);
  return <div className={'viewer '+(compact?'compact':'')}>
    <div className="viewer-canvas" ref={container}/>
    <div className="viewer-label"><span className="live-dot"/> INTERACTIVE 3D PREVIEW</div>
    {error&&<div className="viewer-error" role="alert">{error}</div>}
    <div className="viewer-bottom"><span><Move size={13}/> Drag to rotate · scroll to zoom</span><div className="viewer-tools"><button type="button" onClick={()=>runtime.current?.reset()} title="Reset view" aria-label="Reset view"><RotateCcw size={17}/></button><button type="button" onClick={()=>setWireframe(!wireframe)} aria-pressed={wireframe} title="Wireframe" aria-label="Toggle wireframe"><Box size={17}/></button>{!!analysis?.floating&&<button type="button" onClick={()=>setHighlight(!highlight)} aria-pressed={highlight} title="Highlight floating parts" aria-label="Highlight floating parts"><ScanLine size={17}/></button>}</div></div>
  </div>;
});

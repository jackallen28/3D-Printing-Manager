import * as THREE from 'three';
export function addGlitterShader(material: THREE.MeshStandardMaterial) {
 material.onBeforeCompile=shader=>{
  shader.vertexShader='attribute float bntsGlitter; varying float vBNTSGlitter; varying vec3 vBNTSPosition;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBNTSGlitter=bntsGlitter; vBNTSPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
  shader.fragmentShader='varying float vBNTSGlitter; varying vec3 vBNTSPosition;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>
   if(vBNTSGlitter>0.5){vec3 cell=floor(vBNTSPosition*8.0);float grain=fract(sin(dot(cell,vec3(12.9898,78.233,39.425)))*43758.5453);float sparkle=step(0.975,grain)*pow(abs(dot(normal,normalize(vViewPosition))),2.0);gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(1.0,0.84,1.0),sparkle*0.9);}
  `);
 };
 material.customProgramCacheKey=()=> 'bnts-glitter-v1';
}

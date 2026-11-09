import * as THREE from 'three';
import type {Analysis} from '../types';

export function buildSupportPreview(contacts:Analysis['supportContacts']) {
 const group=new THREE.Group();
 const posts=new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25,0.4,1,6),new THREE.MeshStandardMaterial({color:'#a8adb2',roughness:1,transparent:true,opacity:0.7}),contacts.length);
 const pads=new THREE.InstancedMesh(new THREE.CircleGeometry(0.65,10),new THREE.MeshBasicMaterial({color:'#969ba0',side:THREE.DoubleSide,transparent:true,opacity:0.45,depthWrite:false}),contacts.length);
 const dots=new Float32Array(contacts.length*18*3),transform=new THREE.Object3D(),normal=new THREE.Vector3(),quaternion=new THREE.Quaternion(),up=new THREE.Vector3(0,0,1),point=new THREE.Vector3();
 contacts.forEach((contact,index)=>{
  const height=contact.top-contact.bottom;
  transform.position.set(contact.x,contact.y,contact.bottom+height/2);transform.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2);transform.scale.set(1,height,1);transform.updateMatrix();posts.setMatrixAt(index,transform.matrix);
  normal.fromArray(contact.normal);quaternion.setFromUnitVectors(up,normal);
  transform.position.set(contact.x,contact.y,contact.top).addScaledVector(normal,0.025);transform.quaternion.copy(quaternion);transform.scale.set(1,1,1);transform.updateMatrix();pads.setMatrixAt(index,transform.matrix);
  for(let j=0;j<18;j++){const angle=j*2.399963+index,radius=0.6*Math.sqrt(((j*7+index*3)%19+1)/19);point.set(Math.cos(angle)*radius,Math.sin(angle)*radius,0.035).applyQuaternion(quaternion).add(new THREE.Vector3(contact.x,contact.y,contact.top));point.toArray(dots,(index*18+j)*3);}
 });
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(dots,3));
 const roughness=new THREE.Points(geometry,new THREE.PointsMaterial({color:'#53595f',size:0.16,sizeAttenuation:true,transparent:true,opacity:0.95,depthWrite:false}));
 group.add(posts,pads,roughness);return group;
}

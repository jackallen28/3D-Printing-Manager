import * as THREE from "three";
import { addGlitterShader } from "./glitter";
import type { LoadedModel } from "./model";
import type { Analysis } from "../types";
export interface PrintProgress {
  percent: number;
  layer: number;
  layers: number;
  falling: number;
}
interface AnimationOptions {
  renderer: THREE.WebGLRenderer;
  camera: THREE.Camera;
  scene: THREE.Scene;
  object: THREE.Group;
  content: THREE.Group;
  size: THREE.Vector3;
  model: LoadedModel;
  analysis: Analysis;
  scale: number;
  mapping: Record<string, string>;
  advancedSources: string[];
  render: () => void;
  onProgress: (progress: PrintProgress | null) => void;
}
export function animatePrint(options: AnimationOptions): { finished: Promise<boolean>; stop: () => void } {
  const {
    renderer,
    camera,
    scene,
    object,
    content,
    size,
    model,
    analysis,
    scale,
    mapping,
    advancedSources,
    render,
    onProgress,
  } = options;
  const group = new THREE.Group();
  content.add(group);
  object.visible = false;
  const height = size.z * scale,
    plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
    floating = new Set(analysis.floatingParts);
  const colours = model.palette.map((source) => new THREE.Color(mapping[source] || source));
  const componentTriangles: number[][] = Array.from({ length: analysis.components }, () => []);
  analysis.triangleParts.forEach((part, t) => componentTriangles[part].push(t));
  const actors = componentTriangles.map((triangles, part) => {
    const bounds = analysis.partBounds[part],
      center = new THREE.Vector3(...bounds.min).add(new THREE.Vector3(...bounds.max)).multiplyScalar(0.5);
    const positions = new Float32Array(triangles.length * 9),
      colourData = new Float32Array(positions.length),
      glitter = new Float32Array(triangles.length * 3);
    triangles.forEach((triangle, i) => {
      for (let vertex = 0; vertex < 3; vertex++) {
        const old = triangle * 3 + vertex,
          source = model.palette[model.colourIndices[old]],
          colour = colours[model.colourIndices[old]] || colours[0];
        for (let axis = 0; axis < 3; axis++)
          positions[i * 9 + vertex * 3 + axis] = model.positions[old * 3 + axis] - center.getComponent(axis);
        colour.toArray(colourData, i * 9 + vertex * 3);
        glitter[i * 3 + vertex] = advancedSources.includes(source) ? 1 : 0;
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colourData, 3));
    geometry.setAttribute("bntsGlitter", new THREE.BufferAttribute(glitter, 1));
    geometry.computeVertexNormals();
    // Floating parts get their own plane: releasing them moves the plane away instead of removing it,
    // so the shader program never changes (and never recompiles) mid-animation.
    const ownPlane = floating.has(part) ? new THREE.Plane(new THREE.Vector3(0, -1, 0), 0) : plane;
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      side: THREE.DoubleSide,
      clippingPlanes: [ownPlane],
    });
    addGlitterShader(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(center);
    group.add(mesh);
    return { mesh, center, bounds, floating: floating.has(part), plane: ownPlane, releasedAt: -1 };
  });
  const oldClipping = renderer.localClippingEnabled;
  renderer.localClippingEnabled = true;
  const head = new THREE.Mesh(new THREE.ConeGeometry(1.5, 4, 8), new THREE.MeshBasicMaterial({ color: "#82f0dc" }));
  head.rotation.z = Math.PI;
  scene.add(head);
  const buildPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(size.x * scale, 10) + 6, Math.max(size.y * scale, 10) + 6),
    new THREE.MeshBasicMaterial({
      color: "#79e6d6",
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  buildPlane.rotation.x = -Math.PI / 2;
  scene.add(buildPlane);
  // Compile the new materials now, so the first animated frame doesn't stall on shader compilation.
  renderer.compile(scene, camera);
  const minZ = Math.min(...analysis.partBounds.map((part) => part.min[2]));
  const layers = Math.max(1, Math.ceil(height / 0.2)),
    buildDuration = 5200,
    settleDuration = floating.size ? 1300 : 0;
  let frame = 0,
    start = -1,
    stopped = false,
    lastProgress = -1,
    complete: (finished: boolean) => void = () => {};
  const finished = new Promise<boolean>((resolve) => {
    complete = resolve;
  });
  const clean = (success: boolean) => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    content.remove(group);
    group.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        (node.material as THREE.Material).dispose();
      }
    });
    scene.remove(head, buildPlane);
    head.geometry.dispose();
    head.material.dispose();
    buildPlane.geometry.dispose();
    buildPlane.material.dispose();
    object.visible = true;
    renderer.localClippingEnabled = oldClipping;
    onProgress(null);
    render();
    complete(success);
  };
  const tick = (now: number) => {
    if (stopped) return;
    // The first frame is a warm-up draw that uploads the new geometry to the GPU. The clock starts after it,
    // so that one-off cost never shows as a jump in the animation.
    if (start < 0) {
      plane.constant = 0;
      for (const actor of actors) actor.plane.constant = 0;
      render();
      start = performance.now();
      frame = requestAnimationFrame(tick);
      return;
    }
    const elapsed = now - start,
      fraction = Math.min(1, elapsed / buildDuration),
      layer = Math.min(layers, Math.floor(fraction * layers) + 1),
      // The cut rises continuously so the build looks smooth; the label still counts whole layers.
      level = Math.min(height, fraction * height + 0.001);
    plane.constant = level;
    head.visible = elapsed < buildDuration;
    // A steady sweep across the bed, slow enough to read as a moving print head rather than flicker.
    head.position.set(
      Math.sin(elapsed * 0.0085) * size.x * scale * 0.48,
      level + 2,
      Math.sin(elapsed * 0.0031) * size.y * scale * 0.45,
    );
    buildPlane.position.y = level;
    let falling = 0;
    for (const actor of actors)
      if (actor.floating) {
        const releaseHeight =
          (actor.bounds.min[2] - minZ) * scale +
          Math.min(0.4, (actor.bounds.max[2] - actor.bounds.min[2]) * scale * 0.25);
        if (actor.releasedAt < 0) actor.plane.constant = level;
        if (actor.releasedAt < 0 && level >= releaseHeight) {
          actor.releasedAt = elapsed;
          actor.plane.constant = 1e9;
          // Colour changes are uniforms, so no shader recompile is needed.
          actor.mesh.material.color.set("#ff716c");
          actor.mesh.material.emissive.set("#8b1513");
          actor.mesh.material.emissiveIntensity = 0.6;
        }
        if (actor.releasedAt >= 0) {
          falling++;
          const t = Math.min(1, (elapsed - actor.releasedAt) / 1100),
            fall = t * t;
          actor.mesh.position.x =
            actor.center.x + (size.x + (actor.bounds.max[0] - actor.bounds.min[0]) + 6) * (1 - Math.pow(1 - t, 3));
          actor.mesh.position.z =
            actor.center.z -
            (actor.bounds.min[2] - minZ + Math.max(actor.bounds.max[2] - actor.bounds.min[2], 1) * 0.3) * fall;
          actor.mesh.rotation.y = t * 0.55;
          actor.mesh.rotation.z = t * 0.35;
        }
      }
    const percent = Math.min(100, Math.floor((elapsed / (buildDuration + settleDuration)) * 100));
    if (percent !== lastProgress) {
      lastProgress = percent;
      onProgress({ percent, layer, layers, falling });
    }
    render();
    if (elapsed >= buildDuration + settleDuration) clean(true);
    else frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return { finished, stop: () => clean(false) };
}

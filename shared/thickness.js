import { BufferGeometry, BufferAttribute, Vector3, Ray, DoubleSide } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { sampleSupports } from "./supports.js";
export const MIN_WALL_MM = 0.8;

/** Sample inward wall thickness without changing the original triangle order. */
export function measurePrintFeatures(positions, triangleParts, overhangTriangles, groundZ, checkThickness = true) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const bvh = new MeshBVH(geometry, { indirect: true, targetLeafSize: 10 });
  const samples = [],
    a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    normal = new Vector3(),
    edge = new Vector3(),
    center = new Vector3(),
    ray = new Ray();
  const count = positions.length / 9,
    stride = Math.max(1, Math.ceil(count / 2000)),
    epsilon = 0.0001;
  for (let triangle = 0; checkThickness && triangle < count; triangle += stride) {
    a.fromArray(positions, triangle * 9);
    b.fromArray(positions, triangle * 9 + 3);
    c.fromArray(positions, triangle * 9 + 6);
    normal.subVectors(b, a).cross(edge.subVectors(c, a));
    if (normal.lengthSq() < 1e-12) continue;
    normal.normalize();
    center
      .copy(a)
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3)
      .addScaledVector(normal, -epsilon);
    ray.origin.copy(center);
    ray.direction.copy(normal).negate();
    const hit = bvh.raycastFirst(ray, DoubleSide, epsilon);
    if (
      !hit ||
      hit.faceIndex === undefined ||
      hit.faceIndex === triangle ||
      triangleParts[hit.faceIndex] !== triangleParts[triangle]
    )
      continue;
    const thickness = hit.distance + epsilon;
    if (thickness > epsilon * 3) samples.push({ triangle, opposite: hit.faceIndex, thickness });
  }
  const supportContacts = sampleSupports(bvh, positions, overhangTriangles, groundZ);
  geometry.dispose();
  return { thicknessSamples: samples, supportContacts };
}

/** Locate thin faces at the requested print scale. These checks are estimates. */
export function thinFeatures(samples, partBounds, triangleParts, scalePercent = 100) {
  const factor = scalePercent / 100,
    triangles = new Set(),
    parts = new Set();
  let minimumMm = Infinity;
  for (const sample of samples) {
    const mm = sample.thickness * factor;
    minimumMm = Math.min(minimumMm, mm);
    if (mm < MIN_WALL_MM) {
      triangles.add(sample.triangle);
      triangles.add(sample.opposite);
      parts.add(triangleParts[sample.triangle]);
    }
  }
  const narrow = new Set();
  partBounds.forEach((part, index) => {
    const mm = Math.min(...part.max.map((v, axis) => v - part.min[axis])) * factor;
    minimumMm = Math.min(minimumMm, mm);
    if (mm < MIN_WALL_MM) {
      narrow.add(index);
      parts.add(index);
    }
  });
  if (narrow.size)
    triangleParts.forEach((part, triangle) => {
      if (narrow.has(part)) triangles.add(triangle);
    });
  return {
    triangles: new Uint32Array(triangles),
    parts: [...parts],
    minimumMm: Number.isFinite(minimumMm) ? minimumMm : null,
    warnings: triangles.size
      ? [
          {
            code: "thin-features",
            title: "Some areas may be too thin",
            detail: `Amber areas are under ${MIN_WALL_MM} mm at this scale. Make them thicker or ask your teacher for help.`,
          },
        ]
      : [],
  };
}

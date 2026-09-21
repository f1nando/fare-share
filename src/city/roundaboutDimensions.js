// Shared dimensions keep paving, queues, wheel heights and paths in agreement.
export const RING_RADIUS = 7;
export const ISLAND_RADIUS = 4.1;
export const ROUNDABOUT_CLEARANCE = 10.8;
export const ROUNDABOUT_STOP = 9.4;

// One quadrant, tangent to both straight street edges. The same polygon is
// used by the curb mesh and wheel-height lookup, with no per-frame geometry.
export function roundaboutCornerEdge(inset = 0) {
  const half = 3.85, reach = ROUNDABOUT_CLEARANCE, handle = 8;
  return Array.from({ length: 25 }, (_, i) => {
    const t = i / 24, u = 1 - t;
    const x = u*u*u*half + 3*u*u*t*half + 3*u*t*t*handle + t*t*t*reach;
    const z = u*u*u*reach + 3*u*u*t*handle + 3*u*t*t*half + t*t*t*half;
    const dx = 6*u*t*(handle-half) + 3*t*t*(reach-handle);
    const dz = 3*u*u*(handle-reach) + 6*u*t*(half-handle);
    const length = Math.hypot(dx,dz);
    return { x: x - dz/length*inset, z: z + dx/length*inset };
  });
}

const edge = roundaboutCornerEdge();
export function roundaboutRoadInset(x, z, roadHalf) {
  x = Math.abs(x); z = Math.abs(z);
  const street = Math.min(x,z) - roadHalf;
  if (street <= 0 || x >= ROUNDABOUT_CLEARANCE || z >= ROUNDABOUT_CLEARANCE) return street;
  let lo = 1, hi = edge.length - 1;
  while (lo < hi) { const mid = (lo+hi) >>> 1; if (edge[mid].x < x) lo = mid+1; else hi = mid; }
  const a = edge[lo-1], b = edge[lo], dx = b.x-a.x, dz = b.z-a.z;
  return Math.min(street, ((z-a.z)*dx-(x-a.x)*dz)/Math.hypot(dx,dz));
}

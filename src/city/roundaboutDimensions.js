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
// Closed T arm: a rounded bank across the missing street instead of a stub.
export function roundaboutCapEdge(inset = 0) {
  const reach=ROUNDABOUT_CLEARANCE,half=3.85,top=8.6,points=[];
  for(let i=0;i<=32;i++) {
    const t=i/32;
    const x=-reach+2*reach*t;
    const z=half+(top-half)*Math.sin(Math.PI*t)**2;
    const slope=(top-half)*Math.PI*Math.sin(2*Math.PI*t)/(2*reach);
    const length=Math.hypot(slope,1);
    points.push({x:x-slope/length*inset,z:z+inset/length});
  }
  return points;
}
const capEdge=roundaboutCapEdge();
export function roundaboutRoadInset(x, z, roadHalf, closedArm=-1) {
  let capInset=-Infinity;
  if(closedArm>=0) {
    const angle=(1-closedArm)*Math.PI/2,cos=Math.cos(angle),sin=Math.sin(angle);
    const cx=x*cos-z*sin,cz=x*sin+z*cos;
    if(cz>=0&&Math.abs(cx)<ROUNDABOUT_CLEARANCE) {
      const i=Math.min(capEdge.length-2,Math.max(0,Math.floor((cx+ROUNDABOUT_CLEARANCE)/(2*ROUNDABOUT_CLEARANCE)*(capEdge.length-1))));
      const a=capEdge[i],b=capEdge[i+1],dx=b.x-a.x,dz=b.z-a.z;
      capInset=((cz-a.z)*dx-(cx-a.x)*dz)/Math.hypot(dx,dz);
    }
  }
  x = Math.abs(x); z = Math.abs(z);
  const street = Math.min(x,z) - roadHalf;
  if (street <= 0 || x >= ROUNDABOUT_CLEARANCE || z >= ROUNDABOUT_CLEARANCE) return Math.max(street,capInset);
  let lo = 1, hi = edge.length - 1;
  while (lo < hi) { const mid = (lo+hi) >>> 1; if (edge[mid].x < x) lo = mid+1; else hi = mid; }
  const a = edge[lo-1], b = edge[lo], dx = b.x-a.x, dz = b.z-a.z;
  const normalInset=Math.min(street, ((z-a.z)*dx-(x-a.x)*dz)/Math.hypot(dx,dz));
  // The cap replaces both corner inserts on its side, rather than overlapping.
  return capInset===-Infinity?normalInset:capInset;
}

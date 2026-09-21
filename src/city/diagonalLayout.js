import { parkAt, junctionArms, roundaboutAt, roadworkAt } from './roadLayout.js';
import { canalColumn } from './bridgeProfile.js';
import { reservedParkingAt as parkingAt } from './parkingLayout.js';

export const DIAGONAL_HALF = 3.1;
export const DIAGONAL_LANE = 1.45;
export const APPROACH_BLOCKS = 3;
const mod = (n, d) => ((n % d) + d) % d;
const cache = new Map();

// A small repeated fan: one extra two-way approach to a four-arm ring. Its
// shallow diagonal cuts THREE successive lots, not one corner-to-corner tile.
// Reject the whole corridor at water, parks, parking or another ring.
export function approachAtRing(x, z, block = 40) {
  const key = `${x}:${z}:${block}`;
  if (cache.has(key)) return cache.get(key);
  let result = null;
  if (mod(x, 6) === 3 && mod(z, 6) === 1 && roundaboutAt(x, z) && junctionArms(x, z).every(Boolean)) {
    const variants = [[-1,-3],[1,3],[-3,1],[3,-1],[1,-3],[-1,3],[3,1],[-3,-1]];
    const offset = mod(Math.floor(x / 6) + Math.floor(z / 6), variants.length);
    for (let i = 0; i < variants.length; i++) {
      const [dx,dz] = variants[(i + offset) % variants.length];
      const a = {x:x+dx,z:z+dz}, b = {x,z}, tiles = [];
      for (let gx=Math.min(a.x,b.x);gx<Math.max(a.x,b.x);gx++)
        for(let gz=Math.min(a.z,b.z);gz<Math.max(a.z,b.z);gz++) tiles.push({x:gx,z:gz});
      if (tiles.some(p => canalColumn(p.x) || parkAt(p.x,p.z) || parkingAt(p.x,p.z,block))) continue;
      if (!junctionArms(a.x,a.z).every(Boolean) || roundaboutAt(a.x,a.z)) continue;
      if (tiles.some(p => [0,1].some(ox => [0,1].some(oz =>
        (p.x+ox!==x || p.z+oz!==z) && roundaboutAt(p.x+ox,p.z+oz))))) continue;
      const axis = Math.abs(dx)>Math.abs(dz)?0:1;
      const direction = Math.sign(axis===0?-dx:-dz);
      const crossings = [1,2].map(n => {
        const px=a.x-dx*n/3,pz=a.z-dz*n/3;
        return {x:px,z:pz,axis:1-axis,line:Math.round(axis===0?px:pz),position:axis===0?pz:px,
          key:`approach:${x}:${z}:${n}`,fraction:n/3};
      });
      if (crossings.some(c => roadworkAt(c.axis,c.line,Math.floor(c.position),block))) continue;
      result={key:`${x}:${z}`,x:tiles[0].x,z:tiles[0].z,a,b,tiles,axis,direction,crossings,
        dx:-dx/Math.sqrt(10),dz:-dz/Math.sqrt(10),length:Math.sqrt(10)*block};
      break;
    }
  }
  if(cache.size>512)cache.clear();
  cache.set(key,result); return result;
}

export function approachesNear(x,z,block=40) {
  const roads=[];
  const rx=Math.floor((x-3)/6)*6+3,rz=Math.floor((z-1)/6)*6+1;
  for(const gx of [rx,rx+6]) for(const gz of [rz,rz+6]) {
    const road=approachAtRing(gx,gz,block); if(road)roads.push(road);
  }
  return roads;
}
export function diagonalAt(x,z,block=40) {
  return approachesNear(x+.5,z+.5,block).find(r=>r.tiles.some(t=>t.x===x&&t.z===z))??null;
}
export function diagonalFromJunction(x,z,block=40) {
  return approachesNear(x,z,block).find(r=>r.a.x===x&&r.a.z===z || r.b.x===x&&r.b.z===z)??null;
}
export function diagonalRoadDistance(x,z,block) {
  let distance=Infinity;
  for(const r of approachesNear(x/block,z/block,block)) {
    const px=x-r.a.x*block,pz=z-r.a.z*block,along=px*r.dx+pz*r.dz;
    if(along>=0&&along<=r.length) distance=Math.min(distance,Math.abs(px*r.dz-pz*r.dx));
  }
  return distance;
}

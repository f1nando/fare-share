import { BufferGeometry, Float32BufferAttribute } from 'three';
import { canalDimensions } from './canal.js';

// Cut the canal out of the asphalt instead of covering it with a painted plane.
// A handful of strips still uses one mesh/material and no per-frame shader work.
export function createCanalGround(block, originColumn = 0, size = 1000) {
  const positions = [], half = size / 2, origin = originColumn * block;
  const { left, right } = canalDimensions(block);
  const strip = (a, b) => {
    if (b <= a) return;
    positions.push(a, 0, -half, a, 0, half, b, 0, -half,
      b, 0, -half, a, 0, half, b, 0, half);
  };
  let cursor = -half;
  const first = Math.floor((origin - half - right) / (12 * block));
  const last = Math.ceil((origin + half - left) / (12 * block));
  for (let column = first; column <= last; column++) {
    const start = column * 12 * block + left - origin;
    const end = column * 12 * block + right - origin;
    if (end <= -half || start >= half) continue;
    strip(cursor, Math.max(-half, start));
    cursor = Math.min(half, end);
  }
  strip(cursor, half);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

import { BufferGeometry, Float32BufferAttribute } from 'three';
import { PAVED_ROAD } from './world.js';
import { DIAGONAL_HALF } from './diagonalLayout.js';

// Right triangular prism, with its right angle at the instance origin.
export function diagonalLotGeometry() {
  const p = [], triangle = (a, b, c) => p.push(...a, ...b, ...c);
  const edge = [[0, 0], [1, 0], [0, 1]], at = (v, y) => [v[0], y, v[1]];
  triangle(at(edge[0], .5), at(edge[2], .5), at(edge[1], .5));
  triangle(at(edge[0], -.5), at(edge[1], -.5), at(edge[2], -.5));
  for (let i = 0; i < 3; i++) {
    const a = edge[i], b = edge[(i + 1) % 3];
    triangle(at(a, -.5), at(a, .5), at(b, .5));
    triangle(at(a, -.5), at(b, .5), at(b, -.5));
  }
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(p, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function populateDiagonal(batch, road, x, z, block) {
  const corner = PAVED_ROAD / 2;
  const lots = road.flip ? [[0, 0, 0], [1, 1, Math.PI]] : [[1, 0, -Math.PI / 2], [0, 1, Math.PI / 2]];
  for (const [east, south, rotation] of lots) {
    const layer = (inset, y, height, color) => {
      const margin = corner + inset, length = block - 2 * margin - (DIAGONAL_HALF + inset) * Math.SQRT2;
      batch.add('diagonalLot', x + (east ? block - margin : margin), y, z + (south ? block - margin : margin), length, height, length, color, rotation);
      return length;
    };
    const length = layer(0, .1, .3, '#bdbdbd');
    layer(.21, .25, .34, '#dedede');
    const local = (u, v) => ({ x: x + (east ? block - corner : corner) + u * Math.cos(rotation) + v * Math.sin(rotation),
      z: z + (south ? block - corner : corner) - u * Math.sin(rotation) + v * Math.cos(rotation) });
    const house = local(length * .28, length * .28), width = Math.min(7, length * .27);
    batch.add('building', house.x, 2.5, house.z, width, 4.2, width, '#d3d3d3');
    for (const [u, v] of [[.68, .12], [.12, .68]]) {
      const tree = local(length * u, length * v);
      batch.add('box', tree.x, 1, tree.z, .25, 1.2, .25, '#777777');
      batch.add('crown', tree.x, 2, tree.z, .85, 1.1, .85, '#969696');
    }
  }
  const dx = 1 / Math.SQRT2, dz = (road.flip ? -1 : 1) / Math.SQRT2;
  const start = { x, z: z + (road.flip ? block : 0) }, length = block * Math.SQRT2;
  const angle = Math.atan2(dx, dz), inset = 8;
  for (let d = inset; d < length - inset; d += 3.3)
    batch.add('paint', start.x + dx * d, .02, start.z + dz * d, .12, .025, 1.3, '#e9e9e9', angle);
  for (const side of [-1, 1]) {
    const offset = side * (DIAGONAL_HALF - .25);
    batch.add('paint', start.x + dx * length / 2 - dz * offset, .016, start.z + dz * length / 2 + dx * offset,
      .06, .02, length - inset * 2, '#8d8d8d', angle);
  }
}

import { Shape, ShapeGeometry, DynamicDrawUsage } from 'three';
import { canalDimensions, CANAL_WATER_LEVEL } from './canal.js';

export function sharkGeometry() {
  const outline = new Shape();
  const points = [[0, 4.5], [.38, 3.8], [.65, 2.2], [.72, .9], [1.65, -.1],
    [1.4, -.7], [.58, -.3], [.38, -1.8], [.17, -3.1], [1.15, -4.35],
    [.65, -4.2], [0, -3.75], [-.65, -4.2], [-1.15, -4.35], [-.17, -3.1],
    [-.38, -1.8], [-.58, -.3], [-1.4, -.7], [-1.65, -.1], [-.72, .9], [-.65, 2.2], [-.38, 3.8]];
  points.forEach(([x, z], i) => i ? outline.lineTo(x, -z) : outline.moveTo(x, -z));
  outline.closePath();
  const geometry = new ShapeGeometry(outline).rotateX(-Math.PI / 2);
  geometry.userData.rest = geometry.attributes.position.array.slice();
  geometry.attributes.position.setUsage(DynamicDrawUsage);
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius += 0.35;
  return geometry;
}

export function animateSharkTail(geometry, time) {
  const position = geometry.attributes.position, rest = geometry.userData.rest;
  for (let i = 0; i < position.count; i++) {
    const z = rest[i * 3 + 2], tail = Math.max(0, Math.min(1, (1 - z) / 5.35));
    position.array[i * 3] = rest[i * 3] + Math.sin(time * 2.4 + z * 0.45) * tail * tail * 0.32;
  }
  position.needsUpdate = true;
}

// A subdued surface silhouette suggests depth without making all canal water
// transparent. Boats and bridge decks naturally occlude it in the depth buffer.
export function addSharks(batch, block, worldX, worldZ, area, time) {
  const { width } = canalDimensions(block), spacing = block * 5;
  const minZ = (worldZ - area.z) * block - 8;
  const maxZ = (worldZ + area.z + 1) * block + 8;
  const size = Math.min(1.25, width / 7);
  for (let column = Math.ceil((worldX - area.x) / 12) * 12; column <= worldX + area.x; column += 12) {
    const direction = Math.abs(column / 12) % 2 ? -1 : 1;
    const offset = spacing * 0.45 + direction * time * 1.7;
    for (let index = Math.ceil((minZ - offset) / spacing); index <= Math.floor((maxZ - offset) / spacing); index++) {
      const phase = time * 0.28 + index * 0.8 + column;
      const x = (column - worldX + 0.5) * block + Math.sin(phase) * width * 0.08;
      const z = index * spacing + offset - worldZ * block;
      const angle = Math.atan2(Math.cos(phase) * width * 0.08 * 0.28, direction * 1.7);
      batch.add('shark', x, CANAL_WATER_LEVEL + 0.012, z, size, 1, size, '#63716f', angle);
    }
  }
}

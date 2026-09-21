import { Shape, ExtrudeGeometry } from 'three';
import { canalDimensions, CANAL_WATER_LEVEL } from './canal.js';

export function boatHullGeometry() {
  const outline = new Shape();
  outline.moveTo(-0.5, -0.5);
  outline.lineTo(0.5, -0.5);
  outline.lineTo(0.5, 0.16);
  outline.lineTo(0.3, 0.38);
  outline.lineTo(0, 0.55);
  outline.lineTo(-0.3, 0.38);
  outline.lineTo(-0.5, 0.16);
  outline.closePath();
  const geometry = new ExtrudeGeometry(outline, { depth: 1, bevelEnabled: false });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 1, 0);
  return geometry;
}

const BOATS = [
  { direction: 1, speed: 2.4, phase: 0.3, size: 1, color: '#d5d5d5' },
  { direction: -1, speed: 4.1, phase: 0.7, size: 0.85, color: '#eeeeee' },
];
const WAKE_COLORS = Array.from({ length: 32 }, (_, i) => {
  const shade = Math.round(119 + 98 * (1 - i / 31)).toString(16);
  return `#${shade}${shade}${shade}`;
});

// World-anchored spacing keeps boats continuous across camera origin shifts.
// Only the nearby copies are drawn, so the endless canal needs no growing state.
export function addBoats(batch, block, worldX, worldZ, area, time) {
  const { width } = canalDimensions(block), spacing = block * 4;
  const minZ = (worldZ - area.z) * block - 12;
  const maxZ = (worldZ + area.z + 1) * block + 12;
  for (let column = Math.ceil((worldX - area.x) / 12) * 12; column <= worldX + area.x; column += 12) {
    for (const boat of BOATS) {
      const { direction, speed, phase, size, color } = boat;
      const offset = phase * spacing + direction * speed * time;
      const x = (column - worldX + 0.5) * block + direction * width * 0.23;
      const rotation = direction > 0 ? 0 : Math.PI;
      for (let index = Math.ceil((minZ - offset) / spacing); index <= Math.floor((maxZ - offset) / spacing); index++) {
        const z = index * spacing + offset - worldZ * block;
        const y = CANAL_WATER_LEVEL + 0.04 + Math.sin(time * 1.8 + phase * 10) * 0.025;
        batch.add('boat', x, y, z, 1.55 * size, 0.42, 3.8 * size, color, rotation);
        batch.add('boat', x, y + 0.43, z, 1.25 * size, 0.08, 3.35 * size, '#9b9b9b', rotation);
        batch.add('box', x, y + 0.72, z - direction * 0.22, 0.95 * size, 0.46, 1.1 * size, '#555555', rotation);
        batch.add('box', x, y + 0.98, z - direction * 0.22, 1.12 * size, 0.12, 1.35 * size, '#eeeeee', rotation);

        // Three small V-shaped ripples expand and fade into the water behind the stern.
        for (let ripple = 0; ripple < 3; ripple++) {
          const age = (ripple + (time * speed * 0.28 + phase) % 1) / 3;
          const spread = 0.35 + age * Math.min(1.35, width * 0.14);
          const behind = 1.9 * size + age * (3 + speed * 0.5);
          const length = Math.hypot(spread, 0.65);
          const wakeColor = WAKE_COLORS[Math.min(31, Math.floor(age * 32))];
          for (const side of [-1, 1]) {
            batch.add('paint', x + side * spread / 2, CANAL_WATER_LEVEL + 0.025,
              z - direction * (behind + 0.325), 0.09 * (1 - age * 0.6), 0.008, length,
              wakeColor, Math.atan2(side * spread, -direction * 0.65));
          }
        }
      }
    }
  }
}

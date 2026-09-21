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

const STREAMS = [
  { direction: 1, speed: 2.4, phase: 0.3 },
  { direction: -1, speed: 4.1, phase: 0.7 },
];
const BOATS = [
  { kind: 'dinghy', width: 1.05, length: 2.5, height: 0.28, color: '#b9bfbc' },
  { kind: 'cabin', width: 1.7, length: 4.2, height: 0.42, color: '#d5d5d5' },
  { kind: 'speedboat', width: 1.35, length: 3.35, height: 0.32, color: '#eeeeee' },
  { kind: 'passenger', width: 2.35, length: 6.3, height: 0.5, color: '#e3e3dd' },
];
const WAKE_COLORS = Array.from({ length: 32 }, (_, i) => {
  const shade = Math.round(119 + 98 * (1 - i / 31)).toString(16);
  return `#${shade}${shade}${shade}`;
});

function drawBoat(batch, boat, x, y, z, direction) {
  const { kind, width, length, height, color } = boat;
  const rotation = direction > 0 ? 0 : Math.PI;
  const part = (shape, dx, dy, dz, w, h, d, tint) =>
    batch.add(shape, x + direction * dx, y + dy, z + direction * dz, w, h, d, tint, rotation);
  part('boat', 0, 0, 0, width, height, length, color);
  part('boat', 0, height + 0.01, 0, width * 0.81, 0.06, length * 0.87, '#909792');

  if (kind === 'dinghy') {
    for (const seat of [-0.6, 0.15]) part('box', 0, height + 0.12, seat, width * 0.87, 0.12, 0.25, '#d5d0c4');
    part('box', 0, height + 0.03, -length * 0.5, 0.26, 0.4, 0.3, '#4b5152');
  } else if (kind === 'speedboat') {
    part('boat', 0, height + 0.06, 0.65, width * 0.84, 0.16, length * 0.44, '#eeeeee');
    part('box', 0, height + 0.3, 0.3, width * 0.77, 0.35, 0.12, '#59676b');
    for (const side of [-1, 1]) part('box', side * width * 0.22, height + 0.19, -0.45, 0.31, 0.25, 0.48, '#e0ded4');
    part('box', 0, height + 0.1, -length * 0.5, 0.36, 0.42, 0.26, '#555b5c');
  } else if (kind === 'cabin') {
    part('box', 0, height + 0.27, -0.24, width * 0.66, 0.48, length * 0.32, '#525e62');
    part('box', 0, height + 0.56, -0.24, width * 0.79, 0.12, length * 0.39, '#eeeeee');
    part('box', 0, height + 0.13, -1.35, width * 0.7, 0.18, 0.3, '#dfdcd2');
  } else {
    part('box', 0, height + 0.32, -0.3, width * 0.77, 0.61, length * 0.67, '#c2c8c5');
    part('box', 0, height + 0.43, 1.83, width * 0.67, 0.34, 0.035, '#4b5d65');
    for (const side of [-1, 1]) {
      for (const along of [-1.95, -1.15, -0.35, 0.45, 1.25])
        part('box', side * width * 0.389, height + 0.43, along, 0.025, 0.34, 0.6, '#4b5d65');
      part('box', side * width * 0.4, height + 0.08, -0.3, 0.06, 0.1, length * 0.73, '#778886');
    }
    part('box', 0, height + 0.7, -0.3, width * 0.87, 0.15, length * 0.72, '#f0f0ea');
    part('box', 0, height + 0.84, -0.7, 0.55, 0.15, 0.8, '#aeb6b2');
  }
}

// World-anchored spacing keeps boats continuous across camera origin shifts.
// Only the nearby copies are drawn, so the endless canal needs no growing state.
export function addBoats(batch, block, worldX, worldZ, area, time) {
  const { width } = canalDimensions(block), spacing = block * 3;
  const minZ = (worldZ - area.z) * block - 12;
  const maxZ = (worldZ + area.z + 1) * block + 12;
  for (let column = Math.ceil((worldX - area.x) / 12) * 12; column <= worldX + area.x; column += 12) {
    for (const { direction, speed, phase } of STREAMS) {
      const offset = phase * spacing + direction * speed * time;
      const x = (column - worldX + 0.5) * block + direction * width * 0.23;
      for (let index = Math.ceil((minZ - offset) / spacing); index <= Math.floor((maxZ - offset) / spacing); index++) {
        // Use a permanent world index, so a boat never changes model in view.
        const typeIndex = index + column / 12 + (direction > 0 ? 0 : 3);
        const boat = BOATS[((typeIndex % BOATS.length) + BOATS.length) % BOATS.length];
        const z = index * spacing + offset - worldZ * block;
        const y = CANAL_WATER_LEVEL + 0.04 + Math.sin(time * 1.8 + phase * 10) * 0.025;
        drawBoat(batch, boat, x, y, z, direction);

        // Three small V-shaped ripples expand and fade into the water behind the stern.
        for (let ripple = 0; ripple < 3; ripple++) {
          const age = (ripple + (time * speed * 0.28 + phase) % 1) / 3;
          const spread = boat.width * 0.23 + age * Math.min(1.35, width * 0.14);
          const behind = boat.length * 0.5 + age * (3 + speed * 0.5);
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

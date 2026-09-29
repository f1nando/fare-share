import { BufferGeometry, Float32BufferAttribute } from 'three';
import { parkAt } from './roadLayout.js';

export const MAX_BIRD_PARKS = 2;
export const BIRDS_PER_PARK = 5;

export function birdWingGeometry() {
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([
    0, 0, 0.24, 0, 0, -0.2, 0.85, 0, -0.12,
    0.85, 0, -0.12, 0, 0, -0.2, 0, 0, 0.24,
  ], 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Cache only nearby parks, not a growing list of objects in the endless world.
export class ParkBirds {
  constructor() { this.key = ''; this.parks = []; }

  update(batch, block, worldX, worldZ, area, time) {
    const key = `${block}:${worldX}:${worldZ}:${area.x}:${area.z}`;
    if (key !== this.key) {
      this.key = key;
      const parks = new Map();
      for (let x = worldX - area.x; x <= worldX + area.x; x++) {
        for (let z = worldZ - area.z; z <= worldZ + area.z; z++) {
          const park = parkAt(x, z);
          if (park) parks.set(`${park.x}:${park.z}`, park);
        }
      }
      this.parks = [...parks.values()].sort((a, b) =>
        (a.x - worldX) ** 2 + (a.z - worldZ) ** 2 -
        ((b.x - worldX) ** 2 + (b.z - worldZ) ** 2)).slice(0, MAX_BIRD_PARKS);
    }
    for (const park of this.parks) {
      const cx = (park.x - worldX + (park.axis === 0 ? 1 : 0.5)) * block;
      const cz = (park.z - worldZ + (park.axis === 1 ? 1 : 0.5)) * block;
      const rx = block * (park.axis === 0 ? 0.48 : 0.2);
      const rz = block * (park.axis === 1 ? 0.48 : 0.2);
      const phase = park.x * 0.73 + park.z * 1.17;
      for (let bird = 0; bird < BIRDS_PER_PARK; bird++) {
        const t = time * 0.28 + phase - bird * 0.13;
        const x = cx + Math.cos(t) * rx, z = cz + Math.sin(t) * rz;
        const y = 7 + Math.sin(time * 0.8 + phase + bird * 0.3) * 0.35 + bird * 0.12;
        const heading = Math.atan2(-Math.sin(t) * rx, Math.cos(t) * rz);
        const flap = Math.sin(time * 5.5 + bird * 0.7 + phase) * 0.55;
        for (const side of [-1, 1]) {
          batch.add('birdWing', x, y, z, 0.65, 0.65, 0.65,
            '#454b49', heading, 0, side > 0 ? flap : Math.PI - flap);
        }
      }
    }
  }
}

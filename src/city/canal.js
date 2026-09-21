import { PAVED_ROAD } from './world.js';

// A multiple-of-four column cannot intersect a two-block park (which occupies
// columns 4n+1/4n+2). Every crossing and both bank roads already exist in the grid.
export const canalColumn = x => ((x % 12) + 12) % 12 === 0;
export const CANAL_BRIDGE_HALF = PAVED_ROAD / 2 + 1.75;
export const CANAL_WATER_LEVEL = -2.4;

export function canalDimensions(block) {
  const width = block - 2 * Math.max(PAVED_ROAD / 2 + 3.1, block * 0.26);
  return { width, left: (block - width) / 2, right: (block + width) / 2 };
}

export function populateCanal(batch, x, z, block) {
  const { width, left, right } = canalDimensions(block), roadHalf = PAVED_ROAD / 2;
  const put = (kind, px, y, pz, w, h, d, color, roll = 0) => batch.add(kind, x + px, y, z + pz, w, h, d, color, 0, 0, roll);
  // Water runs below street level, including beneath every bridge opening.
  put('paving', block / 2, CANAL_WATER_LEVEL - 0.01, block / 2, width, 0.02, block, '#777777');
  for (const [across, along] of [[0.42, 0.3], [0.58, 0.68]]) {
    put('paint', left + width * across, CANAL_WATER_LEVEL + 0.006, CANAL_BRIDGE_HALF + (block - CANAL_BRIDGE_HALF * 2) * along,
      0.09, 0.003, block * 0.16, '#b3b3b3');
  }
  // The road stays at y=0, so cars use their original routes and suspension.
  // Its exposed underside and open space below make this read as a bridge.
  put('box', block / 2, -0.3, 0, width + 0.6, 0.6, CANAL_BRIDGE_HALF * 2, '#555555');
  for (const side of [-1, 1]) {
    const bankWidth = left - roadHalf;
    const bankX = side < 0 ? roadHalf + bankWidth / 2 : right + bankWidth / 2;
    const edgeX = side < 0 ? left : right;
    put('box', edgeX + side * 0.12, CANAL_WATER_LEVEL / 2, block / 2, 0.24, -CANAL_WATER_LEVEL, block, '#858585');
    put('box', bankX, 0.1, block / 2, bankWidth, 0.3, block - PAVED_ROAD, '#bdbdbd');
    put('paving', bankX - side * 0.105, 0.25, block / 2, bankWidth - 0.21, 0.34, block - PAVED_ROAD - 0.42, '#dedede');
    put('box', edgeX + side * 0.12, 0.38, block / 2, 0.24, 0.76, block - CANAL_BRIDGE_HALF * 2, '#aaaaaa');
    // Wide pavement on both sides of the bridge supports shoulder manoeuvres.
    // Parapets sit beyond the furthest body/wheel reach of a passing taxi.
    const curbZ = side * (roadHalf + 0.875), railZ = side * (CANAL_BRIDGE_HALF - 0.12);
    put('box', block / 2, 0.1, curbZ, width + 0.6, 0.3, 1.75, '#bdbdbd');
    put('paving', block / 2, 0.25, curbZ + side * 0.105, width + 0.6, 0.34, 1.54, '#dedede');
    put('box', block / 2, 1, railZ, width + 0.6, 0.15, 0.18, '#999999');
    for (const fraction of [0, 0.5, 1]) {
      const top = fraction === 0.5 ? 2.5 : 1.05;
      put('box', left + width * fraction, (top + 0.4) / 2, railZ, 0.18, top - 0.4, 0.18, '#999999');
    }
    // Three straight beams give a readable low-poly bridge silhouette even
    // from the original steep camera, without moving the road or the cars.
    const arch = [[left, 1.05], [left + width * 0.25, 2.5], [right - width * 0.25, 2.5], [right, 1.05]];
    for (let i = 1; i < arch.length; i++) {
      const [ax, ay] = arch[i - 1], [bx, by] = arch[i];
      put('box', (ax + bx) / 2, (ay + by) / 2, railZ, Math.hypot(bx - ax, by - ay), 0.22, 0.22, '#888888', Math.atan2(by - ay, bx - ax));
    }
    for (const fraction of [0.3, 0.7]) {
      put('box', bankX, 1.05, block * fraction, 0.28, 1.4, 0.28, '#777777');
      put('crown', bankX, 2.35, block * fraction, 0.95, 1.25, 0.95, '#969696');
    }
  }
}

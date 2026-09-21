import { PAVED_ROAD } from './world.js';

// A multiple-of-four column cannot intersect a two-block park (which occupies
// columns 4n+1/4n+2). Every crossing and both bank roads already exist in the grid.
export const canalColumn = x => ((x % 12) + 12) % 12 === 0;
export const CANAL_BRIDGE_HALF = PAVED_ROAD / 2 + 2.4;

export function canalDimensions(block) {
  const width = block * 0.42;
  return { width, left: (block - width) / 2, right: (block + width) / 2 };
}

export function populateCanal(batch, x, z, block) {
  const { width, left, right } = canalDimensions(block), roadHalf = PAVED_ROAD / 2;
  const put = (kind, px, y, pz, w, h, d, color) => batch.add(kind, x + px, y, z + pz, w, h, d, color);
  // Flat opaque water uses the existing paving material, with no reflections,
  // animation or new shader. The deck covers the water at each street crossing.
  put('paving', block / 2, 0.001, block / 2, width, 0.002, block, '#858585');
  for (const [across, along] of [[0.42, 0.3], [0.58, 0.68]]) {
    put('paint', left + width * across, 0.006, CANAL_BRIDGE_HALF + (block - CANAL_BRIDGE_HALF * 2) * along,
      width * 0.18, 0.003, 0.09, '#b3b3b3');
  }
  put('paving', block / 2, 0.004, 0, width + 0.6, 0.004, CANAL_BRIDGE_HALF * 2, '#555555');
  for (const side of [-1, 1]) {
    const bankWidth = left - roadHalf;
    const bankX = side < 0 ? roadHalf + bankWidth / 2 : right + bankWidth / 2;
    const edgeX = side < 0 ? left : right;
    put('box', bankX, 0.1, block / 2, bankWidth, 0.3, block - PAVED_ROAD, '#bdbdbd');
    put('paving', bankX - side * 0.105, 0.25, block / 2, bankWidth - 0.21, 0.34, block - PAVED_ROAD - 0.42, '#dedede');
    put('box', edgeX + side * 0.12, 0.38, block / 2, 0.24, 0.76, block - CANAL_BRIDGE_HALF * 2, '#aaaaaa');
    // Wide pavement on both sides of the bridge supports shoulder manoeuvres.
    // Parapets sit beyond the furthest body/wheel reach of a passing taxi.
    const curbZ = side * (roadHalf + 1.2);
    put('box', block / 2, 0.1, curbZ, width + 0.6, 0.3, 2.4, '#bdbdbd');
    put('paving', block / 2, 0.25, curbZ + side * 0.105, width + 0.6, 0.34, 2.19, '#dedede');
    put('box', block / 2, 0.62, side * (CANAL_BRIDGE_HALF - 0.12), width + 0.6, 0.4, 0.24, '#999999');
    for (const fraction of [0.3, 0.7]) {
      put('box', bankX, 1.05, block * fraction, 0.28, 1.4, 0.28, '#777777');
      put('crown', bankX, 2.35, block * fraction, 0.95, 1.25, 0.95, '#969696');
    }
  }
}

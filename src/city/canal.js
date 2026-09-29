import { REVEAL } from './revealStages.js';
import { streetHalf } from './roadProfile.js';
import { PAVED_ROAD } from './world.js';
import { canalBridge, bridgeHeight, bridgeHalfWidth, BRIDGE_START, BRIDGE_HALF, BRIDGE_SEGMENTS } from './bridgeProfile.js';
import { MEDIAN_WIDTH } from './roadLayout.js';

export { canalColumn } from './bridgeProfile.js';
export const CANAL_BRIDGE_HALF = BRIDGE_HALF;
export const CANAL_WATER_LEVEL = -2.4;

export function canalDimensions(block) {
  // Preserve the sidewalk-riding clearance even at the smallest block size.
  const width = block - 2 * Math.max(PAVED_ROAD / 2 + 3.1, block * 0.19);
  return { width, left: (block - width) / 2, right: (block + width) / 2 };
}

export function populateCanal(batch, x, z, block, line = 0, divided = false) {
  const { width, left, right } = canalDimensions(block), roadHalf = streetHalf(0,line),bridgeHalf=bridgeHalfWidth(line);
  const north = canalBridge(line), south = canalBridge(line + 1);
  const bankStart = north ? roadHalf : 0, bankEnd = block - (south ? streetHalf(0,line+1) : 0);
  const walkStart = bankStart + (north ? 0.21 : 0), walkEnd = bankEnd - (south ? 0.21 : 0);
  const wallStart = north ? bridgeHalf : 0, wallEnd = block - (south ? bridgeHalfWidth(line+1) : 0);
  const put = (kind, px, y, pz, w, h, d, color, roll = 0, stage = REVEAL.lots) => batch.add(kind, x + px, y, z + pz, w, h, d, color, 0, 0, roll, stage);
  put('paving', block / 2, CANAL_WATER_LEVEL - 0.01, block / 2, width, 0.02, block, '#777777', 0, REVEAL.water);
  for (const [across, along] of [[0.42, 0.3], [0.58, 0.68]]) {
    put('paint', left + width * across, CANAL_WATER_LEVEL + 0.006, BRIDGE_HALF + (block - BRIDGE_HALF * 2) * along,
      0.09, 0.003, block * 0.16, '#b3b3b3', 0, REVEAL.water);
  }
  for (const side of [-1, 1]) {
    const bankHalf=PAVED_ROAD/2,bankWidth = left - bankHalf;
    const bankX = side < 0 ? bankHalf + bankWidth / 2 : right + bankWidth / 2;
    const edgeX = side < 0 ? left : right;
    put('box', edgeX + side * 0.12, CANAL_WATER_LEVEL / 2, block / 2, 0.24, -CANAL_WATER_LEVEL, block, '#858585');
    put('box', bankX, 0.1, (bankStart + bankEnd) / 2, bankWidth, 0.3, bankEnd - bankStart, '#bdbdbd');
    put('paving', bankX - side * 0.105, 0.25, (walkStart + walkEnd) / 2, bankWidth - 0.21, 0.34, walkEnd - walkStart, '#dedede');
    put('box', edgeX + side * 0.12, 0.38, (wallStart + wallEnd) / 2, 0.24, 0.76, wallEnd - wallStart, '#aaaaaa');
    for (const fraction of [0.3, 0.7]) {
      put('box', bankX, 1.05, block * fraction, 0.28, 1.4, 0.28, '#777777', 0, REVEAL.trees);
      put('crown', bankX, 2.35, block * fraction, 0.95, 1.25, 0.95, '#969696', 0, REVEAL.trees);
    }
  }
  if (!north) return;

  // Eight sections share exactly the profile used by the cars. Upper deck
  // faces meet edge-to-edge; thickness extends below that surface.
  const span = block - 2 * BRIDGE_START;
  for (let i = 0; i < BRIDGE_SEGMENTS; i++) {
    const a = BRIDGE_START + span * i / BRIDGE_SEGMENTS, b = BRIDGE_START + span * (i + 1) / BRIDGE_SEGMENTS;
    const ay = bridgeHeight(a, block), by = bridgeHeight(b, block);
    const angle = Math.atan2(by - ay, b - a), length = Math.hypot(b - a, by - ay);
    const middleX = (a + b) / 2, middleY = (ay + by) / 2;
    const piece = (kind, offsetY, offsetZ, height, depth, color) => {
      put(kind, middleX - Math.sin(angle) * offsetY, middleY + Math.cos(angle) * offsetY,
        offsetZ, length, height, depth, color, angle, REVEAL.roads);
    };
    piece('box', -0.3, 0, 0.6, bridgeHalf * 2, '#555555');
    if (divided) piece('box', 0.09, 0, 0.18, MEDIAN_WIDTH, '#bdbdbd');
    for (const side of [-1, 1]) {
      const curbZ = side * (roadHalf + 0.875), railZ = side * (bridgeHalf - 0.12);
      piece('box', 0.1, curbZ, 0.3, 1.75, '#bdbdbd');
      piece('paving', 0.25, curbZ + side * 0.105, 0.34, 1.54, '#dedede');
      piece('box', 1.05, railZ, 0.16, 0.2, '#888888');
    }
  }
  for (let i = 0; i <= BRIDGE_SEGMENTS; i += 2) {
    const along = BRIDGE_START + span * i / BRIDGE_SEGMENTS;
    for (const side of [-1, 1]) put('box', along, bridgeHeight(along, block) + 0.7,
      side * (bridgeHalf - 0.12), 0.18, 0.7, 0.18, '#999999', 0, REVEAL.roads);
  }
}

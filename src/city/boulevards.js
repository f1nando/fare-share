import { REVEAL } from './revealStages.js';
import { MEDIAN_WIDTH, MEDIAN_INSET } from './roadLayout.js';

export function populateMedian(batch, axis, x, z, blockSize) {
  const length = blockSize - MEDIAN_INSET * 2;
  if (length <= 0) return;
  const put = (kind, along, y, width, height, depth, color, stage) => batch.add(kind,
    x + (axis === 0 ? along : 0), y, z + (axis === 1 ? along : 0),
    axis === 0 ? depth : width, height, axis === 0 ? width : depth, color, 0, 0, 0, stage);
  put('box', blockSize / 2, 0.09, MEDIAN_WIDTH, 0.18, length, '#bdbdbd');
  put('paving', blockSize / 2, 0.19, MEDIAN_WIDTH - 0.08, 0.025, length - 0.25, '#999999');
  // Slender trunks fit between the inner lanes; crowns sit above car roofs.
  // A fixed count keeps large-block settings within the same object budget.
  for (const fraction of [0.2, 0.5, 0.8]) {
    const along = MEDIAN_INSET + length * fraction;
    put('box', along, 1.15, 0.13, 2.1, 0.13, '#777777', REVEAL.trees);
    put('crown', along, 2.55, 0.85, 1.65, 0.85, '#969696');
  }
}

import { roadworkAt } from './roadLayout.js';

export function populateRoadworks(batch, gx, gz, x, z, block) {
  for (const axis of [0, 1]) {
    const work = roadworkAt(axis, axis === 0 ? gz : gx, axis === 0 ? gx : gz, block);
    if (!work) continue;
    const base = (axis === 0 ? gx : gz) * block, start = work.start - base, end = work.end - base;
    const put = (kind, along, across, y, w, h, d, color) => batch.add(kind,
      x + (axis === 0 ? along : -work.direction * across), y,
      z + (axis === 0 ? work.direction * across : along),
      axis === 0 ? d : w, h, axis === 0 ? w : d, color);
    put('paving', (start + end) / 2, 2.45, 0.025, 1.12, 0.03, end - start, '#454545');
    for (const along of [start, (start + end) / 2, end]) for (const across of [1.8, 3.1]) {
      put('box', along, across, 0.055, 0.38, 0.11, 0.38, '#777777');
      put('cone', along, across, 0.41, 0.38, 0.64, 0.38, '#eeeeee');
    }
    // One small raised patch makes the lane closure legible in the gray palette.
    put('box', (start + end) / 2, 2.45, 0.11, 0.62, 0.18, Math.max(1, end - start - 2), '#777777');
  }
}

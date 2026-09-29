import { roadworkAt } from './roadLayout.js';
import { laneOffset } from './roadProfile.js';

export function populateRoadworks(batch, gx, gz, x, z, block) {
  for (const axis of [0, 1]) {
    const work = roadworkAt(axis, axis === 0 ? gz : gx, axis === 0 ? gx : gz, block);
    if (!work) continue;
    const laneCenter = laneOffset(axis,work.line,1);
    const base = (axis === 0 ? gx : gz) * block, start = work.start - base, end = work.end - base;
    const put = (kind, along, across, y, w, h, d, color) => batch.add(kind,
      x + (axis === 0 ? along : -work.direction * across), y,
      z + (axis === 0 ? work.direction * across : along),
      axis === 0 ? d : w, h, axis === 0 ? w : d, color);
    put('paving', (start + end) / 2, laneCenter, 0.025, 1.12, 0.03, end - start, '#454545');
    for (const along of [start, (start + end) / 2, end]) for (const across of [laneCenter-.65, laneCenter+.65]) {
      put('box', along, across, 0.055, 0.38, 0.11, 0.38, '#777777');
      put('cone', along, across, 0.41, 0.38, 0.64, 0.38, '#eeeeee');
    }
    const center = (start + end) / 2;
    if (work.variant === 1) {
      // Open utility shaft, with its cover and a small stack of paving slabs.
      put('island', center, laneCenter, 0.08, 0.94, 0.1, 0.94, '#a4a4a4');
      put('island', center, laneCenter, 0.14, 0.7, 0.025, 0.7, '#353535');
      put('island', center + 1.1, laneCenter, 0.075, 0.78, 0.08, 0.78, '#787878');
      for (let i = 0; i < 3; i++) put('box', center - 1.05, laneCenter, 0.09 + i * 0.1, 0.55, 0.08, 0.65, '#b7b7b7');
    } else if (work.variant === 2) {
      // A narrow trench and striped end barriers, all within the closed lane.
      put('paving', center, laneCenter, 0.045, 0.62, 0.02, Math.max(1, end - start - 1), '#303030');
      for (const along of [start + 0.4, end - 0.4]) {
        for (const across of [laneCenter - 0.42, laneCenter + 0.42])
          put('box', along, across, 0.3, 0.08, 0.55, 0.12, '#777777');
        put('box', along, laneCenter, 0.52, 1.08, 0.24, 0.12, '#dddddd');
        for (const offset of [-0.34, 0.34]) put('box', along, laneCenter + offset, 0.52, 0.2, 0.25, 0.135, '#747474');
      }
    } else {
      put('box', center, laneCenter, 0.11, 0.62, 0.18, Math.max(1, end - start - 2), '#777777');
      // A compact roller makes the fresh-asphalt site recognizable at city scale.
      for (const along of [center - 0.45, center + 0.45])
        put('box', along, laneCenter, 0.21, 0.78, 0.3, 0.35, '#5d5d5d');
      put('box', center, laneCenter, 0.47, 0.56, 0.28, 0.9, '#a5a89a');
      put('box', center - 0.12, laneCenter, 0.72, 0.42, 0.22, 0.4, '#525852');
    }
  }
}

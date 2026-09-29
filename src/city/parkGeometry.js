import { REVEAL } from './revealStages.js';
import { PAVED_ROAD } from './world.js';

export function populatePark(batch, x, z, block, park) {
  const width = block * (park.axis === 0 ? 2 : 1), depth = block * (park.axis === 1 ? 2 : 1);
  const put = (kind, dx, y, dz, w, h, d, color, stage) => batch.add(kind, x + dx, y, z + dz, w, h, d, color, 0, 0, 0, stage);
  put('round', width / 2, 0.1, depth / 2, width - PAVED_ROAD, 0.3, depth - PAVED_ROAD, '#bdbdbd');
  put('round', width / 2, 0.25, depth / 2, width - PAVED_ROAD - 0.42, 0.34, depth - PAVED_ROAD - 0.42, '#dedede');
  put('round', width / 2, 0.46, depth / 2, width - PAVED_ROAD - 2.5, 0.14, depth - PAVED_ROAD - 2.5, '#b8b8b8');
  const horizontal = park.axis === 0, long = horizontal ? width : depth, short = horizontal ? depth : width;
  const at = (kind, along, y, across, w, h, d, color, stage) => horizontal
    ? put(kind, along, y, across, w, h, d, color, stage) : put(kind, across, y, along, d, h, w, color, stage);
  at('paving', long / 2, 0.55, short / 2, long - PAVED_ROAD - 1, 0.04, 2.2, '#e4e4e4');
  for (const fraction of [0.25, 0.75]) {
    at('paving', long * fraction, 0.55, short / 2, 1.8, 0.04, short - PAVED_ROAD - 1, '#e4e4e4');
  }
  if (park.style === 0) {
    // A long, flat pond with a low rim, deliberately kept monochrome.
    at('round', long / 2, 0.6, short / 2, long * 0.27, 0.2, short * 0.25, '#a2a2a2');
    at('paving', long / 2, 0.72, short / 2, long * 0.27 - 0.7, 0.025, short * 0.25 - 0.7, '#858585', REVEAL.water);
  }
  const cx = width / 2, cz = depth / 2;
  const scale = 3, baseY = 0.57;
  const fountainPart = (dx, y, dz, w, h, d, color, stage, rotation = 0, pitch = 0) =>
    batch.add('island', x + cx + dx * scale, baseY + (y - baseY) * scale, z + cz + dz * scale,
      w * scale, h * scale, d * scale, color, rotation, pitch, 0, stage);
  fountainPart(0, 0.74, 0, 4.4, 0.34, 4.4, '#bdbdbd', REVEAL.lots);
  fountainPart(0, 0.92, 0, 3.75, 0.035, 3.75, '#929fa0', REVEAL.water);
  fountainPart(0, 1.07, 0, 0.65, 0.3, 0.65, '#d4d4d4', REVEAL.lots);
  fountainPart(0, 1.76, 0, 0.14, 1.1, 0.14, '#e0ebeb', REVEAL.water);
  // Four low, faceted arcs reuse the existing cylinder instances; no particles.
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const points = [[0, 2.1], [0.65, 1.95], [1.45, 0.95]];
    for (let i = 1; i < points.length; i++) {
      const [a, ay] = points[i - 1], [b, by] = points[i];
      const radius = (a + b) / 2;
      fountainPart(Math.sin(angle) * radius, (ay + by) / 2,
        Math.cos(angle) * radius, 0.075, Math.hypot(b - a, by - ay), 0.075,
        '#e0ebeb', REVEAL.water, angle, Math.atan2(b - a, by - ay));
    }
  }
  for (let i = 0; i < 6; i++) for (const side of [-1, 1]) {
    const along = PAVED_ROAD / 2 + 3 + i * (long - PAVED_ROAD - 6) / 5;
    const across = short / 2 + side * (short / 2 - PAVED_ROAD / 2 - 3);
    at('box', along, 1.15, across, 0.4, 1.5, 0.4, '#777777', REVEAL.trees);
    at('crown', along, 2.6, across, 1.7, 2.0, 1.7, i % 2 ? '#969696' : '#797979');
    if (i === 1 || i === 4) at('box', along, 0.76, short / 2 + side * 2.4, 2.4, 0.4, 0.6, '#a0a0a0');
  }
}

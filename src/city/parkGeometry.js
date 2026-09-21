import { PAVED_ROAD } from './world.js';

export function populatePark(batch, x, z, block, park) {
  const width = block * (park.axis === 0 ? 2 : 1), depth = block * (park.axis === 1 ? 2 : 1);
  const put = (kind, dx, y, dz, w, h, d, color) => batch.add(kind, x + dx, y, z + dz, w, h, d, color);
  put('round', width / 2, 0.1, depth / 2, width - PAVED_ROAD, 0.3, depth - PAVED_ROAD, '#bdbdbd');
  put('round', width / 2, 0.25, depth / 2, width - PAVED_ROAD - 0.42, 0.34, depth - PAVED_ROAD - 0.42, '#dedede');
  put('round', width / 2, 0.46, depth / 2, width - PAVED_ROAD - 2.5, 0.14, depth - PAVED_ROAD - 2.5, '#b8b8b8');
  const horizontal = park.axis === 0, long = horizontal ? width : depth, short = horizontal ? depth : width;
  const at = (kind, along, y, across, w, h, d, color) => horizontal
    ? put(kind, along, y, across, w, h, d, color) : put(kind, across, y, along, d, h, w, color);
  at('paving', long / 2, 0.55, short / 2, long - PAVED_ROAD - 1, 0.04, 2.2, '#e4e4e4');
  for (const fraction of [0.25, 0.75]) {
    at('paving', long * fraction, 0.55, short / 2, 1.8, 0.04, short - PAVED_ROAD - 1, '#e4e4e4');
  }
  if (park.style === 0) {
    // A long, flat pond with a low rim, deliberately kept monochrome.
    at('round', long / 2, 0.6, short / 2, long * 0.27, 0.2, short * 0.25, '#a2a2a2');
    at('paving', long / 2, 0.72, short / 2, long * 0.27 - 0.7, 0.025, short * 0.25 - 0.7, '#858585');
  } else if (park.style === 1) {
    at('round', long / 2, 0.58, short / 2, short * 0.36, 0.12, short * 0.36, '#d4d4d4');
    at('box', long / 2, 1.25, short / 2, 1.6, 1.35, 1.6, '#aaaaaa');
    at('crown', long / 2, 2.65, short / 2, 1.25, 1.25, 1.25, '#eeeeee');
  }
  for (let i = 0; i < 6; i++) for (const side of [-1, 1]) {
    const along = PAVED_ROAD / 2 + 3 + i * (long - PAVED_ROAD - 6) / 5;
    const across = short / 2 + side * (short / 2 - PAVED_ROAD / 2 - 3);
    at('box', along, 1.15, across, 0.4, 1.5, 0.4, '#777777');
    at('crown', along, 2.6, across, 1.7, 2.0, 1.7, i % 2 ? '#969696' : '#797979');
    if (i === 1 || i === 4) at('box', along, 0.76, short / 2 + side * 2.4, 2.4, 0.4, 0.6, '#a0a0a0');
  }
}

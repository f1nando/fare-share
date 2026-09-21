// Small contiguous neighbourhoods vary the skyline without changing roads or
// introducing more simulation objects. Absolute coordinates survive rebasing.
export function districtKind(x, z) {
  const dx = Math.floor(x / 2), dz = Math.floor(z / 2);
  const hash = (Math.imul(dx + 37, 73856093) ^ Math.imul(dz - 19, 19349663)) >>> 0;
  return ['residential', 'centre', 'industrial'][hash % 3];
}

export function populateDistrict(kind, { put, tree, random, palette }) {
  const lots = [[7.8, 7.8], [16, 7.8], [7.8, 16], [16, 16]];
  if (kind === 'residential') {
    for (const [index, [x, z]] of lots.entries()) {
      put('round', x, 0.46, z, 6.3, 0.16, 6.3, palette.grass[index % palette.grass.length]);
      const height = 1.4 + random() * 1.2;
      put('building', x - 0.45, 0.55 + height / 2, z - 0.6, 3.4 + random() * 0.4, height, 3.3,
        palette.buildings[index % palette.buildings.length]);
      if (index === 0 || index === 3) tree(x + 1.8, z + 1.8, 0.85);
    }
  } else if (kind === 'centre') {
    for (const [index, [x, z]] of lots.entries()) {
      const width = 5.4 + random() * 1.1, depth = 5.1 + random() * 1.2;
      const height = 4.4 + random() * 3;
      put('round', x, 0.48, z, width + 0.5, 0.2, depth + 0.5, palette.paving);
      const color = palette.buildings[index % palette.buildings.length];
      if (index % 2) {
        put('building', x, 0.55 + height * 0.3, z, width, height * 0.6, depth, color);
        put('building', x, 0.55 + height * 0.8, z, width * 0.68, height * 0.4, depth * 0.68, color);
      } else put('building', x, 0.55 + height / 2, z, width, height, depth, color);
    }
  } else {
    for (const [index, z] of [7.8, 13.5].entries()) {
      const height = 1.8 + random() * 0.8;
      put('round', 12, 0.48, z, 13.3, 0.2, 4.9, palette.paving);
      put('building', 12, 0.55 + height / 2, z, 12.6, height, 4.2, index ? '#c6c6c6' : '#d3d3d3');
      put('paving', 12, 0.57 + height, z, 8.5, 0.04, 0.8, '#aaaaaa');
    }
    put('paving', 12, 0.5, 18, 13.3, 0.06, 3.1, '#aaaaaa');
    for (let i = 0; i < 6; i++) put('paving', 6.5 + i * 2.2, 0.55, 18, 0.09, 0.025, 2.5, '#dddddd');
  }
}

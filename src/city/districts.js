// Small contiguous neighbourhoods vary the skyline without changing roads or
// introducing more simulation objects. Absolute coordinates survive rebasing.
export function districtKind(x, z) {
  const dx = Math.floor(x / 2), dz = Math.floor(z / 2);
  const hash = (Math.imul(dx + 37, 73856093) ^ Math.imul(dz - 19, 19349663)) >>> 0;
  return ['residential', 'centre', 'industrial'][hash % 3];
}

// One original layout plus four silhouettes per neighbourhood. Footprints use
// the existing 24-unit lot space; heights stay inside the shadow/culling budget.
// [x, z, width, depth, height]
const layouts = {
  residential: [
    { buildings: [[7, 12, 3.4, 12, 2.8], [17, 12, 3.4, 12, 2.8], [12, 7, 6.6, 3.4, 2.8]],
      lawns: [[12, 13.5, 5.6, 6.6]], trees: [[11, 15.5], [13.5, 11.5]] }, // Open courtyard
    { buildings: [[7, 7.6, 3.4, 4.2, 2], [12, 7.6, 3.4, 4.2, 2], [17, 7.6, 3.4, 4.2, 2],
      [7, 16.4, 3.4, 4.2, 2], [12, 16.4, 3.4, 4.2, 2], [17, 16.4, 3.4, 4.2, 2]],
      lawns: [[12, 12, 13.5, 3]], trees: [[9.5, 12], [14.5, 12]] }, // Garden lane
    { buildings: [[8, 12, 4.6, 12, 3.4], [16, 12, 4.6, 12, 2.5]],
      lawns: [[12, 12, 2.4, 12]], trees: [[12, 8.5], [12, 15.5]] }, // Parallel apartments
    { buildings: [[7.5, 7.5, 4.2, 4.2, 2.5], [16, 7.5, 5.7, 4.2, 1.6], [7.5, 16, 4.2, 5.7, 1.8],
      [16.5, 17, 4.6, 3.4, 2.7]], lawns: [[14.3, 12.4, 8.7, 4.1]], trees: [[12, 12], [16.5, 12.5]] }, // Staggered gardens
  ],
  centre: [
    { buildings: [[8, 8, 5, 5, 6.7], [16, 8, 5, 5, 4.4], [8, 16, 5, 5, 3.5]],
      lawns: [[16, 16, 5, 5]], trees: [[15, 16], [17, 16]] }, // Corner square
    { buildings: [[8, 12, 5.5, 12.8, 1.4], [16, 12, 5.5, 12.8, 1.4]],
      towers: [[8, 10, 4.1, 5.6, 5, 1.4], [16, 14, 4.1, 5.6, 5.5, 1.4]],
      lawns: [[12, 12, 1.4, 10]], trees: [[12, 8.5], [12, 15.5]] }, // Twin podiums
    { buildings: [[12, 6.8, 13.6, 3, 4.4], [12, 17.2, 13.6, 3, 4.4],
      [6.8, 12, 3, 7.4, 5.4], [17.2, 12, 3, 7.4, 3.8]],
      lawns: [[12, 12, 5.8, 5.8]], trees: [[11, 11], [13.5, 13.5]] }, // Enclosed court
    { buildings: [[9, 12, 7.2, 13, 2], [16.4, 8, 4.2, 5, 5.8]],
      towers: [[9, 10.5, 5.4, 9, 2, 2], [9, 9, 3.6, 5.4, 2, 4]],
      lawns: [[16.4, 15.5, 4.2, 5]], trees: [[16.4, 15.5]] }, // Terraced offices
  ],
  industrial: [
    { buildings: [[7.2, 10.5, 3.8, 10.2, 2.8], [16.8, 10.5, 3.8, 10.2, 2.8], [12, 7, 5.8, 3.2, 2.3]] }, // Service court
    { buildings: [[9, 10.4, 7.2, 10, 3.5], [16, 8, 5.2, 5.2, 2.2], [16, 13.5, 5.2, 4, 1.6]] }, // Factory and annexes
    { buildings: [[8.3, 7.5, 5.8, 4, 2.1], [15.7, 7.5, 5.8, 4, 2.6],
      [8.3, 13.3, 5.8, 4, 2.6], [15.7, 13.3, 5.8, 4, 2.1]] }, // Workshop cluster
    { buildings: [[12, 9, 13.2, 7.2, 3.1], [8.5, 14.2, 6.2, 2.8, 1.5]] }, // Distribution hall
  ],
};

export function districtLayout(x, z) {
  // Independent of the random stream used for tree colour and building height.
  let hash = (Math.imul(x + 101, 374761393) ^ Math.imul(z - 53, 668265263)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return { variant: hash % 5, turns: (hash >>> 8) % 4 };
}

function industrialApron(put) {
  put('paving', 12, 0.5, 18, 13.3, 0.06, 3.1, '#aaaaaa');
  for (let i = 0; i < 6; i++) put('paving', 6.5 + i * 2.2, 0.55, 18, 0.09, 0.025, 2.5, '#dddddd');
}

export function populateDistrict(kind, { put, tree, random, palette, gx = 0, gz = 0 }) {
  const { variant, turns } = districtLayout(gx, gz);
  if (variant) {
    const layout = layouts[kind][variant - 1];
    // Swap coordinates and extents instead of rotating meshes: the existing
    // shoulder clamp and roundabout cutouts continue to see exact box bounds.
    // Industrial aprons keep their existing position and parking orientation.
    const rotation = kind === 'industrial' ? 0 : turns;
    const point = (x, z) => rotation === 1 ? [24 - z, x] : rotation === 2 ? [24 - x, 24 - z]
      : rotation === 3 ? [z, 24 - x] : [x, z];
    const part = (type, x, y, z, w, h, d, color) => {
      const [px, pz] = point(x, z);
      put(type, px, y, pz, rotation % 2 ? d : w, h, rotation % 2 ? w : d, color);
    };
    const buildings = layout.buildings;
    for (const [index, [x, z, w, d, baseHeight]] of buildings.entries()) {
      const height = baseHeight + random() * 0.4;
      part('building', x, 0.55 + height / 2, z, w, height, d, palette.buildings[index % palette.buildings.length]);
    }
    for (const [index, [x, z, w, d, height, base]] of (layout.towers ?? []).entries()) {
      part('building', x, 0.55 + base + height / 2, z, w, height, d, palette.buildings[index % palette.buildings.length]);
    }
    for (const [index, [x, z, w, d]] of (layout.lawns ?? []).entries()) {
      part('round', x, 0.46, z, w, 0.16, d, palette.grass[index % palette.grass.length]);
    }
    for (const [x, z] of layout.trees ?? []) {
      const [px, pz] = point(x, z);
      tree(px, pz, 0.85);
    }
    if (kind === 'industrial') industrialApron(put);
    return;
  }
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
    industrialApron(put);
  }
}

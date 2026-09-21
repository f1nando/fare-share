export const REVEAL = Object.freeze({ water: 0, roads: 1, lots: 2, buildings: 3, trees: 4, cars: 5 });

// Geometry kinds already distinguish buildings/crowns. Flat elevated paving is
// roof trim; the remaining ground furniture belongs to the lot. Ambiguous parts
// (trunks, water and bridge decks) carry an explicit stage from their generator.
export function sceneryStage(kind, y) {
  if (kind === 'building') return REVEAL.buildings;
  if (kind === 'crown') return REVEAL.trees;
  if (kind === 'paint' || kind === 'cone') return REVEAL.roads;
  if (kind === 'paving' && y > 1) return REVEAL.buildings;
  return REVEAL.lots;
}


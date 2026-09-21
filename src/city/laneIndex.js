import { extraHalfLength } from './vehicleTypes.js';

const tracks = [-1, 0, 1, 2];
const empty = Object.freeze({ gap: Infinity, leader: null });

// Rebuilt once per street step from its already sorted cars. Each car's changes
// are committed immediately, preserving the simulation's live sequential order.
export class LaneIndex {
  constructor(cars, direction, occupiesTrack) {
    this.cars = cars; this.direction = direction; this.occupies = occupiesTrack;
    this.rows = tracks.map(() => []);
    this.rank = new Map();
    for (let i = 0; i < cars.length; i++) this.rank.set(cars[i], i);
    this.owners = new Map();
    for (const car of cars) {
      for (let i = 0; i < tracks.length; i++) if (occupiesTrack(car, tracks[i])) this.rows[i].push(car);
      if (car.overtake && !this.owners.has(car.overtake.leader)) this.owners.set(car.overtake.leader, car);
    }
  }

  ahead(car, track) {
    const row = this.rows[track + 1];
    if (!row?.length) return empty;
    const position = car.position * this.direction;
    let low = 0, high = row.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (row[middle].position * this.direction > position) low = middle + 1;
      else high = middle;
    }
    if (!low) return empty;
    let index = low - 1;
    // Match the original first-in-array choice when cars have tied positions.
    while (index > 0 && row[index - 1].position === row[index].position) index--;
    const leader = row[index];
    return { gap: (leader.position - car.position) * this.direction - extraHalfLength(car) - extraHalfLength(leader), leader };
  }

  reservation(car) { return this.owners.get(car)?.overtake; }

  sync(car, previousLeader) {
    const position = car.position * this.direction, rank = this.rank.get(car);
    for (let i = 0; i < tracks.length; i++) {
      const row = this.rows[i], oldIndex = row.indexOf(car);
      const occupied = this.occupies(car, tracks[i]);
      if (oldIndex === -1 && !occupied) continue;
      if (oldIndex !== -1 && occupied) {
        const before = row[oldIndex - 1], after = row[oldIndex + 1];
        const orderedBefore = !before || before.position * this.direction > position ||
          before.position * this.direction === position && this.rank.get(before) < rank;
        const orderedAfter = !after || after.position * this.direction < position ||
          after.position * this.direction === position && this.rank.get(after) > rank;
        if (orderedBefore && orderedAfter) continue;
      }
      if (oldIndex !== -1) row.splice(oldIndex, 1);
      if (!occupied) continue;
      let low = 0, high = row.length;
      while (low < high) {
        const middle = (low + high) >>> 1, other = row[middle], otherPosition = other.position * this.direction;
        if (otherPosition > position || otherPosition === position && this.rank.get(other) < rank) low = middle + 1;
        else high = middle;
      }
      row.splice(low, 0, car);
    }
    const leader = car.overtake?.leader;
    if (previousLeader === leader) return;
    if (previousLeader && this.owners.get(previousLeader) === car) {
      const replacement = this.cars.find(other => other.overtake?.leader === previousLeader);
      if (replacement) this.owners.set(previousLeader, replacement);
      else this.owners.delete(previousLeader);
    }
    if (leader) {
      const previousOwner = this.owners.get(leader);
      if (!previousOwner || rank < this.rank.get(previousOwner)) this.owners.set(leader, car);
    }
  }
}

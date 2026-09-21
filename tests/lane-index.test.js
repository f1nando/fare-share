import test from 'node:test';
import assert from 'node:assert/strict';
import { LaneIndex } from '../src/city/laneIndex.js';
import { occupiesTrack, seededRandom } from '../src/city/world.js';

const oracle = (cars, car, track, direction) => {
  let gap = Infinity, leader = null;
  for (const other of cars) {
    const distance = (other.position - car.position) * direction;
    if (other !== car && distance > 0 && distance < gap && occupiesTrack(other, track)) { gap = distance; leader = other; }
  }
  return { gap, leader };
};

test('lane index matches exhaustive live searches after moves, merges, feints and ties', () => {
  for (const direction of [-1, 1]) {
    const random = seededRandom(92, direction);
    const cars = Array.from({ length: 35 }, (_, i) => ({ position: Math.floor(random() * 12) * 3, track: i % 2,
      fromTrack: 1 - i % 2, changing: i % 7 === 0, feint: i % 11 === 0 ? { age: 0.1 } : null }));
    cars.sort((a, b) => (b.position - a.position) * direction);
    const index = new LaneIndex(cars, direction, occupiesTrack);
    const check = () => {
      for (const car of cars) for (const track of [-1, 0, 1, 2]) {
        const expected = oracle(cars, car, track, direction), actual = index.ahead(car, track);
        assert.equal(actual.gap, expected.gap); assert.equal(actual.leader, expected.leader);
      }
    };
    check();
    for (const car of cars) {
      car.position += (random() * 15 + 1) * direction;
      car.fromTrack = car.track; car.track = Math.floor(random() * 4) - 1;
      car.changing = random() < 0.5; car.feint = null;
      index.sync(car);
      check();
    }
  }
});

test('reservation owner changes immediately and keeps original priority for competing taxis', () => {
  const leader = { position: 20, track: 0 }, first = { position: 10, track: 0 }, second = { position: 0, track: 0 };
  second.overtake = { leader, returnSpace: 7 };
  const cars = [leader, first, second], index = new LaneIndex(cars, 1, occupiesTrack);
  assert.equal(index.reservation(leader), second.overtake);
  first.overtake = { leader, returnSpace: 9 }; index.sync(first);
  assert.equal(index.reservation(leader), first.overtake);
  first.overtake = null; index.sync(first, leader);
  assert.equal(index.reservation(leader), second.overtake);
  second.overtake = null; index.sync(second, leader);
  assert.equal(index.reservation(leader), undefined);
});

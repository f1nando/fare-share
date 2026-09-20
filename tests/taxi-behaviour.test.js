import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_GAP, STOP_LINE, TRACKS, updateTraffic, occupiesTrack } from '../src/city/world.js';
import { intersectionAccess } from '../src/city/intersections.js';

function queue(direction, track = 0) {
  const cars = Array.from({ length: 4 }, (_, i) => ({
    axis: 0, line: 0, direction, position: direction * (-STOP_LINE - CAR_GAP * i),
    taxi: i === 3, track, fromTrack: track, offset: TRACKS[track],
    speed: 0, cruise: i === 3 ? 16 : 6, acceleration: i === 3 ? 25 : 4,
    changing: false, cooldown: 0, merge: 1, flashCooldown: Infinity,
  }));
  return { cars, taxi: cars[3] };
}

test('taxi escapes a bumper-to-bumper red queue via a free adjacent lane and sprints across', () => {
  for (const direction of [-1, 1]) {
    const { cars, taxi } = queue(direction, 1);
    const lanes = new Map([[`0:0:${direction}`, { cars }]]);
    let changed = false, crossed = false, burst = false;
    for (let frame = 0; frame < 250; frame++) {
      updateTraffic(cars, direction, 0.02, false, { weaving: 0.1, blockSize: 40,
        crossingAccess: intersectionAccess(lanes, 40, 12) });
      changed ||= taxi.track === 0;
      crossed ||= taxi.position * direction > STOP_LINE;
      burst ||= taxi.speed > taxi.cruise;
    }
    assert.ok(changed && crossed && burst);
    for (const car of cars.filter(car => !car.taxi)) assert.ok(car.position * direction <= -STOP_LINE + 1e-8);
  }
});

test('taxi overtakes a whole red queue on the oncoming lane and returns in front', () => {
  for (const direction of [-1, 1]) {
    const { cars, taxi } = queue(direction);
    const lanes = new Map([[`0:0:${direction}`, { cars }]]);
    let borrowed = false, returned = false;
    for (let frame = 0; frame < 250; frame++) {
      updateTraffic(cars, direction, 0.02, false, { weaving: 0.1, blockSize: 40, opposing: [], greenRemaining: 0,
        crossingAccess: intersectionAccess(lanes, 40, 12) });
      borrowed ||= taxi.offset < 0;
      returned ||= borrowed && taxi.track === 0 && !taxi.changing && taxi.position * direction > STOP_LINE;
      const members = cars.filter(car => occupiesTrack(car, 0)).sort((a, b) => a.position - b.position);
      for (let i = 1; i < members.length; i++) assert.ok(members[i].position - members[i - 1].position >= CAR_GAP - 1e-7);
    }
    assert.ok(borrowed && returned);
  }
});

test('a busy crossing or approaching oncoming car prevents departing onto the borrowed lane', () => {
  for (const busy of ['crossing', 'oncoming']) {
    const { cars, taxi } = queue(1);
    const crossCar = { axis: 1, line: 0, direction: 1, position: 0, speed: 8, cruise: 8 };
    const opposing = busy === 'oncoming' ? [{ track: 0, position: 5, speed: 10, cruise: 10 }] : [];
    const lanes = new Map([['0:0:1', { cars }], ['1:0:1', { cars: busy === 'crossing' ? [crossCar] : [] }]]);
    updateTraffic(cars, 1, 0.02, false, { weaving: 0.1, blockSize: 40, opposing,
      crossingAccess: intersectionAccess(lanes, 40, 12) });
    assert.notEqual(taxi.track, -1);
    assert.equal(taxi.crossing, undefined);
  }
});

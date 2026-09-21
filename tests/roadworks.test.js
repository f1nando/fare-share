import test from 'node:test';
import assert from 'node:assert/strict';
import { roadworkAt, roadOpen, spawnRoadOpen, relocateToRoad, laneRoadworks } from '../src/city/roadLayout.js';
import { canalColumn } from '../src/city/bridgeProfile.js';
import { PAVED_ROAD, STOP_LINE, canMerge, occupiesTrack, updateTraffic, trackOffset } from '../src/city/world.js';
import { WORK_MARGIN } from '../src/city/roadworkRules.js';
import { populateRoadworks } from '../src/city/roadworkGeometry.js';
import { TrafficSimulation } from '../src/city/trafficSimulation.js';
import { DEFAULT_SETTINGS } from '../src/city/settings.js';
import { carCoordinates } from '../src/city/trafficNetwork.js';
import { vehiclePose } from '../src/city/world.js';

const vehicle = (position, track = 1, taxi = false, direction = 1) => ({ axis: 0, line: 0, direction,
  position: position * direction, track, fromTrack: track, offset: trackOffset(track), taxi,
  speed: taxi ? 16 : 8, cruise: taxi ? 16 : 8, acceleration: taxi ? 26 : 4,
  cooldown: 0, merge: 1, changing: false, steer: 0, flashCooldown: Infinity, turnCooldown: Infinity });
const closure = direction => ({ start: direction > 0 ? 20 : -26, end: direction > 0 ? 26 : -20, direction });
const blockedInner = direction => Array.from({length:22}, (_, i) => ({...vehicle(-12 + i * 2.9, 0, false, direction), speed:0, cruise:0}));
const safe = (car, work, direction) => {
  if (occupiesTrack(car, 1)) assert.ok(car.position * direction <= 20 - WORK_MARGIN + 1e-7 || car.position * direction >= 26 + WORK_MARGIN - 1e-7, 'car entered the closure');
};

test('sites are sparse, deterministic and clear of bridges, missing roads and intersections', () => {
  const groups = new Map(), sites = [];
  for (const axis of [0,1]) for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) {
    const work = roadworkAt(axis, axis === 0 ? z : x, axis === 0 ? x : z, 40);
    if (!work) continue;
    sites.push(work);
    const key = `${Math.floor(x/4)}:${Math.floor(z/4)}`;
    assert.ok(!groups.has(key)); groups.set(key, work);
    assert.ok(roadOpen(axis, work.line, work.segment));
    assert.ok(axis === 0 ? !canalColumn(work.segment) : !canalColumn(work.line) && !canalColumn(work.line - 1));
    assert.ok(work.start - work.segment * 40 > STOP_LINE + 5);
    assert.ok((work.segment + 1) * 40 - work.end > STOP_LINE + 5);
    const parts = []; populateRoadworks({add:(...p)=>parts.push(p)}, x, z, 0, 0, 40);
    assert.equal(parts.filter(p=>p[0] === 'cone').length,6);
    for (const p of parts) {
      const across = axis === 0 ? Math.abs(p[3]) : Math.abs(p[1]);
      const halfWidth = p[axis === 0 ? 6 : 4] / 2;
      assert.ok(across + halfWidth < PAVED_ROAD / 2, 'the shoulder stays physically clear');
      assert.ok(across - halfWidth > 1.5, 'the inner lane stays physically clear');
    }
  }
  assert.ok(sites.length > 20 && sites.length < 90);
  assert.deepEqual(new Set(sites.map(w=>w.direction)), new Set([-1,1]));
});

test('ordinary cars and taxis merge before the cones in both directions without a sudden stop', () => {
  for (const direction of [-1,1]) for (const taxi of [false,true]) {
    const work = closure(direction), car = vehicle(0,1,taxi,direction); car.roadworks = [work];
    for (let i=0;i<400;i++) {
      const before = car.speed;
      updateTraffic([car],direction,1/30,true,{blockSize:80,opposing:[]});
      safe(car,work,direction);
      assert.ok(before - car.speed <= (taxi ? 13 : 7)/30 + 1e-6);
      if (car.position * direction > 30) break;
    }
    assert.ok(car.workAvoidances > 0);
    assert.ok(car.position * direction > 30);
  }
});

test('blocked normal car brakes progressively and resumes once the adjacent lane opens', () => {
  for (const direction of [-1,1]) {
    const work = closure(direction), car = vehicle(0,1,false,direction); car.roadworks = [work];
    const cars = [car,...blockedInner(direction)];
    for (let i=0;i<300;i++) {
      const before = car.speed;
      updateTraffic(cars,direction,1/30,true,{blockSize:80,opposing:[]});
      assert.ok(before-car.speed <= 7/30+1e-6, `abrupt braking ${before-car.speed}`); safe(car,work,direction);
    }
    assert.ok(car.speed < 0.01);
    for (let i=0;i<240;i++) updateTraffic([car],direction,1/30,true,{blockSize:80,opposing:[]});
    assert.ok(car.position * direction > 30, 'no deadlock at the barrier');
  }
});

test('a race follower can end the race to avoid roadworks within the same update', () => {
  for (const direction of [-1, 1]) {
    const leader = vehicle(18, 0, true, direction), follower = vehicle(0, 1, true, direction);
    leader.cooldown = 10;
    const race = { leader, follower, age: 0, phase: 'follow' };
    leader.race = follower.race = race;
    follower.roadworks = [closure(direction)];
    updateTraffic([leader, follower], direction, 1 / 30, true, { blockSize: 80, opposing: [] });
    assert.equal(follower.workAvoidances, 1);
    assert.equal(follower.race, null);
    assert.equal(leader.race, null);
    assert.equal(follower.track, 0);
    assert.ok(Number.isFinite(follower.speed));
  }
});

test('taxi uses a clear shoulder when the inner lane is blocked and returns after the works', () => {
  for (const direction of [-1,1]) {
    const work = closure(direction), car = vehicle(0,1,true,direction); car.roadworks = [work];
    const cars = [car,...blockedInner(direction)]; let shoulder = false;
    for (let i=0;i<220;i++) {
      updateTraffic(cars,direction,1/30,true,{blockSize:80,opposing:[]});
      shoulder ||= car.track === 2; safe(car,work,direction);
      if (shoulder && car.track === 1 && !car.changing && car.position * direction > 30) break;
    }
    assert.ok(shoulder); assert.equal(car.track,1); assert.equal(car.workBypass,null);
    assert.ok(car.position * direction > 30);
  }
});

test('merges into the blocked lane are rejected; spawning, recycling and lane caches agree', () => {
  const car = vehicle(17,0,true); car.roadworks = [closure(1)];
  assert.equal(canMerge(car,[car],1,1),false);
  car.position = 30; assert.equal(canMerge(car,[car],1,1),true);
  for (let line=-12;line<=12;line++) for(let segment=-12;segment<=12;segment++) {
    const work = roadworkAt(0,line,segment,40); if (!work) continue;
    const at = {...vehicle(0),line,direction:work.direction,position:(work.start+work.end)/2};
    assert.equal(spawnRoadOpen(at,40,STOP_LINE),false);
    relocateToRoad(at,40,STOP_LINE); assert.ok(spawnRoadOpen(at,40,STOP_LINE));
    const lane = {axis:0,line,direction:work.direction,cars:[at]};
    const works = laneRoadworks(lane,40); assert.ok(works.some(w=>w.start===work.start));
    assert.equal(laneRoadworks(lane,40),works);
    at.position += 4000; assert.notEqual(laneRoadworks(lane,40),works);
  }
});

test('moving network routes cars around the physical closure during turns and recycling', () => {
  const simulation = new TrafficSimulation({ settings:{...DEFAULT_SETTINGS,density:50,taxiShare:20,weaving:200},
    area:{x:2,z:2,extents:{x:40,z:40}},focus:{x:20,z:20},simulationHz:30 });
  let avoided = 0;
  for(let step=0;step<450;step++) {
    simulation.advance();
    for(const lane of simulation.lanes.values())for(const car of lane.cars) {
      avoided = Math.max(avoided,car.workAvoidances??0);
      const at = carCoordinates(car,40), pose = car.turn ? at : vehiclePose(at.x,at.z,car.axis,car.direction,car.steer);
      for(const axis of [0,1]) {
        const across = axis === 0 ? pose.z : pose.x, along = axis === 0 ? pose.x : pose.z;
        const line = Math.round(across/40), work = roadworkAt(axis,line,Math.floor(along/40),40);
        if(!work || along < work.start-2 || along > work.end+2)continue;
        const sin=Math.sin(pose.angle),cos=Math.cos(pose.angle);
        let minAlong=Infinity,maxAlong=-Infinity,minAcross=Infinity,maxAcross=-Infinity;
        for(const side of [-.46,.46])for(const end of [-1.125,1.125]) {
          const x=pose.x+side*cos+end*sin,z=pose.z-side*sin+end*cos;
          const a=axis===0?x:z,c=(axis===0?z-line*40:line*40-x)*work.direction;
          minAlong=Math.min(minAlong,a);maxAlong=Math.max(maxAlong,a);minAcross=Math.min(minAcross,c);maxAcross=Math.max(maxAcross,c);
        }
        assert.ok(!(maxAlong > work.start-.19 && minAlong < work.end+.19 && maxAcross > 1.61 && minAcross < 3.29),
          JSON.stringify({step,work,position:car.position,track:car.track,changing:car.changing,turn:!!car.turn}));
      }
    }
  }
  assert.ok(avoided>0,'scenario actually reaches roadworks');
});

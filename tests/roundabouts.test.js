import test from 'node:test';
import assert from 'node:assert/strict';
import { roundaboutAt, roadOpen, spawnRoadOpen, relocateToRoad } from '../src/city/roadLayout.js';
import { canalColumn } from '../src/city/bridgeProfile.js';
import { buildRoundaboutPath, roundaboutPose, ISLAND_RADIUS } from '../src/city/roundabouts.js';
import { updateNetwork, carCoordinates } from '../src/city/trafficNetwork.js';
import { STOP_LINE, TRACKS, vehiclePose } from '../src/city/world.js';
import { TrafficSimulation } from '../src/city/trafficSimulation.js';
import { DEFAULT_SETTINGS } from '../src/city/settings.js';
import { ROUNDABOUT_STOP, ROUNDABOUT_CLEARANCE } from '../src/city/roundaboutDimensions.js';
import { roadHeight } from '../src/city/vehicleSurface.js';
import { populateBlock } from '../src/city/createCity.js';

const center = { x: 120, z: 40 };
const heading = (axis, direction) => axis === 0 ? direction > 0 ? 0 : Math.PI : direction > 0 ? Math.PI/2 : -Math.PI/2;
function fixture() {
  const lanes = new Map();
  for (const axis of [0,1]) for (const direction of [-1,1]) {
    const line = axis === 0 ? 1 : 3;
    lanes.set(`${axis}:${line}:${direction}`, { axis, line, direction, cars: [] });
  }
  return lanes;
}
function vehicle(axis, direction, track, taxi = false, distance = ROUNDABOUT_STOP + 0.8) {
  return { axis, direction, line: axis === 0 ? 1 : 3, track, fromTrack: track, offset: TRACKS[track],
    position: (axis === 0 ? center.x : center.z) - direction * distance,
    taxi, speed: taxi ? 4 : 3, cruise: taxi ? 14 : 7, baseCruise: taxi ? 14 : 7, acceleration: taxi ? 25 : 4,
    changing:false, merge:1, cooldown:5, steer:0, turnCooldown:100, flashCooldown:Infinity };
}
const pose = car => { const p = carCoordinates(car,40); return car.turn ? p : vehiclePose(p.x,p.z,car.axis,car.direction,car.steer); };

test('expanded junction corners contain no pavement slabs, buildings or trees', () => {
  for (const block of [24,40,48]) for (const [cx,cz] of [[3,1],[-3,-5]]) {
    if (!roundaboutAt(cx,cz)) continue;
    for (let gx=cx-2;gx<=cx;gx++) for (let gz=cz-2;gz<=cz;gz++) {
      populateBlock({add(kind,x,y,z,w,h,d,color,rotation=0) {
        if (kind==='paint'||kind==='island') return;
        const scale=kind==='crown'?1:.5;
        const hw=(Math.abs(Math.cos(rotation))*w+Math.abs(Math.sin(rotation))*d)*scale;
        const hd=(Math.abs(Math.sin(rotation))*w+Math.abs(Math.cos(rotation))*d)*scale;
        assert.ok(Math.abs(x-cx*block)-hw>=ROUNDABOUT_CLEARANCE-1e-7 || Math.abs(z-cz*block)-hd>=ROUNDABOUT_CLEARANCE-1e-7,
          JSON.stringify({block,gx,gz,kind,x,z,w,d}));
      }},gx,gz,gx*block,gz*block,block);
    }
  }
});

// Separating-axis test on actual car rectangles, including their corner swing.
function overlaps(a,b) {
  const corners = p => [-.46,.46].flatMap(side => [-1.125,1.125].map(end => ({
    x:p.x+side*Math.cos(p.angle)+end*Math.sin(p.angle), z:p.z-side*Math.sin(p.angle)+end*Math.cos(p.angle) })));
  const ac=corners(a),bc=corners(b);
  for(const p of [a,b])for(const angle of [p.angle,p.angle+Math.PI/2]) {
    const project = c=>c.x*Math.cos(angle)-c.z*Math.sin(angle), av=ac.map(project),bv=bc.map(project);
    if(Math.max(...av)<=Math.min(...bv) || Math.max(...bv)<=Math.min(...av))return false;
  }
  return true;
}

test('rare four-arm rings exclude banks, bridges, and removed roads; recycling stays outside', () => {
  let count=0;
  for(let x=-18;x<=18;x++)for(let z=-18;z<=18;z++)if(roundaboutAt(x,z)) {
    count++;
    assert.ok(!canalColumn(x)&&!canalColumn(x-1));
    assert.ok(roadOpen(0,z,x-1)&&roadOpen(0,z,x)&&roadOpen(1,x,z-1)&&roadOpen(1,x,z));
    for(const axis of [0,1])for(const direction of [-1,1]) {
      const car={axis,direction,line:axis===0?z:x,track:0,position:(axis===0?x:z)*40};
      assert.equal(spawnRoadOpen(car,40,STOP_LINE),false);
      relocateToRoad(car,40,STOP_LINE);
      assert.ok(spawnRoadOpen(car,40,STOP_LINE));
    }
  }
  assert.ok(count>5&&count<40); assert.ok(roundaboutAt(3,1));
});

test('all entries, tracks and exits have continuous paths that clear the island and pavement', () => {
  for(const axis of [0,1])for(const direction of [-1,1])for(const track of [0,1])for(const side of [-1,0,1]) {
    const car=vehicle(axis,direction,track), incoming=heading(axis,direction), outgoing=incoming+side*Math.PI/2;
    const targetAxis=side?1-axis:axis, targetDirection=side ? direction*side*(axis===0?1:-1):direction;
    const targetTrack=side<0?0:track;
    const end={x:center.x+Math.cos(outgoing)*(ROUNDABOUT_STOP+1)-Math.sin(outgoing)*TRACKS[targetTrack],
      z:center.z+Math.sin(outgoing)*(ROUNDABOUT_STOP+1)+Math.cos(outgoing)*TRACKS[targetTrack]};
    const turn=buildRoundaboutPath(car,{axis:targetAxis,direction:targetDirection,centerX:center.x,centerZ:center.z},carCoordinates(car,40),end);
    let previous=roundaboutPose(turn,0);
    for(let d=0;d<=turn.length;d+=.04) {
      const p=roundaboutPose(turn,d);
      assert.ok(Math.hypot(p.x-center.x,p.z-center.z)>ISLAND_RADIUS+0.65);
      for(const end of [-1.125,1.125])for(const side of [-.46,.46]) {
        const x=p.x-center.x+side*Math.cos(p.angle)+end*Math.sin(p.angle),z=p.z-center.z-side*Math.sin(p.angle)+end*Math.cos(p.angle);
        assert.ok(Math.hypot(x,z)>ISLAND_RADIUS+.1,'body clears island');
        assert.equal(roadHeight(center.x+x,center.z+z,40,3.85),0,'body stays on expanded asphalt');
      }
      const difference=Math.atan2(Math.sin(p.angle-previous.angle),Math.cos(p.angle-previous.angle));
      assert.ok(Math.abs(difference)<.13,`heading jump ${difference}`); previous=p;
    }
    const last=roundaboutPose(turn,turn.length);
    assert.ok(Math.hypot(last.x-end.x,last.z-end.z)<1e-8);
  }
});

test('cars pass the circle on either light phase; concurrent approaches do not overlap or deadlock', () => {
  for(const time of [0,12]) {
    const lanes=fixture(),cars=[];
    for(const axis of [0,1])for(const direction of [-1,1])for(const track of [0,1]) {
      const car=vehicle(axis,direction,track,track===1);cars.push(car);lanes.get(`${axis}:${car.line}:${direction}`).cars.push(car);
    }
    let simultaneous=false;
    for(let step=0;step<900;step++) {
      updateNetwork(lanes,1/30,time,{blockSize:40,roadLayout:true});
      simultaneous ||= cars.filter(c=>c.turn?.kind==='roundabout').length>1;
      for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++) {
        assert.ok(!overlaps(pose(cars[i]),pose(cars[j])),`overlap at ${step}, cars ${i}/${j}`);
      }
      if(cars.every(c=>c.roundaboutsCompleted))break;
    }
    assert.ok(cars.every(c=>c.roundaboutsCompleted),'all approaches eventually get a gap');
    assert.ok(simultaneous,'ring admits more than one car when their paths are clear');
  }
});

for (const profile of [{blockSize:40,density:70,weaving:100}, {blockSize:24,density:150,taxiShare:30,weaving:200,trafficSpeed:180,taxiSpeed:180},
  {blockSize:48,density:100,weaving:200,trafficSpeed:50,taxiSpeed:50}])
test(`moving simulation clears islands and circulating traffic (${profile.blockSize} blocks, ${profile.trafficSpeed??130}% speed)`, () => {
  const block=profile.blockSize;
  const simulation=new TrafficSimulation({settings:{...DEFAULT_SETTINGS,...profile},
    area:{x:2,z:2,extents:{x:block,z:block}},focus:{x:block*3-10,z:block},simulationHz:30});
  let completed=0;
  for(let step=0;step<450;step++) {
    simulation.advance();
    const nearby=[];
    for(const lane of simulation.lanes.values())for(const car of lane.cars) {
      completed=Math.max(completed,car.roundaboutsCompleted??0);
      const at=carCoordinates(car,block),p=car.turn?at:vehiclePose(at.x,at.z,car.axis,car.direction,car.steer),x=Math.round(p.x/block),z=Math.round(p.z/block);
      if(!roundaboutAt(x,z)||Math.hypot(p.x-x*block,p.z-z*block)>ROUNDABOUT_STOP+2)continue;
      assert.ok(Math.hypot(p.x-x*block,p.z-z*block)>ISLAND_RADIUS+.65,`island at step ${step}`);
      nearby.push({car,p});
    }
    for(let i=0;i<nearby.length;i++)for(let j=i+1;j<nearby.length;j++) {
      if(!nearby[i].car.turn&&!nearby[j].car.turn)continue;
      assert.ok(!overlaps(nearby[i].p,nearby[j].p),`traffic overlap at ${step}: ${JSON.stringify([nearby[i],nearby[j]].map(({car,p})=>({p,axis:car.axis,position:car.position,track:car.track,turn:car.turn?.kind})))}`);
    }
  }
  assert.ok(completed>0);
});

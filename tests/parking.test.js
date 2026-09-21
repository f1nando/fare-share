import test from 'node:test';
import assert from 'node:assert/strict';
import { parkingAt, parkingLayout, populateParking, reservedParkingAt, parkingPoint, parkingPosition, parkingLotForLane } from '../src/city/parkingLayout.js';
import { updateNetwork, carCoordinates } from '../src/city/trafficNetwork.js';
import { presentation } from '../src/city/vehiclePresentation.js';
import { populateLane } from '../src/city/trafficPopulation.js';
import { DEFAULT_SETTINGS } from '../src/city/settings.js';
import { seedParking, updateParking } from '../src/city/parkingTraffic.js';
import { TrafficSimulation } from '../src/city/trafficSimulation.js';
import { occupiesTrack, resetSignal } from '../src/city/world.js';
import { vehicleType } from '../src/city/vehicleTypes.js';
import { boulevardRoad } from '../src/city/roadProfile.js';
import { boulevardSceneryBatch } from '../src/city/boulevardGeometry.js';
import { diagonalAt, approachAtRing } from '../src/city/diagonalLayout.js';
import { canalColumn } from '../src/city/bridgeProfile.js';
import { roadOpen, roadworkAt, roundaboutAt } from '../src/city/roadLayout.js';

const carAt=(lot,position=parkingPosition(lot,lot.entry+2))=>({axis:lot.axis,line:lot.line,direction:lot.direction,position,track:lot.track,fromTrack:lot.track,offset:lot.bottom-lot.street,
  taxi:false,color:'#ffffff',speed:4,cruise:6,baseCruise:6,acceleration:4,baseAcceleration:4,cooldown:0,merge:1,steer:0});
const network=cars=>new Map([[`${cars[0].axis}:${cars[0].line}:${cars[0].direction}`,{axis:cars[0].axis,line:cars[0].line,direction:cars[0].direction,cars}]]);

function overlaps(a,b,hx=.46,hz=1.125,ax=.46,az=1.125) {
  const corners=(p,w,d)=>[-w,w].flatMap(x=>[-d,d].map(z=>({x:p.x+x*Math.cos(p.angle)+z*Math.sin(p.angle),z:p.z-x*Math.sin(p.angle)+z*Math.cos(p.angle)})));
  const ac=corners(a,ax,az),bc=corners(b,hx,hz);
  for(const p of [a,b])for(const angle of [p.angle,p.angle+Math.PI/2]) {
    const values=c=>c.map(v=>v.x*Math.cos(angle)-v.z*Math.sin(angle)),av=values(ac),bv=values(bc);
    if(Math.max(...av)<=Math.min(...bv)||Math.max(...bv)<=Math.min(...av))return false;
  }
  return true;
}

test('parking entry, bay, reverse and exit stay on the lowered pavement at all block sizes',()=>{
  for(const block of [24,40,48]) {
    assert.ok(parkingAt(1,0,block));const lot=parkingLayout(1,0,block),car=carAt(lot),lanes=network([car]),parts=[];
    populateParking({add:(...args)=>parts.push(args)},1,0,block,0,block);
    const phases=new Set();
    for(let i=0;i<1600&&!car.parkingExits;i++) {
      updateNetwork(lanes,1/30,i/30,{blockSize:block,roadLayout:true});
      if(!car.parking)continue;
      phases.add(car.parking.phase);
      const p=presentation(car,carCoordinates(car,block));
      for(const [kind,x,y,z,w,h,d] of parts)if(y+h/2>.15)assert.ok(!overlaps(p,{x,z,angle:0},w/2,d/2),JSON.stringify({block,i,phase:car.parking.phase,p,kind,x,z,w,d}));
    }
    assert.equal(car.parksCompleted,1);assert.equal(car.parkingExits,1);
    assert.deepEqual(phases,new Set(['enter','parked','reverse','aisle','waiting','merge']));
    assert.equal(car.track,1);assert.equal(car.parking,null);
  }
});

test('parking reuses population, owns unique bays and releases state on recycling',()=>{
  const lanes=Array.from({length:7},(_,i)=>populateLane(0,i-3,-1,DEFAULT_SETTINGS,3,0,0,true));
  const parked=lanes.flatMap(l=>l.cars).filter(c=>c.parking);
  assert.ok(parked.length>0);
  assert.equal(new Set(parked.map(c=>`${c.parking.lot.key}:${c.parking.slot}`)).size,parked.length);
  for(const car of parked){assert.equal(occupiesTrack(car,1),false);resetSignal(car);assert.equal(car.parking,null);}
});

test('parking exit waits for traffic, then rejoins without adding or losing cars',()=>{
  const lot=parkingLayout(1,0,40),car=carAt(lot),lanes=network([car]);
  for(let i=0;i<1400&&car.parking?.phase!=='waiting';i++)updateNetwork(lanes,1/30,i/30,{blockSize:40,roadLayout:true});
  assert.equal(car.parking?.phase,'waiting');
  const blocker=carAt(lot,lot.exit-1.8);blocker.cruise=blocker.speed=0;lanes.values().next().value.cars.push(blocker);
  for(let i=0;i<90;i++)updateNetwork(lanes,1/30,12,{blockSize:40,roadLayout:true});
  assert.equal(car.parking.phase,'waiting');
  blocker.position-=15;
  for(let i=0;i<150&&!car.parkingExits;i++) {
    updateNetwork(lanes,1/30,12,{blockSize:40,roadLayout:true});
    assert.ok(!overlaps(presentation(car,carCoordinates(car,40)),presentation(blocker,carCoordinates(blocker,40))));
  }
  assert.equal(car.parkingExits,1);assert.equal(lanes.values().next().value.cars.length,2);
});

test('adjacent occupied bays clear reversing cars and multiple arrivals',()=>{
  for(const block of [24,40,48]) {
    const lot=parkingLayout(1,0,block),cars=Array.from({length:5},(_,i)=>carAt(lot,lot.entry+2-i*3.1)),lanes=network(cars);
    seedParking(lanes.values().next().value,block);
    cars[2].position=lot.entry+2;
    cars[3].position=lot.entry+5.3;cars[4].position=lot.entry+8.6;
    const seen=new Set();
    for(let step=0;step<1800;step++) {
      updateNetwork(lanes,1/30,step/30,{blockSize:block,roadLayout:true});
      const lane=lanes.values().next().value;
      lane.cars=lane.cars.filter(c=>c.parking||c.position>lot.left+5.4);
      const live=lane.cars,poses=live.map(c=>presentation(c,carCoordinates(c,block)));
      for(const car of cars)if(car.parking)seen.add(car);
      for(let a=0;a<live.length;a++)for(let b=a+1;b<live.length;b++)if(live[a].parking||live[b].parking)
        assert.ok(!overlaps(poses[a],poses[b]),JSON.stringify({block,step,a,b,phases:[live[a].parking?.phase,live[b].parking?.phase],poses:[poses[a],poses[b]]}));
    }
    assert.ok(seen.size>=2);assert.ok(cars.some(c=>c.parkingExits));
  }
});

test('parking works with live street traffic and keeps the population bounded',()=>{
  const sim=new TrafficSimulation({settings:{...DEFAULT_SETTINGS,cameraSpeed:0},area:{x:3,z:3,extents:{x:45,z:60}},focus:{x:20,z:20},simulationHz:30});
  const initial=sim.snapshot().cars;let entries=0,exits=0;
  for(let i=0;i<900;i++) {
    const frame=sim.advance();assert.equal(frame.cars,initial);
    const cars=[...sim.lanes.values()].flatMap(l=>l.cars),positions=new Map();
    for(const car of cars){entries+=car.parksCompleted??0;exits+=car.parkingExits??0;positions.set(car,presentation(car,carCoordinates(car,40)));}
    for(const car of cars)if(car.parking)for(const other of cars) {
      if(other===car)continue;
      const a=positions.get(car),b=positions.get(other);
      if(Math.hypot(a.x-b.x,a.z-b.z)>3)continue;
      assert.ok(!overlaps(a,b),JSON.stringify({i,phase:car.parking.phase,other:other.parking?.phase,a,b}));
    }
  }
  assert.ok(entries>0);assert.ok(exits>0);
});

function clearBodies(cars,block,context) {
  const poses=cars.map(c=>presentation(c,carCoordinates(c,block)));
  for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++) {
    const a=vehicleType(cars[i]),b=vehicleType(cars[j]);
    assert.ok(!overlaps(poses[i],poses[j],b.width/2,b.length/2,a.width/2,a.length/2),
      JSON.stringify({context,i,j,kinds:[cars[i].kind,cars[j].kind],phases:[cars[i].parking?.phase,cars[j].parking?.phase],poses:[poses[i],poses[j]]}));
  }
}
function waitingLot(lot,count=1) {
  const cars=Array.from({length:count},()=>carAt(lot)),lanes=network(cars),lane=lanes.values().next().value;
  seedParking(lane,lot.block);
  for(let i=0;i<1500&&!cars.some(c=>c.parking?.phase==='waiting');i++)updateParking(lanes,1/30,lot.block);
  assert.ok(cars.some(c=>c.parking?.phase==='waiting'));return {cars,lanes,lane};
}

test('regression: a stopped car twelve units behind the landing does not imprison a parked car',()=>{
  const lot=parkingLayout(1,0,40),{cars,lanes,lane}=waitingLot(lot),car=cars[0];
  const blocker=carAt(lot,parkingPosition(lot,lot.exit-1.8+12));blocker.speed=0;blocker.parking=null;blocker.cruise=6;
  const front=Object.assign(carAt(lot,parkingPosition(lot,lot.exit-1.8-8)),{kind:'bus',speed:0,cruise:6,parking:null});
  lane.cars.push(blocker,front);
  for(let i=0;i<180&&!car.parkingExits;i++) {
    updateParking(lanes,1/30,40);clearBodies(lane.cars,40,i);
  }
  assert.equal(car.parkingExits,1);assert.equal(blocker.speed,0);
});

test('yielding opens a slot in dense moving traffic and every waiting bay progresses',()=>{
  for(const kind of ['car','truck','bus']) {
    const lot=parkingLayout(29,0,40),{cars,lanes,lane}=waitingLot(lot,2),parked=[...cars];
    const end=parkingPosition(lot,lot.exit-1.8);
    for(let i=0;i<9;i++) {
      const c=carAt(lot,end-5+i*7);Object.assign(c,{kind,speed:6,cruise:6,lastParkingLot:lot.key});lane.cars.push(c);
    }
    let yielded=false;
    for(let step=0;step<1200&&!parked.every(c=>c.parkingExits);step++) {
      updateNetwork(lanes,1/30,2,{blockSize:40,roadLayout:true});
      yielded ||= lane.cars.some(c=>Number.isFinite(c.parkingClearance));
      clearBodies(lane.cars,40,{kind,step});
      lane.cars=lane.cars.filter(c=>c.parking||c.position>end-8);
      // Sustain a moving queue throughout the manoeuvres, without adding parked cars.
      const tail=Math.max(...lane.cars.filter(c=>!c.parking).map(c=>c.position));
      if(tail<end+55) {
        const c=carAt(lot,end+62);Object.assign(c,{kind,speed:6,cruise:6,lastParkingLot:lot.key});lane.cars.push(c);
      }
    }
    assert.ok(yielded);assert.ok(parked.every(c=>c.parkingExits),JSON.stringify({kind,parked:parked.map(c=>c.parking?.phase),cars:lane.cars.map(c=>({p:c.position,s:c.speed,pc:c.parkingClearance,phase:c.parking?.phase}))}));
  }
});

test('a stopped mixed queue restarting during a merge respects the reserved swept body',()=>{
  for(const kind of ['car','truck','bus'])for(const restart of [1,12,24]) {
    const lot=parkingLayout(1,0,40),{cars,lanes,lane}=waitingLot(lot),car=cars[0],end=parkingPosition(lot,lot.exit-1.8);
    const queue=[12,17,22].map(n=>Object.assign(carAt(lot,end+n),{kind,speed:0,cruise:0,lastParkingLot:lot.key}));
    lane.cars.push(...queue);
    updateParking(lanes,1/30,40);assert.equal(car.parking.phase,'merge');
    for(let step=0;step<100;step++) {
      if(step===restart)for(const c of queue)c.cruise=8;
      updateNetwork(lanes,1/30,2,{blockSize:40,roadLayout:true});clearBodies(lane.cars,40,{kind,restart,step});
    }
    assert.equal(car.parkingExits,1);
  }
});

test('more lots cover all four frontages while preserving diagonals, rings and water',()=>{
  for(const block of [24,40,48]) {
    let before=0,after=0;const rotations=new Set();
    for(let x=-18;x<=18;x++)for(let z=-18;z<=18;z++) {
      before+=Number(reservedParkingAt(x,z,block));if(!parkingAt(x,z,block))continue;
      after++;const lot=parkingLayout(x,z,block);rotations.add(lot.rotation);
      assert.ok(!diagonalAt(x,z,block)&&!canalColumn(x));
      for(const dx of [0,1])for(const dz of [0,1])assert.ok(!roundaboutAt(x+dx,z+dz));
      assert.ok(roadOpen(lot.axis,lot.line,lot.segment));assert.ok(!roadworkAt(lot.axis,lot.line,lot.segment,block));
      assert.equal(lot.track,boulevardRoad(lot.axis,lot.line)?3:1);
      assert.deepEqual(parkingLotForLane(lot,lot.segment,block),lot);
      const entry=parkingPosition(lot,lot.entry),exit=parkingPosition(lot,lot.exit);
      const nextJunction=(lot.segment+(lot.direction===1?1:0))*block;
      assert.ok((entry-exit)*lot.direction>0,'traffic meets the exit before the entry');
      assert.ok(Math.abs(nextJunction-entry)<Math.abs(nextJunction-exit),'entry is nearer the next traffic light');
    }
    assert.ok(after>before*1.6&&after<before*2.5,JSON.stringify({block,before,after}));assert.equal(rotations.size,4);
    // These established approaches must retain their original endpoints.
    assert.deepEqual(approachAtRing(3,1,block).a,{x:2,z:-2});
  }
});

test('all rotated lots, including avenues and rebased scenery, match their actual driving paths',()=>{
  for(const block of [24,40,48]) {
    const sites=new Map();
    for(let x=-15;x<=15;x++)for(let z=-15;z<=15;z++)if(parkingAt(x,z,block)) {
      const lot=parkingLayout(x,z,block),key=`${lot.rotation}:${lot.track}`;if(!sites.has(key))sites.set(key,lot);
    }
    assert.equal(sites.size,8);
    for(const lot of sites.values()) {
      const car=carAt(lot),lanes=network([car]),parts=[],dx=127,dz=-91;
      const neighbour=carAt(lot);
      seedParking(network([neighbour]).values().next().value,block);
      Object.assign(neighbour.parking,{slot:1,wait:Infinity,
        pose:{...parkingPoint(lot,lot.slots[1],lot.bay),angle:Math.PI-lot.rotation*Math.PI/2}});
      lanes.values().next().value.cars.push(neighbour);
      populateParking(boulevardSceneryBatch({add:(...a)=>parts.push(a)},lot.x,lot.z,lot.left+dx,lot.z*block+dz,block),
        lot.x,lot.z,lot.left+dx,lot.z*block+dz,block);
      let previous=null;
      for(let i=0;i<1600&&!car.parkingExits;i++) {
        updateNetwork(lanes,1/30,lot.axis===0?2:13,{blockSize:block,roadLayout:true});
        clearBodies([car,neighbour],block,{lot:lot.key,i});
        const p=presentation(car,carCoordinates(car,block));
        if(previous) {
          assert.ok(Math.hypot(p.x-previous.x,p.z-previous.z)<.5,'continuous route and lane handoff');
          assert.ok(Math.abs(Math.atan2(Math.sin(p.angle-previous.angle),Math.cos(p.angle-previous.angle)))<.8,'no heading snap at the reversed aisle or lane handoff');
          if(car.parking?.phase==='aisle'&&previous.phase==='aisle') {
            const along=lot.axis===0?p.x-previous.x:p.z-previous.z;
            assert.ok(along*lot.direction<=1e-8,'internal aisle runs back towards the upstream exit');
          }
        }
        previous={...p,phase:car.parking?.phase};
        if(!car.parking)continue;
        for(const[k,x,y,z,w,h,d]of parts)if(y+h/2>.15)
          assert.ok(!overlaps(p,{x:x-dx,z:z-dz,angle:0},w/2,d/2),JSON.stringify({block,lot:lot.key,rotation:lot.rotation,track:lot.track,i,phase:car.parking.phase,k,p,x:x-dx,z:z-dz,w,d}));
      }
      assert.equal(car.parkingExits,1,JSON.stringify({block,lot}));assert.equal(car.track,lot.track);
      const p=parkingPoint(lot,lot.exit-1.8,lot.street);
      assert.ok(Math.abs((lot.axis===0?p.z:p.x)-(lot.line*block+(lot.axis===0?1:-1)*lot.direction*car.offset))<1e-8);
    }
  }
});



test('yield requests disappear when a parking owner is recycled out of the active lane',()=>{
  const lot=parkingLayout(29,0,40),{cars,lanes,lane}=waitingLot(lot),owner=cars[0];
  const end=parkingPosition(lot,lot.exit-1.8);
  const blocker=Object.assign(carAt(lot,end),{kind:'bus',speed:0,cruise:0});
  const follower=Object.assign(carAt(lot,end+15),{kind:'truck',speed:0,cruise:6});
  lane.cars.push(blocker,follower);
  for(let step=0;step<70;step++)updateParking(lanes,1/30,40);
  assert.equal(follower.parkingYield,owner.parking);assert.ok(Number.isFinite(follower.parkingClearance));
  lane.cars=lane.cars.filter(c=>c!==owner);updateParking(lanes,1/30,40);
  assert.equal(follower.parkingYield,undefined);assert.equal(follower.parkingClearance,undefined);
});

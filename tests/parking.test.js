import test from 'node:test';
import assert from 'node:assert/strict';
import { parkingAt, parkingLayout, populateParking } from '../src/city/parkingLayout.js';
import { updateNetwork, carCoordinates } from '../src/city/trafficNetwork.js';
import { presentation } from '../src/city/vehiclePresentation.js';
import { populateLane } from '../src/city/trafficPopulation.js';
import { DEFAULT_SETTINGS } from '../src/city/settings.js';
import { seedParking } from '../src/city/parkingTraffic.js';
import { TrafficSimulation } from '../src/city/trafficSimulation.js';
import { occupiesTrack, resetSignal } from '../src/city/world.js';

const carAt=(lot,position=lot.entry+2)=>({axis:0,line:lot.z+1,direction:-1,position,track:1,fromTrack:1,offset:2.45,
  taxi:false,color:'#ffffff',speed:4,cruise:6,baseCruise:6,acceleration:4,baseAcceleration:4,cooldown:0,merge:1,steer:0});
const network=cars=>new Map([[`0:${cars[0].line}:-1`,{axis:0,line:cars[0].line,direction:-1,cars}]]);

function overlaps(a,b,hx=.46,hz=1.125) {
  const corners=(p,w,d)=>[-w,w].flatMap(x=>[-d,d].map(z=>({x:p.x+x*Math.cos(p.angle)+z*Math.sin(p.angle),z:p.z-x*Math.sin(p.angle)+z*Math.cos(p.angle)})));
  const ac=corners(a,.46,1.125),bc=corners(b,hx,hz);
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

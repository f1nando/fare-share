import { streetHalf, boulevardRoad, laneOffset } from '../src/city/roadProfile.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { roundaboutAt, roadOpen, spawnRoadOpen, relocateToRoad, junctionArms, roundaboutClosedArm } from '../src/city/roadLayout.js';
import { canalColumn } from '../src/city/bridgeProfile.js';
import { buildRoundaboutPath, roundaboutPose, ISLAND_RADIUS } from '../src/city/roundabouts.js';
import { updateNetwork, carCoordinates } from '../src/city/trafficNetwork.js';
import { STOP_LINE, TRACKS, vehiclePose } from '../src/city/world.js';
import { TrafficSimulation } from '../src/city/trafficSimulation.js';
import { DEFAULT_SETTINGS } from '../src/city/settings.js';
import { ROUNDABOUT_STOP, ROUNDABOUT_CLEARANCE, roundaboutCornerEdge, roundaboutRoadInset } from '../src/city/roundaboutDimensions.js';
import { roundaboutCornerGeometry } from '../src/city/roundaboutGeometry.js';
import { roadHeight } from '../src/city/vehicleSurface.js';
import { populateBlock } from '../src/city/createCity.js';
import { VEHICLE_KINDS, vehicleType } from '../src/city/vehicleTypes.js';

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
  return { axis, direction, line: axis === 0 ? 1 : 3, track, fromTrack: track, offset: laneOffset(axis,axis===0?1:3,track),
    position: (axis === 0 ? center.x : center.z) - direction * distance,
    taxi, speed: taxi ? 4 : 3, cruise: taxi ? 14 : 7, baseCruise: taxi ? 14 : 7, acceleration: taxi ? 25 : 4,
    changing:false, merge:1, cooldown:5, steer:0, turnCooldown:100, flashCooldown:Infinity };
}
const pose = car => { const p = carCoordinates(car,40); return car.turn ? p : vehiclePose(p.x,p.z,car.axis,car.direction,car.steer); };

test('curved curb inserts meet the straight pavement and match the wheel surface', () => {
  const edge=roundaboutCornerEdge();
  assert.deepEqual(edge[0],{x:3.85,z:ROUNDABOUT_CLEARANCE});
  assert.deepEqual(edge.at(-1),{x:ROUNDABOUT_CLEARANCE,z:3.85});
  assert.ok(Math.abs(edge[12].x-edge[12].z)<1e-9);
  assert.ok(roundaboutRoadInset(5,5,3.85)<0,'diagonal driving space stays open');
  assert.ok(roundaboutRoadInset(8,8,3.85)>0,'former square corner becomes pavement');
  for(const inset of [0,.21]) {
    const geometry=roundaboutCornerGeometry(inset),positions=geometry.attributes.position;
    for(let i=0;i<positions.count;i++) {
      const x=positions.getX(i),z=positions.getZ(i);
      // Polygon normals approximate the smooth offset to less than 0.001 unit.
      assert.ok(roundaboutRoadInset(x,z,3.85)>=inset-1e-3,'curb does not intrude into asphalt');
      assert.ok(x<=ROUNDABOUT_CLEARANCE+1e-5&&z<=ROUNDABOUT_CLEARANCE+1e-5);
    }
    geometry.dispose();
  }
});

test('expanded junction corners contain no pavement slabs, buildings or trees', () => {
  for (const block of [24,40,48]) for (const [cx,cz] of [[3,1],[-3,-5]]) {
    if (!roundaboutAt(cx,cz)) continue;
    for (let gx=cx-2;gx<=cx;gx++) for (let gz=cz-2;gz<=cz;gz++) {
      populateBlock({add(kind,x,y,z,w,h,d,color,rotation=0) {
        if (['diagonalLot','paint','island','roundaboutCurb','roundaboutWalk','roundaboutCapCurb','roundaboutCapWalk'].includes(kind)) return;
        const scale=kind==='crown'?1:.5;
        const hw=(Math.abs(Math.cos(rotation))*w+Math.abs(Math.sin(rotation))*d)*scale;
        const hd=(Math.abs(Math.sin(rotation))*w+Math.abs(Math.cos(rotation))*d)*scale;
        assert.ok(Math.abs(x-cx*block)-hw>=ROUNDABOUT_CLEARANCE-1e-7 || Math.abs(z-cz*block)-hd>=ROUNDABOUT_CLEARANCE-1e-7,
          JSON.stringify({block,gx,gz,kind,x,z,w,d}));
      }},gx,gz,gx*block,gz*block,block);
    }
  }
});

test('closed-arm curb meshes match the surface and face upwards', () => {
  for(const inset of [0,.21]) {
    const geometry=roundaboutCornerGeometry(inset,true),positions=geometry.attributes.position,normals=geometry.attributes.normal;
    for(let i=0;i<positions.count;i++) {
      const x=positions.getX(i),z=positions.getZ(i);
      assert.ok(roundaboutRoadInset(x,z,3.85,1)>=inset-.002,'cap stays outside driving surface');
      if(positions.getY(i)===.5&&Math.abs(normals.getY(i))>.5)assert.ok(normals.getY(i)>0,'top faces upward');
    }
    geometry.dispose();
  }
});

// Separating-axis test on actual car rectangles, including their corner swing.
function overlaps(a,b, typeA = vehicleType(), typeB = vehicleType()) {
  const corners = (p, type) => [-type.width/2,type.width/2].flatMap(side => [-type.length/2,type.length/2].map(end => ({
    x:p.x+side*Math.cos(p.angle)+end*Math.sin(p.angle), z:p.z-side*Math.sin(p.angle)+end*Math.cos(p.angle) })));
  const ac=corners(a,typeA),bc=corners(b,typeB);
  for(const p of [a,b])for(const angle of [p.angle,p.angle+Math.PI/2]) {
    const project = c=>c.x*Math.cos(angle)-c.z*Math.sin(angle), av=ac.map(project),bv=bc.map(project);
    if(Math.max(...av)<=Math.min(...bv) || Math.max(...bv)<=Math.min(...av))return false;
  }
  return true;
}

test('rare three/four-arm rings exclude banks and bridges; recycling stays on open roads', () => {
  let count=0,tCount=0;
  for(let x=-18;x<=18;x++)for(let z=-18;z<=18;z++)if(roundaboutAt(x,z)) {
    count++;
    assert.ok(!canalColumn(x)&&!canalColumn(x-1));
    const arms=junctionArms(x,z);assert.ok(arms.filter(Boolean).length>=3);if(arms.includes(false))tCount++;
    for(const axis of [0,1])for(const direction of [-1,1]) {
      const car={axis,direction,line:axis===0?z:x,track:0,position:(axis===0?x:z)*40};
      assert.equal(spawnRoadOpen(car,40,STOP_LINE),false);
      relocateToRoad(car,40,STOP_LINE);
      assert.ok(spawnRoadOpen(car,40,STOP_LINE));
    }
  }
  assert.ok(count>5&&count<50&&tCount>0); assert.ok(roundaboutAt(3,1));
});

test('all entries, tracks and exits have continuous paths that clear the island and pavement', () => {
  for(const axis of [0,1])for(const direction of [-1,1])for(const track of [0,1])for(const side of [-1,0,1]) {
    const car=vehicle(axis,direction,track), incoming=heading(axis,direction), outgoing=incoming+side*Math.PI/2;
    const targetAxis=side?1-axis:axis, targetDirection=side ? direction*side*(axis===0?1:-1):direction;
    const targetTrack=side<0?0:track;
    const offset=laneOffset(targetAxis,targetAxis===0?1:3,targetTrack);
    const end={x:center.x+Math.cos(outgoing)*(ROUNDABOUT_STOP+1)-Math.sin(outgoing)*offset,
      z:center.z+Math.sin(outgoing)*(ROUNDABOUT_STOP+1)+Math.cos(outgoing)*offset};
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

test('an empty roundabout accepts a moving car before forced yield-line braking', () => {
  const lanes=fixture(),car=vehicle(0,1,0,false,ROUNDABOUT_STOP+5);
  car.speed=car.cruise=8; lanes.get('0:1:1').cars.push(car);
  let minimum=car.speed;
  for(let i=0;i<120&&!car.turn;i++) {
    updateNetwork(lanes,1/30,12,{blockSize:40,roadLayout:true});minimum=Math.min(minimum,car.speed);
  }
  assert.equal(car.turn?.kind,'roundabout');assert.ok(minimum>=7.9,'no mandatory near-stop at an empty entry');
});

test('dense queues share moving exits and clear without source-slot ghosts', () => {
  const lanes=new Map(),cars=[];
  // This ring has no roadworks on its approaches; outgoing traffic leaves
  // the fixture only once its body has cleared the exit.
  for(const axis of [0,1])for(const direction of [-1,1]) {
    const line=axis?3:7,lane={axis,line,direction,cars:[]};lanes.set(`${axis}:${line}:${direction}`,lane);
    for(const track of [0,1])for(let i=0;i<5;i++) {
      const car=vehicle(axis,direction,track);
      Object.assign(car,{line,position:(axis?280:120)-direction*(9.5+i*3.2),speed:0,cooldown:100});
      lane.cars.push(car);cars.push(car);
    }
  }
  let departed=0,at15=0,maxActive=0;
  for(let step=0;step<900&&departed<cars.length;step++) {
    updateNetwork(lanes,1/30,12,{blockSize:40,roadLayout:true});
    const live=[...lanes.values()].flatMap(l=>l.cars),poses=live.map(pose);
    maxActive=Math.max(maxActive,live.filter(c=>c.turn).length);
    for(let a=0;a<live.length;a++)for(let b=a+1;b<live.length;b++)assert.ok(!overlaps(poses[a],poses[b]),`queue overlap at ${step}: ${a}/${b} ${JSON.stringify([live[a],live[b]].map(c=>({axis:c.axis,line:c.line,p:c.position,speed:c.speed,track:c.track,turn:c.turn?.kind,phase:c.turn?.phase,xy:pose(c)})))}`);
    for(const lane of lanes.values())lane.cars=lane.cars.filter(c=>{
      if(c.roundaboutsCompleted&&Math.abs(c.position-(c.axis?280:120))>14){departed++;return false;}
      return true;
    });
    if(step===449)at15=departed;
  }
  assert.ok(at15>=24,`${at15}/40 clear in 15 seconds`);
  assert.equal(departed,40,'all queues drain within 30 seconds');
  assert.ok(maxActive>=6,'several cars share the ring');
});

test('mixed vehicle queues enter an empty ring and all leave without body collisions', () => {
  const lanes = new Map(), cars = [];
  for (const axis of [0,1]) for (const direction of [-1,1]) {
    const line = axis ? 3 : 7, lane = { axis, line, direction, cars: [] };
    lanes.set(`${axis}:${line}:${direction}`, lane);
    for (const track of [0,1]) for (let i = 0; i < 4; i++) {
      const car = vehicle(axis,direction,track);
      Object.assign(car, { kind: VEHICLE_KINDS[(i + track) % 4], line,
        position: (axis ? 280 : 120) - direction * (12 + i * 4.6), speed: 0, cooldown: 100 });
      lane.cars.push(car); cars.push(car);
    }
  }
  let departed = 0;
  for (let step = 0; step < 1800 && departed < cars.length; step++) {
    updateNetwork(lanes,1/30,step/30,{blockSize:40,roadLayout:true});
    const live = [...lanes.values()].flatMap(lane => lane.cars), poses = live.map(pose);
    for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
      assert.ok(!overlaps(poses[a],poses[b],vehicleType(live[a]),vehicleType(live[b])),
        `mixed body collision at ${step}: ${live[a].kind}/${live[b].kind}`);
    }
    for (const lane of lanes.values()) lane.cars = lane.cars.filter(car => {
      if (car.roundaboutsCompleted && Math.abs(car.position - (car.axis ? 280 : 120)) > 16) { departed++; return false; }
      return true;
    });
  }
  assert.equal(departed,cars.length,'every mixed-traffic approach must drain within 60 seconds');
});

test('a stopped exit queue cannot be hit by following circulating cars', () => {
  const lanes=new Map();
  for(const axis of [0,1])for(const direction of [-1,1]) {
    const line=axis?3:7;lanes.set(`${axis}:${line}:${direction}`,{axis,line,direction,cars:[]});
  }
  const cars=[vehicle(0,1,1),vehicle(0,1,1),vehicle(0,1,1)];
  cars.forEach((car,i)=>Object.assign(car,{line:7,position:i===2?134.9:110.5-i*3.2,speed:0,cruise:i===2?0:7,cooldown:100}));
  lanes.get('0:7:1').cars.push(...cars);
  for(let step=0;step<450;step++) {
    updateNetwork(lanes,1/30,12,{blockSize:40,roadLayout:true});
    for(let a=0;a<cars.length;a++)for(let b=a+1;b<cars.length;b++)assert.ok(!overlaps(pose(cars[a]),pose(cars[b])),`blocked exit overlap at ${step}: ${a}/${b}`);
  }
});

test('T rings close their missing arm visually and route all traffic through existing exits', () => {
  for(const block of [24,40,48])for(const [cx,cz] of [[-6,1],[9,10]]) {
    const arms=junctionArms(cx,cz),closed=roundaboutClosedArm(cx,cz),lanes=new Map(),cars=[];
    assert.ok(roundaboutAt(cx,cz)&&closed>=0);
    const geometry=[];populateBlock({add:(...p)=>geometry.push(p)},cx,cz,0,0,block);
    if(streetHalf(1-closed%2,closed%2===0?cx:cz)>3.85)assert.ok(geometry.some(p=>p[0]==='diagonalLot'));
    else assert.equal(geometry.filter(p=>p[0]==='roundaboutCapCurb').length,1);
    if(!boulevardRoad(0,cz)&&!boulevardRoad(1,cx))assert.equal(geometry.filter(p=>p[0]==='roundaboutCurb').length,2);
    for(const axis of [0,1])for(const direction of [-1,1]) {
      const line=axis===0?cz:cx,lane={axis,line,direction,cars:[]};lanes.set(`${axis}:${line}:${direction}`,lane);
      const arm=axis===0?(direction>0?2:0):(direction>0?3:1);
      if(!arms[arm])continue;
      for(const track of [0,1]) {
        const car=vehicle(axis,direction,track,track===1);
        Object.assign(car,{line,position:(axis===0?cx:cz)*block-direction*(ROUNDABOUT_STOP+3),speed:6});
        lane.cars.push(car);cars.push(car);
      }
    }
    for(let i=0;i<900&&!cars.every(c=>c.roundaboutsCompleted);i++) {
      updateNetwork(lanes,1/30,12,{blockSize:block,roadLayout:true});
      const poses=cars.map(car=>{
        const at=carCoordinates(car,block),p=car.turn?at:vehiclePose(at.x,at.z,car.axis,car.direction,car.steer);
        if(car.turn?.kind==='roundabout') {
          assert.ok(roadOpen(car.turn.axis,car.turn.line,Math.floor(car.turn.position/block)));
          for(const side of [-.46,.46])for(const end of [-1.125,1.125]) {
            const x=p.x+side*Math.cos(p.angle)+end*Math.sin(p.angle),z=p.z-side*Math.sin(p.angle)+end*Math.cos(p.angle);
            assert.equal(roadHeight(x,z,block,3.85),0,JSON.stringify({message:'T-ring body clears the closed-arm curb',block,cx,cz,i,x:x-cx*block,z:z-cz*block,closed}));
          }
        }
        return p;
      });
      for(let a=0;a<cars.length;a++)for(let b=a+1;b<cars.length;b++)assert.ok(!overlaps(poses[a],poses[b]),
        JSON.stringify({block,cx,cz,i,a,b,cars:[a,b].map(k=>({p:poses[k],axis:cars[k].axis,track:cars[k].track,turn:cars[k].turn?.kind,position:cars[k].position}))}));
    }
    assert.ok(cars.every(c=>c.roundaboutsCompleted),'all T approaches exit instead of waiting for a missing road');
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

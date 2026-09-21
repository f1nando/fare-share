import { boulevardRoad, THIRD_TRACK, junctionStop, laneOffset } from '../src/city/roadProfile.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { approachAtRing, diagonalAt, diagonalFromJunction, diagonalRoadDistance, DIAGONAL_HALF } from '../src/city/diagonalLayout.js';
import { diagonalTarget, buildDiagonalPath, beginInboundRing, beginOutboundRoad } from '../src/city/diagonalTraffic.js';
import { approachLots, populateDiagonal } from '../src/city/diagonalGeometry.js';
import { junctionArms, parkAt, roundaboutAt } from '../src/city/roadLayout.js';
import { parkingAt } from '../src/city/parkingLayout.js';
import { canalColumn } from '../src/city/bridgeProfile.js';
import { carCoordinates, turnPose, updateNetwork } from '../src/city/trafficNetwork.js';
import { roadHeight } from '../src/city/vehicleSurface.js';
import { TRACKS, STOP_LINE, PAVED_ROAD, vehiclePose } from '../src/city/world.js';
import { scenarioSettings } from '../src/city/benchmarkScenario.js';
import { vehicleType, extraHalfLength } from '../src/city/vehicleTypes.js';
import { ROUNDABOUT_STOP } from '../src/city/roundaboutDimensions.js';
import { TrafficSimulation } from '../src/city/trafficSimulation.js';
import { DEFAULT_SETTINGS } from '../src/city/settings.js';
const sites=block=>{const a=[];for(let x=-9;x<=9;x+=6)for(let z=-5;z<=7;z+=6){const r=approachAtRing(x,z,block);if(r)a.push(r);}return a;};
function carAt(r,out,block,taxi=false,axis=out?1-r.axis:r.axis,d=out?1:r.direction){
  const p=out?r.b:r.a,line=axis===0?p.z:p.x,cross=axis===0?p.x:p.z;
  let cruise=taxi?13:6;while(Math.abs(Math.round(cruise*100)+cross*7+line*11)%5>=4)cruise+=.01;
  const track=boulevardRoad(axis,line)?THIRD_TRACK:1;
  return {axis,line,direction:d,position:cross*block-d*(out?ROUNDABOUT_STOP:junctionStop(p.x,p.z)),track,
    fromTrack:track,offset:laneOffset(axis,line,track),taxi,speed:3,cruise,baseCruise:cruise,acceleration:taxi?24:4,
    cooldown:10,turnCooldown:0,changing:false,merge:1,steer:0,flashCooldown:Infinity};
}
function lanesAt(r){const m=new Map();for(const axis of[0,1])for(let line=Math.min(r.a.x,r.a.z,r.b.x,r.b.z)-2;line<=Math.max(r.a.x,r.a.z,r.b.x,r.b.z)+2;line++)
  for(const d of[-1,1])m.set(`${axis}:${line}:${d}`,{axis,line,direction:d,cars:[]});return m;}
const key=c=>`${c.axis}:${c.line}:${c.direction}`;

test('a bus clears a linked grid junction after entering the diagonal crossing just before red',()=>{
  const block=40,r=approachAtRing(3,1,block),gate=r.crossings[1];
  for(const occupied of[false,true])for(const speed of[2,8]){
    const lanes=lanesAt(r),bus={axis:0,line:0,direction:1,track:THIRD_TRACK,fromTrack:THIRD_TRACK,
      offset:laneOffset(0,0,THIRD_TRACK),kind:'bus',speed,cruise:8,baseCruise:8,acceleration:4,
      taxi:false,cooldown:100,turnCooldown:100,changing:false,merge:1,steer:0};
    const gateCentre=gate.position*block+r.dx/r.dz*laneOffset(0,0,0);
    const stop=gateCentre-DIAGONAL_HALF/Math.abs(r.dz)-2-extraHalfLength(bus);
    bus.position=stop-.07;lanes.get(key(bus)).cars.push(bus);
    if(occupied){
      const blocker={...bus,axis:1,line:3,direction:1,track:0,fromTrack:0,offset:laneOffset(1,3,0),position:-2,speed:0,cruise:0,baseCruise:0,acceleration:0};
      lanes.get(key(blocker)).cars.push(blocker);
    }
    updateNetwork(lanes,1/30,7.7,{blockSize:block,roadLayout:true});
    assert.equal(bus.crossing,occupied?undefined:120,'reserve the downstream junction before entering the diagonal');
    for(let i=1;i<140;i++)updateNetwork(lanes,1/30,7.7+i/30,{blockSize:block,roadLayout:true});
    if(occupied)assert.ok(bus.position<=stop+.001,'wait before the diagonal when the grid junction is occupied');
    else assert.ok(bus.position>124,'a red grid signal must not stop the bus across the diagonal');
  }
});

test('changing lanes at a red diagonal approach cannot move the stop line behind the vehicle',()=>{
  const block=40,r=approachAtRing(3,1,block),gate=r.crossings[1],lanes=lanesAt(r);
  const stop=gate.position*block+r.dx/r.dz*laneOffset(0,0,0)-DIAGONAL_HALF/Math.abs(r.dz)-2;
  const car={axis:0,line:0,direction:1,track:1,fromTrack:THIRD_TRACK,offset:laneOffset(0,0,THIRD_TRACK),
    kind:'motorcycle',position:stop-.05,speed:1.1,mergeSpeed:1.1,cruise:8,baseCruise:8,acceleration:4,
    taxi:false,cooldown:100,turnCooldown:100,changing:true,merge:0,steer:0};
  lanes.get(key(car)).cars.push(car);
  for(let i=0;i<100;i++){
    updateNetwork(lanes,1/30,9,{blockSize:block,roadLayout:true});
    assert.ok(car.position<=stop+.001,'lane changes keep the same upstream stop boundary');
  }
  assert.equal(car.changing,false);assert.equal(car.speed,0);assert.equal(car.crossing,undefined);
});

test('three-block fifth arms end at rings and preserve water, parks and parking',()=>{
  for(const block of[24,40,48])for(const r of sites(block)){
    assert.equal(r.tiles.length,3);assert.equal(r.crossings.length,2);assert.ok(roundaboutAt(r.b.x,r.b.z));
    assert.deepEqual(junctionArms(r.b.x,r.b.z),[true,true,true,true]);
    for(const p of[r.a,r.b])assert.equal(diagonalFromJunction(p.x,p.z,block).key,r.key);
    for(const p of r.tiles){assert.equal(diagonalAt(p.x,p.z,block).key,r.key);assert.ok(!canalColumn(p.x)&&!parkAt(p.x,p.z)&&!parkingAt(p.x,p.z,block));}
  }
});
test('both route directions and ring joins keep the entire vehicle on asphalt',()=>{
  for(const block of[24,40,48])for(const r of sites(block))for(const out of[false,true])for(const axis of(out?[0,1]:[r.axis]))for(const direction of(out?[-1,1]:[r.direction])){
    const c=carAt(r,out,block,false,axis,direction),cross=Math.round((c.position+c.direction*(out?ROUNDABOUT_STOP:STOP_LINE))/block);
    let t=diagonalTarget(c,cross,block);if(!t)continue;t.block=block;
    buildDiagonalPath(c,t,carCoordinates(c,block),block);const paths=[t];t.distance=t.length;
    if(out){t={...t};beginOutboundRoad(t,block);paths.push(t);}else paths.push(beginInboundRing(c,t,block));
    for(const path of paths)for(let i=0;i<=100;i++){
      path.distance=path.length*i/100;const p=turnPose(path);
      for(const side of[-.52,.52])for(const front of[-1.2,1.2]){
        const x=p.x+side*p.cos+front*p.sin,z=p.z-side*p.sin+front*p.cos;
        assert.ok(roadHeight(x,z,block,PAVED_ROAD/2)<.04,JSON.stringify({block,r:r.key,out,axis,direction,i,x,z}));
      }
    }
  }
});
test('successive polygon lots change width and every building clears the diagonal',()=>{
  for(const block of[24,40,48])for(const r of sites(block)){
    const areas=[];
    for(const tile of r.tiles){
      const lots=approachLots(r,tile.x,tile.z,block);areas.push(lots.map(p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.z-b.x*a.z;},0)/2)));
      const parts=[];populateDiagonal({add:(...v)=>parts.push(v)},r,tile.x*block,tile.z*block,block,tile.x,tile.z);
      for(const[k,x,y,z,w,h,d]of parts)if(k==='building')for(const sx of[-.5,.5])for(const sz of[-.5,.5])
        assert.ok(diagonalRoadDistance(x+sx*w,z+sz*d,block)>DIAGONAL_HALF+.2);
    }
    assert.ok(Math.max(...areas.flat())-Math.min(...areas.flat())>block);
  }
});
test('ordinary cars and taxis complete both directions, including two intermediate crossings',()=>{
  for(const r of[approachAtRing(3,1),approachAtRing(-3,1)])for(const out of[false,true])for(const taxi of[false,true]){
    const c=carAt(r,out,40,taxi),lanes=lanesAt(r);lanes.get(key(c)).cars.push(c);
    for(let i=0;i<2100&&!c.diagonalsCompleted;i++)updateNetwork(lanes,1/30,13+i/30,{blockSize:40,roadLayout:true});
    assert.equal(c.diagonalsCompleted,1,JSON.stringify({r:r.key,out,taxi,phase:c.turn?.phase}));
    assert.equal([...lanes.values()].flatMap(l=>l.cars).filter(o=>o===c).length,1);
  }
});
test('opposing traffic shares the approach and a following queue progresses',()=>{
  const r=approachAtRing(3,1),lanes=lanesAt(r),cars=[carAt(r,false,40),carAt(r,true,40),carAt(r,false,40,true)];
  cars[2].position-=r.direction*8;
  for(const c of cars)lanes.get(key(c)).cars.push(c);
  let simultaneous=false;
  for(let i=0;i<2400&&!cars.every(c=>c.diagonalsCompleted);i++){
    updateNetwork(lanes,1/30,13+i/30,{blockSize:40,roadLayout:true});
    simultaneous ||= cars.some(c=>c.turn?.flow===1)&&cars.some(c=>c.turn?.flow===-1);
  }
  assert.ok(simultaneous);assert.ok(cars.every(c=>c.diagonalsCompleted));
});
test('standard density uses new approaches for cars and taxis without increasing population',t=>{
  const sim=new TrafficSimulation({settings:{...DEFAULT_SETTINGS,cameraSpeed:0},area:{x:3,z:3,extents:{x:70,z:70}},focus:{x:120,z:40},simulationHz:30});
  const entered=new Set(),completed=new Set(),flows=new Set();let taxi=false,ordinary=false;
  for(let i=0;i<2700;i++){
    sim.advance();for(const lane of sim.lanes.values())for(const c of lane.cars){
      assert.ok(Number.isFinite(c.position));
      if(c.turn?.kind==='diagonal'){entered.add(c);flows.add(c.turn.flow);}
      if(c.diagonalsCompleted){completed.add(c);taxi ||= c.taxi;ordinary ||= !c.taxi;}
    }
  }
  assert.ok(entered.size>=10);assert.ok(completed.size>=6,`completed ${completed.size}`);assert.equal(flows.size,2);assert.ok(taxi&&ordinary);
  t.diagnostic(`DEFAULT: ${entered.size} entered, ${completed.size} completed, ${[...completed].filter(c=>c.taxi).length} taxis in 90s`);
});

test('a diagonal queue at the boulevard stop boundary releases cross traffic without body collisions',t=>{
  const sim=new TrafficSimulation({settings:{...scenarioSettings('main'),cameraSpeed:0},area:{x:3,z:3,extents:{x:70,z:70}},focus:{x:120,z:40},simulationHz:30});
  const waits=new Map(),passed=new Set(),entered=new Set(),completed=new Set();let longest=0;
  const overlap=(a,b)=>{
    const dx=b.pose.x-a.pose.x,dz=b.pose.z-a.pose.z;
    for(const[x,z]of[[a.pose.cos,-a.pose.sin],[a.pose.sin,a.pose.cos],[b.pose.cos,-b.pose.sin],[b.pose.sin,b.pose.cos]]){
      const extent=c=>c.type.width/2*Math.abs(x*c.pose.cos-z*c.pose.sin)+c.type.length/2*Math.abs(x*c.pose.sin+z*c.pose.cos);
      if(Math.abs(dx*x+dz*z)>=extent(a)+extent(b))return false;
    }return true;
  };
  for(let i=0;i<2700;i++){
    sim.advance();const local=[];
    for(const lane of sim.lanes.values())for(const car of lane.cars){
      if(car.turn?.kind==='diagonal')entered.add(car);
      if(car.diagonalsCompleted)completed.add(car);
      if(car.parking||car.turn||car.axis!==0||car.line!==0)waits.delete(car);
      if(car.parking)continue;
      if(!car.turn&&car.axis===0&&car.line===0){
        const stopped=car.speed<.01&&car.position>95&&car.position<115;
        const wait=stopped?(waits.get(car)??0)+1:0;waits.set(car,wait);longest=Math.max(longest,wait/30);
        if(wait===0&&car.speed>1&&car.position>104&&car.position<109)passed.add(car.direction);
      }
      const diagonal=car.turn?.kind==='diagonal'&&car.turn.roadId==='3:1'&&!car.turn.ringActive;
      if(!diagonal&&(car.turn||car.axis!==0||car.line!==0))continue;
      const p=carCoordinates(car,40),pose=car.turn?p:vehiclePose(p.x,p.z,car.axis,car.direction,car.steer);
      if(Math.abs(p.x-106.667)>12||Math.abs(p.z)>10)continue;
      local.push({pose,type:vehicleType(car),diagonal});
    }
    for(let a=0;a<local.length;a++)for(let b=a+1;b<local.length;b++)if(local[a].diagonal!==local[b].diagonal)
      assert.ok(!overlap(local[a],local[b]),`crossing bodies overlap at step ${i}`);
  }
  assert.ok(longest<33,`cross traffic stuck ${longest.toFixed(1)}s at the intermediate boulevard crossing`);
  assert.equal(passed.size,2,'both boulevard directions make progress');
  assert.ok(completed.size>=6,`main scenario completed ${completed.size}`);
  assert.ok([...completed].some(c=>c.taxi),'a taxi completes a diagonal route too');
  t.diagnostic(`main: ${entered.size} entered, ${completed.size} completed, ${[...completed].filter(c=>c.taxi).length} taxis; longest crossing wait ${longest.toFixed(1)}s`);
});

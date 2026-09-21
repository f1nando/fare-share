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
import { TRACKS, STOP_LINE, PAVED_ROAD } from '../src/city/world.js';
import { ROUNDABOUT_STOP } from '../src/city/roundaboutDimensions.js';
import { TrafficSimulation } from '../src/city/trafficSimulation.js';
import { DEFAULT_SETTINGS } from '../src/city/settings.js';
const sites=block=>{const a=[];for(let x=-9;x<=9;x+=6)for(let z=-5;z<=7;z+=6){const r=approachAtRing(x,z,block);if(r)a.push(r);}return a;};
function carAt(r,out,block,taxi=false,axis=out?1-r.axis:r.axis,d=out?1:r.direction){
  const p=out?r.b:r.a,line=axis===0?p.z:p.x,cross=axis===0?p.x:p.z;
  let cruise=taxi?13:6;while(Math.abs(Math.round(cruise*100)+cross*7+line*11)%5>=4)cruise+=.01;
  return {axis,line,direction:d,position:cross*block-d*(out?ROUNDABOUT_STOP:STOP_LINE),track:1,
    fromTrack:1,offset:TRACKS[1],taxi,speed:3,cruise,baseCruise:cruise,acceleration:taxi?24:4,
    cooldown:10,turnCooldown:0,changing:false,merge:1,steer:0,flashCooldown:Infinity};
}
function lanesAt(r){const m=new Map();for(const axis of[0,1])for(let line=Math.min(r.a.x,r.a.z,r.b.x,r.b.z)-2;line<=Math.max(r.a.x,r.a.z,r.b.x,r.b.z)+2;line++)
  for(const d of[-1,1])m.set(`${axis}:${line}:${d}`,{axis,line,direction:d,cars:[]});return m;}
const key=c=>`${c.axis}:${c.line}:${c.direction}`;

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
    assert.ok(Math.abs(Math.max(...areas[0])-Math.max(...areas[1]))>block);
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
test('standard density uses new approaches for cars and taxis without increasing population',()=>{
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
});

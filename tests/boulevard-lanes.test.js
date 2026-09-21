import { parkingAt, parkingLayout, parkingPosition } from '../src/city/parkingLayout.js';
import { seedParking } from '../src/city/parkingTraffic.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {THIRD_TRACK,streetTracks,streetHalf,junctionStop,laneOffset,BOULEVARD_LANE_SCALE,laneDividers}from'../src/city/roadProfile.js';
import {populateLane}from'../src/city/trafficPopulation.js';
import {DEFAULT_SETTINGS}from'../src/city/settings.js';
import {TRACKS,SHOULDER_TRACK,STOP_LINE,vehiclePose,updateTraffic,MERGE_DURATION}from'../src/city/world.js';
import {updateNetwork,carCoordinates,makeTurn,turnPose}from'../src/city/trafficNetwork.js';
import {roundaboutStopAt}from'../src/city/roadLayout.js';
import {vehicleType,extraHalfLength}from'../src/city/vehicleTypes.js';
import {roadHeight}from'../src/city/vehicleSurface.js';
import {populateBlock}from'../src/city/createCity.js';
const key=c=>`${c.axis}:${c.line}:${c.direction}`;
const car=(axis,line,direction,track,position,kind='car')=>({axis,line,direction,track,fromTrack:track,position,offset:laneOffset(axis,line,track),kind,taxi:false,
 speed:4,cruise:6,baseCruise:6,acceleration:4,cooldown:100,turnCooldown:100,changing:false,merge:1,steer:0});
function onAsphalt(c,p,block){const type=vehicleType(c);for(const side of[-type.width/2,type.width/2])for(const front of[-type.length/2,type.length/2])
  assert.ok(roadHeight(p.x+side*p.cos+front*p.sin,p.z-side*p.sin+front*p.cos,block,3.85)<.06,JSON.stringify({c:{axis:c.axis,line:c.line,track:c.track,kind:c.kind},p}));}

function overlap(a,b){
  const at=c=>{const p=carCoordinates(c,40);return c.turn?p:vehiclePose(p.x,p.z,c.axis,c.direction,c.steer);};
  const p=at(a),q=at(b),ta=vehicleType(a),tb=vehicleType(b),dx=q.x-p.x,dz=q.z-p.z;
  for(const[x,z]of[[p.cos,-p.sin],[p.sin,p.cos],[q.cos,-q.sin],[q.sin,q.cos]]){
    const radius=(v,t)=>t.width/2*Math.abs(x*v.cos-z*v.sin)+t.length/2*Math.abs(x*v.sin+z*v.cos);
    if(Math.abs(dx*x+dz*z)>=radius(p,ta)+radius(q,tb))return false;
  }return true;
}
test('planted avenues have three normal tracks each way with unchanged total density',()=>{
  assert.notEqual(THIRD_TRACK,SHOULDER_TRACK);
  const taxiTracks=new Set();
  for(const axis of[0,1])for(const d of[-1,1]){
    const line=axis===0?0:3,l=populateLane(axis,line,d,DEFAULT_SETTINGS,4,0,0,true),base=populateLane(axis,line,d,DEFAULT_SETTINGS,4,0,0,false);
    assert.deepEqual([...new Set(l.cars.filter(c=>!c.parking).map(c=>c.track))].sort(),[0,1,3]);
    assert.ok(l.cars.length<=base.cars.length);assert.deepEqual(streetTracks(axis,line+1),[0,1]);
    assert.ok(l.cars.every(c=>c.track!==SHOULDER_TRACK));
    for(const c of l.cars)assert.equal(c.offset,laneOffset(axis,line,c.track));
    const centres=streetTracks(axis,line).map(t=>laneOffset(axis,line,t));
    assert.ok(Math.abs((centres[1]-centres[0])/(TRACKS[1]-TRACKS[0])-BOULEVARD_LANE_SCALE)<1e-10);
    assert.deepEqual(laneDividers(axis,line),[(centres[0]+centres[1])/2,(centres[1]+centres[2])/2]);
    l.cars.filter(c=>c.taxi).forEach(c=>taxiTracks.add(c.track));
  }
  assert.deepEqual([...taxiTracks].sort(),[0,1,3]);
});
test('all three lanes carry moving cars and heavy vehicles through normal crossings',()=>{
  for(const axis of[0,1])for(const d of[-1,1]){
    const line=axis===0?6:3,lanes=new Map(),cars=[0,1,3].map((t,i)=>car(axis,line,d,t,120-d*28,['car','truck','bus'][i]));
    for(const dir of[-1,1])lanes.set(`${axis}:${line}:${dir}`,{axis,line,direction:dir,cars:dir===d?cars:[]});
    for(let i=0;i<180;i++){
      updateNetwork(lanes,1/30,axis===0?2:13,{blockSize:40,roadLayout:true});
      for(const c of cars){const p=carCoordinates(c,40);onAsphalt(c,c.turn?p:vehiclePose(p.x,p.z,axis,d,c.steer),40);}
    }
    assert.ok(cars.every(c=>c.position*d>120*d));assert.deepEqual(cars.map(c=>c.track),[0,1,3]);
  }
});

test('wide-lane changes keep heavy bodies on asphalt and reach the matching lane centre',()=>{
  for(const axis of[0,1])for(const d of[-1,1])for(const[from,to]of[[0,1],[1,0],[1,3],[3,1]])for(const kind of['car','truck','bus']){
    const c=car(axis,axis===0?6:3,d,to,260,kind);
    Object.assign(c,{fromTrack:from,offset:laneOffset(c.axis,c.line,from),changing:true,merge:0,dividedRoad:true});
    for(let i=0;i<60;i++){
      updateTraffic([c],d,MERGE_DURATION/50,true,{blockSize:40});
      const p=carCoordinates(c,40),pose=vehiclePose(p.x,p.z,axis,d,c.steer);onAsphalt(c,pose,40);
      const type=vehicleType(c);
      for(const side of[-type.width/2,type.width/2])for(const front of[-type.length/2,type.length/2]){
        const across=axis===0?pose.z-side*pose.sin+front*pose.cos:pose.x+side*pose.cos+front*pose.sin;
        assert.ok(Math.abs(across-c.line*40)>.17,'whole body clears median');
      }
    }
    assert.equal(c.changing,false);assert.equal(c.offset,laneOffset(c.axis,c.line,to));
  }
});
test('third-lane turns land on an ordinary two-lane street with bodies clear of curbs',()=>{
  for(const block of[24,40,48])for(const d of[-1,1])for(const kind of['car','bus','truck']){
    const c=car(1,3,d,3,2*block-d*junctionStop(3,2),kind),t=makeTurn(c,block,1);
    assert.ok([0,1].includes(t.track));
    for(let i=0;i<=100;i++){t.distance=t.length*i/100;onAsphalt(c,turnPose(t),block);}
  }
});
test('three-lane approaches narrow onto the ring and every mixed queue leaves',()=>{
  const lanes=new Map(),cars=[];
  for(const axis of[0,1])for(const d of[-1,1]){
    const line=axis===0?7:3,l={axis,line,direction:d,cars:[]};lanes.set(`${axis}:${line}:${d}`,l);
    for(const track of streetTracks(axis,line))for(let i=0;i<2;i++){
      const c=car(axis,line,d,track,(axis===0?120:280),i?'bus':'car');c.speed=0;
      c.position-=d*(roundaboutStopAt(3,7)+extraHalfLength(c)+.3+i*4.8);l.cars.push(c);cars.push(c);
    }
  }
  for(let i=0;i<1800&&!cars.every(c=>c.roundaboutsCompleted);i++){
    updateNetwork(lanes,1/30,i/30,{blockSize:40,roadLayout:true});
    for(const c of cars)if(c.turn)onAsphalt(c,turnPose(c.turn),40);
    const live=[...lanes.values()].flatMap(l=>l.cars);
    for(let a=0;a<live.length;a++)for(let b=a+1;b<live.length;b++)assert.ok(!overlap(live[a],live[b]),'three-lane queue bodies must not overlap');
    for(const l of lanes.values())l.cars=l.cars.filter(c=>!c.roundaboutsCompleted||Math.abs(c.position-(c.axis===0?120:280))<18);
  }
  assert.ok(cars.every(c=>c.roundaboutsCompleted),JSON.stringify(cars.filter(c=>!c.roundaboutsCompleted).map(c=>({axis:c.axis,d:c.direction,p:c.position,track:c.track,speed:c.speed,turn:c.turn?.kind}))));assert.ok(cars.filter(c=>c.roundaboutsCompleted).every(c=>c.track===0||c.track===1));
});
test('avenue lots, trees and houses leave room for the third lane',()=>{
  for(const block of[24,40,48])for(const[gx,gz]of[[2,0],[3,0],[4,5]]){
    const parts=[];populateBlock({add:(...p)=>parts.push(p)},gx,gz,gx*block,gz*block,block);
    for(const[k,x,y,z,w,h,d]of parts)if(k==='building'){
      assert.ok(x-w/2>=gx*block+streetHalf(1,gx)-.001);assert.ok(x+w/2<=(gx+1)*block-streetHalf(1,gx+1)+.001);
      assert.ok(z-d/2>=gz*block+streetHalf(0,gz)-.001);assert.ok(z+d/2<=(gz+1)*block-streetHalf(0,gz+1)+.001);
    }
  }
});

test('parking on an avenue exits into the third normal lane',()=>{
  let lot;
  for(let x=-16;x<=16&&!lot;x++)for(const z of[-1,5])if(parkingAt(x,z,40)){
    const candidate=parkingLayout(x,z,40);if(candidate.track===THIRD_TRACK){lot=candidate;break;}
  }
  assert.ok(lot);
  const c=car(lot.axis,lot.line,lot.direction,THIRD_TRACK,parkingPosition(lot,lot.left+20)),lane={axis:lot.axis,line:lot.line,direction:lot.direction,cars:[c]};
  seedParking(lane,40);assert.ok(c.parking);assert.equal(c.parking.lot.track,THIRD_TRACK);
  const lanes=new Map([[key(c),lane]]);
  for(let i=0;i<900&&!c.parkingExits;i++)updateNetwork(lanes,1/30,i/30,{blockSize:40,roadLayout:true});
  assert.equal(c.parkingExits,1);assert.equal(c.track,THIRD_TRACK);assert.equal(c.offset,laneOffset(c.axis,c.line,THIRD_TRACK));
});

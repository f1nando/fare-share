import { THIRD_TRACK, boulevardRoad, streetHalf, junctionStop, laneOffset } from './roadProfile.js';
import { DIAGONAL_LANE, DIAGONAL_HALF, diagonalFromJunction, approachesNear } from './diagonalLayout.js';
import { CAR_GAP, STOP_LINE, occupiesTrack, greenLight, stoppingSpeed } from './world.js';
import { vehicleGap, extraHalfLength } from './vehicleTypes.js';
import { ROUNDABOUT_STOP } from './roundaboutDimensions.js';
import { buildRoundaboutPath, roundaboutPose } from './roundabouts.js';

const laneKey=t=>`${t.axis}:${t.line}:${t.direction}`;
const lanePoint=(t,block)=>t.axis===0?{x:t.position,z:t.line*block+t.direction*laneOffset(t.axis,t.line,t.track)}:
  {x:t.line*block-t.direction*laneOffset(t.axis,t.line,t.track),z:t.position};
const onRoad=(road,d,flow,block)=>({x:road.a.x*block+road.dx*d-road.dz*DIAGONAL_LANE*flow,
  z:road.a.z*block+road.dz*d+road.dx*DIAGONAL_LANE*flow});
export function diagonalTarget(car,cross,block){
  const x=car.axis===0?cross:car.line,z=car.axis===0?car.line:cross;
  const road=diagonalFromJunction(x,z,block);
  if(!road||extraHalfLength(car)>.5||car.track!==(boulevardRoad(car.axis,car.line)?THIRD_TRACK:1))return null;
  const outbound=x===road.b.x&&z===road.b.z;
  if(!outbound&&(car.axis!==road.axis||car.direction!==road.direction))return null;
  // Avoid a full U-turn from the immediately neighbouring parallel entry.
  if(outbound&&car.axis===road.axis&&car.direction===road.direction)return null;
  const flow=outbound?-1:1,axis=road.axis,direction=road.direction*flow,end=outbound?road.a:road.b;
  return {kind:'diagonal',road,flow,phase:outbound?'ringOut':'roadIn',axis,line:axis===0?end.z:end.x,direction,track:1,
    position:(axis===0?end.x:end.z)*block+direction*((outbound?junctionStop(end.x,end.z):ROUNDABOUT_STOP)+1),side:0,
    junction:`${x}:${z}`,exitJunction:`${end.x}:${end.z}`,roadId:road.key,
    centerX:x*block,centerZ:z*block,exitX:end.x*block,exitZ:end.z*block,sourceCleared:false};
}
const cubic=(a,b,c,d,t)=>{const u=1-t;return{x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,
  z:u*u*u*a.z+3*u*u*t*b.z+3*u*t*t*c.z+t*t*t*d.z};};
function sample(turn,points,startAngle,endAngle){
  const samples=[0];
  for(let i=1;i<points.length;i++)samples.push(samples.at(-1)+Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z));
  const angles=points.map((p,i)=>i===0?startAngle:i===points.length-1?endAngle:
    Math.atan2(points[i+1].x-points[i-1].x,points[i+1].z-points[i-1].z));
  Object.assign(turn,{path:points,samples,angles,length:samples.at(-1),distance:0});
}
function curveInto(points,a,b,c,d){for(let i=1;i<=16;i++)points.push(cubic(a,b,c,d,i/16));}
export function buildDiagonalPath(car,turn,start,block){
  const {road,flow}=turn;
  if(turn.phase==='ringOut'){
    const end=onRoad(road,road.length-ROUNDABOUT_STOP,-1,block);
    turn.outgoingHeading=Math.atan2(-road.dz,-road.dx);
    buildRoundaboutPath(car,turn,start,end);turn.kind='diagonal';turn.ringActive=true;
    return turn;
  }
  const a=onRoad(road,10,1,block),end=onRoad(road,road.length-ROUNDABOUT_STOP,1,block);
  const forward={x:car.axis===0?car.direction:0,z:car.axis===1?car.direction:0},points=[start];
  curveInto(points,start,{x:start.x+forward.x*4,z:start.z+forward.z*4},
    {x:a.x-road.dx*3,z:a.z-road.dz*3},a);
  const entryIndex=points.length-1;
  for(let d=12;d<road.length-ROUNDABOUT_STOP;d+=2)points.push(onRoad(road,d,flow,block));
  points.push(end);sample(turn,points,Math.atan2(forward.x,forward.z),Math.atan2(road.dx,road.dz));
  turn.entryLength=turn.samples[entryIndex]+2;
  return turn;
}
export function beginInboundRing(car,turn,block){
  const start=roundaboutPose(turn),r=turn.road;
  const ring={...turn,centerX:r.b.x*block,centerZ:r.b.z*block,junction:r.key,
    incomingHeading:Math.atan2(r.dz,r.dx),outgoingHeading:undefined,phase:'ringIn',sourceCleared:true,ringActive:true};
  buildRoundaboutPath(car,ring,start,lanePoint(ring,block));ring.kind='diagonal';return ring;
}
export function beginOutboundRoad(turn,block){
  const start=roundaboutPose(turn),r=turn.road,points=[start];
  for(let d=r.length-ROUNDABOUT_STOP-2;d>10;d-=2)points.push(onRoad(r,d,-1,block));
  const a=onRoad(r,10,-1,block);points.push(a);
  const exitStartIndex=points.length-1,end=lanePoint(turn,block),dx=turn.axis===0?turn.direction:0,dz=turn.axis===1?turn.direction:0;
  curveInto(points,a,{x:a.x-r.dx*3,z:a.z-r.dz*3},{x:end.x-dx*4,z:end.z-dz*4},end);
  sample(turn,points,Math.atan2(-r.dx,-r.dz),Math.atan2(dx,dz));
  Object.assign(turn,{phase:'roadOut',ringActive:false,sourceCleared:true,exitStart:turn.samples[exitStartIndex],exitGranted:false});
}
export function diagonalLandingClear(car,turn,lanes){
  const lane=lanes.get(laneKey(turn));
  return lane&&lane.cars.every(other=>other===car||!occupiesTrack(other,turn.track)||
    Math.abs(other.position-turn.position)>=vehicleGap(car,other)+1);
}
export function approachProgress(turn){const p=roundaboutPose(turn),r=turn.road;return(p.x-r.a.x*turn.block)*r.dx+(p.z-r.a.z*turn.block)*r.dz;}
const crossingHalf=(road,gate)=> (streetHalf(gate.axis,gate.line)+1.6)/(road.axis===0?Math.abs(road.dx):Math.abs(road.dz));
const normalHalf=road=>DIAGONAL_HALF/(road.axis===0?Math.abs(road.dx):Math.abs(road.dz))+2;
const crossingPosition=(road,gate,car,block)=>gate.position*block+(gate.axis===0?road.dx/road.dz:road.dz/road.dx)*
  (gate.axis===0?car.direction*car.offset:-car.direction*car.offset);
// At the narrow end of a wedge, the next grid stop line can still lie inside
// the diagonal crossing. Reserve that junction before entering the crossing,
// so a signal change cannot strand the rear of a bus across the diagonal.
function linkedJunction(road,gate,car,block){
  const along=crossingPosition(road,gate,car,block),d=car.direction;
  const center=Math.ceil(along*d/block)*block*d;
  const stop=junctionStop(gate.axis===0?center/block:gate.line,gate.axis===0?gate.line:center/block);
  return (center-along)*d-stop<=normalHalf(road)+extraHalfLength(car)*2 ? center : null;
}
function crossingEntryDistance(road,gate,car,block){
  const divided=boulevardRoad(gate.axis,gate.line);
  const inner=laneOffset(gate.axis,gate.line,divided?0:-1),outer=laneOffset(gate.axis,gate.line,divided?THIRD_TRACK:2);
  const slope=gate.axis===0?road.dx/road.dz:-road.dz/road.dx;
  // One stop line across the carriageway: changing lanes while waiting must
  // not slide the angled boundary behind the car and silently admit it.
  return (gate.position*block-car.position)*car.direction+Math.min(slope*inner,slope*outer)-normalHalf(road)-extraHalfLength(car);
}

// Cross traffic and approach traffic share alternating signal phases. Claims
// cover this crossing and an overlapping grid junction, never the whole road;
// the opposite lane and following cars remain independent.
export function prepareApproachCrossings(lanes,active,time,block,crossingAccess,delta=0){
  const roads=new Map();
  for(const car of active)if(car.turn.kind==='diagonal')roads.set(car.turn.roadId,car.turn.road);
  for(const lane of lanes.values())for(const car of lane.cars){
    car.approachClearance=Infinity;
    if(car.turn||car.parking)continue;
    const x=car.axis===0?car.position/block:car.line,z=car.axis===0?car.line:car.position/block;
    for(const r of approachesNear(x,z,block))if(r.crossings.some(c=>c.axis===car.axis&&c.line===car.line))roads.set(r.key,r);
  }
  for(const road of roads.values())for(const gate of road.crossings){
    const crossingCars=active.filter(c=>c.turn.kind==='diagonal'&&c.turn.roadId===road.key&&
      // A car waiting exactly at the entry boundary owns no crossing yet.
      // Projection roundoff must not turn that stopped queue into a claim.
      !c.turn.ringActive&&Math.abs(approachProgress(c.turn)-gate.fraction*road.length)<crossingHalf(road,gate)+extraHalfLength(c)-.001);
    for(const d of [-1,1])for(const car of lanes.get(`${gate.axis}:${gate.line}:${d}`)?.cars??[]){
      if(car.turn||car.parking)continue;
      const along=crossingPosition(road,gate,car,block);
      const until=crossingEntryDistance(road,gate,car,block);
      const landingBlocked=(lanes.get(`${gate.axis}:${gate.line}:${d}`)?.cars??[]).some(other=>other!==car&&!other.turn&&occupiesTrack(other,car.track)&&
        (other.position-car.position)*d>0&&(other.position-car.position)*d<(along-car.position)*d+normalHalf(road)+vehicleGap(car,other));
      if(until<-.001)continue;
      const center=linkedJunction(road,gate,car,block),reserved=center!==null&&car.crossing===center;
      let blocked=!reserved&&(!greenLight(time,gate.axis)||crossingCars.length||landingBlocked);
      if(!blocked&&!reserved&&center!==null&&crossingAccess){
        let clearance=Infinity;
        for(const other of lanes.get(`${gate.axis}:${gate.line}:${d}`)?.cars??[]){
          if(other===car||!occupiesTrack(other,car.track))continue;
          const ahead=(other.position-car.position)*d;
          if(ahead>0)clearance=Math.min(clearance,ahead-vehicleGap(car,other)+CAR_GAP);
        }
        const travel=(center-car.position)*d-(car.junctionStop??STOP_LINE)+.01;
        // Claim a short approach too: this frame's acceleration can carry a
        // car over the boundary even when speed * delta falls just short.
        const commit=until<=Math.max(1,(car.speed+(car.acceleration??4)*2*delta)*delta);
        blocked=!crossingAccess(car,travel,true,clearance,car.speed,commit);
      }
      if(blocked)car.approachClearance=Math.min(car.approachClearance,Math.max(0,until));
    }
  }
}
export function diagonalTravelLimit(car,active,lanes,time,block){
  const t=car.turn,r=t.road,progress=approachProgress(t);
  let limit=t.length-t.distance;
  for(const other of active){
    if(other===car||other.turn?.kind!=='diagonal'||other.turn.roadId!==r.key||other.turn.flow!==t.flow)continue;
    const ahead=(approachProgress(other.turn)-progress)*t.flow;
    if(ahead>0)limit=Math.min(limit,Math.max(0,ahead-vehicleGap(car,other)));
  }
  for(const gate of r.crossings){
    const until=(gate.fraction*r.length-progress)*t.flow-crossingHalf(r,gate)-extraHalfLength(car);
    if(until<-.01)continue;
    let clear=greenLight(time,r.axis)&&limit>=until+crossingHalf(r,gate)*2+vehicleGap(car,car);
    for(const d of [-1,1])for(const other of lanes.get(`${gate.axis}:${gate.line}:${d}`)?.cars??[]){
      if(other.turn||other.parking)continue;
      const along=crossingPosition(r,gate,other,block),center=linkedJunction(r,gate,other,block);
      const reserved=center!==null&&other.crossing===center&&(along-other.position)*d>=-normalHalf(r)-extraHalfLength(other);
      if(reserved||Math.abs(other.position-along)<normalHalf(r)+extraHalfLength(other)-.001)clear=false;
    }
    if(!clear)limit=Math.min(limit,Math.max(0,until));
  }
  if(t.phase==='roadOut'&&!t.exitGranted)limit=Math.min(limit,Math.max(0,t.exitStart-t.distance));
  return limit;
}
export function advanceDiagonal(car,travel,delta){
  const t=car.turn,braking=car.taxi?13:7;
  car.speed=Math.min(car.cruise,car.speed+car.acceleration*delta,stoppingSpeed(travel,braking,delta));
  t.distance=Math.min(t.length,t.distance+Math.min(travel,car.speed*delta));
  // Reach finite stage boundaries without an asymptotic sub-millimetre wait.
  if(t.length-t.distance<.001)t.distance=t.length;
  if(!t.sourceCleared&&t.distance>t.entryLength)t.sourceCleared=true;
}

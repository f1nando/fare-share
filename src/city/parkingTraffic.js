import { parkingAt, parkingLayout } from './parkingLayout.js';
import { CAR_GAP, TRACKS, occupiesTrack } from './world.js';

const point=(x,z)=>({x,z});
const curve=(a,b,c,d,t)=>{
  const u=1-t;
  return {x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,z:u*u*u*a.z+3*u*u*t*b.z+3*u*t*t*c.z+t*t*t*d.z};
};
function path(segments,reverse=false) {
  const points=[segments[0][0]],samples=[0];
  for(const segment of segments)for(let i=1;i<=16;i++) {
    const p=curve(...segment,i/16),previous=points.at(-1);
    samples.push(samples.at(-1)+Math.hypot(p.x-previous.x,p.z-previous.z));points.push(p);
  }
  return {points,samples,length:samples.at(-1),distance:0,reverse};
}
const line=(a,b)=>[a,point(a.x+(b.x-a.x)/3,a.z+(b.z-a.z)/3),point(a.x+(b.x-a.x)*2/3,a.z+(b.z-a.z)*2/3),b];
function poseAt(route) {
  const {points,samples}=route,d=route.distance;
  let lo=1,hi=samples.length-1;
  while(lo<hi){const mid=(lo+hi)>>>1;if(samples[mid]<d)lo=mid+1;else hi=mid;}
  const a=points[lo-1],b=points[lo],t=(d-samples[lo-1])/Math.max(1e-9,samples[lo]-samples[lo-1]);
  const angleAt=i=>{const from=points[Math.max(0,i-1)],to=points[Math.min(points.length-1,i+1)];return Math.atan2(to.x-from.x,to.z-from.z);};
  const angle=angleAt(lo-1),next=angleAt(lo);
  return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,angle:angle+Math.atan2(Math.sin(next-angle),Math.cos(next-angle))*t+(route.reverse?Math.PI:0)};
}
function setRoute(state,phase,route) { state.phase=phase;state.route=route; }
function enterRoute(car,lot,slot) {
  const a=point(car.position,lot.street),b=point(lot.entry,lot.aisle),c=point(lot.slots[slot]+2.2,lot.aisle),d=point(lot.slots[slot],lot.bay);
  return path([[a,point(a.x-1.3,a.z),point(b.x+1.3,b.z),b],line(b,c),[c,point(d.x,lot.aisle),point(d.x,d.z+1.6),d]]);
}
function reverseRoute(lot,slot) {
  const a=point(lot.slots[slot],lot.bay),b=point(a.x+2.2,lot.aisle);
  return path([[a,point(a.x,a.z+2),point(b.x-1.8,b.z),b]],true);
}
function mergeRoute(lot) {
  const a=point(lot.exit,lot.aisle),b=point(lot.exit-1.8,lot.street);
  return path([[a,point(a.x-1.4,a.z),point(b.x+1.4,b.z),b]]);
}
function stateFor(lot,slot,wait) {
  return {lot,slot,phase:'parked',wait,roadOccupancy:false,pose:{x:lot.slots[slot],z:lot.bay,angle:Math.PI}};
}

// Reuse a small part of the street population for initially occupied bays.
export function seedParking(lane,block) {
  if(lane.axis!==0||lane.direction!==-1)return;
  const segments=new Set(lane.cars.map(car=>Math.floor(car.position/block)));
  for(const gx of segments) {
    const gz=lane.line-1;if(!parkingAt(gx,gz,block))continue;
    const lot=parkingLayout(gx,gz,block);
    const candidates=lane.cars.filter(c=>!c.taxi&&(!c.kind||c.kind==='car')&&c.track===1&&!c.parking&&Math.floor(c.position/block)===gx);
    for(let i=0;i<Math.min(2,candidates.length,lot.slots.length);i++) {
      const car=candidates[i],slot=i===0?0:lot.slots.length-1;
      car.position=lot.entry+1.8;car.speed=0;car.parking=stateFor(lot,slot,4+i*5);
    }
  }
}

function exitClear(car,lane,route) {
  const end=route.points.at(-1).x,duration=route.length/4+.4;
  return lane.cars.every(other=>{
    if(other===car||!occupiesTrack(other,1)&&!occupiesTrack(other,2))return true;
    const ahead=end-other.position;
    // Extra room also covers longer vehicles passing the driveway.
    if(ahead>=0)return ahead>CAR_GAP+2;
    const travel=Math.max(other.speed,other.cruise*1.65)*duration;
    return -ahead>travel+CAR_GAP+2;
  });
}

// Only one car manoeuvres in a given lot at a time; parked cars keep their bays.
// No global registry or extra simulated population survives outside the camera.
export function updateParking(lanes,delta,block) {
  for(const lane of lanes.values()) {
    if(lane.axis!==0||lane.direction!==-1)continue;
    const occupied=new Map(),busy=new Set();
    for(const car of lane.cars)if(car.parking) {
      const state=car.parking,key=state.lot.key;
      if(!occupied.has(key))occupied.set(key,new Set());occupied.get(key).add(state.slot);
      if(state.phase!=='parked')busy.add(key);
    }
    for(const car of lane.cars) {
      const state=car.parking;
      if(!state)continue;
      const {lot,slot}=state;
      if(state.phase==='parked') {
        state.wait-=delta;
        if(state.wait<=0&&!busy.has(lot.key)){busy.add(lot.key);setRoute(state,'reverse',reverseRoute(lot,slot));}
      } else if(state.phase==='waiting') {
        const route=state.route;
        if(exitClear(car,lane,route)) {
          state.phase='merge';state.roadOccupancy=true;car.position=route.points.at(-1).x;
        }
      } else {
        const speed=state.phase==='merge'?4:state.phase==='reverse'?2.1:3.2;
        state.route.distance=Math.min(state.route.length,state.route.distance+speed*delta);
        state.pose=poseAt(state.route);car.speed=speed;
        if(state.phase==='enter'&&state.route.distance>=state.route.samples[16])state.roadOccupancy=false;
        if(state.route.distance>=state.route.length) {
          if(state.phase==='enter') {
            state.phase='parked';state.wait=10+(Math.round(car.baseCruise*100)%13);state.route=null;state.pose.angle=Math.PI;car.speed=0;
            car.parksCompleted=(car.parksCompleted??0)+1;
          } else if(state.phase==='reverse') {
            setRoute(state,'aisle',path([line(point(state.pose.x,state.pose.z),point(lot.exit,lot.aisle))]));
          } else if(state.phase==='aisle') {setRoute(state,'waiting',mergeRoute(lot));car.speed=0;}
          else if(state.phase==='merge') {
            car.parking=null;car.lastParkingLot=lot.key;car.parkingExits=(car.parkingExits??0)+1;
            car.track=car.fromTrack=1;car.offset=TRACKS[1];car.steer=0;car.cooldown=2;
          }
        }
      }
    }
    for(const car of lane.cars) {
      if(car.parking||car.taxi||car.kind&&car.kind!=='car'||car.turn||car.changing||car.overtake||car.track!==1)continue;
      const gx=Math.floor(car.position/block),gz=lane.line-1;
      const start=gx*block+block-6.7,distance=car.position-start;
      if(distance<-.25||distance>Math.max(.7,car.speed*delta+.15)||!parkingAt(gx,gz,block))continue;
      const lot=parkingLayout(gx,gz,block);
      if(car.lastParkingLot===lot.key||busy.has(lot.key)||lane.cars.some(other=>other.overtake?.leader===car))continue;
      const used=occupied.get(lot.key)??new Set(),slot=lot.slots.findIndex((_,i)=>!used.has(i));
      if(slot<0)continue;
      const state=stateFor(lot,slot,0);state.roadOccupancy=true;state.pose={x:car.position,z:lot.street,angle:-Math.PI/2};
      setRoute(state,'enter',enterRoute(car,lot,slot));car.parking=state;car.crossing=undefined;car.steer=0;
      used.add(slot);occupied.set(lot.key,used);busy.add(lot.key);
    }
  }
}

import { boulevardRoad, THIRD_TRACK, laneOffset, streetHalf } from './roadProfile.js';
import { parkAt, roadOpen, roadworkAt, roundaboutAt } from './roadLayout.js';
import { canalColumn } from './bridgeProfile.js';
import { diagonalAt } from './diagonalLayout.js';

const mod=(n,d)=>((n%d)+d)%d;
export const PARKING_GATE_INSET=8.5;

// Preserve the established diagonal corridors when adding more parking lots.
// The corridor planner uses only this original reservation, never parkingAt.
export function reservedParkingAt(x,z,block=40) {
  if(((x+z*2)%7+7)%7!==1 || canalColumn(x) || parkAt(x,z) || !roadOpen(0,z+1,x))return false;
  if(roadworkAt(0,z+1,x,block))return false;
  for(const dx of [0,1])for(const dz of [0,1])if(roundaboutAt(x+dx,z+dz))return false;
  return true;
}

function frontage(x,z,rotation) {
  return [
    {axis:0,line:z+1,direction:-1,segment:x},
    {axis:1,line:x,direction:-1,segment:z},
    {axis:0,line:z,direction:1,segment:x},
    {axis:1,line:x+1,direction:1,segment:z},
  ][rotation];
}
function orientation(x,z,block) {
  const first=mod(x+z*3-1,4);
  for(let i=0;i<4;i++) {
    const rotation=(first+i)%4,{axis,line,segment}=frontage(x,z,rotation);
    if(roadOpen(axis,line,segment)&&!roadworkAt(axis,line,segment,block)&&
      !(axis===1&&(canalColumn(line)||canalColumn(line-1))))return rotation;
  }
  return -1;
}
export function parkingAt(x,z,block=40) {
  if(![1,3,4].includes(mod(x+z*2,7))||canalColumn(x)||parkAt(x,z))return false;
  for(const dx of [0,1])for(const dz of [0,1])if(roundaboutAt(x+dx,z+dz))return false;
  return orientation(x,z,block)>=0&&!diagonalAt(x,z,block);
}

// Rotate the same geometry AND paths about the block centre. Canonical
// coordinates describe a south-side lot; street positions remain lane-local.
export function parkingPoint(lot,x,z) {
  const cx=lot.left+lot.block/2,cz=lot.bottom-lot.block/2,dx=x-cx,dz=z-cz;
  const [rx,rz]=[[dx,dz],[-dz,dx],[-dx,-dz],[dz,-dx]][lot.rotation];
  return {x:cx+rx,z:cz+rz};
}
export function parkingPosition(lot,along) {
  const p=parkingPoint(lot,along,lot.street);return lot.axis===0?p.x:p.z;
}
export function parkingLocalPosition(lot,position) {
  return lot.left+lot.block/2-(position-(lot.segment+.5)*lot.block)*lot.direction;
}
export function parkingLotForLane(lane,segment,block) {
  const x=lane.axis===0?segment:lane.line-(lane.direction===1?1:0);
  const z=lane.axis===0?lane.line-(lane.direction===-1?1:0):segment;
  if(!parkingAt(x,z,block))return null;
  const lot=parkingLayout(x,z,block);
  return lot.axis===lane.axis&&lot.line===lane.line&&lot.direction===lane.direction?lot:null;
}

// Street traffic meets the upstream exit first, then the downstream entry.
// Inside the lot the one-way aisle runs back towards the upstream exit.
// All dimensions are shared by scenery and traffic, including small blocks.
export function parkingLayout(x,z,block) {
  const left=x*block,right=left+block,bottom=(z+1)*block;
  const rotation=Math.max(0,orientation(x,z,block)),road=frontage(x,z,rotation),boulevard=boulevardRoad(road.axis,road.line);
  const entry=left+PARKING_GATE_INSET,exit=right-PARKING_GATE_INSET,first=entry+2.2,last=exit-2.2;
  const count=Math.min(10,Math.floor((last-first)/2.4)+1);
  const aisle=bottom-Math.max(6.6,streetHalf(road.axis,road.line)+1.12),track=boulevard?THIRD_TRACK:1;
  return {key:`${x}:${z}`,x,z,block,left,right,bottom,entry,exit,rotation,...road,aisle,bay:aisle-4.2,
    track,street:bottom-laneOffset(road.axis,road.line,track),slots:Array.from({length:count},(_,i)=>first+(last-first)*i/Math.max(1,count-1))};
}

export function populateParking(batch,gx,gz,x,z,block) {
  const lot=parkingLayout(gx,gz,block),dx=x-gx*block,dz=z-gz*block;
  const target=batch;
  batch={add:(kind,px,y,pz,w,h,d,color)=>{
    const p=parkingPoint(lot,px-dx,pz-dz),swap=lot.rotation%2;
    target.add(kind,p.x+dx,y,p.z+dz,swap?d:w,h,swap?w:d,color);
  }};
  const rect=(left,right,top,bottom)=>{
    if(right<=left||bottom<=top)return;
    batch.add('box',(left+right)/2,.1,(top+bottom)/2,right-left,.3,bottom-top,'#bdbdbd');
    batch.add('box',(left+right)/2,.25,(top+bottom)/2,right-left,.34,bottom-top,'#dedede');
  };
  const north=lot.bay+dz-2.7,south=lot.aisle+dz+1.6,inner=3.85;
  rect(x+inner,x+block-inner,z+inner,north);
  rect(x+inner,x+6,north,z+block-inner);
  rect(x+block-6,x+block-inner,north,z+block-inner);
  const openings=[lot.entry+dx,lot.exit+dx];
  let cursor=x+6;
  for(const gate of openings){rect(cursor,gate-2,south,z+block-inner);cursor=gate+2;}
  rect(cursor,x+block-6,south,z+block-inner);
  batch.add('box',x+block/2,.01,(north+south)/2,block-12,.02,south-north,'#999999');
  for(const gate of openings)batch.add('box',gate,.01,(south+z+block-inner)/2,4,.02,z+block-inner-south,'#999999');
  // Gate arrows make the reversed driveway order readable from the city view.
  for(const [gate,direction] of [[lot.entry,-1],[lot.exit,1]]) {
    const center=lot.aisle+(lot.street-lot.aisle)*.65;
    const stroke=(px,pz,length,angle)=>{
      const p=parkingPoint(lot,px,pz);
      target.add('paint',p.x+dx,.04,p.z+dz,.12,.018,length,'#eeeeee',angle-lot.rotation*Math.PI/2);
    };
    stroke(gate,center,1.1,0);
    for(const side of [-1,1])stroke(gate+side*.2,center+direction*.32,Math.hypot(.4,.46),Math.atan2(side*.4,-direction*.46));
  }
  for(const slot of lot.slots) {
    batch.add('paint',slot+dx-1.15,.035,lot.bay+dz,.08,.018,3.1,'#ededed');
  }
  batch.add('paint',lot.slots.at(-1)+dx+1.15,.035,lot.bay+dz,.08,.018,3.1,'#ededed');
  batch.add('paint',x+block/2,.035,lot.bay+dz-1.55,lot.slots.at(-1)-lot.slots[0]+2.3,.018,.08,'#ededed');
  const rows=block>=32?2:1,space=north-(z+inner);
  for(let i=0;i<rows;i++) {
    const center=z+inner+space*(i+.5)/rows,depth=Math.min(5,space/rows-1.8),height=2.1+i*.45;
    batch.add('building',x+block/2,.42+height/2,center,block-14,height,depth,i?'#c6c6c6':'#d3d3d3');
    batch.add('paving',x+block/2,.44+height,center,block-19,.04,.65,'#aaaaaa');
  }
}

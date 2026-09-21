import { boulevardRoad, THIRD_TRACK } from './roadProfile.js';
import { parkAt, roadOpen, roadworkAt, roundaboutAt } from './roadLayout.js';
import { canalColumn } from './bridgeProfile.js';

export function parkingAt(x,z,block=40) {
  if(((x+z*2)%7+7)%7!==1 || canalColumn(x) || parkAt(x,z) || !roadOpen(0,z+1,x))return false;
  if(roadworkAt(0,z+1,x,block))return false;
  for(const dx of [0,1])for(const dz of [0,1])if(roundaboutAt(x+dx,z+dz))return false;
  return true;
}

// One-way aisle: enter from the right, reverse out of a bay, exit to the left.
// All dimensions are shared by scenery and traffic, including small blocks.
export function parkingLayout(x,z,block) {
  const left=x*block,right=left+block,bottom=(z+1)*block;
  const entry=right-8.5,exit=left+8.5,first=exit+2.2,last=entry-2.2;
  const count=Math.min(10,Math.floor((last-first)/2.4)+1);
  return {key:`${x}:${z}`,x,z,block,left,right,bottom,entry,exit,aisle:bottom-6.6,bay:bottom-10.8,
    track:boulevardRoad(0,z+1)?THIRD_TRACK:1,street:bottom-(boulevardRoad(0,z+1)?4.08:2.45),slots:Array.from({length:count},(_,i)=>first+(last-first)*i/Math.max(1,count-1))};
}

export function populateParking(batch,gx,gz,x,z,block) {
  const lot=parkingLayout(gx,gz,block),dx=x-gx*block,dz=z-gz*block;
  const rect=(left,right,top,bottom)=>{
    if(right<=left||bottom<=top)return;
    batch.add('box',(left+right)/2,.1,(top+bottom)/2,right-left,.3,bottom-top,'#bdbdbd');
    batch.add('box',(left+right)/2,.25,(top+bottom)/2,right-left,.34,bottom-top,'#dedede');
  };
  const north=z+block-13.5,south=z+block-5,inner=3.85;
  rect(x+inner,x+block-inner,z+inner,north);
  rect(x+inner,x+6,north,z+block-inner);
  rect(x+block-6,x+block-inner,north,z+block-inner);
  const openings=[lot.exit+dx,lot.entry+dx];
  let cursor=x+6;
  for(const gate of openings){rect(cursor,gate-2,south,z+block-inner);cursor=gate+2;}
  rect(cursor,x+block-6,south,z+block-inner);
  batch.add('box',x+block/2,.01,(north+south)/2,block-12,.02,south-north,'#999999');
  for(const gate of openings)batch.add('box',gate,.01,(south+z+block-inner)/2,4,.02,z+block-inner-south,'#999999');
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

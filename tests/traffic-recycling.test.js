import test from 'node:test';
import assert from 'node:assert/strict';
import { recycleVehicle } from '../src/city/activeWorld.js';
import { vehicleGap } from '../src/city/vehicleTypes.js';

const car=(position,direction,kind='car')=>({axis:0,line:1,direction,position,kind,track:0,fromTrack:0,speed:5,offset:.82});
test('recycling heavy vehicles never inserts them on an occupied boundary queue',()=>{
  for(const direction of [-1,1]) {
    const outgoing=car(120+direction*140.1,direction,'bus');
    const queue=Array.from({length:2},(_,i)=>car(120-direction*(139.9-i*4.2),direction,'truck'));
    const lane={cars:[outgoing,...queue]};
    assert.ok(recycleVehicle(lane,outgoing,120,140,70,40));
    assert.ok(Math.abs(outgoing.position-120)>80);
    for(const other of queue)assert.ok(Math.abs(outgoing.position-other.position)>=vehicleGap(outgoing,other));
    assert.equal(outgoing.speed,0);
  }
});
test('a full offscreen buffer postpones recycling without changing visible cars',()=>{
  const outgoing=car(260.1,1),queue=Array.from({length:61},(_,i)=>car(-20+i,1));
  const positions=queue.map(c=>c.position);
  assert.equal(recycleVehicle({cars:[outgoing,...queue]},outgoing,120,140,70,40),false);
  assert.equal(outgoing.position,260.1);assert.deepEqual(queue.map(c=>c.position),positions);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {movePlayer,resolveCircleBox,PLAYER_RADIUS} from '../src/physics.mjs';
const boxes=JSON.parse(fs.readFileSync(new URL('../assets/collision.json',import.meta.url)));
const clear=p=>boxes.every(b=>!resolveCircleBox(p.x,p.z,PLAYER_RADIUS-1e-6,b).hit);
test('actual scene spawn is collision-free',()=>assert.ok(clear({x:0,z:0})));
test('actual scene central cross streets support all four cardinal walks',()=>{
 for(const [x,z] of [[1,0],[-1,0],[0,1],[0,-1]]){
  let p={x:0,z:0};for(let i=0;i<800;i++){p=movePlayer(p,x*.1,z*.1,boxes);assert.ok(clear(p));}
  assert.ok(Math.hypot(p.x,p.z)>79,JSON.stringify(p));
 }
});
test('actual scene outer limit is respected from cardinal streets',()=>{
 for(const [x,z] of [[1,0],[-1,0],[0,1],[0,-1]]){
  let p={x:0,z:0};for(let i=0;i<1200;i++)p=movePlayer(p,x*.1,z*.1,boxes);
  assert.ok(Math.hypot(p.x,p.z)<=99.55);assert.ok(clear(p));
 }
});
test('actual scene sampled random walks remain collision-free',()=>{
 let seed=42;const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32};
 let p={x:0,z:0};for(let segment=0;segment<140;segment++){
  const a=rnd()*Math.PI*2;for(let j=0;j<60;j++){
   p=movePlayer(p,Math.cos(a)*.1,Math.sin(a)*.1,boxes);
   assert.ok(clear(p),JSON.stringify(p));assert.ok(Math.hypot(p.x,p.z)<=99.55);
  }
 }
});

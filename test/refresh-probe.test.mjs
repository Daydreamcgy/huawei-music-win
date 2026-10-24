import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRefresh} from '../src/refresh-probe.mjs';
import {RESEARCH_CLIENT} from '../src/auth.mjs';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
test('refresh probe proves new token is used for music session and private access',async()=>{
 const logs=[],calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url:String(url),...options});
  if(calls.length===1)return response({access_token:'NEW_SECRET',refresh_token:'ROTATED_SECRET',expires_in:3600});
  if(calls.length===2)return response({result:{resultCode:'000000'},token:'MUSIC_SECRET'});
  return response({result:{resultCode:'000000'}});
 };
 const result=await verifyRefresh({access_token:'OLD_SECRET',refresh_token:'OLD_REFRESH'},RESEARCH_CLIENT,{fetchImpl,log:s=>logs.push(s)});
 assert.equal(JSON.parse(calls[1].body).accessToken,'NEW_SECRET');
 assert.match(calls[2].headers.Authorization,/token=MUSIC_SECRET$/);
 assert.equal(result.refresh_token,'ROTATED_SECRET');assert.equal(calls.length,3);
 assert.ok(!logs.join('').includes('SECRET'));assert.equal(JSON.parse(logs[1]).success,true);
});
test('music failure retains rotated token and records separate failure',async()=>{
 let i=0;const logs=[];
 const result=await verifyRefresh({refresh_token:'OLD'},RESEARCH_CLIENT,{log:s=>logs.push(JSON.parse(s)),fetchImpl:async()=>++i===1
  ?response({access_token:'NEW',refresh_token:'ROTATED'}):response({result:{resultCode:'990006'}})});
 assert.equal(result.refresh_token,'ROTATED');assert.equal(logs[0].success,true);assert.equal(logs[1].success,false);
});
test('refresh failure does not attempt private requests or expose token',async()=>{
 let calls=0;const logs=[];
 const result=await verifyRefresh({refresh_token:'SECRET'},RESEARCH_CLIENT,{log:s=>logs.push(s),fetchImpl:async()=>{
  calls++;return response({error:1101,sub_error:20171,error_description:'SECRET'},400);
 }});
 assert.equal(result,null);assert.equal(calls,1);assert.ok(!logs.join('').includes('SECRET'));
});

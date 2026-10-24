import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicClient } from '../src/music.mjs';
import { ProviderError } from '../src/auth.mjs';
const success=()=>new Response(JSON.stringify({result:{resultCode:'000000'}}));
test('anonymous search sends no user token',async()=>{
 let request;const client=new MusicClient({fetchImpl:async(url,options)=>{request={url,...options};return success();}});
 await client.search('贝多芬',{limit:1});
 assert.equal(request.url.pathname,'/music-search-service/v10/service/fuzzysearch');
 assert.equal(JSON.parse(request.body).queryWord,'贝多芬');assert.ok(!request.headers.Authorization.includes('token='));
});
test('private endpoints require session before issuing request',async()=>{
 let called=false;const client=new MusicClient({fetchImpl:async()=>{called=true;return success();}});
 await assert.rejects(client.playlistDetail('test-id'),/需要音乐会话/);assert.throws(()=>client.favorites(),/SNS/);assert.equal(called,false);
});
test('favorites uses only current session user, not arbitrary target input',async()=>{
 let sent;const client=new MusicClient({session:{token:'SESSION',snsUserID:'SELF'},fetchImpl:async(url,options)=>{sent={url,...options};return success();}});
 await client.favorites({start:50,limit:50,targetSnsUserID:'OTHER'});const body=JSON.parse(sent.body);
 assert.equal(body.targetSnsUserID,'SELF');assert.deepEqual(body.contentTypes,['1']);assert.match(sent.headers.Authorization,/token=SESSION$/);
 assert.equal(body.start,50);assert.equal(body.limit,50);
});
test('playlist and history queries are GET, contain no write operations',async()=>{
 const seen=[];const client=new MusicClient({session:{token:'SESSION'},fetchImpl:async(url,options)=>{seen.push({url,...options});return success();}});
 assert.throws(()=>client.playlistDetail(''),/playListID/);
 await client.playlistDetail('test-id');await client.recent();
 assert.ok(seen.every(x=>x.method==='GET'&&!x.body));assert.equal(seen[0].url.searchParams.get('start'),'0');
});
test('music errors fail closed and do not expose response body',async()=>{
 const client=new MusicClient({fetchImpl:async()=>new Response(JSON.stringify({result:{resultCode:'990006',resultMessage:'PRIVATE'}}))});
 await assert.rejects(client.search('x'),e=>e instanceof ProviderError&&!e.message.includes('PRIVATE'));
});
test('read-only network failures retry once after the first attempt',async()=>{
 let calls=0;
 const client=new MusicClient({fetchImpl:async()=>{if(++calls===1)throw new Error('offline');return success();}});
 await client.search('x');assert.equal(calls,2);
});
test('business and HTTP errors are not retried',async()=>{
 for(const response of [
  new Response(JSON.stringify({result:{resultCode:'990006'}})),
  new Response('unavailable',{status:503}),
 ]){
  let calls=0;
  const client=new MusicClient({fetchImpl:async()=>{calls++;return response.clone();}});
  await assert.rejects(client.search('x'));
  assert.equal(calls,1);
 }
});
test('repeated network failure stops after two attempts and stays sanitized',async()=>{
 let calls=0;
 const client=new MusicClient({fetchImpl:async()=>{calls++;throw new Error('PRIVATE NETWORK DETAIL');}});
 await assert.rejects(client.search('x'),error=>error.message==='音乐只读请求网络失败');
 assert.equal(calls,2);
});
test('library discovery asks for every personal playlist type in one paged call',async()=>{
 let sent;const client=new MusicClient({session:{token:'SESSION',snsUserID:'SELF'},fetchImpl:async(url,options)=>{sent={url,...options};return success();}});
 await client.library({start:100,limit:200});const body=JSON.parse(sent.body);
 assert.deepEqual(body.contentTypes,['1','4','5','7']);assert.equal(body.start,100);assert.equal(body.limit,200);
});
test('album and artist requests use the documented shapes and reject empty ids',async()=>{
 const seen=[];const client=new MusicClient({fetchImpl:async(url,options)=>{seen.push({url,...options});return success();}});
 assert.throws(()=>client.album(''),/专辑 ID/);assert.throws(()=>client.artist(''),/歌手 ID/);
 await client.album('al',{start:0,limit:50});
 await client.artist('ar');
 assert.equal(seen[0].url.pathname,'/music-metacontent-service/v1/service/album/detail/byalbumcode');
 assert.equal(seen[0].url.searchParams.get('albumCode'),'al');
 assert.equal(seen[0].method,'GET');
 assert.equal(seen[1].url.pathname,'/music-metacontent-service/v2/service/artist/detail/byartistcode');
 assert.deepEqual(JSON.parse(seen[1].body),{artistCode:'ar',songNum:20,albumNum:20});
});
test('write operations never retry after a network failure',async()=>{
 let calls=0;const client=new MusicClient({session:{token:'SESSION'},fetchImpl:async()=>{calls++;throw new Error('offline');}});
 await assert.rejects(client.setFavorite('song',true),/收藏操作网络失败/);
 await assert.rejects(client.deletePlaylist('pl'),/删除歌单网络失败/);
 await assert.rejects(client.createPlaylist({name:'临时',songCodes:['song'],createTime:'20260101000000'}),/创建歌单网络失败/);
 assert.equal(calls,3);
});
test('recent play reporting uses the observed H5 shape and never retries',async()=>{
 let sent;let calls=0;
 const client=new MusicClient({session:{token:'SESSION'},fetchImpl:async(url,options)=>{calls++;sent={url,...options};return success();}});
 await client.createRecentPlay([{songCode:'s1',contentCode:'s1',contentType:'1',songName:'Synthetic',listenType:'1',duration:42,createTime:'20260101000000',playCount:1,songDuration:60}]);
 assert.equal(sent.url.pathname,'/music-userbehavior-service/v1/service/recentlyplayed/create');
 assert.match(sent.headers.Authorization,/token=SESSION$/);
 assert.deepEqual(JSON.parse(sent.body),{createRecentPlayInfos:[{songCode:'s1',contentCode:'s1',contentType:'1',songName:'Synthetic',listenType:'1',duration:42,createTime:'20260101000000',playCount:1,songDuration:60}]});
 assert.equal(calls,1);
 let failed=0;
 const offline=new MusicClient({session:{token:'SESSION'},fetchImpl:async()=>{failed++;throw new Error('offline');}});
 await assert.rejects(offline.createRecentPlay([{contentCode:'s1',contentType:'1',duration:1,createTime:'20260101000000'}]),/播放历史上报网络失败/);
 assert.equal(failed,1,'a write that may already have applied must not be retried');
});

test('recent play reporting validates its payload before any request',async()=>{
 let calls=0;const client=new MusicClient({session:{token:'SESSION'},fetchImpl:async()=>{calls++;return success();}});
 assert.throws(()=>client.createRecentPlay([]),/1-20/);
 assert.throws(()=>client.createRecentPlay([{contentCode:'',contentType:'1',duration:1,createTime:'20260101000000'}]),/歌曲 ID/);
 assert.throws(()=>client.createRecentPlay([{contentCode:'s',contentType:'',duration:1,createTime:'20260101000000'}]),/内容类型/);
 assert.throws(()=>client.createRecentPlay([{contentCode:'s',contentType:'1',duration:-1,createTime:'20260101000000'}]),/播放时长/);
 assert.throws(()=>client.createRecentPlay([{contentCode:'s',contentType:'1',duration:1,createTime:'2026-01-01'}]),/上报时间/);
 assert.equal(calls,0);
});

test('write operations validate input before any request is issued',async()=>{
 let calls=0;const client=new MusicClient({session:{token:'SESSION'},fetchImpl:async()=>{calls++;return success();}});
 assert.throws(()=>client.createPlaylist({name:'  ',songCodes:['song'],createTime:'20260101000000'}),/歌单名称/);
 assert.throws(()=>client.createPlaylist({name:'临时',songCodes:[],createTime:'20260101000000'}),/至少需要一首歌曲/);
 assert.throws(()=>client.createPlaylist({name:'临时',songCodes:['song'],createTime:'2026-01-01'}),/创建时间/);
 assert.throws(()=>client.setFavorite('',true),/歌曲 ID/);
 assert.throws(()=>client.updatePlaylistDescription('pl','x'.repeat(201)),/简介/);
 assert.throws(()=>client.favoriteExist(''),/歌曲 ID/);
 assert.equal(calls,0);
});

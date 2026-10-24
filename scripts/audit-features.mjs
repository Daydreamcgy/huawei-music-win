import {mkdir,writeFile,chmod} from 'node:fs/promises';
import {loadMusicSession} from '../src/saved-session.mjs';
import {MUSIC_ENDPOINT,musicHeaders} from '../src/auth.mjs';
const dir='.local/feature-audit';await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
const {music}=await loadMusicSession();
const report=[];
function shape(value,depth=0) {
 if(depth>3)return Array.isArray(value)?{type:'array',length:value.length}:typeof value;
 if(Array.isArray(value))return {type:'array',length:value.length,first:value.length?shape(value[0],depth+1):null};
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,shape(v,depth+1)]));
 return typeof value;
}
async function request(name,path,params,{method='POST',auth=true}={}) {
 const url=new URL(path,MUSIC_ENDPOINT);if(method==='GET')for(const [k,v]of Object.entries(params))url.searchParams.set(k,String(v));
 try {
  const r=await fetch(url,{method,headers:musicHeaders(auth?music.token:null),...(method==='POST'?{body:JSON.stringify(params)}:{}),redirect:'error',signal:AbortSignal.timeout(25000)});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=null;}
  await writeFile(`${dir}/${name}.json`,JSON.stringify({status:r.status,body:data??text},null,2),{mode:0o600});
  const entry={name,httpStatus:r.status,resultCode:data?.result?.resultCode??null,shape:shape(data)};
  report.push(entry);console.log(JSON.stringify(entry));return data;
 }catch {const entry={name,error:'network-or-parse-error'};report.push(entry);console.log(JSON.stringify(entry));return null;}
}
await request('favorites','/music-userbehavior-service/v3/service/favorite/simple/all',{targetSnsUserID:music.snsUserID,start:0,limit:5,contentTypes:['1']});
await request('favorites-sheets','/music-userbehavior-service/v3/service/favorite/simple/all',{targetSnsUserID:music.snsUserID,start:0,limit:5,contentTypes:['4']});
await request('recent','/music-userbehavior-service/v1/service/recentlyplayed/query',{contentType:'1'},{method:'GET'});
await request('playlists','/music-userbehavior-service/v1/service/playlist/detail/all',{start:0,limit:5,playListID:''},{method:'GET'});
await request('daily','/music-recommend-service/v1/service/recommend/querydaily',{rcmScenario:0,scenario:1,termType:1});
const search=await request('search','/music-search-service/v10/service/fuzzysearch',{contentType:'1',correct:'1',limit:'3',queryWord:'贝多芬',start:'0'},{auth:false});
const song=search?.songSimpleInfos?.[0];
if(song) {
 if(song.albumID)await request('album','/music-metacontent-service/v1/service/album/detail/byalbumcode',{albumCode:song.albumID,start:0,limit:3},{method:'GET'});
 if(song.artistID?.[0])await request('artist','/music-metacontent-service/v2/service/artist/detail/byartistcode',{artistCode:song.artistID[0],songNum:3,albumNum:3});
 await request('play-standard','/music-play-service/v3/service/file/bycontentcode',{contentCode:song.contentID,contentType:'1',qualityType:'1'});
}
await writeFile(`${dir}/report.json`,JSON.stringify({testedAt:new Date().toISOString(),report},null,2),{mode:0o600});

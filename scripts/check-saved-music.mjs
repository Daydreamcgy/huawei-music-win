import {loadMusicSession} from '../src/saved-session.mjs';
import {MusicClient} from '../src/music.mjs';
import {ProviderError} from '../src/auth.mjs';
try {
 const record=await loadMusicSession();
 console.log(JSON.stringify({event:'saved-music-session-check',savedAt:record.savedAt,
  elapsedSeconds:Math.floor((Date.now()-Date.parse(record.savedAt))/1000),
  accountAccessExpiresIn:record.accountAccessExpiresIn,
  musicExpireTime:/^\d{14}$/.test(String(record.music.expireTime))?String(record.music.expireTime):null,
  usesOriginalMusicToken:true,performsLoginOrRefresh:false}));
 const client=new MusicClient({session:record.music});
 for(const operation of ['favorites','recent']) {
  try {
   const data=await client[operation]();
   console.log(JSON.stringify({operation,success:true,resultCode:data.result.resultCode}));
  }catch(error){
   console.log(JSON.stringify({operation,success:false,...(error instanceof ProviderError
    ?{httpStatus:error.status,code:error.code,subCode:error.subCode}:{reason:'请求失败'})}));
   process.exitCode=1;
  }
 }
}catch {console.error('读取受限会话文件失败；未输出敏感内容。');process.exitCode=1;}

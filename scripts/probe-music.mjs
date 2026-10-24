import { MusicClient } from '../src/music.mjs';
import { ProviderError } from '../src/auth.mjs';
const client=new MusicClient();
try {
 const search=await client.search('贝多芬',{limit:1});
 const playlist=await client.publicPlaylist('145401',{limit:3});
 console.log(JSON.stringify({search:{result:search.result.resultCode,count:search.songSimpleInfos?.length ?? 0},
  publicPlaylist:{result:playlist.result.resultCode,count:playlist.musicListInfoEx?.songSimpleInfos?.length ?? 0}},null,2));
} catch(error) {
 console.error(error instanceof ProviderError
  ? JSON.stringify({stage:error.stage,status:error.status,code:error.code}) : '音乐预检失败');
 process.exitCode=1;
}

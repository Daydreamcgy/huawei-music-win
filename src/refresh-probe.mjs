import { refreshAccessToken, exchangeMusicSession, ProviderError } from './auth.mjs';
import { MusicClient } from './music.mjs';

export async function verifyRefresh(tokens, config, {round='immediate', fetchImpl=fetch, log=console.log}={}) {
  try {
    const refreshed=await refreshAccessToken(tokens.refresh_token,config,undefined,fetchImpl);
    log(JSON.stringify({event:'refresh',round,success:true,
      accessTokenChanged:refreshed.access_token!==tokens.access_token,
      refreshTokenChanged:refreshed.refresh_token!==tokens.refresh_token,
      expiresIn:Number(refreshed.expires_in)||null}));
    // Preserve the newest token even if a later music request fails; never reuse a rotated token.
    try {
      const session=await exchangeMusicSession(refreshed.access_token,fetchImpl);
      const client=new MusicClient({session,fetchImpl});
      const data=await client.recent();
      log(JSON.stringify({event:'refreshed-music-access',round,success:true,resultCode:data.result.resultCode}));
    } catch(error) {log(JSON.stringify(safeFailure('refreshed-music-access',round,error)));}
    return refreshed;
  } catch(error) {
    log(JSON.stringify(safeFailure('refresh',round,error)));
    return null;
  }
}
function safeFailure(event,round,error) {
  return {event,round,success:false,...(error instanceof ProviderError
    ? {httpStatus:error.status,code:error.code,subCode:error.subCode}
    : {reason:'网络错误或响应缺少所需字段'})};
}

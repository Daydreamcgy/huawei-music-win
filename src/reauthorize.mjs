import { createAttempt, isCallback, consumeCallback, exchangeCode, exchangeMusicSession, ProviderError } from './auth.mjs';
import { MusicClient } from './music.mjs';

// New OAuth attempt in the SAME browser context. Do not click consent or initiate QR polling manually.
// Timeout means user interaction may be needed; it is not proof that SSO is impossible.
export async function probeReauthorization(context, config, {prompt='none',timeoutMs=25000,log=console.log,fetchImpl=fetch}={}) {
  const attempt=createAttempt(config);const url=new URL(attempt.authorizeUrl);url.searchParams.set('prompt',prompt);
  const page=await context.newPage();let timer,cdp,settled=false;
  let resolveCallback,rejectCallback;
  const callback=new Promise((resolve,reject)=>{resolveCallback=resolve;rejectCallback=reject;});callback.catch(()=>{});
  const capture=target=>{
    if(settled||!isCallback(target,attempt))return;
    settled=true;
    try{resolveCallback(consumeCallback(target,attempt));}catch(error){rejectCallback(error);}
  };
  try {
    await page.route('**/*',async route=>{
      if(isCallback(route.request().url(),attempt)){capture(route.request().url());await route.abort();}
      else await route.continue();
    });
    cdp=await context.newCDPSession(page);await cdp.send('Page.enable');
    cdp.on('Page.frameRequestedNavigation',e=>capture(e.url));
    cdp.on('Page.frameScheduledNavigation',e=>capture(e.url));
    cdp.on('Page.frameNavigated',e=>capture(e.frame.url));
    timer=setTimeout(()=>rejectCallback(new Error('interaction-or-timeout')),timeoutMs);
    page.on('close',()=>rejectCallback(new Error('closed')));
    await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:timeoutMs}).catch(()=>{});
    const code=await callback;clearTimeout(timer);
    const tokens=await exchangeCode(code,attempt,fetchImpl);
    const session=await exchangeMusicSession(tokens.access_token,fetchImpl);
    const result=await new MusicClient({session,fetchImpl}).recent();
    log(JSON.stringify({event:'browser-reauthorization',prompt,success:true,resultCode:result.result.resultCode,expiresIn:Number(tokens.expires_in)||null}));
    return {tokens,session};
  }catch(error){
    log(JSON.stringify({event:'browser-reauthorization',prompt,success:false,
      ...(error instanceof ProviderError ? {code:error.code,subCode:error.subCode,httpStatus:error.status}
        : {reason:'未完成免交互授权，可能需要登录/同意或出现超时'})}));
    return null;
  }finally {clearTimeout(timer);if(cdp)await cdp.detach().catch(()=>{});await page.close().catch(()=>{});}
}

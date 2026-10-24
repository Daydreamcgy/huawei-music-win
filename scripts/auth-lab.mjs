import { chromium } from 'playwright-core';
import { mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MusicClient } from '../src/music.mjs';
import { saveMusicSession } from '../src/saved-session.mjs';
import { verifyRefresh } from '../src/refresh-probe.mjs';
import { lifetimeSummary } from '../src/lifetime.mjs';
import { probeReauthorization } from '../src/reauthorize.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { createAttempt, isCallback, consumeCallback, exchangeCode,
  exchangeMusicSession, summarizeTokens, ProviderError } from '../src/auth.mjs';

if (!process.argv.includes('--login')) {
  console.log('登录验证原型：npm run auth:lab -- --login\n仅在本人电脑运行；账号密码只输入华为官方页面。\n此工具使用公开研究资料中的应用标识，并非已注册的独立第三方应用。\n授权码兑换与自动续期仍未验证；令牌只保存在本进程内存，退出即清除。');
  process.exit(0);
}
console.log('即将打开华为官方登录页面。请核对授权应用及权限；不认可请关闭窗口。');
const saveSession=process.argv.includes('--save-music-session');
if(saveSession && ['--test-refresh','--test-reauthorize','--wait-expiry'].some(x=>process.argv.includes(x)))throw new Error('持久化寿命实验不能混用其他续期实验');
console.log(saveSession ? '本轮仅保存音乐业务会话到本地受限文件，供新进程延后验证；不保存账号 Token、密码或 Cookie。' : '这是登录可行性实验，不代表华为认可此第三方客户端。不会保存密码、Cookie 或令牌。');
const attempt=createAttempt();
const options={headless:false, ...(process.env.CHROME_PATH
  ? {executablePath:process.env.CHROME_PATH} : {channel:'msedge'})};
if (process.argv.includes('--headless')) options.headless=true;
// Root-only server lab: Chromium sandbox cannot start as root. Never disable TLS checks.
if (process.getuid?.() === 0) options.args=['--no-sandbox'];
const shareQr=process.argv.includes('--share-qr');
const qrDir=resolve('.local/auth-lab');
let snapshotTimer;
let snapshotBusy=false;
let browser;
let timer;
try {
  browser=await chromium.launch(options);
  const context=await browser.newContext({locale:'zh-CN'});
  const page=await context.newPage();
  // Capture only the pre-login official page; never screenshot post-login personal data.
  let qrPageReady=false;
  let qrScreenshotTaken=false;
  if(shareQr) {
    await mkdir(qrDir,{recursive:true,mode:0o700});
    await chmod(qrDir,0o700);
    page.on('response',response=>{
      const url=new URL(response.url());
      if(url.hostname==='id1.cloud.huawei.com' && url.pathname==='/DimensionalCode/getqrInfo' && response.ok()) qrPageReady=true;
    });
    snapshotTimer=setInterval(async()=>{
      if(snapshotBusy || !qrPageReady || qrScreenshotTaken || page.isClosed())return;
      snapshotBusy=true;
      try {
        const url=new URL(page.url());
        if(url.hostname==='id1.cloud.huawei.com' && url.pathname==='/CAS/portal/loginAuth.html') {
          const file=resolve(qrDir,'official-login.png');
          await page.screenshot({path:file});
          await chmod(file,0o600);
          qrScreenshotTaken=true;
          console.log('QR_READY .local/auth-lab/official-login.png');
        }
      } catch {} finally {snapshotBusy=false;}
    },1500);
  }
  let resolveCallback, rejectCallback;
  let finished=false;
  const callbackPromise=new Promise((resolve,reject)=>{resolveCallback=resolve;rejectCallback=reject;});
  // Attach rejection handling before navigation so a failed/closed window is never unhandled.
  callbackPromise.catch(()=>{});
  const capture=url=>{
    if (!isCallback(url,attempt) || finished) return;
    finished=true;
    try {resolveCallback(consumeCallback(url,attempt));} catch(error){rejectCallback(error);}
  };
  // Inspect navigation targets only; do not instrument credential fields or log network URLs.
  await context.route('**/*', async route=>{
    const url=route.request().url();
    if (isCallback(url,attempt)) {capture(url);await route.abort();return;}
    await route.continue();
  });
  // Some Chromium builds reject external schemes before Playwright routing sees them.
  // CDP sees the intended navigation but does not register/hijack the system-wide hms:// scheme.
  const cdp=await context.newCDPSession(page);
  await cdp.send('Page.enable');
  cdp.on('Page.frameRequestedNavigation',e=>capture(e.url));
  cdp.on('Page.frameScheduledNavigation',e=>capture(e.url));
  cdp.on('Page.frameNavigated',e=>capture(e.frame.url));
  page.on('close',()=>{if(!finished)rejectCallback(new Error('登录窗口已关闭'));});
  timer=setTimeout(()=>rejectCallback(new Error('登录等待超时，请重新发起')),10*60_000);
  try { await page.goto(attempt.authorizeUrl,{waitUntil:'domcontentloaded',timeout:60_000}); }
  catch {if(!finished) throw new Error('官方登录页面加载失败');}
  console.log('等待本人在官方页面完成登录和授权……');
  const code=await callbackPromise;
  clearTimeout(timer);
  clearInterval(snapshotTimer);
  // Optional SSO probe needs the original in-memory browser cookies. Never save storageState.
  const testReauthorize=process.argv.includes('--test-reauthorize');
  if(!testReauthorize){await browser.close();browser=null;}
  let tokens=await exchangeCode(code,attempt);
  if(process.argv.includes('--test-refresh')) {
    const refreshed=await verifyRefresh(tokens,attempt);
    if(refreshed) tokens=refreshed;
    console.log(JSON.stringify({event:'refresh-probe-initial-complete',success:!!refreshed}));
    if(refreshed && process.argv.includes('--wait-expiry')) {
      const seconds=Number(tokens.expires_in);
      if(Number.isFinite(seconds) && seconds>0 && seconds<=7200) {
        const waitSeconds=seconds+60;
        console.log(JSON.stringify({event:'waiting-access-token-expiry',waitSeconds,
          retryAt:new Date(Date.now()+waitSeconds*1000).toISOString(),credentials:'memory-only'}));
        await delay(waitSeconds*1000);
        const renewed=await verifyRefresh(tokens,attempt,{round:'after-access-token-expiry'});
        if(renewed)tokens=renewed;
      }
    }
  }
  let music;
  try {music=await exchangeMusicSession(tokens.access_token);}
  finally {console.log(JSON.stringify(summarizeTokens(tokens,music),null,2));}
  const cookies=browser ? await context.cookies() : [];
  console.log(JSON.stringify({event:'credential-lifetimes',...lifetimeSummary(tokens,music,cookies)}));
  if(testReauthorize) {
    await probeReauthorization(context,attempt);
    if(process.argv.includes('--wait-expiry')) {
      const lifetime=Number(tokens.expires_in);
      if(lifetime>0 && lifetime<=7200) {
        console.log(JSON.stringify({event:'waiting-sso-expiry-test',waitSeconds:lifetime+60,
          retryAt:new Date(Date.now()+(lifetime+60)*1000).toISOString()}));
        await delay((lifetime+60)*1000);
        // First see whether the original music session still works after account AT lifetime.
        try {
          const result=await new MusicClient({session:music}).recent();
          console.log(JSON.stringify({event:'original-music-session-after-account-expiry',success:true,resultCode:result.result.resultCode}));
        } catch(error) {
          console.log(JSON.stringify({event:'original-music-session-after-account-expiry',success:false,
            ...(error instanceof ProviderError ? {code:error.code,httpStatus:error.status}:{reason:'请求失败'})}));
        }
        const renewed=await probeReauthorization(context,attempt);
        if(renewed){tokens=renewed.tokens;music=renewed.session;}
      }
    }
  }
  console.log('账号令牌及音乐会话兑换成功，开始验证个人音乐库（只读，不输出曲目或用户信息）。');
  const client=new MusicClient({session:music});
  for(const operation of ['favorites','recent']) {
    try {
      const response=await client[operation]();
      console.log(JSON.stringify({operation,resultCode:response.result.resultCode,success:true}));
    } catch(error) {
      console.log(JSON.stringify({operation,success:false,...(error instanceof ProviderError
        ? {httpStatus:error.status,code:error.code,subCode:error.subCode} : {reason:'请求失败或会话缺少所需字段'})}));
    }
  }
  if(saveSession) {
    const metadata=await saveMusicSession(music,tokens.expires_in);
    console.log(JSON.stringify({event:'music-session-saved',...metadata,credentials:'local-file-mode-0600',accountTokensSaved:false,browserCookiesSaved:false}));
  }
  console.log(saveSession ? '验证结束，浏览器和进程退出；已保存原音乐会话，稍后使用新进程测试，不续期、不重新登录。' : '验证结束；令牌和个人数据不落盘，进程退出后丢弃。');
} catch(error) {
  if(error instanceof ProviderError) {
    console.error(JSON.stringify({stage:error.stage,httpStatus:error.status,code:error.code,subCode:error.subCode}));
  } else {
    // Browser errors can contain redirect URLs/codes. Only expose a small set of safe messages.
    const message=error?.message || '';
    const safe=/^(授权回调已使用|授权尝试已过期|回调地址不匹配|回调参数重复|OAuth state 不匹配|用户取消授权或授权服务拒绝请求|回调缺少授权码|登录窗口已关闭|登录等待超时，请重新发起|官方登录页面加载失败|响应缺少账号访问令牌|响应缺少音乐会话令牌|授权码兑换网络请求失败|音乐会话兑换网络请求失败)$/;
    console.error(safe.test(message) ? message : '登录验证未完成。请检查 Edge/CHROME_PATH 与网络；未输出可能含凭据的底层异常。');
  }
  process.exitCode=1;
} finally {clearTimeout(timer);clearInterval(snapshotTimer);if(browser)await browser.close();}

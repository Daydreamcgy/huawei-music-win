// Offline browser integration test. Synthetic code only; no Huawei credentials.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { createAttempt, consumeCallback, isCallback } from '../src/auth.mjs';
const attempt=createAttempt();
const target=`${attempt.redirectUri}?code=synthetic-code&state=${attempt.state}`;
const server=createServer((req,res)=>{
 res.setHeader('Content-Type','text/html');
 res.end(`<button id="go" onclick='location.href=${JSON.stringify(target)}'>Synthetic callback</button>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,timer;
try {
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH}:{channel:'msedge'}),...(process.getuid?.()===0?{args:['--no-sandbox']}:{})});
 const page=await browser.newPage();
 const cdp=await page.context().newCDPSession(page);await cdp.send('Page.enable');
 const result=new Promise((resolve,reject)=>{
  timer=setTimeout(()=>reject(new Error('Custom scheme callback not observed')),8000);
  const capture=e=>{if(isCallback(e.url,attempt)){try{resolve(consumeCallback(e.url,attempt));}catch(err){reject(err);}}};
  cdp.on('Page.frameRequestedNavigation',capture);cdp.on('Page.frameScheduledNavigation',capture);
 });
 result.catch(()=>{});
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.locator('#go').click();
 assert.equal(await result,'synthetic-code');
 console.log('PASS: Chromium observes hms:// navigation and validates state without registering an OS protocol handler.');
} finally {
 clearTimeout(timer);if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeFor, createAttempt, consumeCallback, isCallback, isAllowedLoginUrl, exchangeCode,
  exchangeMusicSession, refreshAccessToken, RESEARCH_CLIENT, ProviderError, summarizeTokens } from '../src/auth.mjs';

const callback=(attempt,extra='')=>`${attempt.redirectUri}?code=test-code&state=${attempt.state}${extra}`;
const reply=(data,status=200)=>async()=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

test('PKCE matches RFC 7636 test vector',()=>{
 assert.equal(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('random independent attempts, minimal scope and S256',()=>{
 const a=createAttempt(),b=createAttempt();const u=new URL(a.authorizeUrl);
 assert.notEqual(a.state,b.state);assert.notEqual(a.verifier,b.verifier);
 assert.equal(u.searchParams.get('scope'),'openid');assert.equal(u.searchParams.get('code_challenge_method'),'S256');
 assert.equal(u.searchParams.get('code_challenge'),challengeFor(a.verifier));
 assert.equal(u.searchParams.get('access_type'),'offline');
});
test('callback requires exact destination',()=>{
 const a=createAttempt();assert.ok(isCallback(callback(a),a));
 for(const u of ['hms://redirect_uri.evil/?code=x','https://redirect_uri?code=x','hms://redirect_uri/other?code=x','hms://user@redirect_uri?code=x','hms://redirect_uri?code=x#fragment'])assert.equal(isCallback(u,a),false);
});
test('login navigation allowlist rejects credentials, alternate ports and lookalike hosts',()=>{
 for(const host of ['oauth-login.platform.hicloud.com','id1.cloud.huawei.com','oauth-login.cloud.huawei.com','account.huawei.com','consumer.huawei.com'])
  assert.equal(isAllowedLoginUrl(`https://${host}/path`),true);
 for(const url of [
  'http://account.huawei.com/',
  'https://attacker@account.huawei.com/',
  'https://account.huawei.com:444/',
  'https://account.huawei.com.attacker.invalid/',
  'https://sub.account.huawei.com/',
  'https://account-huawei.com/',
  'javascript:alert(1)',
 ]) assert.equal(isAllowedLoginUrl(url),false,url);
});
test('CAS regional service callback is allowed as an intermediate page, not consumed as OAuth completion',()=>{
 const attempt=createAttempt();
 const service=new URL('https://oauth-login1.cloud.huawei.com:443/oauth2/v3/loginCallback');
 for(const key of ['client_id','redirect_uri','state','code_challenge','code_challenge_method'])
  service.searchParams.set(key,new URL(attempt.authorizeUrl).searchParams.get(key));
 service.searchParams.set('ticket','synthetic-cas-ticket');
 assert.equal(isAllowedLoginUrl(service.href),true);
 assert.equal(isCallback(service.href,attempt),false);
 assert.equal(attempt.consumed,false);
 for(const url of [
  'http://oauth-login1.cloud.huawei.com/oauth2/v3/loginCallback',
  'https://oauth-login1.cloud.huawei.com:444/oauth2/v3/loginCallback',
  'https://user@oauth-login1.cloud.huawei.com/oauth2/v3/loginCallback',
  'https://oauth-login1.cloud.huawei.com.attacker.invalid/oauth2/v3/loginCallback',
  'https://sub.oauth-login1.cloud.huawei.com/oauth2/v3/loginCallback',
  'https://oauth-login2.cloud.huawei.com/oauth2/v2/loginCallback',
  'https://oauth-login1.cloud.huawei.com/not-an-oauth-callback',
  'https://oauth-login1.cloud.huawei.com/oauth2/v3/loginCallback/extra',
 ])assert.equal(isAllowedLoginUrl(url),false,url);
});
test('valid callback is single use',()=>{
 const a=createAttempt();assert.equal(consumeCallback(callback(a),a),'test-code');assert.throws(()=>consumeCallback(callback(a),a),/已使用/);
});
test('state mismatch and duplicates are rejected',()=>{
 const a=createAttempt();assert.throws(()=>consumeCallback(`${a.redirectUri}?code=x&state=wrong`,a),/state/);
 assert.throws(()=>consumeCallback(callback(a,'&code=duplicate'),a),/重复/);
 assert.throws(()=>consumeCallback(callback(a,`&state=${a.state}`),a),/重复/);
});
test('expired attempts and user denial',()=>{
 const a=createAttempt(RESEARCH_CLIENT,0);assert.throws(()=>consumeCallback(callback(a),a,600001),/过期/);
 const b=createAttempt();assert.throws(()=>consumeCallback(`${b.redirectUri}?error=access_denied&state=${b.state}`,b),/取消/);
});
test('code exchange sends PKCE, never an embedded client secret',async()=>{
 const a=createAttempt();let sent;
 const tokens=await exchangeCode('code',a,async(url,options)=>{sent={url,...options};return new Response(JSON.stringify({access_token:'private-token'}));});
 assert.equal(tokens.access_token,'private-token');assert.equal(sent.body.get('code_verifier'),a.verifier);
 assert.equal(sent.body.has('client_secret'),false);assert.equal(sent.redirect,'error');
});
test('provider errors omit echoed secrets',async()=>{
 await assert.rejects(exchangeCode('private-code',createAttempt(),reply({error:1101,error_description:'private-code private-token',sub_error:20152},400)),e=>{
  assert.ok(e instanceof ProviderError);assert.equal(e.code,'1101');assert.equal(e.subCode,20152);
  assert.ok(!JSON.stringify(e).includes('private-'));assert.ok(!e.message.includes('private-'));return true;
 });
});
test('music session exchange uses account token in JSON body',async()=>{
 let sent;const session=await exchangeMusicSession('private-token',async(url,options)=>{sent={url,...options};return new Response(JSON.stringify({result:{resultCode:'000000'},token:'music-token'}));});
 assert.equal(JSON.parse(sent.body).accessToken,'private-token');assert.equal(session.token,'music-token');
 assert.match(sent.headers.Authorization,/^Digest username=app-music-baseline/);
 assert.ok(!sent.headers.Authorization.includes('private-token'));
});
test('music errors fail closed even when HTTP is 200',async()=>{
 await assert.rejects(exchangeMusicSession('x',reply({result:{resultCode:'990006'},token:'ignore'})),ProviderError);
});
test('research client refuses embedded secret without making network request',async()=>{
 let called=false;await assert.rejects(refreshAccessToken('token',RESEARCH_CLIENT,'do-not-use',async()=>{called=true;}),/私密应用凭据/);assert.equal(called,false);
});
test('public refresh sends real grant without secret and preserves omitted refresh token',async()=>{
 let body;const result=await refreshAccessToken('OLD',RESEARCH_CLIENT,undefined,async(url,options)=>{
  body=options.body;return new Response(JSON.stringify({access_token:'NEW',expires_in:3600}));
 });
 assert.equal(body.get('grant_type'),'refresh_token');assert.equal(body.get('refresh_token'),'OLD');
 assert.equal(body.has('client_secret'),false);assert.equal(result.refresh_token,'OLD');
});
test('refresh token rotation is preserved',async()=>{
 const result=await refreshAccessToken('OLD',RESEARCH_CLIENT,undefined,reply({access_token:'NEW',refresh_token:'ROTATED'}));
 assert.equal(result.refresh_token,'ROTATED');
});
test('refresh rejection reports provider error instead of success',async()=>{
 await assert.rejects(refreshAccessToken('OLD',RESEARCH_CLIENT,undefined,reply({error:1101,sub_error:20171},400)),ProviderError);
});
test('summary contains presence flags but not tokens or identifiers',()=>{
 const s=summarizeTokens({access_token:'SECRET',refresh_token:'SECRET2',expires_in:3600},{token:'SECRET3',userID:'123'});
 assert.equal(s.hasAccessToken,true);assert.equal(s.expiresIn,3600);assert.ok(!JSON.stringify(s).includes('SECRET'));assert.ok(!('userID' in s));
});
test('regional OAuth callback hosts follow the CAS region',()=>{
 for(const url of ['https://oauth-login5.cloud.huawei.com/oauth2/v3/loginCallback','https://oauth-login1.cloud.huawei.com/oauth2/v3/loginCallback'])
  assert.equal(isAllowedLoginUrl(url),true,url);
 for(const url of ['https://oauth-login5.cloud.huawei.com/oauth2/v3/authorize','https://oauth-login555.cloud.huawei.com/oauth2/v3/loginCallback','https://oauth-login5.cloud.huawei.com.attacker.invalid/oauth2/v3/loginCallback'])
  assert.equal(isAllowedLoginUrl(url),false,url);
});

import { createAttempt, ProviderError } from '../src/auth.mjs';

const attempt = createAttempt();
const response = await fetch('https://oauth-login.platform.hicloud.com/oauth2/ajax/getLoginWay', {
  method:'POST', body:new URL(attempt.authorizeUrl).searchParams,
  headers:{'Content-Type':'application/x-www-form-urlencoded', interfaceVersion:'v3', fromLoginAuth:'false'},
  signal:AbortSignal.timeout(25_000), redirect:'error',
});
const data = await response.json();
if (!response.ok || data.isSuccess !== 'true') {
  console.error(new ProviderError('登录预检', response.status).message);
  process.exitCode=1;
} else {
  const info=data.signatureInfo || {};
  const cas=data.loginInteractInfo?.cas?.casLoginRedirectUrl;
  console.log(JSON.stringify({
    loginEntryAvailable:true,
    statePreserved:info.state===attempt.state,
    pkceChallengePreserved:info.code_challenge===new URL(attempt.authorizeUrl).searchParams.get('code_challenge'),
    redirectPreserved:info.redirect_uri===attempt.redirectUri,
    loginHost:cas ? new URL(cas).hostname : null,
    tokenExchangeVerified:false, refreshVerified:false,
  },null,2));
}

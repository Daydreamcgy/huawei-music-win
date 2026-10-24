import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fetch as httpFetch } from 'undici';

export const AUTHORIZE_ENDPOINT = 'https://oauth-login.platform.hicloud.com/oauth2/v3/authorize';
export const TOKEN_ENDPOINT = 'https://oauth-login.cloud.huawei.com/oauth2/v3/token';
export const MUSIC_ENDPOINT = 'https://api-drcn.music.dbankcloud.cn';
// Public client identifier from the author's published interoperability instructions.
// Code exchange was verified with user consent; refresh and distribution suitability need separate validation.
export const RESEARCH_CLIENT = Object.freeze({
  clientId: '101444301', redirectUri: 'hms://redirect_uri', scopes: ['openid'],
});

export function challengeFor(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function createAttempt(config = RESEARCH_CLIENT, now = Date.now()) {
  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri,
    response_type: 'code', access_type: 'offline', scope: config.scopes.join(' '),
    state, code_challenge: challengeFor(verifier), code_challenge_method: 'S256',
    countryCode: 'cn', ui_locales: 'zh-cn',
  });
  return { ...config, verifier, state, createdAt: now, consumed: false,
    authorizeUrl: `${AUTHORIZE_ENDPOINT}?${params}` };
}

export function isCallback(url, attempt) {
  try {
    const actual = new URL(url), expected = new URL(attempt.redirectUri);
    return actual.protocol === expected.protocol && actual.hostname === expected.hostname
      && actual.port === expected.port && actual.pathname === expected.pathname
      && !actual.username && !actual.password && !actual.hash;
  } catch { return false; }
}

const LOGIN_HOSTS = new Set([
  'oauth-login.platform.hicloud.com', 'id1.cloud.huawei.com', 'oauth-login.cloud.huawei.com',
  'account.huawei.com', 'consumer.huawei.com',
]);

// The authorize page picks a regional CAS host from the getLoginWay response (observed id5,
// id1 in other networks). Only the numeric-region form is accepted so lookalike hosts stay out.
const REGIONAL_CAS_HOST = /^id\d{1,2}\.cloud\.huawei\.com$/;
// The CAS hop returns to the OAuth host of the same region (observed oauth-login5 with id5,
// oauth-login1 with id1). Only the numeric-region form and the callback route are accepted.
const REGIONAL_OAUTH_HOST = /^oauth-login\d{1,2}\.cloud\.huawei\.com$/;

export function isAllowedLoginUrl(value) {
  try {
    const url = new URL(value);
    // The official getLoginWay response places this regional OAuth service in the
    // CAS `service` parameter. Blocking it strands the QR page before hms:// exists.
    // Allow only the observed callback route, not arbitrary regional hosts or paths.
    const regionalCallback = REGIONAL_OAUTH_HOST.test(url.hostname)
      && url.pathname === '/oauth2/v3/loginCallback';
    return url.protocol === 'https:'
      && (LOGIN_HOSTS.has(url.hostname) || regionalCallback || REGIONAL_CAS_HOST.test(url.hostname))
      && !url.username && !url.password && !url.port;
  } catch { return false; }
}

export function consumeCallback(url, attempt, now = Date.now()) {
  if (attempt.consumed) throw new Error('授权回调已使用');
  if (now - attempt.createdAt > 10 * 60_000 || now < attempt.createdAt) throw new Error('授权尝试已过期');
  if (!isCallback(url, attempt)) throw new Error('回调地址不匹配');
  const params = new URL(url).searchParams;
  if (['state', 'code', 'error'].some(key => params.getAll(key).length > 1)) throw new Error('回调参数重复');
  const state = params.get('state') || '';
  const a = Buffer.from(state), b = Buffer.from(attempt.state);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('OAuth state 不匹配');
  attempt.consumed = true;
  if (params.has('error')) throw new Error('用户取消授权或授权服务拒绝请求');
  const code = params.get('code');
  if (!code) throw new Error('回调缺少授权码');
  return code;
}

// Deliberately do not put provider error descriptions, responses or URLs into errors:
// providers can echo credentials. Callers may display only these structural fields.
export class ProviderError extends Error {
  constructor(stage, status, data = {}) {
    super(`${stage}失败（HTTP ${status}）`);
    this.name = 'ProviderError';
    this.stage = stage;
    this.status = status;
    this.code = String(data.error ?? data.result?.resultCode ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    this.subCode = Number.isFinite(Number(data.sub_error)) ? Number(data.sub_error) : null;
  }
}

async function post(url, body, headers, stage, fetchImpl = httpFetch) {
  let response;
  try {
    response = await fetchImpl(url, {method:'POST', body, headers,
      signal:AbortSignal.timeout(25_000), redirect:'error'});
  } catch { throw new Error(`${stage}网络请求失败`); }
  let data;
  try { data = await response.json(); } catch { throw new ProviderError(stage, response.status); }
  if (!response.ok || data.error !== undefined || (data.result && data.result.resultCode !== '000000')) {
    throw new ProviderError(stage, response.status, data);
  }
  return data;
}

export async function exchangeCode(code, attempt, fetchImpl = httpFetch) {
  const body = new URLSearchParams({grant_type:'authorization_code', client_id:attempt.clientId,
    redirect_uri:attempt.redirectUri, code, code_verifier:attempt.verifier});
  const data = await post(TOKEN_ENDPOINT, body, {'Content-Type':'application/x-www-form-urlencoded'}, '授权码兑换', fetchImpl);
  if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('响应缺少账号访问令牌');
  return data;
}

export async function refreshAccessToken(refreshToken, config, clientSecret, fetchImpl = httpFetch) {
  // Test the actual public-client grant instead of inferring behavior from fake-token errors.
  // Never embed or extract an official app secret. Optional secret is for an owned client only.
  if (typeof refreshToken !== 'string' || !refreshToken) throw new Error('缺少刷新令牌');
  if (config.clientId === RESEARCH_CLIENT.clientId && clientSecret) throw new Error('研究客户端不接受私密应用凭据');
  const body = new URLSearchParams({grant_type:'refresh_token', client_id:config.clientId,
    refresh_token:refreshToken});
  if (clientSecret) body.set('client_secret',clientSecret);
  const data=await post(TOKEN_ENDPOINT, body, {'Content-Type':'application/x-www-form-urlencoded'}, '令牌刷新', fetchImpl);
  if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('响应缺少账号访问令牌');
  // OAuth refresh responses may omit refresh_token: retain the current one, but use rotation if returned.
  return {...data,refresh_token:data.refresh_token || refreshToken};
}

export function musicHeaders(token, now = new Date()) {
  const created = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const nonce = randomBytes(24).toString('base64url');
  if (token && /[\r\n,]/.test(token)) throw new Error('音乐会话令牌格式无效');
  return {'Content-Type':'application/json',
    Authorization:`Digest username=app-music-baseline, nonce=${nonce}, created=${created}${token ? `, token=${token}` : ''}`};
}

export async function exchangeMusicSession(accessToken, fetchImpl = httpFetch) {
  const data = await post(`${MUSIC_ENDPOINT}/music-odpapp-service/v5/service/userinfo/loginex`,
    JSON.stringify({accessToken}), musicHeaders(), '音乐会话兑换', fetchImpl);
  if (typeof data.token !== 'string' || !data.token) throw new Error('响应缺少音乐会话令牌');
  return data;
}

export function summarizeTokens(tokens, music) {
  return {hasAccessToken:!!tokens.access_token, hasRefreshToken:!!tokens.refresh_token,
    expiresIn:Number.isFinite(Number(tokens.expires_in)) ? Number(tokens.expires_in) : null,
    hasMusicSession:!!music?.token, musicResult:music?.result?.resultCode ?? null};
}

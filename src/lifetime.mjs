// Only durations and structural flags; never persist tokens, cookie names/values or user IDs.
export function lifetimeSummary(tokens, music, cookies=[], now=Date.now()) {
  const seconds=value=>value!==undefined&&value!==null&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0 ? Number(value):null;
  const raw=String(music?.expireTime??'');
  // Legacy code parses yyyyMMddHHmmss without a documented server timezone.
  const compact=/^\d{14}$/.test(raw);
  const persistent=cookies.filter(c=>Number.isFinite(c.expires)&&c.expires>0);
  return {
    accessTokenExpiresInSeconds:seconds(tokens.expires_in),
    refreshTokenExpiresInSeconds:seconds(tokens.refresh_token_expires_in),
    refreshTokenLifetimeVerified:false,
    musicExpireTime:compact ? raw : null,
    musicExpireTimeTimezoneVerified:false,
    hasMusicExpireTime:!!raw,
    browserCookies:{count:cookies.length,sessionCookieCount:cookies.length-persistent.length,
      persistentExpiryRemainingSeconds:persistent.map(c=>Math.max(0,Math.floor(c.expires-now/1000))).sort((a,b)=>a-b),
      serverSessionLifetimeVerified:false},
  };
}

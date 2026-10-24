import test from 'node:test';
import assert from 'node:assert/strict';
import {lifetimeSummary} from '../src/lifetime.mjs';
test('lifetime metadata does not expose credential values and does not guess RT lifetime',()=>{
 const data=lifetimeSummary({access_token:'SECRET',refresh_token:'RTSECRET',expires_in:3600},
  {token:'MUSICSECRET',expireTime:'20261015180000'},
  [{name:'secret-name',value:'COOKIESECRET',expires:-1},{name:'other',value:'SECRET',expires:120}],100000);
 assert.equal(data.accessTokenExpiresInSeconds,3600);assert.equal(data.refreshTokenExpiresInSeconds,null);
 assert.equal(data.musicExpireTime,'20261015180000');assert.equal(data.musicExpireTimeTimezoneVerified,false);
 assert.deepEqual(data.browserCookies.persistentExpiryRemainingSeconds,[20]);
 assert.equal(data.browserCookies.sessionCookieCount,1);
 assert.ok(!JSON.stringify(data).includes('SECRET'));assert.ok(!JSON.stringify(data).includes('secret-name'));
});
test('unknown expiration formats are not treated as timestamps',()=>{
 const data=lifetimeSummary({expires_in:'bad'},{expireTime:'unknown'});
 assert.equal(data.accessTokenExpiresInSeconds,null);assert.equal(data.musicExpireTime,null);
});

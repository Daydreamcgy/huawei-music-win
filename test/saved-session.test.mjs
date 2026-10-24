import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveMusicSession,loadMusicSession} from '../src/saved-session.mjs';
test('save minimal music credentials with restrictive permissions and no account token',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'music-session-'));
 try {
  const info=await saveMusicSession({token:'TEST-ONLY',snsUserID:'SELF',expireTime:'20261015180000',unneeded:'exclude'},3600,dir);
  assert.ok(!JSON.stringify(info).includes('TEST-ONLY'));
  const file=join(dir,'session.json');assert.equal((await loadMusicSession(file)).music.token,'TEST-ONLY');
  assert.ok(!(await readFile(file,'utf8')).includes('unneeded'));
  if(process.platform!=='win32'){assert.equal((await stat(file)).mode&0o777,0o600);assert.equal((await stat(dir)).mode&0o777,0o700);}
 } finally {await rm(dir,{recursive:true,force:true});}
});

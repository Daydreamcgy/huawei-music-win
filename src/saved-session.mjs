import {mkdir,chmod,writeFile,rename,readFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
export const SESSION_DIR=resolve('.local/music-lifetime-test');
export const SESSION_FILE=resolve(SESSION_DIR,'session.json');
export async function saveMusicSession(music,accessExpiresIn,dir=SESSION_DIR) {
  if(typeof music?.token!=='string'||!music.token)throw new Error('缺少音乐会话');
  await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
  const record={version:1,savedAt:new Date().toISOString(),accountAccessExpiresIn:Number(accessExpiresIn)||null,
    music:{token:music.token,snsUserID:music.snsUserID,expireTime:music.expireTime}};
  const tmp=resolve(dir,`session-${randomBytes(8).toString('hex')}.tmp`);
  await writeFile(tmp,JSON.stringify(record),{mode:0o600,flag:'wx'});
  await rename(tmp,resolve(dir,'session.json'));
  return {savedAt:record.savedAt,accountAccessExpiresIn:record.accountAccessExpiresIn,
    musicExpireTime:/^\d{14}$/.test(String(music.expireTime))?String(music.expireTime):null};
}
export async function loadMusicSession(file=SESSION_FILE) {
  const stat=await lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error('会话文件类型错误');
  if(process.platform!=='win32' && (stat.mode&0o077)!==0)throw new Error('会话文件权限过宽');
  const data=JSON.parse(await readFile(file,'utf8'));
  if(data.version!==1||!data.music?.token||!Number.isFinite(Date.parse(data.savedAt)))throw new Error('会话文件无效');
  return data;
}

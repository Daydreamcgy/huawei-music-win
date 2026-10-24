"""Build a Windows x64 portable research bundle; no credentials or raw captures."""
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
VERSION = 'v22.23.3'
ARCHIVE = f'node-{VERSION}-win-x64.zip'
BASE = f'https://nodejs.org/dist/{VERSION}/'

def fetch(name):
    with urllib.request.urlopen(BASE + name, timeout=90) as response:
        return response.read()

checksums = fetch('SHASUMS256.txt').decode()
expected = next(line.split()[0] for line in checksums.splitlines() if line.split()[-1] == ARCHIVE)
raw = fetch(ARCHIVE)
actual = hashlib.sha256(raw).hexdigest()
if actual != expected:
    raise SystemExit('Node archive checksum mismatch')

out = ROOT / 'dist'
out.mkdir(exist_ok=True)
path = out / 'huawei-music-auth-lab-win-x64.zip'
prefix = 'huawei-music-auth-lab/'
with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as bundle:
    with zipfile.ZipFile(io.BytesIO(raw)) as node:
        for name in ['node.exe', 'LICENSE']:
            bundle.writestr(prefix + ('NODE-LICENSE.txt' if name == 'LICENSE' else name), node.read(f'node-{VERSION}-win-x64/{name}'))
    for name in ['package.json','package-lock.json','README.md','docs/login-research.md',
                 'src/auth.mjs','src/music.mjs','src/refresh-probe.mjs','src/lifetime.mjs','src/reauthorize.mjs','src/saved-session.mjs','scripts/auth-lab.mjs',
                 'scripts/probe-login.mjs','scripts/probe-music.mjs','scripts/test-callback-browser.mjs']:
        bundle.write(ROOT / name, prefix + name)
    dependency = ROOT / 'node_modules/playwright-core'
    for file in dependency.rglob('*'):
        if file.is_file():
            bundle.write(file, prefix + str(file.relative_to(ROOT)).replace('\\','/'))
    launcher = '@echo off\r\ncd /d "%~dp0"\r\nnode.exe scripts\\auth-lab.mjs --login\r\necho.\r\npause\r\n'
    bundle.writestr(prefix + 'START-LOGIN.cmd', launcher)
    preflight = '@echo off\r\ncd /d "%~dp0"\r\nnode.exe scripts\\probe-login.mjs\r\nnode.exe scripts\\probe-music.mjs\r\necho.\r\npause\r\n'
    bundle.writestr(prefix + 'CHECK.cmd', preflight)
    instructions = '''华为音乐登录验证包（Windows x64）

1. 完整解压 ZIP 到一个目录，不要在压缩包内直接运行。
2. 双击 START-LOGIN.cmd，打开系统 Edge 的临时窗口。
3. 只在华为官方页面扫码或输入短信验证码，核对应用和授权权限。
4. 程序尝试兑换音乐会话并检查个人收藏/歌单，只显示脱敏状态。
5. 把最后的成功/错误状态反馈即可，不要发送密码、授权码、Cookie 或令牌。

这是研究原型，不是已完成的音乐播放器；授权成功与自动续期仍未验证。
所用 client_id 来自公开研究资料，并非为本项目申请的正式应用。
程序不会保存登录状态，因此本次授权结果仅用于验证，退出后丢弃。
不想授权可以随时关掉窗口。CHECK.cmd 仅检查公开接口，不登录账号。
需要 Windows x64 和已安装的 Microsoft Edge，不需要安装 Node.js。
如管理员策略禁用浏览器自动化，验证可能失败；不要为此关闭系统安全防护。
'''
    bundle.writestr(prefix + '使用说明.txt', instructions.encode('utf-8-sig'))
    bundle.writestr(prefix + 'build-manifest.json', json.dumps({
        'nodeVersion':VERSION,'nodeArchiveSHA256':actual,
        'playwrightVersion':json.loads((dependency/'package.json').read_text())['version'],
        'credentialPersistence':False,'windowsEndToEndTested':False,
    },indent=2))
sha = hashlib.sha256(path.read_bytes()).hexdigest()
(path.with_suffix('.zip.sha256')).write_text(f'{sha}  {path.name}\n')
print(f'Built {path.name}: {path.stat().st_size:,} bytes')
print(f'SHA256 {sha}')

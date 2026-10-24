# Windows 运行手册（本机实测记录）

本目录是 `talongao/huawei-music-desktop` 的工作副本，用于在这台 Windows 上跑通「用自己华为账号播放华为音乐」。

## 启动

```powershell
cd D:\Desktop\WorkSpace\huawei-music\app
npm ci          # 首次
npm start       # 构建 + 启动
```

如果启动后窗口一片空白或直接报 `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`，说明当前终端继承了
`ELECTRON_RUN_AS_NODE=1`（Electron 会退化成纯 Node）。清掉再启动：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE
npm start
```

## 本次为 Windows 做的改动

| 文件 | 改动 | 原因 |
|---|---|---|
| `package.json` | 未改（`type: module` 保持） | ESM 主进程本身可用，问题在环境变量 |
| `src/auth.mjs` | 登录白名单新增 `idN.cloud.huawei.com`（`/^id\d{1,2}\.cloud\.huawei\.com$/`） | 授权页会按网络把登录跳到 `id5.cloud.huawei.com/CAS/...`，原白名单只有 `id1`，导致登录页白屏 |
| `src/main/huawei.ts` | 登录导航加 `[login-blocked]` / `[login-allowed]` 日志 | 排查登录白屏，后续可删 |
| `test/auth.test.mjs` | 同步白名单用例 | 保持 `npm test` 通过 |
| `src/auth.mjs` | 地域 OAuth 回调主机 `oauth-loginN.cloud.huawei.com`（仅 `/oauth2/v3/loginCallback`） | id5 区网络下 CAS 回跳的是 `oauth-login5`，原白名单只放行 `oauth-login1`，扫码后当场失败 |
| `src/main/index.ts` | 无进程代理变量时对 app session 强制 `direct`（`HWMUSIC_USE_SYSTEM_PROXY=1` 可回退） | Windows 系统代理（Clash 全局 7890）会把音乐 CDN 也代理出去，CDN 直接 404，表现为「浏览器未能开始播放」 |

## 代理：必须直连（实测）

这条是 Windows 上最容易踩的坑，症状是**部分歌曲能放、大部分报「浏览器未能开始播放」**。

同一首歌的媒体地址实测：

| 路径 | 结果 |
|---|---|
| 直连 `xz.tingmall.com/...mp3?sign=...` | `200` `audio/mpeg` 2.1MB |
| 走 `http://127.0.0.1:7890` | `404` |

代理会让 `audio.play()` 收到 `NotSupportedError`（服务端返回的是错误页，不是音频）。修法是让应用自己直连，而不是要求用户切 Clash 规则模式：

- 不设任何 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` → 应用 session 用 `direct`，**系统代理开着也不影响**。
- 需要走代理时显式设置环境变量（登录页也会用同一份配置）。
- `HWMUSIC_USE_SYSTEM_PROXY=1` → 恢复继承系统代理（调试用）。

修完后 10/10 首连续播放成功，无损 FLAC（`...-FLAC-1000K-FTD.flac`）同样可放。

## 登录流程（实测路径）

1. 应用内点「扫码登录」→ 官方 `oauth-login.platform.hicloud.com/oauth2/v3/authorize`。
2. 页面判定 `loginType=TICKET`，跳 `id5.cloud.huawei.com/CAS/remoteLogin` → `CAS/portal/loginAuth.html`（华为账号登录页，含二维码）。
3. 手机扫码授权 → CAS 带 ticket 回到 `oauth-login1.cloud.huawei.com/oauth2/v3/loginCallback` → 发 `code` → `hms://redirect_uri`（应用内拦截，不注册系统协议）。
4. `oauth2/v3/token` 换账号 AT → `music-odpapp-service/v5/service/userinfo/loginex` 换音乐会话 token。
5. 音乐业务域：`https://api-drcn.music.dbankcloud.cn`（直连可达，无需代理）。

注意：音乐会话约 7 天，refresh 流程未打通，过期需重新扫码。

## 待验收

- [x] 扫码登录成功、重启后凭据可恢复（`safeStorage`/DPAPI）——2026-10-24 实测
- [x] 收藏/歌单列表拉取——154 首收藏，首屏 50 首
- [x] 会员曲目真实播放（标准 / 无损）——10/10 首 MP3 起播，FLAC 1000K 起播
- [x] 歌词——服务端歌词渲染正常
- [ ] 进度拖动、媒体键、托盘、关闭窗口行为、单实例
- [ ] 播放历史上报是否落库（服务端确认）

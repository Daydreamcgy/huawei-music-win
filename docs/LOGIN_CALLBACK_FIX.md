# Electron 扫码成功后停在 CAS 页面：根因与最小修复

核验日期：2026-10-15。范围：当前 `openLogin()` 的 OAuth 导航，不修改技术栈或音乐接口。

## 根因

`src/auth.mjs` 的 `isAllowedLoginUrl()` 漏掉了官方当前使用的区域 OAuth 服务：

```text
https://oauth-login.platform.hicloud.com/oauth2/v3/authorize
  → https://id1.cloud.huawei.com/CAS/remoteLogin
  → https://id1.cloud.huawei.com/CAS/portal/loginAuth.html
  → https://oauth-login1.cloud.huawei.com/oauth2/v3/loginCallback
  → hms://redirect_uri?code=...&state=...
```

这里的区域主机是 **oauth-login1**，不是原白名单中的 oauth-login。它出现在华为 `getLoginWay` 响应的 `loginInteractInfo.cas.casLoginRedirectUrl` 的 `service` 查询参数内。

本次不使用个人账号的在线预检确认：

- CAS origin/path 为 `https://id1.cloud.huawei.com` + `/CAS/remoteLogin`，旧白名单允许。
- service origin/path 为 `https://oauth-login1.cloud.huawei.com` + `/oauth2/v3/loginCallback`，旧白名单拒绝。
- 中间 service 携带的 state、redirect_uri、code_challenge 与本次授权请求一致。

`src/main/huawei.ts` 的 `rejectUnknownNavigation` 在 will-navigate/will-redirect 上调用这个白名单。扫码后即使华为已经认可账号，跳回 OAuth 服务仍会被 preventDefault。此时页面留在绿色勾的 CAS 页，最终 hms:// 根本没生成；给 CDP observer 增加更多事件不能弥补被拦掉的中间请求。

之前测试仅在登录页直接发出合成 hms://，绕过 service 导航，故未覆盖该缺陷。

## 最小生产修改

只在 `src/auth.mjs` 的 `isAllowedLoginUrl()` 添加一个精确例外：

```js
const regionalCallback = url.hostname === 'oauth-login1.cloud.huawei.com'
  && url.pathname === '/oauth2/v3/loginCallback';
return url.protocol === 'https:' && (LOGIN_HOSTS.has(url.hostname) || regionalCallback)
  && !url.username && !url.password && !url.port;
```

URL parser 将 HTTPS 的显式 443 规范化为空 port，仍允许默认 HTTPS 端口。其他端口、userinfo、近似域名、子域、`oauth-login2`、本区域主机的其他路径均拒绝。

不放行 `*.huawei.com`，不把 service 查询字符串解开当成最终 code。区域 loginCallback 是允许网页继续导航的中间地址，**不是**已完成授权的终点。最终仍只接受精确的 `hms://redirect_uri`，并走原 `consumeCallback()` 的 state、过期、重复参数和单次消费校验。

## 已检查但不需要改动的部分

- `src/auth.mjs/createAttempt()` 的 client_id、redirect_uri、state、PKCE 与以前成功的流程一致。
- `src/login-callback.mjs` 已观察 Page.frameRequestedNavigation、Page.frameScheduledNavigation、Page.frameNavigated；这轮补强测试，没有重写 observer。
- `src/main/huawei.ts/openLogin()` 已监听 will-navigate、will-redirect、setWindowOpenHandler，并安装限定在临时登录窗口的 CDP observer。当前复现路径是同一顶层窗口，尚无证据要求全局抓取网络响应或放宽任意 frame。
- 没有注册全局 hms://、没有关闭 TLS/webSecurity、没有改权限请求策略、没有改令牌交换。
- 未假定账号/二维码出错，也没有注入生产“登录成功”状态。

## 回归测试

### 无账号离线 Electron 回归

新命令：

```sh
npm run test:login-callback
```

脚本 `scripts/test-electron-login-callback.mjs` 启动正式构建的 App，点击正式登录按钮。在仅测试进程的临时 login partition 安装本地 HTTPS protocol fixture，不访问网络、不关闭证书检查、不修改生产白名单。

覆盖：

1. 初始 authorize → CAS 页面。
2. 页面脚本导航到区域 service callback。
3. 另一用例经同域 HTTP 302 再跳区域 service callback，覆盖 will-redirect。
4. service 产生自定义协议导航，经过正式导航/CDP 回调处理。
5. **最终使用故意错误的 state**，要求生产代码拒绝，账号保持未登录，不调用 token endpoint。
6. 近似恶意主机、区域主机无关路径在请求前被拒绝。
7. 临时 session 清理，登录窗无 Node/业务 preload。

修复前复现：`serviceReached=false`、`callbackRequested=false`、页面仍在 `/CAS/portal/loginAuth.html`。
修复后两个合法中间导航用例成功抵达 service，保留 state/PKCE/redirect，最终错误 state 被拒绝；两个非法目标被请求前拦截。

该测试证明导航策略与回调校验正确，**不是本人扫码成功的替代证明**。

### 在线公开入口与现有 smoke

如需代理，仅给测试进程传入当前环境的 `HTTP_PROXY`/`HTTPS_PROXY`，不改系统代理；本机代理地址和端口不写入仓库：

```sh
npm run test:login-navigation
npm run test:login-cancel

npm test
npm run test:electron
```

`test:login-navigation` 已增加官方 getLoginWay 的 CAS/service 检查，只输出 origin/path 和布尔绑定结果；如果官方变更到新区域主机，它会明确失败，不自动扩大白名单。

本轮通过：75 项单元测试、类型检查/构建、离线 service 导航回归、代理下公开入口导航检查、正式取消/错误 state/清理故障 smoke、Electron renderer/本地音频/代理 smoke。

### 本人真实扫码最终复验

新增 `scripts/test-electron-login-live.mjs`，默认无 --login 只显示帮助。服务端无桌面可执行：

```sh
npm run test:login-live -- --login --qr
```

长等待需后台运行；找到 `QR_READY` 文件后交给本人扫码。该工具启动正式 App 和真实官方页面，不导入已有研究凭据，也不提供伪造成功开关。它只输出主机/路径、登录状态、收藏读取成功与数量，不输出 URL query、state、code、token 或 Cookie。扫码后验证正式会话提交和只读收藏，完成后销毁临时 App/profile 并删除 QR 截图；不截取个人音乐库。

输出 `authenticated=true` 且 favorites.success=true 才能确认这一次真实扫码链路。Linux safeStorage 不可用时报告 memory-only，不把导航修复说成安全持久化已完成。

旧 `scripts/.tmp-authorized-login.mjs` 会输出导航 URL 前缀并持续截图，真实账号复验不要使用它；本次保留原文件不破坏已有工作现场。

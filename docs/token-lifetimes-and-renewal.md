# 令牌有效期与续期路线

研究日期：2026-10-14。事实分为本人账号实测、官方通用文档、待验证假设。

## 后续实验更新与首版决策

用户后续要求关闭所有浏览器/进程再验证原音乐会话。已记录 expireTime=`20261021101354`，若按UTC解释约7天，但时区/实际七天寿命未完全验证。原token在新进程、保存后4674秒（77分54秒）继续成功读取收藏和历史。证据见 [跨进程复测](pending-lifetime-check.md)。

下面关于“尚未记录音乐 expireTime”的内容是早期过程，已被此结果更新。正式第一版不依赖保持浏览器运行，也不依赖未验证的SSO续期；采用系统安全存储保存音乐会话，服务端确认失效后才要求重新扫码。SSO代码保留为后续实验，不是正在运行的后台任务。

## 有效期

| 凭据 | 当前可确认的期限 | 证据与限制 |
|---|---|---|
| OAuth Authorization Code | 一次性，具体时间未知 | 本项目取得后立即兑换；没有查到适用于当前客户端的准确秒数，不猜 5/10 分钟 |
| Account Access Token | 3600 秒（1 小时） | 两次本人扫码返回 expires_in=3600；这不是音乐业务 token 的期限 |
| Account Refresh Token | 官方 Web 文档写 180 天 | 本人确实取得，但未保存/观测其真实期限，且无密钥 refresh grant 已失败；180 天不代表免登录承诺 |
| Music loginex token | 未知 | loginex 结构包含 expireTime，早期工具按 yyyyMMddHHmmss 解析；之前验证未记录，不能恢复已丢弃响应，也不能据此推断时区 |
| ID Token | 未知（如返回，应验签并看 exp） | 身份声明，不是音乐接口凭据；当前无需求，不使用未验签 JWT 作授权决策 |
| 浏览器登录 Cookie / CAS 会话 | 未知 | Cookie 的 expires 只说明浏览器端期限，无法代表服务端会话存活时间；session Cookie 没有固定到期日期 |
| 下载工具作者提及的 ucs_token | 作者称“预计 180 天” | 不是本项目观察到的标准字段；不能断言等于 Refresh Token 或音乐 loginex token |

官方 H5 的 getHeads/getPubPackageHeads 对缓存 token 采用 36e5 毫秒（一小时）阈值，超时调用原生 getCsToken。**这是前端取缓存策略，不是 token 服务端硬有效期**。实际更新隐藏在原生应用内，不能把桥接函数当作可直接调用的 HTTP 刷新接口。

## 路线一：标准 Refresh Token grant

当前请求 client_id=101444301 + grant_type=refresh_token + 本人 refresh_token，不带 client_secret，实测返回 1101/20171（HTTP 400）。公开 Web 文档将 client_secret 标为必选，OIDC discovery 声明 client_secret_post。

PKCE 是授权码保护，不等于取消客户端刷新鉴权。额外加 code_verifier 的虚构令牌测试也得到缺少 client_secret，未用真实令牌测试该变体，不宣称它绝对无效。

官方 AppAuth Android/iOS 指南仅列 client_id、redirect_uri、scope、端点，没有给出适用于本音乐客户端的完整无密钥刷新保证。因此不再根据通用 AppAuth 示例推断当前配置必然可刷新。

自有注册应用的 client_secret + 后端是标准方案，但自有应用的 token 是否能兑换华为音乐会话未知，不能把注册账号登录应用当作已经获得音乐接入权限。绝不从其他应用提取私密凭据。

## 路线二：保留官方 CAS 登录会话，重新走授权码

这是当前最值得验证的方案：本人首次扫码后保留**同一个浏览器上下文**，再发起新的 OAuth state/PKCE 请求，用仍有效的官方 Cookie 换新 code，再走已经成功过的 code → AT → music token。

- 它是重新授权/SSO，不是标准 refresh grant。
- 必须实际验证会不会要求再次扫码/同意/风控验证。
- 官方 getLoginWay 预检保留 prompt=none。
- 本次在无 Cookie 的 Chromium 中实测 prompt=none 仍显示官方登录页面，没有观察到立即返回 login_required；所以不能假设服务严格执行 OIDC 静默行为，也不能把空上下文结果外推到已登录会话。
- 尚未使用本人的已登录上下文测试，因为此前进程已退出、Cookie 未保存。
- 实验仅观察导航，不自动点击同意、不改动用户授权。
- 即便同一进程成功，仍需验证跨进程安全存储、服务端会话失效、退出撤销与重新授权。不是“永久免扫码”。

已实现 `src/reauthorize.mjs`，在原上下文中新建页执行一次限时 25 秒的二次授权，成功后用新 AT 兑换音乐会话并读历史。

`--test-reauthorize --wait-expiry` 会：
1. 首次授权后记录纯期限元数据（不记录 token、Cookie 名或值）。
2. 立即尝试同上下文免交互二次授权。
3. 等最初 AT 有效期再加 60 秒。
4. 用原 music token 读历史，观察 music token 是否独立于 AT 继续有效。
5. 再用原浏览器上下文尝试获取新 code/AT/music token。

以上流程已编码，**本人会话部分未运行**。不在用户未准备扫码时自动生成短时效二维码。

## 路线三：独立音乐业务会话

如果 music token 生命周期长于 AT，可在 AT 过期后继续工作，这能够降低重新授权频率，却不是续期方案本身。

应先记录真实 expireTime 和服务端 Date/时间规范，再实际观测到期行为。不能简单缓存 180 天，也不能因 H5 一小时更新缓存就硬判音乐 token 一小时失效。

当前没有找到可独立验证的 music token → 新 music token HTTP 接口。getCsToken 是原生桥，不应猜接口路径盲试。

## 已完成工作

- 读取官方刷新文档、Android/iOS AppAuth 指南、HMS silentSignIn 指南。
- 区分 HMS SDK 的静默登录与浏览器 CAS SSO；前者依赖 SDK 维护授权，不是 Windows 通用刷新接口。
- 两种 prompt 参数预检与匿名浏览器实验完成。
- 添加寿命脱敏摘要、同上下文二次授权和到期后测试代码。
- 全部 25 项离线测试通过，二次授权代码语法检查通过。没有新增本人授权测试，不宣称 SSO 已成功。

## 来源

- https://developer.huawei.com/consumer/cn/doc/development/HMSCore-Guides/web-refresh-access-token-0000001050048952
- https://developer.huawei.com/consumer/cn/doc/development/HMSCore-Guides/app-auth-access-huaweiid-android-0000001050434521
- https://developer.huawei.com/consumer/cn/doc/development/HMSCore-Guides/app-auth-access-huaweiid-ios-0000001148032958
- https://developer.huawei.com/consumer/cn/doc/development/HMSCore-Guides/login-silentsignin-0000001050050853
- https://oauth-login.cloud.huawei.com/.well-known/openid-configuration
- https://github.com/Tontonnow/hwyy/blob/main/auth/auth.go

本地证据：research/prompt-preflight.json、research/silent-entry-results.json、research/web/app.js 及 .local/auth-lab/refresh-status.log。

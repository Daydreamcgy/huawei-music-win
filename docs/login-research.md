# 登录研究与验证状态

> 此文件保留按时间推进的研究记录，下方早期“未验证”描述不代表现役结论。当前产品状态见 [README](../README.md)，实施要求见 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)，各 token 的最新界限见 [token-lifetimes-and-renewal.md](token-lifetimes-and-renewal.md)。真实扫码登录已成功，标准 RT 刷新失败，个人歌单读写和会员样本全曲解码已在后续完成。

更新时间：2026-10-14。目标是独立 Windows 客户端，不是手机遥控器或换源播放器。

## 最新：真实 Refresh Token 续期测试失败

2026-10-14 用户再次扫码授权，程序使用真实返回的 Refresh Token 请求官方 `/oauth2/v3/token`，参数为 `grant_type=refresh_token`、`client_id=101444301`、本人 refresh_token，不带 client_secret。

结果：HTTP 400，error=1101，sub_error=20171。此前相同错误码的负向测试消息为 `missing required parameter: client_secret`；本次程序只记录脱敏码，不记录原始响应内容。

- 真实授权码兑换仍成功，返回 Access Token、Refresh Token，expires_in=3600。
- 真实 Refresh Token 立即刷新失败，不能声明自动续期可用。
- 因立即刷新失败，没有进入等待 61 分钟后刷新阶段。
- 原 Access Token 兑换音乐会话成功，收藏/历史依旧返回 `000000`；歌单列表仍 HTTP 400。
- 程序已退出，凭据未持久保存。未实现跨重启保持登录。
- 该结果只否定当前参数和客户端配置下的刷新尝试，不证明华为不存在其他正式授权或会话续期方式。

证据：本地忽略目录 `.local/auth-lab/refresh-status.log`。后续优先核查官方公共客户端刷新要求及音乐会话生命周期，避免在没有新假设时反复要求用户扫码。

## 本人扫码端到端验证成功

用户在本次服务器无头 Chromium 会话中亲自扫码确认，运行 `scripts/auth-lab.mjs --login --headless --share-qr` 的结果：

- 环境为 Debian 13 服务器，不是 Ubuntu，也不是 Windows。
- 真实 OAuth 回调捕获和 state 校验成功。
- `openid` 最小 scope、PKCE S256 请求得到 Access Token 和 Refresh Token，`expires_in=3600`；请求未携带 client_secret。这证明本次授权码兑换无需 client_secret，不代表通用刷新请求也无需它。
- 账号 Access Token → 音乐 loginex 兑换成功，业务码 `000000`。
- 本人收藏 favorites 接口：业务码 `000000`。
- 本人播放历史 recent 接口：业务码 `000000`。
- playlists 接口：HTTP 400，尚未识别业务错误；需进一步检查参数/路由，不能认定账号没有歌单。
- 接口成功仅验证请求被业务接受，程序未展示/核对实际收藏条数与内容。
- 本次没有验证会员歌曲完整播放，也没有尝试真实 Refresh Token 刷新。
- 程序正常结束，账号令牌及音乐会话仅在内存，未持久保存。再次使用本人会话需要重新授权。

脱敏证据在本地忽略目录 `.local/auth-lab/status.log`。以下各节保留此前调研过程；其中“未验证真实兑换”的描述已被本节结果更新。

## 结论

找到并实测打开了浏览器 OAuth 登录入口，官方登录页提供扫码和短信登录。已独立实现登录验证程序，包括 PKCE、state、回调捕获、账号令牌兑换、音乐会话兑换，以及随后只读验证个人收藏/歌单/历史的代码。

**真实账号的授权码兑换、音乐会话兑换、收藏与历史读取已成功。私人歌单列表、真实令牌续期和会员播放仍未通过验证。**

## 已完成的真实验证

1. 在项目作者的公开说明中找到浏览器授权入口：
   - client_id：`101444301`
   - redirect_uri：`hms://redirect_uri`
   - response_type：`code`
   - access_type：`offline`
2. 使用官方公开前端同样调用的 `/oauth2/ajax/getLoginWay` 预检，返回 `isSuccess=true`。
3. 在 Chromium 中真实打开官方授权页，自动跳转至 `id1.cloud.huawei.com` 的账号登录页。
4. 页面显示扫码、短信验证码登录，二维码初始化及等待接口均返回 HTTP 200。未扫码、未提交账号密码。
5. 缩减为 `scope=openid` 后仍能打开登录页。**不代表这个最小权限足够换取音乐会话**，需真实授权后验证。没有照搬原帖子中钱包、云盘、生日、手机号等大量权限。
6. OAuth 预检原样保留 state、PKCE S256 challenge 与 callback。只证明参数被保留，不证明服务端在兑换时强制校验了 PKCE。
7. 普通本地回调 `http://127.0.0.1:8765/callback` 被拒绝：`redirect_uri not registered`，sub_error=20023。
8. 文档规定的 `com.huawei.apps.101444301:/oauth2redirect` 形式在预检中被接受；目前验证程序仍使用出处明确的 `hms://redirect_uri`，不擅自注册系统全局协议。
9. 使用本地测试页与虚构授权码，通过 Chromium CDP 捕获自定义协议导航成功，再通过 state 校验。不是华为真实授权后的回调测试。

## 令牌兑换：仍有条件未验证

向官方 `/oauth2/v3/token` 发送虚构授权码、不带 client_secret：

- 返回 HTTP 400，error=1101，sub_error=20152，`invalid code`。
- 这仅证明请求到达并被识别，**不能从错误检查顺序推断真实 code 可以无 client_secret 兑换**。

真实 code 只能在用户本人完成登录后得到，因此程序预先实现此路径，但未声明成功。

官方 Web 获取凭证文档将 client_secret 列为请求参数；官方 AppAuth Android 指南介绍纯浏览器 OAuth 接入，却没有在示例配置中列出 client_secret。不同客户端配置/类型可能存在差异，不能混为一谈。

## 自动续期：目前不能承诺

已用虚构 refresh token 进行负向测试：

- 不带 client_secret：`missing required parameter: client_secret`，sub_error=20171。
- 额外带 code_verifier：相同错误。
- 官方 OIDC discovery 声明 `token_endpoint_auth_methods_supported=["client_secret_post"]`，另声明支持 S256。

因此：**PKCE 支持不等于免 client_secret 自动续期。**

官方 Web 文档写 Access Token 有效期 1 小时、Refresh Token 180 天，但不能把这些期限无条件套用到音乐业务会话。程序应以真实返回值及服务错误为准。

原下载工具作者称闭源版本具备自动更新 token，并称 ucs_token 预计有效 180 天。这是作者声明，不是本项目已验证的机制；`ucs_token` 与标准 `refresh_token` 是否相同也未证明。没有下载/运行其闭源二进制，没有提取或使用官方应用私密 client_secret。

当前研究配置禁止调用自动刷新 helper；未来需验证允许的公共客户端刷新方式、使用自有应用凭据的正式接入，或明确采用重新授权。不能把密钥塞到桌面程序里冒充解决方案。

## 本人授权时的一次性验证流程

`npm run auth:lab -- --login`（Windows 默认使用系统 Edge）将：

1. 新建隔离的临时浏览器上下文，打开华为官方页面；用户核对应用及权限后自行授权。
2. 在浏览器内观察目标回调导航，不读取密码输入框，不注册全局 `hms://` 协议。
3. 校验准确的回调地址、state、有效期和单次消费规则。
4. 用授权码和 PKCE verifier 请求账号令牌。
5. 用账号访问令牌请求音乐 `loginex` 会话。
6. 如成功，继续只读检查本人收藏、歌单、播放历史，不输出具体用户数据。
7. 仅输出状态码和成功标记，令牌不落盘、关闭后丢弃。

原型不是正式持久登录实现。Windows 真机测试、授权应用显示名/归属核验、真实 callback、音乐会话权限和续期均需要后续验收。

关于 client_id 的出处（2026-10-17 复核）：

- 来源帖子（吾爱破解《华为音乐下载工具》，配套仓库 `Tontonnow/hwyy`）只公开了**带 `client_id=101444301` 的完整授权 URL**，让用户登录后从 `hms://redirect_uri?code=` 复制 code；帖中**没有说明该 id 如何获得**，只提到下载用的 `authorization` 头需要抓包、建议用模拟器。
- 我们自己的抓取（`research/probe-results.json` 等）显示：`101444301` 同时是**华为音乐在 AppGallery 的应用 ID**（官方站下载卡片指向 `appgallery.huawei.com/#/app/C101444301`，标题“华为音乐”），且官方注册的回调 scheme 形式为 `com.huawei.apps.101444301:/oauth2redirect`。
- 因此基本可以判定它是**华为音乐官方 App 自身的 OAuth 身份**，不是可供第三方注册使用的 client。这也解释了标准 refresh 一直返回 1101/20171：我们没有、也不应取得该应用的完整客户端配置。
- 结论：该 id 不属于本项目，随时可能失效；用它登录会把流量记在官方应用名下；随客户端分发涉及服务条款与身份冒用问题。本项目发布二进制时只在 GitHub Release 提供未签名的学习构建，并在发布说明中写明上述风险；不另开对象存储或网盘等公开分发渠道。

## Windows 验证交付物

已制作 `dist/huawei-music-auth-lab-win-x64.zip`，自带 Node v22.23.3 与 playwright-core，默认使用系统 Edge。解压后双击 `START-LOGIN.cmd` 即可发起本人登录，不需要安装开发环境。

构建时已校验 Node 官方 SHA-256 清单、ZIP 完整性和原始研究文件排除情况。没有 Windows 机器，所以不声明 Windows 真机验证通过。

## 代码与验证

本次结果：17 项离线测试通过；独立实现的音乐搜索/公开歌单真实请求通过；官方登录入口 state/PKCE 参数预检通过；本地虚构自定义协议回调浏览器集成测试通过。

- `src/auth.mjs`：OAuth / 音乐会话协议及安全校验。
- `src/music.mjs`：只读音乐 API，私人请求只针对会话本人的 SNS ID。
- `scripts/probe-login.mjs`：不登录账号的真实入口预检。
- `scripts/auth-lab.mjs`：本人授权的端到端验证工具。
- `scripts/test-callback-browser.mjs`：纯本地虚构回调的浏览器集成测试。
- `test/`：PKCE 标准向量、state、重复参数、过期、重放、错误脱敏及只读会话测试。

没有实现密码代填、接管已登录个人浏览器、第三方中转令牌、自动扩大授权权限或音源替换。

## 来源

- 作者公开说明：https://www.52pojie.cn/thread-2017353-1-1.html
- 作者仓库及 issue：https://github.com/Tontonnow/hwyy/issues/1
- 官方浏览器授权入口：https://oauth-login.platform.hicloud.com/oauth2/v3/authorize
- 官方 OIDC discovery：https://oauth-login.cloud.huawei.com/.well-known/openid-configuration
- 官方获取凭证：https://developer.huawei.com/consumer/cn/doc/development/HMSCore-Guides/web-get-access-token-0000001050048946
- 官方更新凭证：https://developer.huawei.com/consumer/cn/doc/development/HMSCore-Guides/web-refresh-access-token-0000001050048952
- 官方 AppAuth Android 指南：https://developer.huawei.com/consumer/cn/doc/development/HMSCore-Guides/app-auth-access-huaweiid-android-0000001050434521

原始网页、响应和截图仅留在 git 忽略的 `research/`。所有测试未登录真实账号，也没有向任何用户发送短信或修改账号数据。

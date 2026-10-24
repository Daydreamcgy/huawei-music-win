# 华为音乐第三方桌面客户端：技术选型与执行方案

版本：2026-10-14。用途：直接交给另一个编码模型实施。本文件规定目标方案，不表示这些桌面能力已经实现。

## 0. 给实现者的首要约束

1. 按本方案完成桌面产品，不重新进行框架选型。选型已定：Electron + React + TypeScript。
2. 现有项目是协议研究原型，不是空仓库。先读本文、`API_CONTRACT.md` 和 `authorized-feature-validation.md`，保留已有验证成果。
3. 第一版不做每日推荐、不解决所有高阶音质、不承诺永久免扫码。不得偷偷换用其他音乐平台音源。
4. 不复制没有许可证的第三方代码；现有 `src/*.mjs` 是本项目独立实现，可迁移复用。
5. `.local/` 含本人凭据和音乐库数据，`research/` 含私有响应及研究样本；禁止打印凭据、进入提交、进入构建上下文或发行包。不要主动登录真实账号或重跑写操作脚本。
6. 单机桌面应用，不做业务服务器、云账号代理、微服务、数据库迁移框架、插件架构、依赖注入容器或多音源抽象。
7. UI 只承担展示与交互，令牌与账号请求只在主进程。远程登录页没有应用 preload、IPC、Node 权限。
8. 遇到未经验证的接口，标明“待验证”，不要编参数、返回假成功或用 mock 冒充实测。
9. 用户当前委托的是方案；本文交付后由下一阶段实现，不在本次方案阶段初始化 Electron 应用。

## 1. 为什么选 Electron，不选 Tauri / Go

### 固定决策

- Electron：采用实现时仍受官方维护的稳定版本，锁定具体版本与 lockfile。不要使用浮动 latest 构建发行版。
- 前端：React + TypeScript，Vite 构建。
- 工具链：electron-vite + electron-builder；单仓库、一个 package.json。
- 样式：普通 CSS + CSS 变量；不叠加 Tailwind 与另一套样式体系。
- 图标：lucide-react，仅按需导入。
- 页面导航：react-router-dom 的 HashRouter。
- 运行时参数校验：Zod，仅用于跨 IPC 边界与配置，不为每个第三方嵌套字段堆完整 schema。
- 测试：Vitest；Playwright 的 Electron 自动化用于应用烟测，不放进发行依赖。
- 播放：Chromium HTMLAudioElement 单实例，首版只保证经实测的 MP3/FLAC。
- 存储：系统安全存储 + 小型 JSON 文件。不引入 SQLite、ORM、Redis。

### 选择理由

| 维度 | Electron | Tauri | Go GUI |
|---|---|---|---|
| 已有 JS 协议代码复用 | 直接迁移 | 可部分复用，但请求/凭据层常需 Rust | 需重写 Go 请求层 |
| 登录/媒体运行环境 | 三端随包携带 Chromium，差异较小但仍需实测 | Windows WebView2、macOS WKWebView、Linux WebKitGTK，三种环境 | Wails 仍依赖 WebView；Fyne 等需另做浏览器登录和媒体集成 |
| 交给较便宜模型实现 | 单语言主线，接口边界清晰 | TypeScript + Rust 与平台差异增加返工 | UI、音频和平台行为需要更多自定义 |
| 资源开销 | 较大，接受这一代价 | 通常较轻 | 取决于 GUI/音频依赖，并非必然最小 |

前面倾向 Tauri，是资源占用优先。现在目标改为“明确方案、低成本模型可靠交付”，因此选 Electron。不要一边写 Electron 一边保留 Tauri/Go 替换层。

不要为“纯 exe”牺牲维护性。Windows 安装包是主交付；便携版可后补。Chromium、FFmpeg 编解码实际能力仍要在 Electron 上测试，不能把 Linux 命令行 FFmpeg 成功当作 Electron 已通过。

## 2. 产品范围与事实边界

### 第一版必须完成

- 官方页面扫码登录、取消登录、退出账号。
- 安全保存音乐会话，程序退出/系统重启后恢复；失效时有明确重新登录入口。
- 收藏歌曲列表、我的自建/收藏歌单、歌单详情。
- 搜索歌曲；进入专辑和歌手详情。
- 收藏/取消收藏；创建、修改简介、删除自建歌单。
- 本地播放队列：播放/暂停、上一首/下一首、进度拖动、音量、顺序/单曲循环/随机。
- 标准音质与无损选项；按真实可用资源播放，不虚标音质。
- 行级歌词；无歌词时显示明确空态。
- 从华为读取历史；本机播放记录单独显示，不宣称已同步回华为。
- 托盘与退出、系统媒体控制、窗口关闭行为设置。
- Windows 优先验收，macOS/Linux 同一代码构建和分别测试。

### 首版明确不做

每日推荐、私人 FM、云盘上传、离线下载、音频解密、Audio Vivid/空间音频、Hi-Res 承诺、无缝/交叉淡化、均衡器、逐字歌词、桌面歌词窗、移动端/纯鸿蒙端、第三方音源、云同步、自动更新服务。

暂不提供未经验证的歌单改名/封面/排序/曲目增删按钮。简介编辑是已测能力，不要把它扩写成“所有编辑能力已通”。

### 已知限制必须呈现

- Access Token 两次实测为 3600 秒。
- 音乐 Token 曾在新进程、约 78 分钟后继续成功；到期字段提示可能约 7 天，未实测满 7 天。
- 标准 refresh grant 使用真实 RT 返回 1101/20171，自动续期未打通。首版允许音乐会话失效后重新扫码，不每小时主动销毁会话。
- 当前 OAuth client_id 来自公开兼容性研究，不是本项目自有注册身份。个人实验可继续验证；公开分发前须解决应用身份、授权与服务条款评估，不能宣称官方客户端或已获授权。
- 会员播放已用本人账号一个样本验证 MP3/FLAC 全曲解码，不等于全曲库和所有特殊授权曲目保证。

## 3. 最小架构：三个边界，不再多分层

```text
Electron 主进程
  华为 API、登录窗口、令牌安全存储、JSON 持久化、托盘/窗口
        │ 白名单 IPC：结构化请求/结果
preload：window.desktop 固定方法
        │
React 渲染进程
  页面、播放队列、单个 Audio 元素、歌词、系统 Media Session
```

所有华为业务请求在主进程。渲染进程接收经过挑选的 DTO，不接收账号/音乐令牌或整个 API 原始响应。

音频 CDN 地址是播放必须的临时能力，允许作为单曲播放结果暂时交给渲染进程；不放进日志、LocalStorage、队列持久化或 crash report。主进程不把 Authorization 随 URL 发给 CDN。

首版直接把可信音频 URL 赋给 Audio.src。不写本地 HTTP 代理/Express 服务，不先上自定义媒体协议。如果真实测试证明必须处理头信息、跨域、seek 或缓存，再针对那个问题做最小补丁，先记录证据。

跨源 audio 可播放不等于 fetch 可任意跨源，不添加 `crossOrigin='anonymous'` 除非确认服务端允许；首版无 WebAudio 分析/均衡器，不为它引入 CORS 问题。

## 4. 目标目录（约束职责，不要求空文件占位）

```text
src/
  main/
    index.ts              生命周期、单实例、窗口、IPC 注册
    auth.ts               OAuth state/PKCE、官方登录窗口、会话切换
    huawei.ts             明确的业务请求函数及响应归一化
    storage.ts            安全凭据 + settings/queue/cache JSON 原子读写
    ipc.ts                白名单 handler、来源和参数校验
    tray.ts               托盘和窗口显隐，播放命令路由
  preload/
    index.ts              只暴露固定 desktop API
  shared/
    types.ts              DTO、Result、枚举
    channels.ts           少量固定 IPC 常量（不用生成器）
  renderer/
    main.tsx
    App.tsx
    bridge.ts             window.desktop 的类型化薄封装
    player.ts             单 Audio、队列、竞态控制、MediaSession
    stores.ts             简单 Context/useReducer 或外部 store，不引入 Redux
    styles.css
    components/
      AppShell.tsx
      TrackTable.tsx
      PlayerBar.tsx
      QueuePanel.tsx
      LyricsPanel.tsx
      ConfirmDialog.tsx
    pages/
      FavoritesPage.tsx
      PlaylistsPage.tsx
      PlaylistDetailPage.tsx
      SearchPage.tsx
      AlbumPage.tsx
      ArtistPage.tsx
      HistoryPage.tsx
      SettingsPage.tsx
      LoginPage.tsx
scripts/                  保留 CLI 研究验证，不进入发行包
research/                 本地研究，不提交/不打包
.local/                   私有数据，不读取打印/不提交/不打包
test/                     迁移现有测试，保留协议回归
```

迁移可以按里程碑逐步完成，现有 src/*.mjs 可短期并存。不要复制同一认证逻辑到主进程和 renderer 两份。不要先删除旧原型再从头猜协议。

## 5. 数据模型与 IPC 合同

### 简单 DTO

```ts
type Track = {
  id: string; title: string;
  artists: { id?: string; name: string }[];
  album?: { id: string; title: string };
  coverUrl?: string; durationSeconds?: number;
  qualities: ('standard' | 'lossless')[];
  available: boolean;
};
type Playlist = {
  id: string; title: string; coverUrl?: string; count?: number;
  kind: 'owned' | 'collected' | 'chart'; description?: string;
};
type Result<T> = { ok: true; data: T } | {
  ok: false; error: { kind: 'auth'|'permission'|'network'|'unsupported'|'invalid'|'unknown';
    message: string; retryable: boolean; code?: string };
};
```

不要把未知值伪造为 0 秒、HQ 或可播放。缺字段显示 `—`。用户输入、曲目标题、简介都是纯文本，禁止 innerHTML。

### 暴露给 renderer 的 API

- `auth.status()` → 登录状态、显示名（如可得）、音乐到期原值/已确认日期；无 token。
- `auth.login()` → 触发官方登录窗口；通过只含阶段的事件更新状态。
- `auth.logout()` → 清本地凭据和本账号缓存，不调用未知撤销接口。
- `music.search({query,start,limit})` → Track[] + nextStart/hasMore（根据实际返回）。
- `music.favorites({start,limit})` → Track[]。
- `music.playlists()` → Playlist[] + truncated 标记。
- `music.playlistDetail({id,kind,start,limit})` → 元数据和 Track[]。
- `music.album({id,start,limit})`、`music.artist({id})`。
- `music.remoteHistory()`。
- `music.setFavorite({trackId,favorite})`。
- `music.createPlaylist({title,trackIds})`、`music.updatePlaylistDescription({id,description})`、`music.deletePlaylist({id})`。
- `music.resolvePlayback({trackId,quality})` → `{url, actualQuality, contentType?, durationSeconds?, previewHint?, expiresAt?}`。
- `music.lyrics({trackId})` → 行级歌词，不接受任意 URL 参数。
- `settings.get/update`，`queue.load/save`。
- `window.show/hide`、`app.quit`；托盘只发送 play/pause/next/previous 固定命令。

禁止通用 `invoke(channel,args)`、`request(url,headers)`、`readFile(path)`、`openExternal(anyString)` 暴露到窗口。

验证 IPC 来自唯一主窗口的主 frame，登录窗口禁止调用任何业务 handler。ID 长度/字符、分页、JSON 体大小均校验；playlist delete 还需检查本账号最近读取的 owned 列表，而不是仅信任 renderer 的 kind。

## 6. 登录与凭据保存

### 登录流

1. 主进程生成随机 state、PKCE verifier/challenge；10 分钟尝试过期且回调单次消费。
2. 新建官方登录 BrowserWindow：nodeIntegration=false、contextIsolation=true、sandbox=true、无 preload、webSecurity=true、无 devtools token 日志。
3. URL 使用现有验证配置和最小 `scope=openid`，用户在华为官方页面扫码。不要自行重写账号密码表单或代理密码。
4. 首选拦截 will-navigate / will-redirect / window-open 的目标 URL，精确匹配回调 scheme/hostname/path，处理后阻止外部协议启动。不注册全局 hms:// 处理器。
5. 若 Electron 实际测试中导航事件收不到自定义协议，允许**仅登录窗口**使用已经验证过的 CDP `Page.frameRequestedNavigation` 后备观察；完成后 detach。不要注册全局 webRequest 抓所有窗口流量。
6. state、重复参数、授权错误、过期、重放校验遵循已有 auth.mjs 测试。拒绝未知域名跳转/权限申请/下载，合法华为登录跳转域名通过实际 trace 建白名单，不允许粗暴封死正常登录或允许任意网站。
7. 主进程用 code+verifier 换账号 AT，再调用 loginex 取音乐 token。
8. **候选会话完成音乐只读检验后再原子替换旧会话**。取消或失败不清旧会话。
9. 关闭并销毁临时登录 session；不保留账号 Cookie。正式版不依赖 Playwright、系统 Edge 或用户保持浏览器运行。

### 持久化

- 只持久化后续需要的音乐 token、本人 SNS ID、expireTime、schemaVersion；账号 AT/RT 首版无需持久化，因为无可用刷新方案。
- `safeStorage` 使用系统密钥能力加密后，密文落在 `app.getPath('userData')/session.enc`，临时文件原子 rename。
- Windows 使用 Electron 提供的系统保护，macOS 使用 Keychain，Linux 使用可用的系统秘密服务；实际安全边界遵循 Electron 文档，不承诺防止已控制同用户进程的恶意软件。
- Linux `isEncryptionAvailable=false` 或 `getSelectedStorageBackend()==='basic_text'` 时，禁止无提示降级明文：只保留本次内存登录，并明确显示“系统安全存储不可用，退出后需重新登录”。不得设置 `setUsePlainTextEncryption(true)`。
- 保存写入失败不宣布“已记住登录”；保留本次可用会话并显示提示。
- 密文解不开：不给异常打印原始数据；显示重新登录，不自动破坏其他设置。
- 退出账号删除本地会话、个人缓存/队列/历史并停止播放；说明这不是撤销华为服务端授权。
- 不直接读取研究环境 `.local` 凭据作正式产品初始账号；没有自动从开发机导入真实账号行为。

### 到期策略

- 不因账号 AT 一小时到期而删除音乐 token。
- 音乐 expireTime 的时区未经完整确认，不在 UI 用推测日期强制清理；显示“会话有效，以服务端校验为准”或“预计到期”且明确估计。
- 启动读取凭据，首次个人接口验证。网络失败 ≠ token 失效；禁止所有 400/403 都弹登录。
- 只有已核对的认证失效业务码才标 authExpired；未知码保留原 session 并给重试与手动重新登录入口。
- 同一时刻只出现一个失效提示。已取得且仍可播放的音频不因 UI 提示强制停止。
- 首版接受真正失效时扫码一次；自动续期作为后续独立研究，不能让实现者去找/提取官方 client_secret。

## 7. 播放设计：一个 Audio，无播放器框架

### 状态与队列

`idle → resolving → buffering → playing ↔ paused → ended`，另有 `error`。状态由真实事件更新，不能点击按钮就把 buffering 直接当 playing。

- player.ts 持有唯一 Audio，不随路由切换重建。
- 队列项使用独立 queueItemId，允许同一 track 多次加入。持久化歌曲信息/索引/模式/音量/进度，不持久化播放 URL。
- 每次切歌递增 generation；较早的 resolve 结果回来时丢弃，不能覆盖用户后点的歌曲。
- 换歌先停止旧源并移除旧事件关联。play() 的 Promise 拒绝必须显示可恢复错误。
- 上下曲、自然结束、用户点选走同一 playTrack 函数；不要三份重复播放逻辑。
- 随机模式使用一轮无重复的队列索引排列，上一首遵从实际播放历史；不需要复杂算法。
- 启动恢复队列但不自动出声；用户按播放后重新取链并在 metadata 就绪后 seek。
- 收藏按钮等待服务端确认后更新，失败不假装成功；批量页面共享同一收藏状态更新。

### 取链与音质

- standard 映射 qualityType=1；lossless 映射 3。其他品质不露按钮。
- MP3/FLAC 能否播放以实际 Electron Audio 的 metadata、currentTime、ended 等验收，FFmpeg 结果只是协议证据。
- 不仅看 URL 后缀；返回 playQuality 与资源/codec 不符要记录脱敏诊断，不标“无损”。
- auditionTime 字段在已验证会员全曲响应中也存在，不能单独截断到 30 秒；也不能一律忽略权限结果。综合业务码、资源元数据与实际时长：实际只有短片段就明确“试听”，不循环/拼接成全曲。
- 某资源失败：只允许对同曲同品质重新取链一次。网络错误不默认降级；无损无权限时提示“该音质暂不可用”，用户明确选择后才降到标准。
- URL 在同次播放内复用，切歌/重新播放适时重取；不事先缓存整份歌单媒体链接。
- 不根据请求取链就上报播放历史。首版不调用华为 history/create，避免未知计数规则和额外改动账号。
- 无离线下载功能。Audio 的常规网络缓冲与缓存不等于承诺“离线缓存”。

### CDN、安全和资源边界

主进程只接受 API 返回的资源地址；使用 URL parser 验证 http(s)，禁止 userinfo、file/data/javascript、本机/IP/局域网目标。初始域名来自已测华为 CDN、tingmall、kuke 等明确来源，新增域必须有协议证据并经过测试。域名后缀匹配必须检查点边界。

优先 HTTPS。已经验证封面同路径 HTTPS 可用的域可以精确转换；不全局无脑替换。不要关闭 webSecurity 或放宽 TLS 校验来“修播放”。真实 CDN 重定向也要检查，重定向失败给可解释错误，不能静默换源。

渲染页面用本地可信 origin 和严格 CSP；media-src/img-src 仅允许所需 HTTPS CDN 与必要 blob/data 图片占位，脚本不允许远程执行。测试是否触发 Referer/CORS/Range 问题；有证据才增加最小修复。

## 8. 页面与操作规格（不是视觉风格定稿）

本方案仅锁定信息结构与行为，不擅自替用户确定最终美术风格。实现时先完成可运行骨架，正式视觉方案再做 A/B/C/D 预览由用户选；不能因做预览阻塞协议/安全验证。

### 窗口结构

- 默认 1180×760，最小 960×640。系统原生标题栏，首版不造全套无边框窗口控件。
- 左侧约 200px：收藏、我的歌单、历史、设置。搜索框在主内容顶部。
- 底部约 88px 常驻播放栏；切换路由不停止播放。
- 右侧队列/歌词抽屉互斥，避免挤压表格；窄窗口改覆盖层。
- 中文系统字体，无斜体。空态、错误态、加载态明确区分，不铺假推荐卡片。

### 收藏页 / TrackTable

列：序号或播放状态、歌名、歌手、专辑、时长、收藏/更多。长标题省略但悬停可见。支持单击选中、双击播放；键盘 Enter 播放，输入框内不抢快捷键。

每页 50 条（不超过验证限制），底部继续加载；千首级列表可用虚拟列表，但只有真实测到 DOM 开销后引入 @tanstack/react-virtual，不先上大型表格框架。

点击“播放全部”用已完成读取的明确集合；未取完时不得把当前一页假称全部。可以先显示“加载全部后播放”，失败允许取消。

### 我的歌单

分自建、收藏/榜单。已知 type=5 才显示删除和简介编辑；type=4/7 显示只读详情，不把它们当自建。

创建对话框首版要求至少一首所选歌曲（空歌单创建未验证）；名称不能为空，长度限制以客户端保守校验+服务端错误为准，不编官方上限。默认私密 shareFlag=0。

删除仅作用于被选中的 owned ID，需要确认对话框；删除成功重新拉列表。删除失败仍显示原歌单，不“乐观消失”。

简介编辑打开时保留原文，保存成功后重新读详情确认。没有改名接口就不放改名输入框。

### 搜索 / 专辑 / 歌手

按 Enter 提交搜索，取消过期请求或丢弃过期响应。保留搜索词和页位置。

搜索首版仅歌曲 tab，不展示未做的分类占位。点击专辑/歌手进入真实详情；缺 ID 的文本不可伪装链接。

### 历史

“华为历史”只读服务端返回；“本机最近播放”是单独标签，以成功开始播放事件记录，最多 200 首去重。标签明确区分来源，不假称已同步。

### 播放栏 / 歌词

- 空队列时控制禁用，保留音量设置。
- 拖动进度时 UI 预览，松手后 seek；尚无 duration 时禁用拖动。
- LRC 支持多时间戳、毫秒精度差异、offset；纯文字歌词显示纯文字，不伪造同步。
- 当前行高亮，手动滚动后暂停自动跟随，点击“跟随播放”恢复；减少动效偏好有效。
- 不使用大规模歌词翻译/第三方歌词源。

### 设置

音质默认标准；主题先跟随系统；关闭按钮默认退出（避免后台残留），用户可开启关闭到托盘。设置中提供明确“退出程序”。

会话信息显示状态，不展示 token、完整 SNS ID、Cookie。提供清缓存、退出账号、打开脱敏日志目录，不提供一键导出敏感会话。

## 9. 请求、缓存与异常处理

- API timeout 25 秒；GET/只读 POST 网络失败最多重试一次且有短退避。业务拒绝不重试。
- 写操作不自动重试。超时后显示“结果待确认”，读取真实状态核对，避免重复建歌单。
- 收藏幂等目标状态：已是目标值就不重复操作；多次点击时同曲排队/禁用按钮。
- 响应正常 HTTP 200 但业务码非 000000 仍是失败；400 空响应是参数/协议问题，不当作 token 过期。
- 日志写 HTTP 状态、受控业务码、操作名、耗时；不写 URL query、请求体、原始响应、Authorization、曲目私人标识、用户个人资料。
- 非敏感偏好 settings.json、队列 queue.json、缓存 cache.json，均 schemaVersion=1，写 temp+rename，损坏时回退默认并保留一个备份。
- 个人缓存按账号隔离，切换账号清旧缓存；需要本地账号 key 时存密文凭据内引用，不把私人标识上传。
- 收藏/歌单缓存只用于离线查看，标“离线缓存，可能不是最新”；后台刷新成功替换。首版缓存总量上限 5MB，不保存音频。
- 退出账号清个人缓存，但保留主题、音量等通用设置。

## 10. 系统集成

- `app.requestSingleInstanceLock()` 防止两个应用实例同时播放/写会话文件。
- 托盘菜单：显示窗口、播放/暂停、上一首/下一首、退出。
- `navigator.mediaSession` 接入标题/歌手/专辑/封面和固定操作；各系统真机验证。不得因自定义全局键失败导致启动失败。
- Linux 部分桌面没有托盘时不要把窗口藏到无法恢复；保持普通关闭/退出行为。
- 系统睡眠/恢复时校准播放器状态，失败重新取当前曲目 URL；不要自行重播所有队列。
- 不占用常驻 localhost 端口，不启动后台代理服务，不安装系统协议劫持。

## 11. 开发里程碑与停止门

### M0：安全地整理工程

- 新建 electron-vite TS/React 配置，保留 docs、研究文件和已有测试。
- 配置 lint/typecheck/test/build；明确 src/main/preload/renderer/shared。
- 迁移已有 PKCE、回调、错误脱敏、歌曲读取与安全边界测试。
- 发行白名单仅 out/** + 必要依赖/资源；验证 `.local`、research、测试私有夹具不进包。
- 不读取真实会话测试新 UI。默认 mock 必须在开发测试路径中显式启用。

验收：空壳可启动；Node 不暴露 renderer；现有测试不因删掉断言而“通过”。

### M1：最先做两条真实纵向链路

A. Electron 登录窗口 → 回调 → 音乐会话 → secure storage → 退出重开读取收藏。
B. 在 Electron Audio 内用账号返回的 MP3 和 FLAC 播放、拖动、到达末尾；切页不中断。

真实账号操作需用户本人授权，不自动沿用服务器私有凭据。Linux 验证不能代替 Windows/macOS。

**停止门：A 或 B 不通，先解决，禁止继续做全部页面。**

如果 Chromium Audio 不能处理目标资源，不立刻重写为 libmpv：先确认真实 codec、响应、Range、证书/重定向/错误；整理最小复现与备选方案交回用户。

### M2：只读音乐库

收藏分页、本人歌单列表/详情、搜索、专辑、歌手、远程历史。补真实字段归一化和空态/错误态。

验收：个人歌单和歌曲在账号范围内正确；960+ 收藏不会一次建几千个高开销 DOM；搜索竞态不会显示旧结果；刷新失败保留缓存提示。

### M3：播放器日用能力

队列、顺序/随机/单曲循环、音量、进度、行级歌词、音质选择、队列恢复、MediaSession。

验收：连续切歌、拖到末尾、网络中断、会话失效、资源过期、退出重开各有测试。

### M4：受控写操作

收藏增删、创建临时自建歌单、简介更新、删除。单独 opt-in 联网测试，不跑在 CI。

验收：执行后读回确认；写超时不重复创建；有基线、操作日志、清理脚本，真实测试必须显示最终 added=0/removed=0。不能把 favorite/delete 的 000000 当作自建歌单删除成功。

### M5：正式视觉与系统集成

按用户视觉选择完成外观，补键盘导航、焦点、中文排版、无障碍、窄窗口、长标题、空数据和错误恢复；托盘/窗口关闭/媒体键完成。

验收：真实桌面截图，不只 localhost 浏览器截图；没有假推荐、没有按钮无行为。

### M6：三端发行

Windows x64 NSIS；macOS arm64/x64 DMG 分架构；Linux x64 AppImage + deb。ARM Linux 后补，不默认承诺。

分别用相应 OS runner 构建；macOS 签名/公证、Windows 代码签名需要真实身份和证书，缺失标“内部测试未签名”，不绕过系统安全机制。

首版手动更新，关于页显示版本；不搭自动更新服务器。可加 CI build artifacts，但不擅自创建 public 仓库/公开上传。

## 12. 测试与交付验收表

### 必须自动化

- PKCE RFC 向量、state 不匹配、重复参数、回调地址错误、重放、取消、超时。
- IPC 非主窗口调用、非法分页、恶意 URL、本机/IP 请求、凭据不得越界。
- secure storage 不可用/basic_text、写失败、坏密文、切账号清缓存。
- 曲目归一化缺字段、contentExInfo 非 JSON、收藏分页结束、歌单类型分流。
- 请求业务错误与 HTTP 错误区分、写超时核对、删除目标限制。
- 播放 generation 竞态、重复 track 队列、ended 行为、seek、play() rejection、随机上一首。
- LRC 多标签/offset/无歌词、队列恢复不自动播放、不持久化 URL。

### 每个平台必须人工/端到端验证

首次扫码、重启恢复、MP3/FLAC 听播和 seek、锁屏媒体控制、托盘退出、缺网恢复、系统睡眠唤醒、卸载/重装后的凭据预期、日志无凭据。

以真实可用性为标准，不给无法实测的平台打勾。性能先在同一机器量 baseline：空闲无轮询风暴，UI 切页不卡，播放两小时内存不持续增长；不承诺未经测量的 RAM 数字。

### 每个阶段完成后向用户汇报

1. 完成了哪些真实路径；
2. 跑了哪些测试、在哪个系统；
3. 未验证/受阻项；
4. 可运行命令或产物；
5. 是否改动了真实账号及清理结果。

不能把“代码已写”“构建成功”“截图好看”“API 返回 200”混同为功能验收。

## 13. 明确不允许实现者自由发挥的地方

- 不改框架、不拆 monorepo、不抽通用音源 SDK、不建 GraphQL。
- 不先实现移动端，不宣称 Tauri/Go 以后零成本迁移。
- 不承诺 7 天固定重新登录，也不每小时扫码。
- 不从 Qt/Go/Rust 再引入一个播放器进程，除非 M1 得到证据并经用户同意。
- 不把测试代码中的全量 JSON 输出复制进正式日志。
- 不把用户现有歌单当写操作测试目标；不得因清理失败就继续创建更多对象。
- 不自动上传分析数据或 crash dump；不自动发布软件。

## 14. 参考与现有材料

- 本项目接口契约：[API_CONTRACT.md](API_CONTRACT.md)
- 当前验证状态：[authorized-feature-validation.md](authorized-feature-validation.md)
- 凭据期限：[token-lifetimes-and-renewal.md](token-lifetimes-and-renewal.md)
- 后续交接入口：[IMPLEMENTER_PROMPT.md](IMPLEMENTER_PROMPT.md)
- Electron 安全：https://www.electronjs.org/docs/latest/tutorial/security
- Electron 安全存储：https://www.electronjs.org/docs/latest/api/safe-storage
- Tauri WebView 差异：https://v2.tauri.app/reference/webview-versions/

本次只交付选型、实现合同和阶段计划，不声称已完成 Electron 登录、GUI 或平台发行测试。

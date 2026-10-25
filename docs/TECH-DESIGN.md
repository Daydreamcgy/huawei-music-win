# 技术方案

> 目标：在 Windows 上做一个**像鸿蒙原生**的华为音乐客户端。协议层复用已验证的实现，界面从零写。

## 1. 目标与非目标

**目标（M1–M5，已完成）**

- 官方扫码登录 → 会话加密保存 → 重启免登录
- 首页 / 音乐厅 / 我的收藏 / 歌单详情 / 搜索 / 设置 / 播放页 / 迷你播放条，视觉对齐鸿蒙电脑版
- 真实数据：收藏全量、最近播放、歌单与歌单曲目、在线搜索、单曲播放地址、歌词
- 一个窗口、无多进程花活、可调试（CDP 截图）

**非目标（本阶段不做）**

- 每日推荐、榜单：`recommend/querydaily` 变体仍 400，不做假数据替代
- 专辑 / 歌手独立详情页（数据接口有，界面还没做）
- 桌面歌词、快捷键自定义
- 自动续期：音乐 token 约 7 天，过期就重新登录

## 2. 整体架构

```
┌────────────────────────── Renderer（React 19） ──────────────────────────┐
│ App.tsx     路由 + 登录流程 + 库数据 + toast                              │
│ screens.tsx 首页 / 收藏 / 登录屏        PlayerView.tsx 播放条 + 播放页 / PlayerShell.tsx 过渡 │
│ lib/player.ts  Audio 元素 + 队列 + 歌词   lib/api.ts  IPC 薄封装           │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ window.desktop（contextBridge 白名单）
┌───────────────────────────────▼──────────────────────────────────────────┐
│ Preload（无 Node 能力，只转发固定通道）                                     │
└───────────────────────────────┬──────────────────────────────────────────┘
┌───────────────────────────────▼──────────────────────────────────────────┐
│ Main（Electron 44）                                                        │
│  · 窗口 / 代理策略（华为 CDN 强制直连）                                     │
│  · AuthManager：登录 WebContentsView + hms:// 回调 + safeStorage           │
│  · music-client：Digest 头、业务接口、错误归一化                            │
│  · storage：会话 / 设置 / 队列（全部落 userData）                           │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ HTTPS
                        api-drcn.music.dbankcloud.cn
```

**边界规则**

- 渲染层**没有** Node、没有 `fs`、没有凭据；所有网络与令牌在主进程。
- 登录页 `WebContentsView` 无 preload、无业务 IPC，只能由主进程取消。
- CSP 写死在 `index.html`：图片/媒体只允许华为三个 CDN 域。

## 3. 渲染层设计

### 3.1 组件树

```
App（grid：左栏 232px / 右栏；行：内容 / 播放条 76px）
├─ sidebar              品牌（拖拽区）/ 首页 / 音乐厅 / 我的收藏 / 我的歌单 / 底部「设置」入口
├─ stage
│   ├─ TitleBar         52px 自绘标题栏：搜索框（在线搜索）+ 最小化/最大化/关闭（按钮内缩）
│   └─ main             LoginScreen | HomeScreen | HallScreen | FavoritesScreen | PlaylistsScreen
│                       | PlaylistScreen | SearchScreen | SettingsScreen
├─ PlayerShell          常驻 76px 播放条 + 播放页（同一份「当前曲目」共享元素）
│   ├─ PlayerBar        左侧曲目 / 中间传输键 / 右侧时间·收藏·队列·音量·收起
│   └─ PlayerStage      播放页内容层（大封面 + 歌词），只铺到播放条上沿
├─ login-strip          登录中顶部 48px 取消条
└─ toast
```

路由是一个判别联合（`{ name: 'home' | 'hall' | 'favorites' | 'playlists' | 'settings' }`
`| { name: 'playlist'; playlist } | { name: 'search'; query }`），不引路由库；
账号信息原来的底部账号块已经搬进设置页，侧栏只留导航，歌单也不再在侧栏展开。
`PlaylistScreen` / `SearchScreen` 自己管分页状态（`start` / `hasMore` / `loadingMore`），App 只传当前歌单或关键词。

### 3.2 状态

只有两层，不引 Redux/Zustand：

- **App 级**：`auth`、库数据（收藏/历史/总数/loading）、`route`、`playerOpen`、`queueOpen`、`menu`（右键菜单目标）、`toast`、`quality`、`volume`。
- **播放级**（`usePlayer`）：`queue`、`index`、`playing`、`buffering`、`position`、`duration`、`lyrics`、`favorite`、`mode`。
  `mode` 是单值枚举 `'sequential' | 'all' | 'one' | 'shuffle'`（顺序 / 列表循环 / 单曲循环 / 随机），
  不再是一个按钮管 repeat、另一个按钮管 shuffle；落盘时映射回既有的 `repeatMode` + `shuffle` 两个字段，
  不动 `shared/types`。
- **播放页过渡**（`PlayerShell` 内部）：`mounted`（播放页是否挂着）、`active`（是否已到终态）、
  `arriving`（收起动画后半段，把条里的歌名淡回来）。这三者只服务动画，不落盘。

`usePlayer` 内部用 ref 镜像关键状态（`queueRef`、`indexRef`、`modeRef`…），避免音频事件回调里读到过期闭包。
随机另存一份 `shuffleHistory`，随机模式下「上一首」回退到真正随机到过的那一首。
队列的增删（`enqueueNext` / `enqueueLast` / `removeAt` / `clearUpcoming` / `jumpTo` / `restore`）都在
`usePlayer` 里同步更新 state 与 ref，`index` 始终指向"正在播的这一首"。

### 3.3 关键数据流

**登录**

```
点击登录 → auth.login() ──主进程──→ 打开官方授权页（y=48 起）
   ↑ onProgress 文案                 扫码 → hms:// 回调 → 换 token → 音乐 token
   └──────────── Result<AuthStatus> ←── 关闭视图、写 safeStorage
→ setAuth() → 触发 loadLibrary()
```

**收藏**

```
api.favorites() → 循环 music.favorites({start,limit:50}) 直到 hasMore=false 或 800 首
                → 按 id 去重 → favoritesSummary() 补总数（失败则用已拉取数）
```

**播放**

```
双击行 / 点播放 → player.playFrom(tracks, index)
→ index+nonce 变化 → resolvePlayback() → audio.src → play()
                   ├→ lyrics()        异步，失败静默
                   └→ favoriteState() 异步，失败静默
```

**播放队列**

```
队列变化 → 1200ms 防抖 → queue.save({tracks, index, positionSeconds})
播放中   → 每 10s       → queue.save(…positionCommit.current)
启动     → queue.load() → restore(tracks, index, position)
           ├→ 载入并 seek 到上次进度，**不自动出声**
           └→ 队列非空时不再覆盖（避免抢占用户正在点的歌）
播放模式 → settings.update({repeatMode, shuffle})，启动时回灌到播放器（顺序/列表/单曲/随机 一一映射）
```

队列语义：`index` 之前的都算"已播放"，之后是"接下来"；播到底的行为由 `mode` 决定：
`sequential` 停住、`all` 绕回第 0 首、`one` 重播当前首、`shuffle` 随机挑一首不重复的。
**播放全部必须是整列**：歌单页会先把剩余分页拉全再建队列，
否则队列只覆盖已加载的那一页，听感上就是"播几首又绕回开头"。

**播放条 / 播放页（同一条 bar）**

`
点击条左侧曲目或右下角展开 ──→ PlayerShell 挂上 PlayerStage（is-open=false 起手）
                              ├─ 量两个矩形：PlayerStage 的大封面、PlayerBar 的 44px 槽位
                              ├─ Web Animations：translate+scale(44/320) → 0，圆角 10/scale → 20
                              │  歌名/歌手同步 translate 到条里文字的位置，前 42% 淡出
                              └─ 下一帧加 is-open：内容层淡入 + 上浮 28px，背景 100ms 铺满
点击右下角收起 / Esc ────────→ 反向：动画跑完 400ms 才卸载 PlayerStage
                              （条里那份 240ms 后才淡回来，正好接住飞下来的封面）
`

位移两端坐标必须实时量，所以用 **Web Animations API** 而不是 CSS transition：
transition 依赖"先写起手位、等浏览器重算一次样式、再写终态"，中间任何一次样式合并都会让它直接跳到终点（实测过）；
`animate()` 不受影响。`prefers-reduced-motion: reduce` 时跳过动画直接到位。

播放条只有一条进度：2px 细线贴着条的上沿，点击或拖动都能跳转（拖动时加粗并露出圆点），
时间读数在条右侧 —— 播放页里不再叠第二条进度条。

### 3.4 交互约定

| 操作 | 行为 |
|---|---|
| 双击行 / 行内播放按钮 / Enter、Space | 播放并把该列表设为队列 |
| 右键任意歌曲行 | 菜单：立即播放 / 下一首播放 / 添加到播放队列 |
| 点播放条上的队列按钮（收起/展开都在同一位置） | 右侧抽屉滑出：正在播放 + 接下来 + 已播放；开 260ms / 收 200ms，收完才卸载 |
| 队列里点某首 / 悬停点 × | 跳过去 / 从队列移除（正在播放那行不给删） |
| 队列头部「清空待播」 | 只留正在播放的这一首 |
| 点 / 拖播放条上沿的进度线 | 跳转到该时间点（2px 细线，命中区 9px，拖动时加粗 + 圆点） |
| 点击播放页歌词行 | 跳转到该时间点 |
| `Esc` | 收起播放页 / 关闭队列与右键菜单 |
| `Space`（非输入框） | 播放/暂停 |
| 点播放条左侧封面/标题或右下角图标 | 展开播放页（封面从 44px 长成 320/360px，页面向下滑入） |
| 收起播放页（右下角图标 / Esc） | 页面向下沉、封面飞进播放条，400ms 后卸载 |
| 点播放条上的模式按钮 | 顺序 → 列表循环 → 单曲循环 → 随机 → 顺序，映射后写回设置的 `repeatMode` / `shuffle` |
| 收藏页红心 | 取消收藏（乐观更新，失败回滚） |
| 播放条红心 | 收藏/取消收藏当前曲目（收起与展开是同一个按钮） |

## 4. 视觉规范

全部在 `src/renderer/styles.css` 顶部 `:root`：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--bg` / `--bg-sidebar` / `--bg-bar` | `#0a0a0c` / `#0b0b0e` / `#0b0b0e` | 内容 / 侧栏 / 播放条 |
| `--surface` / `--surface-2` | `#141418` / `#1b1b21` | 卡片、输入框 |
| `--text` / `--muted` / `--faint` | `#f2f2f5` / `#9a9aa5` / `#62626d` | 三级文字 |
| `--like` | `#ff375f` | 红心、强调 |
| `--radius-xl/lg/md/sm` | 20 / 14 / 10 / 7 px | banner / 卡片 / 行 / 小控件 |
| `--sidebar` | 232px | 侧栏宽度 |
| `--titlebar` | 52px | 自绘标题栏高度（登录视图 `LOGIN_VIEW_TOP_INSET` 与之等值） |
| `--playerbar` | 76px | 常驻播放条高度 |

排版：页面标题 27px/600、banner 标题 30px/600、区块标题 18px/600、行标题 13px/500、正文 14px、次级 12px。
字体栈优先 `HarmonyOS Sans SC`，回退 `MiSans` / `Microsoft YaHei UI`。

**动效克制**：卡片 hover `translateY(-3px)`、播放页 200ms 淡入、红心/进度 160ms 过渡。不做弹跳、不做彩色阴影。

**歌词纵深**：以当前行为中心，按 `|i - active|` 计算，透明度和 `scale()` 逐行递减（opacity 1 → 0.14，
scale 1.00 → 0.82，最多算 8 行），当前行白色加粗，形成前后层次；过渡 380ms，切歌时是滑动而不是跳变。
当前行是**真放大字号**（19px → 24px，配 `margin: -4px 0` 抵掉多出来的行高），不用 `transform: scale` 硬拉——
缩放拉出来的字会发虚，而且行高会被撑开，切行时整列会跳。

### 4.1 窗口外壳

- `BrowserWindow` 用 `frame: false` + `backgroundColor: '#08080a'`，没有系统标题栏，避免顶部出现一条割裂的白条。
- 标题栏与侧栏品牌区用 `-webkit-app-region: drag` 拖拽；搜索框、导航、窗口按钮显式 `no-drag`，否则点不到。
- 标题栏高 52px，内容垂直居中（上下各 11px 留白），窗口按钮 42×30 圆角内缩、不再贴顶贴边，悬停底色不会压到窗口圆角。
- 最小化/最大化/关闭走 IPC：`window:minimize` `window:toggle-maximize` `window:close`；最大化状态由主进程 `maximize`/`unmaximize` 事件推回渲染层（`window:maximized-changed`），按钮图标随之切换。
- 应用图标：`build/icon-src.png`（用户提供的官方图标）→ `scripts/make-icon.mjs` → `build/icon.png`(512) / `build/icon.ico`(16–256) / `build/tray.png` / `src/renderer/assets/app-icon.png`。主进程窗口图标、`build.win.icon`、侧栏品牌、启动页都取这一份。

### 4.2 大屏/全屏布局规则

- **一条内容列**：`--content-max: 1400px`（内容 1320）+ `.main { scrollbar-gutter: stable }`，所有页面（含设置）共用这条左右基线，宽屏居中收口。列表不再自己收口，页头按钮、歌曲行、专辑列、心在同一右边界。
- **卡片列数写死**：4 列（默认）/ 5 列（≥1274）/ 6 列（≥1468），断点由「内容列 = 5×176+4×18」反推；单卡 2048 下 205px、1322 下 186px、960 下 159px，最大化时封面是放大的而不是被 auto-fill 挤成 9 列小图。
- **横滑区跟网格同列**：`.card-row` 用 `grid-auto-columns: calc((100% - n*var(--card-gap)) / N)`，可见张数恒等于网格列数，最后一张不会被切半张。
- **设置页**不单独居中：继承 `.screen` 的页列，只有 `.settings-group` / `.settings-note` 收到 820 的阅读宽度；1322 与 960 表现不变。
- 播放页三行（head / body / foot）≤1599 时 `max-width: 1080px`，≥1600 抬到 1240、封面 360、栏距 72；body 两栏，歌词块整体居中排版，宽屏下左右留白对称。
- 播放页播放条是 `1fr auto 1fr` 的 grid：中间传输键永远在页心，左端红心、右端音量各自贴边，三块 `align-items: center`
  共用一条水平中线（音量不要用 `position: absolute` 硬编码 `bottom`，那样会比播放键低十几像素）。
- 底部常驻播放条同样是三段式 grid：左「当前曲目」、中「传输键」（播放键落在窗口正中）、右「时间 + 音量 + 展开」。
  别再用 flex + `margin-left: auto` 把控制键挤在封面后面，整条会左重右空。
- 播放页背景只用中性径向渐变，**不放整屏 `filter: blur()` 图层**：大尺寸滤镜图层在窗口缩放/切歌时可能留下没重绘的浅色带（底部空白），且每帧都贵。
- 列表行 `56px`，列宽用 `minmax()` 收放；收藏页专辑列上限 320px，避免宽屏把标题和专辑拉得太远。≤1120 时专辑列收到 160。
- 最小窗（960）下音乐厅的歌手横排隐藏原生滚动条、右侧 28px 渐隐，别让滚动条横在名字下面。
- 评分依据与逐条推导见 `docs/UI-REVIEW.md`（960 / 1322 / 2048 三档实测）。

## 5. 实现决策与坑

| 问题 | 处理 |
|---|---|
| 收藏接口分页 | 循环拉到 `hasMore=false`，ID 去重，上限 800 防止异常长跑 |
| 快速切歌 `play()` 被中断 | 捕获 `AbortError` 时静默，不弹 toast；用 `loadToken` 丢弃过期响应 |
| 音质徽标 | 接口没回 `actualQuality` 时回退显示用户设置的音质，避免「音质读取中」常驻 |
| 队列持久化 | 监听 `queue/index` 变化，1.2s 防抖后写 userData，避免拖动时狂写 |
| 封面 404 / 缺字段 | `Cover` 组件 `onError` 回退到占位块，hero 优先挑有封面的曲目 |
| 时长缺失 | 列表不显示 `--:--`，直接留空 |
| 红心太吵 | 收藏页红心常态 32% 透明度，悬停/当前曲目才全亮 |
| 行焦点框 | 关掉浏览器默认 outline，改用背景色表达选中 |
| 用 `requestAnimationFrame` 等「下一帧再切状态」 | 窗口被挡住时 rAF 会被节流到 300–400ms（实测 408ms），等它的动画会卡住不动。播放条/播放页/队列抽屉改成：Web Animations（自带起手帧）+ CSS 动画（keyframes 自带起手帧），只有收起方向用 transition（此时起手态早就渲染过了） |

## 6. 性能

- 只有 `index/nonce` 变化才重新解析播放地址，`timeupdate` 只更新进度 state。
- 卡片封面 `loading="lazy"`，列表不做虚拟滚动（154 首量级够用，上千首再上）。
- 渲染层 bundle 约 695KB（React + lucide 图标），后续可按需引入图标减小体积。

## 7. 验证手段

- **CDP 截图**：`node tools/shots.mjs`（窗口尺寸）/ `node tools/shots.mjs fullscreen`（最大化后跑同一脚本），Playwright 连 `--remote-debugging-port=9222`，走 DOM 事件点击（窗口被遮挡时也能跑），产物进 `docs/screenshots/`。
- **类型/构建**：`npx tsc --noEmit`、`npm run build` 必须全绿。
- **人工清单**：登录 → 首页数据 → 收藏翻页 → 播放 3 首 → 拖进度 → 切循环 → 重启恢复队列。

## 8. 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| M1 | 登录 / 首页 / 收藏 / 播放 / 播放页 | ✅ 已完成 |
| M2 | 搜索（`music.search`）+ 专辑/歌手详情页 | 🟡 搜索已完成；专辑/歌手详情页待做 |
| M3 | 音乐厅 + 歌单（`music.playlists` / `playlistDetail`） | ✅ 已完成（音乐厅用播放记录/歌单/收藏组合，不做假推荐） |
| M4 | 设置页（账号、音质、关闭行为、歌词缓存）+ 托盘 | ✅ 已完成（账号卡已从侧栏搬进设置） |
| M5 | 打包 NSIS、图标、版本信息 | ✅ 已完成（v0.0.1 内部包） |

## 9. 风险

- **协议层脆弱**：华为接口非公开，字段随时可能变；所有解析都要容错，不能因为一个字段崩掉整页。
- **token 过期**：目前靠重新登录；后续要做「过期前提示」而不是静默失败。
- **合规**：OAuth 身份属于官方客户端，只可自用；不得公开分发。
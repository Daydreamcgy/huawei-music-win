# 技术方案

> 目标：在 Windows 上做一个**像鸿蒙原生**的华为音乐客户端。协议层复用已验证的实现，界面从零写。

## 1. 目标与非目标

**目标（M1，已完成）**

- 官方扫码登录 → 会话加密保存 → 重启免登录
- 首页 / 我的收藏 / 播放页 / 迷你播放条四个界面，视觉对齐鸿蒙电脑版
- 真实数据：收藏全量、最近播放、单曲播放地址、歌词
- 一个窗口、无多进程花活、可调试（CDP 截图）

**非目标（本阶段不做）**

- 音乐厅、搜索、歌单/专辑详情、每日推荐
- 设置页、托盘、桌面歌词、快捷键自定义
- 打包分发（NSIS / 签名）
- 自动续期：音乐 token 约 7 天，过期就重新登录

## 2. 整体架构

```
┌────────────────────────── Renderer（React 19） ──────────────────────────┐
│ App.tsx     路由 + 登录流程 + 库数据 + toast                              │
│ screens.tsx 首页 / 收藏 / 登录屏        PlayerView.tsx 迷你条 + 播放页     │
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
├─ sidebar              品牌（拖拽区）/ 首页 / 我的收藏（带数量）/ 底部账号块
├─ stage
│   ├─ TitleBar         44px 自绘标题栏：搜索框 + 最小化/最大化/关闭
│   └─ main             LoginScreen | HomeScreen | FavoritesScreen
├─ MiniPlayer           常驻 76px 播放条（无曲目时是空态）
├─ PlayerScreen         全屏播放页（覆盖层 from 44px，Esc 关闭）
├─ login-strip          登录中顶部 48px 取消条
└─ toast
```

### 3.2 状态

只有两层，不引 Redux/Zustand：

- **App 级**：`auth`、库数据（收藏/历史/总数/loading）、`route`、`playerOpen`、`toast`、`quality`、`volume`。
- **播放级**（`usePlayer`）：`queue`、`index`、`playing`、`buffering`、`position`、`duration`、`lyrics`、`favorite`、`repeat`、`shuffle`。

`usePlayer` 内部用 ref 镜像关键状态（`queueRef`、`indexRef`、`repeatRef`…），避免音频事件回调里读到过期闭包。

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

### 3.4 交互约定

| 操作 | 行为 |
|---|---|
| 双击行 / 行内播放按钮 / Enter、Space | 播放并把该列表设为队列 |
| 点击播放页歌词行 | 跳转到该时间点 |
| `Esc` | 收起播放页 |
| `Space`（非输入框） | 播放/暂停 |
| 点迷你条封面/标题或右下角图标 | 展开播放页 |
| 收藏页红心 | 取消收藏（乐观更新，失败回滚） |
| 播放页红心 | 已并入底部播放条（循环按钮右侧），和传输控制同一行 |

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
| `--titlebar` | 44px | 自绘标题栏高度（登录视图也按这个内缩） |
| `--playerbar` | 76px | 常驻播放条高度 |

排版：页面标题 27px/600、banner 标题 30px/600、区块标题 18px/600、行标题 13px/500、正文 14px、次级 12px。
字体栈优先 `HarmonyOS Sans SC`，回退 `MiSans` / `Microsoft YaHei UI`。

**动效克制**：卡片 hover `translateY(-3px)`、播放页 200ms 淡入、红心/进度 160ms 过渡。不做弹跳、不做彩色阴影。

**歌词纵深**：以当前行为中心，按 `|i - active|` 计算，透明度和 `scale()` 逐行递减（opacity 1 → 0.14，
scale 1.05 → 0.82，最多算 8 行），当前行白色加粗，形成前后层次；过渡 380ms，切歌时是滑动而不是跳变。

### 4.1 窗口外壳

- `BrowserWindow` 用 `frame: false` + `backgroundColor: '#08080a'`，没有系统标题栏，避免顶部出现一条割裂的白条。
- 标题栏与侧栏品牌区用 `-webkit-app-region: drag` 拖拽；搜索框、导航、窗口按钮显式 `no-drag`，否则点不到。
- 最小化/最大化/关闭走 IPC：`window:minimize` `window:toggle-maximize` `window:close`；最大化状态由主进程 `maximize`/`unmaximize` 事件推回渲染层（`window:maximized-changed`），按钮图标随之切换。
- 应用图标：`build/icon-src.png`（用户提供的官方图标）→ `scripts/make-icon.mjs` → `build/icon.png`(512) / `build/icon.ico`(16–256) / `build/tray.png` / `src/renderer/assets/app-icon.png`。主进程窗口图标、`build.win.icon`、侧栏品牌、启动页都取这一份。

### 4.2 大屏/全屏布局规则

- `.screen` 内容 `max-width: 1680px` 居中；再宽也不会把卡片拉成一条。
- 卡片列用 `auto-fill` + `minmax(155px, 1fr)`，列数随宽度自然增减；横滑区用 `grid-auto-columns: clamp(158px, 11vw, 190px)`，卡宽有上下限。
- 播放页三行（head / body / foot）统一 `max-width: 1080px` 居中；body 两栏 `340px + 1fr`，歌词块整体居中排版，宽屏下左右留白对称。
- 播放页背景只用中性径向渐变，**不放整屏 `filter: blur()` 图层**：大尺寸滤镜图层在窗口缩放/切歌时可能留下没重绘的浅色带（底部空白），且每帧都贵。
- 列表行 `56px`，列宽用 `minmax()` 收放；收藏页专辑列上限 320px，避免宽屏把标题和专辑拉得太远。

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
| M2 | 搜索（`music.search`）+ 专辑/歌手详情页 | 待做 |
| M3 | 音乐厅：分类歌单（`music.playlists` / `playlistDetail`） | 待做 |
| M4 | 设置页（音质、代理说明、缓存清理）+ 托盘 + 快捷键 | 待做 |
| M5 | 打包 NSIS、图标、版本信息 | 待做 |

## 9. 风险

- **协议层脆弱**：华为接口非公开，字段随时可能变；所有解析都要容错，不能因为一个字段崩掉整页。
- **token 过期**：目前靠重新登录；后续要做「过期前提示」而不是静默失败。
- **合规**：OAuth 身份属于官方客户端，只可自用；不得公开分发。

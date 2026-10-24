# 华为音乐 · Windows 客户端（自研 UI）

按**鸿蒙电脑版华为音乐**的观感重做的桌面客户端：深色打底、封面当主角、导航只有一层、播放器永远退到幕后。

这是一个**新的独立项目**，不是给 VutronMusic 换皮。协议层（登录、收藏、播放地址、歌词）沿用上一个学习版已验证的实现，界面全部重写。

![首页](docs/screenshots/home.png)

| 我的收藏 | 播放页 |
|---|---|
| ![收藏](docs/screenshots/favorites.png) | ![播放](docs/screenshots/player.png) |

---

## 现在能做什么

| 能力 | 状态 | 说明 |
|---|---|---|
| 华为账号登录 | ✅ 可用 | 官方登录页嵌在主窗口 `WebContentsView`，扫完码自动回主界面 |
| 会话恢复 | ✅ 可用 | 凭据走 safeStorage，加密存在 userData 里，重启免登录 |
| 首页 | ✅ 可用 | 问候语 + 继续听大图 + 最近播放 + 收藏速览 |
| 我的收藏 | ✅ 可用 | 全量分页拉取（154 首实测）、本地筛选、播放全部、取消收藏 |
| 播放 | ✅ 可用 | 单曲解析、播放/暂停、上下首、拖进度、音量、循环/随机 |
| 播放页 | ✅ 可用 | 封面 + 歌词双栏、当前行高亮、点歌词跳转、音质徽标 |
| 迷你播放条 | ✅ 可用 | 底部常驻，进度/控制/音量/展开 |
| 队列持久化 | ✅ 可用 | 关掉再开恢复上次队列与位置 |
| 登录页 | ✅ 可用 | 未登录时的引导页 + 登录中顶部取消条 |
| 音乐厅 / 搜索 / 歌单 / 设置 / 托盘 / 打包 | ⬜ 未做 | 见 `docs/TECH-DESIGN.md` 的里程碑 |

> 收藏数字是主进程分页拉全后按 ID 去重得到的，不是首屏数量。

---

## 跑起来

依赖已经装好了（`node_modules` 和上一版共用，含 Electron 44、React 19、electron-vite）。

```powershell
cd D:\Desktop\WorkSpace\huawei-music-win

# 单次构建
npm run build

# 启动（构建 + 拉起 Electron）
npm start
```

只想看截图的话：

```powershell
# 带调试端口启动
node_modules\electron\dist\electron.exe out/main/index.js --remote-debugging-port=9222
# 另一个终端
node tools/shots.mjs        # 输出到 docs/screenshots/
```

**注意**：本机 shell 默认导出 `ELECTRON_RUN_AS_NODE=1`，会让 Electron 变成纯 Node 直接报错。
命令前先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`。

---

## 技术栈与目录

Electron 44 + React 19 + TypeScript + electron-vite。渲染层不引 UI 框架，样式全部手写（`styles.css`）。

```
src/
├── main/            # 主进程：窗口、IPC、登录、华为业务 HTTP、安全存储
│   ├── index.ts         # 应用入口、窗口、代理策略
│   ├── huawei.ts        # 登录页 WebContentsView + hms:// 回调拦截
│   ├── auth-manager.ts  # 登录/取消/登出状态机
│   ├── music-client.ts  # 华为业务接口封装
│   └── storage.ts       # safeStorage 会话、设置、队列
├── renderer/        # 渲染层（本次重写的部分）
│   ├── App.tsx          # 外壳：侧栏、路由、登录流程、toast
│   ├── screens.tsx      # 首页 / 收藏 / 登录三屏
│   ├── PlayerView.tsx   # 迷你播放条 + 全屏播放页
│   ├── ui.tsx           # 封面、行、按钮等基础组件
│   ├── lib/api.ts       # IPC 薄封装（拆 Result、收藏分页）
│   ├── lib/player.ts    # 播放内核 hook（Audio 元素 + 队列）
│   └── styles.css       # 设计令牌与全部样式
├── preload/         # contextBridge 白名单 API
└── shared/          # 主/渲染共用类型与 IPC 通道名
```

---

## 界面是怎么对齐鸿蒙电脑版的

| 鸿蒙电脑版 | 这里的实现 |
|---|---|
| 左侧四项导航（首页/音乐厅/café听/我的） | 首页 / 我的收藏，登录状态收在底部账号块 |
| 音乐厅：大 banner + 筛选胶囊 + 横滑卡片 | 首页：继续听大图 + 最近播放横滑 + 收藏速览 |
| 播放是浮动小窗，左封面右歌词 | 全屏播放页，左封面右歌词，`Esc` 收起 |
| 播放条极细，不抢注意力 | 76px 高的毛玻璃迷你条，2px 进度线 |
| 深色 + 封面发光 + 白色胶囊按钮 | 同一套：`#08080a` 底、`#f4f4f6` 主按钮、封面驱动背景模糊 |
| Hi-Res / 空间音频徽标 | 右上角音质徽标（无损 FLAC / 标准 MP3） |

设计令牌（颜色、圆角、字号、间距）集中在 `styles.css` 顶部的 `:root`，改一处全局生效。

---

## 数据从哪来

渲染层只调 `window.desktop`（`src/preload/index.ts` 暴露的白名单），主进程持有凭据、代理与全部业务 HTTP。

| 界面 | IPC |
|---|---|
| 登录状态 / 登录 / 取消 / 登出 | `auth.status` `auth.login` `auth.cancelLogin` `auth.logout` `auth.onProgress` |
| 收藏列表 | `music.favorites({start,limit})` + `music.favoritesSummary` |
| 最近播放 | `music.history` |
| 播放地址 | `music.resolvePlayback({trackId,quality})` |
| 歌词 | `music.lyrics({trackId,title,artist,...})` |
| 收藏/取消 | `music.favoriteState` / `music.setFavorite` |
| 设置与队列 | `settings.get/update`、`queue.load/save` |

接口细节（Digest 头、`resultCode === '000000'`、OAuth 链路）见 `docs/API_CONTRACT.md`，那是上一阶段真实账号验过的合同。

---

## 五个必须知道的坑

1. **华为 CDN 必须直连**。开 Clash 全局时音频请求会走代理，CDN 返 404，表现为「大部分歌点了没反应」。主进程已强制 `session.setProxy({ mode: 'direct' })`，不要再改回跟随系统。
2. **`ELECTRON_RUN_AS_NODE`**：见上，启动前清掉。
3. **userData 目录**：直接跑 `electron out/main/index.js` 时 Electron 用 `%APPDATA%\Electron`，老会话就在那里；用 `npx electron .` 会变成 `%APPDATA%\huawei-music-desktop`，登录态就「丢」了。要复用老会话就按 `npm start` 的方式启动。
4. **登录页高度耦合**：官方登录页是 `WebContentsView`，从 `y=48` 开始盖住窗口。渲染层的取消条必须正好 48px（`LOGIN_VIEW_TOP_INSET`），改一边要同步改另一边。
5. **音乐 token 约 7 天**，自动续期没打通。过期后接口返回授权错误，需要重新登录一次。

---

## 和别的目录什么关系

- `D:\Desktop\WorkSpace\huawei-music\app`：上一阶段的学习版（Linux 验证、完整自动化测试）。**只读参考，不要改**。
- `D:\Desktop\WorkSpace\huawei-music-vutron`：VutronMusic 分支实验，已放弃，留档。
- 本目录：当前主线。

旧版 README 与全部协议/验收文档都保留在 `docs/`（`LEGACY-README.md`、`API_CONTRACT.md`、`IMPLEMENTATION_*.md` 等）。

---

## 合规

非官方客户端，仅供个人学习研究。OAuth 的 `client_id` 属于华为官方音乐应用，不得分发、不得商用、不得公开仓库或产物。`.local/`、真实凭据、个人音乐库数据都不进版本库、不进安装包。

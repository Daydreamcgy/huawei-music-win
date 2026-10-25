# 项目须知（先读这段）

这是**华为音乐的非官方 Windows 客户端**：按鸿蒙电脑版观感重做的界面 + 桌面端交互。
本项目基于 [talongao/huawei-music-desktop](https://github.com/talongao/huawei-music-desktop)（AGPL-3.0）修改而来，
自 2026-10-24 起重写渲染层、重塑播放条/播放页、新增播放队列与 Windows 打包。来源与修改声明见 `NOTICE`。

**开工顺序**：`README.md` → `docs/TECH-DESIGN.md` → `docs/API_CONTRACT.md`。

**边界**

- 界面改动集中在 `src/renderer/**` 与 `tools/**`；`src/main/**`、`src/preload/**`、`src/shared/**`、`src/*.mjs`
  是稳定层（协议、凭据、IPC），要改先说明理由。
- 界面照鸿蒙电脑版走：深色、封面为主角、导航一层、播放条克制。不要引入 UI 组件库或第二种设计语言。
- 设计令牌集中在 `src/renderer/styles.css` 的 `:root`，新颜色/圆角/字号必须先加令牌，不要散落魔法值。
- 渲染层不碰 Node、不碰凭据、不直连服务端；一切走 `window.desktop` 白名单 IPC。

**命令**

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue   # 必须，否则 electron 变成纯 Node
npm run build                                                        # tsc + electron-vite 构建
npm start                                                            # 构建并启动
node tools/shots.mjs                                                 # 需要先带 --remote-debugging-port=9222 启动
```

**验证口径**

- `npx tsc --noEmit`、`npm run build` 必须通过。
- 截图只证明「界面能出来」，真实数据要走一次登录 + 播放；没验过的功能写 pending，不要写 verified。
- 开发态会话在 `%APPDATA%\Electron`（按 `electron out/main/index.js` 启动）；换成 `npx electron .` 会读不到老会话。

**红线**

- `.local/`、真实凭据、个人音乐库数据：不打印、不提交、不打包。
- 不关闭 webSecurity/CSP，不改系统代理，不抢占 `hms://`。
- 不做任何绕过付费/会员/地域/版权限制的功能（解密、下载、代理音源、批量抓取）。
- 显示名必须始终带「非官方」（`src/shared/app-name.mjs`）；不得使用任何厂商官方图标或商标做产品标识。

**发布**

- 二进制只通过 GitHub Release 发布（未签名构建），发布说明必须写明：未签名、非官方、
  OAuth 身份不属于本项目。
- 发版前跑 `npm test`、`npm run typecheck`、`npm run build`，并确认 `.local/`、`research/`、`docs/review/`
  没有被带进版本库。

---

# 工程约定（上一阶段延续，同样有效）

- 本项目是独立的第三方桌面客户端；不用其他平台音源，不依赖手机充当播放器。
- 不要重新选 Tauri/Go；继续 Electron + React + TypeScript。
- 实际验收以 `docs/IMPLEMENTATION_STATUS.md` 为准；未验平台不能宣称已验收。
- 现有 `src/*.mjs` 和 `test/` 是协议原型，可迁移复用；`scripts/` 是实验命令，不能全部塞进发行包。
- 真实个人联网验证需授权；写操作只用临时对象并最终读回确认清理。
- 方案文档是目标要求，不是已实现状态；与 README 当前状态冲突时以 README 为准。
- 每日推荐首版不做；歌单简介编辑已测，不等于改名/曲目编辑/封面均已测。
- 收藏没有已确认的总数字段：总数由主进程完整分页后 ID 去重得到，与「已加载 N 首」分开。
- 主进程持有凭据与业务 HTTP；渲染层只用白名单 IPC。官方登录页嵌在主窗口的 `WebContentsView` 中，
  必须无 preload/Node/业务 IPC，取消只能走 `auth:cancelLogin`；顶部取消条高度与 `LOGIN_VIEW_TOP_INSET` 必须一致。
- 不关闭 webSecurity/TLS 校验；不把研究原型的明文文件当正式安全存储。
- 不创建复杂抽象、插件框架、后端服务、云端令牌代理或移动端工程。
- 不要恢复 Electron 默认菜单栏（Windows/Linux 应为无菜单，macOS 仅最小角色）；
  显示名统一用 `src/shared/app-name.mjs`，不得改 `package.json` 的 `name`（会挪动 userData 路径、丢旧数据）。
- 实现阶段维护简短的 `docs/IMPLEMENTATION_STATUS.md`，按真实证据标 pending/in-progress/verified。

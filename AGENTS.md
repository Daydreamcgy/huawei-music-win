# 本项目须知（UI 重构版，先读这段）

从 2026-10-24 起，这个目录是**按鸿蒙电脑版观感重做的新客户端**，渲染层全部重写，
主进程/协议层沿用上一版（`..\huawei-music\app`，只读参考，不要改那个目录）。

**开工顺序**：`README.md` → `docs/TECH-DESIGN.md` → `docs/API_CONTRACT.md`。

**边界**

- 只改 `src/renderer/**` 与 `tools/**`；`src/main/**`、`src/preload/**`、`src/shared/**`、`src/*.mjs` 视为稳定层，要改先说明理由。
- 界面照鸿蒙电脑版走：深色、封面为主角、导航一层、播放条克制。不要引入 UI 组件库或第二种设计语言。
- 设计令牌集中在 `src/renderer/styles.css` 的 `:root`，新颜色/圆角/字号必须先加令牌，不要散落魔法值。
- 渲染层不碰 Node、不碰凭据、不直连华为；一切走 `window.desktop` 白名单 IPC。

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
- 会话在 `%APPDATA%\Electron`（因为按 `electron out/main/index.js` 启动）；换成 `npx electron .` 会读不到老会话。

**红线**

- `.local/`、真实凭据、个人音乐库数据：不打印、不提交、不打包。
- 不关闭 webSecurity/CSP，不改系统代理，不抢占 `hms://`。
- OAuth 身份属于华为官方应用，产物不得公开分发。

---

# 上一版规则（同样有效，作为补充）


- 本项目是华为音乐独立第三方桌面客户端；不用其他平台音源，不依赖手机充当播放器。
- 已有 Electron + React + TypeScript 客户端与 Linux Electron 自动化；实际验收以 `docs/IMPLEMENTATION_STATUS.md` 为准。当前以 Linux 完成共享 API/页面/播放器验证，不用 Windows/macOS 或 Wine 阻塞开发；未验平台不能宣称已验收。不要重新选 Tauri/Go。
- 开工先读 `README.md`、`docs/IMPLEMENTATION_PLAN.md`、`docs/API_CONTRACT.md`、`docs/authorized-feature-validation.md`。
- 交接任务书：`docs/IMPLEMENTER_PROMPT.md`。按 M0–M6 推进，先完成真实登录和 MP3/FLAC 播放，再铺 UI。
- 启动：`npm ci && npm start`；检查：`npm test`、`typecheck`、`build`、`test:electron`、`test:electron-ui`、`test:electron-business`、`test:electron-favorites`。后两项含合成账号/965 首夹具，不能当私人账号证据。`probe:login` / `probe:music` 会请求外网但不登录个人账号。
- 现有 `src/*.mjs` 和 `test/` 是独立协议原型，可迁移复用；`scripts/` 为实验命令，不能全部塞进发行包。
- `.local/` 包含真实账号凭据和音乐库数据：禁止打印/上传/提交/打包。`research/` 为本地研究材料，同样不得进入发行包。
- 不主动调用保存的私人会话或重跑写测试；真实个人联网验证需当前用户授权。写操作只能用本次确定的临时对象并最终读回确认清理。
- 方案文档是目标要求，不是已实现状态。历史研究描述遇到冲突，以最新实测和 README 当前状态为准。
- 音乐 token 与账号 AT 不同：AT=1小时；音乐会话超过1小时仍可用，约7天只是到期字段线索。自动续期未打通。
- 每日推荐首版不做；歌单简介编辑已测，不等于改名/曲目编辑/封面均已测。
- playlist/detail/all 要真实 playListID；自建歌单删除用 playlist/delete，不能用 favorite/delete 的成功码冒充删除完成。
- playback 顶层 fileURL 是音频，fileInfos 可能是 JSON。auditionTime 不能单独判为30秒试听；完整播放按实际权限、资源和时长验证。
- 收藏没有已确认的直接总数字段：总数由主进程完整分页后 ID 去重得到，与“已加载 N 首”分开。保留滚动自动加载/失败重试/切页位置；禁止用首屏数量冒充总数或把合成数据截图当本人音乐库。
- 主进程持有凭据与业务 HTTP；renderer 只用白名单 IPC。官方登录页嵌在主窗口的 `WebContentsView` 中（不是第二个窗口），仍必须无 preload/Node/业务 IPC，取消只能走 `auth:cancelLogin`；顶部取消条高度与 `LOGIN_VIEW_TOP_INSET` 必须一致。
- 不关闭 webSecurity/TLS 校验；不抢占系统 hms://；不把研究原型的0600明文文件当正式安全存储。
- 不创建复杂抽象、插件框架、后端服务、云端令牌代理或移动端工程。
- 二进制只通过 GitHub Release 发布（未签名测试构建），发布说明必须写明未签名、非官方、OAuth 身份不属于本项目；不要另开对象存储/网盘等公开分发渠道。
- 不擅自公开仓库/产物、变更系统代理或删除研究现场。
- 应用/托盘图标由 `scripts/make-icon.mjs` 从 Lucide（ISC）生成；换图标要重跑脚本并保留 `build/icon.LICENSE.txt` 归属声明。
- 不要恢复 Electron 默认菜单栏（Windows/Linux 应为无菜单，macOS 仅最小角色）；显示名统一用 `src/shared/app-name.mjs`，不得改 `package.json` 的 `name`（会挪动 userData 路径、丢旧数据）。
- 实现阶段维护简短 `docs/IMPLEMENTATION_STATUS.md`，按真实证据标 pending/in-progress/verified；没有测试的平台不宣称支持已验收。

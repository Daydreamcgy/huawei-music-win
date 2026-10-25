**非官方客户端。与华为及其关联公司无隶属、合作或代理关系，未获授权、认可或技术支持。**

不含任何音源，不下载、不破解、不绕过付费 / 会员 / 地域 / DRM 限制；能听什么完全取决于你自己的账号。
使用第三方客户端是否违反服务条款、账号是否可能受限，由使用者自行判断和承担。

- 安装包（NSIS，x64，未签名）：双击运行向导，可自选安装目录；会创建桌面与开始菜单快捷方式。
- 卸载走「应用和功能」；卸载默认保留用户数据（设置、队列、登录态）。
- 首次运行可能被 SmartScreen 拦一次（未签名），请先核对附件里的 `SHA256SUMS` 再决定是否继续。
- 登录用的 OAuth 应用标识不属于本项目（见 README 的「已知限制」），可能随时失效。
- 代码以 AGPL-3.0-only 授权，完整源码见本 Release 对应的 tag；`NOTICE` 写明了对上游项目
  [talongao/huawei-music-desktop](https://github.com/talongao/huawei-music-desktop) 的修改范围。

**校验安装包**

```powershell
Get-FileHash .\huawei-music-desktop-<version>-win-x64-setup-unofficial.exe -Algorithm SHA256
```

哈希应与同一 Release 里的 `SHA256SUMS` 一致。

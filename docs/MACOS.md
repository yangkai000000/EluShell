# macOS 测试版

2026-09-14 11:10（北京时间）已发布 **0.9.1 上传诊断版**，用于收集 `Permission denied` 的定位日志。安装后在“文件传输”面板点击“导出诊断日志”，回传 JSONL 文件。[诊断版操作说明](MACOS-DIAGNOSTICS-0.9.1.md)。官网下载页提供全部历史版本及时间记录。下文保留 0.9.0 基础版本的安装、构建与验收范围说明。

基于与 Windows 0.9.0 相同的已测试代码，提供 Apple 芯片 arm64 与 Intel x64 两个独立 ZIP。使用 Electron 40.10.6 官方预编译运行时，不需要用户安装 Node.js。

发布页面：http://47.105.176.1:8800/elushell-updates/ 。两个包均要求 macOS 12 Monterey 或更新版本。

| 架构 | 文件 | 字节数 |
| --- | --- | ---: |
| Apple 芯片 arm64 | EluShell-0.9.0-macos-arm64-preview.zip | 117543461 |
| Intel x64 | EluShell-0.9.0-macos-x64-preview.zip | 124242776 |

校验和与包结构报告保存在 `release/macos/report-arm64.json` 和 `report-x64.json`，下载页也展示对应 SHA256。发布记录包含在官网 `releases/0.9.0.json`。

## 安装与操作

### 更新已有 Mac 安装

1. 打开[官网下载页面](http://47.105.176.1:8800/elushell-updates/#mac-update)，在苹果菜单“关于本机”确认芯片：Apple M 系列选 arm64，Intel 选 x64。
2. 下载相同架构的新版本 ZIP，核对页面 SHA256 后解压。
3. 保存编辑内容、完成文件传输并停止抓包，按 **Command+Q** 完全退出 EluShell。只关闭窗口会隐藏应用，不能代替退出。
4. 在访达打开“应用程序”，用新版 `EluShell.app` 替换旧版。不要删除 `~/.EluShell`，连接、设置和个人数据保存在这个独立目录。
5. 从“应用程序”启动 EluShell，在设置的“更新配置”确认版本号。若提示应用正在使用，先完全退出再替换；若系统阻止打开，按下面的安装说明处理。

当前 Mac 测试版仅提供手动更新。Windows 的 `windows/x64/` 更新目录不能用于 Mac。现有客户端只接入 Windows NSIS 更新器；Mac 自动更新还需要 Mac 更新器、`latest-mac.yml`、满足更新校验要求的签名包与真实 Mac 升级验证。当前 ad-hoc 测试发布流程尚未提供这些保证。

从发布页面选择对应芯片的 ZIP，解压后把 EluShell.app 拖到“应用程序”。系统版本要求见下载页面和包内安装说明。应用配置位于 `~/.EluShell`。Windows 导出的连接 JSON 可以导入，带密码的版本 2 JSON 可迁移已保存登录密码，导入后由 Mac 系统加密；私钥及其口令仍需在本机配置。

- 终端：Command+C 复制选区、Command+V 粘贴、Command+F 搜索；Ctrl+C 保留为远程 Shell 中断。
- 文件列表：Command+单击切换选择，Shift+单击连续选择，右键选中区域批量下载。
- 文件编辑器：Command+S 保存，Command+F 查找；命令编辑器：Command+Enter 发送。
- 关闭窗口会隐藏应用并保留 SSH 会话，点击 Dock 图标恢复；Command+Q 或 EluShell 菜单退出。
- macOS 测试版不支持应用内自动更新。退出后手动替换应用包，个人配置保留。
- SSH Agent 使用 `SSH_AUTH_SOCK`，没有可用 Agent 时可改用私钥文件认证。

当前包仅做 ad-hoc 签名，无 Apple Developer ID 签名或公证。若系统阻止打开，先核对下载页 SHA256，再使用“系统设置 → 隐私与安全性”针对本应用选择“仍要打开”。不要关闭系统整体安全检查。

## 构建

`npm run prepare:mac` 编译前端和主进程，生成 `release/macos/app.asar`。仅装入必要的运行时依赖，排除 Windows `.node` 加速模块，并通过独立 SSH 服务验证 ssh2 的 JavaScript 实现。

跨平台打包在隔离 Linux 工作目录执行 `scripts/package-mac-preview.py`。输入为 `app.asar`、`icon.png`、`app-update.yml`、`payload-report.json`、`verify-mac-signatures.py` 和经上游 SHA256 校验的 rcodesign 0.29.0 Linux 二进制。

脚本核对 Electron 官方 SHASUMS256，恢复 Unix 权限与符号链接，设置主应用和 Helper 名称及标识，生成 ICNS 图标，递归 ad-hoc 签名，验证结构后以 `zip -y` 保留符号链接。可预先从镜像取得 Electron ZIP，但必须通过官方校验和检查。

未来有 macOS 构建环境时可使用 `npm run dist:mac`。正式分发还需配置 Developer ID、公证，并完成 Mac 启动与功能验收。

## 验证范围

- TypeScript 与生产构建、99 项单元/本地 SSH/SFTP 测试。
- Windows 隔离 Electron 窗口中的命令工作区回归。
- `node scripts/terminal-files-smoke.mjs --mac-shortcuts` 模拟 Mac renderer 平台，验证 Command+F、Ctrl+C、剪贴板菜单和文件操作。它不是 macOS 系统模拟器。
- 追加 `--mac-payload` 后，直接使用将要发布的 `app.asar` 在 Windows Electron 中执行同组测试，覆盖包内纯 JavaScript SSH/SFTP 实现；报告为 `test-results/terminal-files-mac-payload.json`。
- 应用载荷中的 JavaScript SSH 实际握手与执行，无 Windows 原生模块。
- 两架构 Mach-O 类型、执行权限、符号链接、ZIP CRC 和 SHA256。
- 自有离线检查器校验 CodeDirectory 的代码页、特殊槽哈希、资源文件与嵌套签名摘要。结构来自 [Apple XNU cs_blobs.h](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/cs_blobs.h)。

rcodesign 的 `verify` 明确提示存在误报，且对 ad-hoc 的空 CMS 数据报错；保留该日志，不将其记为通过。离线哈希检查不等于 Apple `codesign --verify`、Gatekeeper 或公证验收。

每个架构检查 15 个 Mach-O、14 个符号链接、9 份资源清单和 250 个资源条目。对离线签名检查器进行了篡改测试，修改代码字节、Info.plist 或资源清单均会被拒绝。

**未验证：** macOS 实际启动、界面、Dock、Keychain、文件对话框、系统剪贴板和真实 Mac SSH 会话。Windows/Linux 沙箱无法替代 macOS 环境。发布包因此标注为测试版。

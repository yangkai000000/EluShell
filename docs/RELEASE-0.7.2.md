# EluShell 0.7.2

2026-09-10 发布。Windows x64 安装包及 blockmap 已通过 itos 上传到现有 Nginx 静态站；安装包校验完成后原子替换 latest.yml。

## 变更

- 连接配置共享：导入预览、分类路径合并、重复跳过、导入前备份。导出不包含密码、私钥或历史；导入的隧道及自动登录命令默认关闭。
- 新 ES 终端图标应用于窗口、可执行文件、安装及卸载程序。
- SSH 改为带 PTY 的登录 Shell 启动器，启动阶段识别 PID，不再向交互终端输入可见探测命令。目录跟随保留。
- 选中终端文字后出现复制和搜索；右键支持复制、粘贴、查找、清空本地终端缓存。Ctrl+Shift+C/V/F；Ctrl+C 保留远程中断功能。
- 文件管理增加名称、大小、修改时间、权限、用户/用户组排序，显示 SFTP 所有者名称或 UID/GID；移除行末下载按钮。
- 支持 Windows 外部文件及文件夹拖入当前目录或具体文件夹，递归上传，同名文件直接替换、目录合并。菜单上传采用同样规则。
- 附 30 页 Word 操作指南，含实际打包界面截图与功能标注。

## 验证

- `npm test`：16 个测试文件、79 项测试通过。
- `npm run build`：TypeScript、Vite 和 Electron 主进程构建通过。
- Electron Builder：NSIS 和便携 EXE 成功生成，已检查图标资源与版本。
- `terminal-files-smoke.mjs --packaged`：列排序、所有者、选择菜单位置、复制、搜索、粘贴不加回车、Ctrl+C、清空缓存、原生拖入文件和文件夹、同名覆盖、合并保留其他文件、拖入具体目录。
- `files-smoke.mjs --packaged`：编辑器 Ctrl+S、未保存保护、远程冲突保护、目录上传下载、权限、改名、目录树 cd 等回归通过。
- `sharing-smoke.mjs --packaged`：导出无密码、导入预览与取消、重复跳过、凭据和历史保留、备份及重启持久化通过。
- 真实 118 服务器 itos 会话：无可见探测命令、Shell PID 识别、`cd /tmp` 跟随、用户/用户组读取通过；未修改服务器业务文件。
- 公网下载 99,533,528 字节，SHA512 与本地产物及清单一致，Range 返回 206，旧版 0.7.0 安装包仍可访问。

## 产物

- `release/EluShell-Setup-0.7.2-x64.exe`
- `release/EluShell-Setup-0.7.2-x64.exe.blockmap`
- `release/EluShell-0.7.2-windows-x64.exe`
- `release/latest.yml`
- `artifacts/guide/EluShell操作指南.docx`
- `assets/brand/elushell-icon.png`、`build/icon.ico`

安装包 SHA256：`2f117adba8569b80b91bcc38724e904ea670c74bec108f58f64d7310c3459682`。

更新源仍默认空白。本次测试站目录为 `http://118.190.211.218:8800/elushell-updates/windows/x64/`，客户端使用它时需自行配置并允许 HTTP 测试源。现有用户配置不会随安装包发布。

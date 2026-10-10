# 应用更新与发布

客户端使用 electron-updater 6.8.9 和 Windows NSIS。更新服务器地址默认空白，未设置时不创建更新客户端，也不发送网络请求。安装包不内置用户服务器地址。

## 0.9.1 Mac 诊断版发布记录

2026-09-14 11:10（北京时间）按用户要求发布 Mac arm64/x64 上传诊断包，增加本地读取与 SFTP 阶段日志以及“文件传输 → 导出诊断日志”入口，保留既有上传流程，等待真实 Mac 复现日志。Windows 自动更新保持 0.9.0。

下载页新增全部版本区，共 17 个版本、32 个安装包，包含补档的 15 个历史 Windows 包。记录使用北京时间；旧版优先采用服务器留存时间，缺少首次发布时间的早期包明确标注构建记录。公开清单：`releases/downloads-0.9.1.json`。

## 0.9.0 发布记录

2026-09-12 已同步发布 0.9.0 Windows 安装包、Mac arm64/x64 ZIP 测试包与同版本在线/Word/PDF 指南。服务器发布门禁和 nginx 全部 53 个文件完整下载校验通过；构建记录、路径及回退备份见 [发布流程](RELEASING.md)。

Mac 当前使用手动更新：从官网选择相同芯片架构的新版 ZIP，按 Command+Q 完全退出，用新版 EluShell.app 替换“应用程序”中的旧版，保留 ~/.EluShell。0.9.0 客户端增加官网更新说明入口；网站模板增加 #mac-update 专节。具体步骤见 [macOS 说明](MACOS.md)。

## 0.8.0 在线升级验收记录

1. 安装 `release/EluShell-Setup-0.7.0-x64.exe`，从桌面快捷方式打开。
2. 在「工作区设置 → 软件更新」填写 `http://47.105.176.1:8800/elushell-updates/windows/x64/`。
3. 当前测试站使用 HTTP，勾选「允许 HTTP 测试源」，保存更新设置。
4. 点击「检查更新」，应发现 0.8.0。可下载更新、明天提醒或忽略此版本。
5. 下载后点击「重启并安装」，重启后版本为 0.8.0；也可稍后从设置中继续安装。

为测试版本差异，可以从 0.7.0、0.7.1 或 0.7.2 更新。直接安装 0.8.0 后检查会显示已是最新版本。重新打开应用时，已配置的更新源在首屏出现约三秒后进行后台检查，不阻塞启动。

## 配置与安装

- `.EluShell/updates.json` 保存地址、自动检查、HTTP 测试开关、忽略版本、提醒时间和上次检查时间。地址留空即关闭检查。
- 忽略仅针对该版本，手动检查可再次显示它；明天提醒延后 24 小时。后台检查超时约 10 秒，失败不弹出阻塞窗口。
- 下载需要用户点击，完成后不会在普通退出时自动安装。关闭再打开后，可手动检查并复用已校验的下载缓存。
- 安装前要求没有正在传输的文件和未保存的编辑内容；有 SSH 会话时确认断开。设置先 flush，再备份为 `settings.pre-update-原版本.json`。
- 连接、系统加密密码、共享命令、历史、外观和下载目录沿用原 `.EluShell`。
- 更新器校验安装包 SHA512。当前测试包未配置 Windows 发布者签名；HTTP 不提供传输身份保证。正式公开分发应配置 HTTPS 和代码签名，HTTP 测试选项默认关闭。
- 应用内更新需要 Setup 安装版，便携包不支持自动安装。

## 服务器发布记录

本次使用 itos。实际 Nginx 配置是 `/home/itos/conf/itos.conf`，用户提供路径中的 `/homs` 应为 `/home`。8800 端口静态站根目录 `/home/itos/application/web` 可由 itos 写入，新建 `/home/itos/application/web/elushell-updates/windows/x64/` 即可发布，未修改或重载 Nginx。

目录保留 0.7.0、0.7.1、0.7.2、0.8.0 的 Setup EXE 和 blockmap，latest.yml 指向 0.8.0。先上传临时文件，核对 SHA256，安装包就位后最后发布清单。凭据仅经关闭回显的标准输入传给 SSH 发布脚本，不进入项目和发布目录。

0.7.2 安装包为 99,533,528 字节，SHA256 为 `2f117adba8569b80b91bcc38724e904ea670c74bec108f58f64d7310c3459682`。公网完整下载 SHA512 与本地清单一致，Range 请求返回 206。发布前清单保存在服务器的 `latest-before-0.7.2.yml.backup`。

2026-09-10 发布 0.8.0，使用 itos 账号。安装包为 99,546,068 字节，SHA256 为 `2e1e0b624412e4cc5b4366c63c5ae3645edd79f07d152652acd15484cef7bc2e`。服务器发布前的清单保留为 `latest-before-0.8.0.yml.backup`。本地全部制品哈希记录在 `release/checksums-0.8.0.json`，线上完整下载验证报告见 `test-results/published-update-v07.json`（报告内版本字段为 0.8.0）。

## 后续版本

提升 package.json 和 package-lock.json 版本，完成构建、单元测试及安装回归，再运行 `npx electron-builder --win nsis --config.electronDist=node_modules/electron/dist`。执行 `node scripts/make-update-feed.mjs 新版本号` 生成清单，并修改脚本内的本次更新说明。

上传新的 EXE 和 blockmap，校验后原子替换 latest.yml。保留旧版本 blockmap 便于差分下载，失败可回退完整下载。不要覆盖已发布的同版本安装包。

latest.yml 使用 JSON 语法（合法 YAML），包含大小、SHA512 和更新说明。静态站无需数据库或常驻 Node 服务，可迁移到 HTTPS 域名或对象存储。

## macOS 测试版发布

2026-09-10 在 Windows 0.8.0 发布完成后，新增 `/elushell-updates/` 统一下载页，以及 `macos/arm64/`、`macos/x64/` 两个测试包目录。Windows 的安装包和 latest.yml 未替换。macOS 0.8.0 使用手动 ZIP 安装，无自动更新清单，不接入 Windows NSIS 更新流程。

macOS 包无 Developer ID 或公证，没有 Mac 实机验收；下载页明确标注测试版。构建、隔离验证、离线签名检查及限制见 [macOS 说明](MACOS.md)。公网完整下载验证脚本为 `scripts/verify-mac-downloads.py`；下载清单先经 SSH 哈希比对，再核对 ZIP 大小、SHA256、CRC、Unix 权限、符号链接数和 app.asar 与已测试载荷的一致性。

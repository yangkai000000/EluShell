# 测试与交付

## 0.7.0 / 0.7.1 更新验收（2026-09-10）

- 构建和 71 项单元/协议测试通过。更新测试覆盖空地址不联网、不写配置、URL/HTTP 校验、忽略与延后提醒持久化、手动检查覆盖忽略、下载取消、忙碌时禁止换源、下载失败禁止安装和检查超时。
- `node scripts/update-smoke.mjs` 使用实际打包应用和本机 HTTP 源验证设置界面、忽略版本后重启、后台提示抑制、手动检查、实际 electron-updater 下载、SHA512 错误拒绝安装、普通退出不自动安装、清空地址。报告 `test-results/updates-packaged.json`。
- management 和 files 打包回归通过：连接、加密密码、进程管理、命令历史、面板、文件传输、编辑器保存及未保存退出保护正常。
- 真实 0.7.0 NSIS 安装到工作区测试目录，经更新模块下载真实 0.7.1 安装包，用户点击后完成覆盖升级并启动带 `--updated` 的新版进程。新安装 app.asar 与发布文件校验一致，重启后历史、字号、更新偏好以及升级前备份验证通过。报告 `test-results/native-upgrade-v07.json`。
- NSIS 经 Explorer 启动新版时不会继承测试专用环境变量；自动启动进程单独核验后，用相同隔离测试配置重新启动进行界面断言。最初两次自动化重连失败因此修正，未将它们作为产品安装失败或通过的依据。
- 升级测试副本随后卸载，程序、快捷方式和卸载登记清理通过，隔离配置保留。报告 `test-results/upgrade-cleanup-v07.json`。
- 通过 itos 将安装包和清单发布到现有 Nginx 静态目录，服务器端 SHA256 校验一致。更新地址没有写入客户端默认值。发布详情及用户测试步骤见 [UPDATES.md](UPDATES.md)。
- 公网完整下载 0.7.1 的 99,224,146 字节安装包，SHA512 与清单/本地产物一致，Range 返回 206 且 EXE 文件头正确，0.7.0 安装包 HEAD 返回 200。报告 `test-results/published-update-v07.json`。
- 生产依赖审计为 0 漏洞，electron-updater 固定 6.8.9。没有执行自动更新强制降级；当前发布包未签名，HTTP 测试源需显式勾选。

安装起点 `release/EluShell-Setup-0.7.0-x64.exe`，服务器目标 `release/EluShell-Setup-0.7.1-x64.exe`；校验值保存在 `release/checksums-0.7.json`。

## 0.6.2 启动与安装验收（2026-09-10）

- 构建及 64 项单元/本地协议测试通过。配置测试检查当前格式 settings.json 再次初始化时不会调用写入。
- 最终应用通过 management / newtab / commands 三组 `--packaged` 回归：SSH 首屏输出、终端切换保留、加密密码重启使用、进程操作、命令和编辑器设置持久化均正常。桌面管理测试同样通过；截图确认「活跃进程」在「磁盘与 I/O」上方。
- `EluShell-Setup-0.6.2-x64.exe` 实际静默安装到工作区独立测试目录，安装后的 app.asar 与发行目录 SHA-256 一致。三次启动后卸载测试副本，应用、开始菜单快捷方式和卸载登记清理通过。报告：`test-results/installer-smoke-v062.json`。
- `scripts/startup-bench.mjs <EXE> <报告名称> 3` 测量从进程启动到新标签页可用，包含 CDP/界面轮询开销。每组使用独立配置，组内三次共用配置、完整退出后重新启动。未同时运行其他应用测试，不是 OS 冷启动测试。

| 路径 | 第一次 | 第二次 | 第三次 | 平均 |
| --- | --- | --- | --- | --- |
| 旧 0.6.1 单文件便携 EXE | 10.227 s | 10.719 s | 10.072 s | 10.339 s |
| 优化前直接运行应用目录 | 0.722 s | 0.558 s | 0.585 s | 0.622 s |
| 新 0.6.2 安装后 EXE | 2.356 s | 0.549 s | 0.572 s | 1.159 s |

主要收益来自避免便携包每次解压，不能把全部差异归因于前端优化。新安装版三次启动的 settings.json 修改时间保持相同；首屏脚本/预加载列表仅含 index 与约 0.12 KB 的公共 runtime，不包含约 304 KB 的终端 chunk。首次连接后终端功能由上述打包回归验证。

计时报告：`startup-portable-before.json`、`startup-direct-before.json`、`startup-installed-after.json`，均位于 test-results。安装测试使用项目隔离配置与本地服务，没有更改用户真实服务器。

最终 0.6.2 便携 EXE 也已直接启动通过解压、renderer/preload、设置和隧道入口检查，报告 `test-results/portable-smoke.json`。安装包 98,922,404 字节，便携包 98,692,936 字节；校验值见 `release/checksums-0.6.2.json`。

## 0.6.1 极限场景验收（2026-09-10）

新增 `npm run test:stress`；用 `npm run test:stress -- --packaged` 验证实际发行目录。两者均通过，报告 `test-results/stress-desktop.json` 和 `stress-packaged.json`。构建、64 项单元/协议测试，以及命令库、新标签页的桌面与打包回归均通过。

| 板块 | 数据量 / 边界 | 已验证操作 |
| --- | --- | --- |
| 最近连接 | 100 条 | 列表位置靠上、条数、固定表头、鼠标滚轮、实际拖动滑块到末尾、Home/End、搜索后回到顶部、空结果、超过 100 条淘汰最旧记录 |
| 命令与分类 | 各 1000 条 | 分类横向滚轮/滑块、命令纵向滚轮/滑块、末项复制和发送、长名称省略、搜索和空分类、滚动不误发命令 |
| 命令编辑器 | 8000 字符长行、400 行文本 | 横纵滚动、超限输入拒绝、最大宽度、折叠恢复、最小文件面板仍可访问命令 |
| 历史 | 100 条，含 7900 多字符命令 | 滚动到底、键盘循环选择末项、补全 |
| 文件 / 进程 | 各 1000 项 | SFTP 实际列目录、滚动到末项、搜索、进程排序 |
| 保存连接 | 1000 条 | 连接管理内滚动、筛选、双击登录、更新最近记录 |
| 工作区 | 1060×700、30 标签、128 逻辑核心指标 | 拖动左右与上下分隔线、无页面整体溢出、标签换行且传输/设置可达 |

本机打包测试记录：100 最近连接及 1000 命令配置加载到表格可用约 183 ms，1000 命令查询到结果约 170 ms。这是本次隔离测试的测量，不是其他机器上的性能保证。测试仅使用本机 SSH/SFTP 服务和项目测试目录。

截图：`stress-recent-100.png`、`stress-commands-1000.png`、`stress-processes-1000.png`。交付 `release/EluShell-0.6.1-windows-x64.exe`，88,965,151 字节，SHA-256 保存在 `release/checksums-0.6.1.json`。

## 0.6.0 验收（2026-09-10）

- `npm run build` 通过，64 项单元/SSH/SFTP 协议测试通过。新增命令迁移、分类边界、模糊匹配、历史隔离和多会话部分失败测试。
- commands / files / newtab / management / appearance 五组 Electron 桌面测试及对应 `--packaged` 测试全部通过，报告位于 `test-results/*-desktop.json` 与 `*-packaged.json`。
- 命令测试验证单击直接发送且保留输入栏草稿、分类及命令右键操作、每连接最近 100 条、模糊键盘补全、两连接三个会话广播、CR 设置、Ctrl+Enter、仅清空当前历史、编辑器选项/草稿重启恢复。
- 文件测试验证九个权限勾选与八进制双向同步、特殊位保留、无效值禁用，以及目录树/文件列表 cd、空格与单引号路径转义、成功发送记录历史。SFTP 测试端检查实际收到的递归 chmod 数值。
- 新标签页测试验证启动与「＋」、单击选择/双击连接、替换新标签、最近记录去重排序/持久化、清空不删连接、缺少密码回到表单、切换新标签不卸载已有终端、关闭最后会话自动出现新标签。
- 最终 `release/EluShell-0.6.0-windows-x64.exe` 已直接启动通过自解压与界面检查，报告 `test-results/portable-smoke.json`；88,965,379 字节，SHA-256 见 `release/checksums-0.6.0.json`。

本轮使用隔离本地 SSH/SFTP 服务与独立用户目录，不访问或修改用户真实服务器。截图包括 `command-workspace-v6.png`、`command-history-v6.png`、`permissions-v6.png`、`new-tab-v6.png`。

## 自动化覆盖

| 层         | 内容                                                                                                                     | 命令                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| 类型/构建  | 严格 TypeScript，Vite 静态资源，主进程/preload bundle                                                                    | `npm run build`         |
| 单元       | CPU/网络差分、内存与挂载点解析、计数重置、无效数据、命令引用/历史/标签/补全/参数校验、磁盘 I/O                           | `npm test`              |
| SSH 集成   | 本地真实 SSH Server，认证成功/失败、指纹拒绝、PTY 收发、独立指标、resize、disconnect                                     | `npm test`              |
| SFTP 集成  | 本地 SFTP 协议服务，列目录、路径补全、90 KB 二进制上传和下载逐字节一致性                                                 | `npm test`              |
| 桌面端到端 | Electron 启动、五类指标详情、快捷命令、历史、自定义命令、连接保存、经 IPC 连接本地 SSH、自动登录命令、关闭会话、紧凑布局 | `npm run test:desktop`  |
| 打包验收   | 对解包 EXE 执行相同的桌面测试，验证 preload/资源路径和 SSH 依赖随包可用                                                  | `npm run test:packaged` |

0.2.0 单元/协议集成共 22 项测试。新增本地与远程隧道真实数据收发、断开释放端口、监听冲突回滚，以及目录路径与隧道配置校验。每次桌面验收生成 `desktop-smoke.json` / `packaged-smoke.json`，结果以这些实际运行报告为准。

## 0.2.0 新布局验收

`npm run test:workspace` 覆盖终端默认高度、右侧快捷栏移除、多级目录导航、输入栏和直接终端的 cd 同步、监控宽度、目录树拖拽、文件高度、折叠恢复、尺寸持久化、隧道配置保存和紧凑布局。`npm run test:workspace -- --packaged` 对打包程序重复这些检查。

用户授权的真实服务器验证结果见 `test-results/live-desktop-v2.json`：输入栏 cd、直接终端 cd、失败 cd 不切换、恢复原工作目录均通过；没有创建生产服务器隧道或修改远程文件。隧道使用独立的本地 SSH 测试服务验证，服务器策略仍可能限制真实远程端口转发。

新截图为 `test-results/workspace-v2.png`、`workspace-v2-packaged.png`、`workspace-v2-compact.png` 和 `tunnel-settings.png`。功能对照见 [FinalShell 对照](FINALSHELL-COMPARISON.md)。

0.2.0 最终结果：生产构建、22 项单元/协议测试、新工作区桌面与打包测试、原有 SSH 流程回归、便携 EXE 自解压启动测试全部通过。产物校验记录为 `release/checksums-0.2.0.json`。

2026-09-08 本机验收：类型检查与生产构建通过，16 项测试通过，桌面与解包 EXE 端到端测试通过。用户授权服务器的后端只读验证及实际 Electron 界面验证均通过，读取到 16 个逻辑核心、约 61.8 GiB 内存、13 个挂载点，默认路由网卡为 eth0。测试未修改远程文件，未持久化密码。

真实服务器报告：`test-results/live-readonly.json`、`test-results/live-desktop.json`。对应实际界面截图：`test-results/live-workspace.png`。

2026-09-09 便携启动器验收通过：直接启动最终便携 EXE，验证自解压、渲染进程与 preload、内存详情、终端输入、配置持久化和文件工作区。报告为 `test-results/portable-smoke.json`，截图为 `test-results/portable-workspace.png`。可使用 `npm run test:portable` 重跑；脚本通过独立的本地调试端口连接自行启动的测试实例，测试完成后关闭该实例。

## 产物

- `release/EluShell-Setup-0.6.2-x64.exe`：当前推荐安装包，安装后从快捷方式直接启动应用。
- `release/EluShell-0.6.2-windows-x64.exe`：便携启动器，每次运行时解压应用。
- `release/win-unpacked/EluShell.exe`：完整应用目录中的程序，不能只复制这一文件。
- `test-results/workspace.png`、`packaged-workspace.png`：正常窗口截图。
- `test-results/compact.png`、`packaged-compact.png`：紧凑窗口截图。

## 真实环境验收建议

当前自动化服务器为本机可控测试服务，另已使用用户授权账号对指定 Linux 服务器完成只读验证（见 test-results/live-readonly.json）。上线使用前，用测试 Linux 主机验证你的发行版、私钥格式、Agent、网络链路与权限。建议检查 `top`/`vim` 等交互程序，两个并行会话，网络断开重连，不同挂载点，以及大文件传输。没有实际运行这些真实环境场景之前，不将它们视为已经通过。

未执行 macOS/Linux 打包、Windows 代码签名及跨版本安装升级测试。0.6.2 已验证首次安装、启动及卸载；这些检查不能替代长期稳定性与所有 Linux 发行版的兼容性验证。

## 0.3.0 验收

新增 `tests/remote-files.test.ts`，通过真实本地 SSH/SFTP 协议验证文件夹多级上传下载、同名下载保留、UTF-8/CRLF 编辑、远端冲突拒绝、二进制拒绝、目录创建/改名/权限/删除、根目录保护、路径校验和取消任务状态。单元/协议测试合计 25 项。

`npm run test:files` 验证会话栏、系统实际桌面下载默认路径、修改下载目录、双击内置编辑器、Ctrl+S 回传、未保存关闭保护、取消应用退出后会话仍可使用、远端编辑冲突、文件夹递归传输、进度面板、递归权限、改名、目录树右键和递归删除。全部写入仅发生在独立本地测试服务中，未写入用户真实服务器。

报告：`test-results/files-desktop.json`、`files-packaged.json`。截图：`workspace-v3.png`、`editor-v3.png`、`transfers-v3.png`。最终程序为 `release/EluShell-0.3.0-windows-x64.exe`；打包和便携启动结果以对应实际测试报告为准。

0.3.0 最终验收通过：25 项单元/协议测试，文件操作桌面与打包测试，原有 SSH 桌面与打包回归，打包布局回归，最终便携 EXE 自解压启动测试。产物校验为 `release/checksums-0.3.0.json`。

本次最终打包命令为 `npm run dist -- --config.electronDist=node_modules/electron/dist`，使用项目已安装的 Electron 40.10.6，避开打包工具重复在线下载时的网络超时。代码签名尚未配置；构建日志中的 signtool 阶段不表示已取得可信发布者签名。

## 0.4.0 验收

新增配置迁移、非覆盖迁移、分组转文件夹、凭据加密与端点绑定、加密不可用拒绝明文回退、文件夹环路拒绝、全进程解析/排序、PID/启动时间校验测试。合计 29 项通过。

`test:desktop` / `test:packaged` 现在运行 management-smoke.mjs：无演示启动、多级分类、独立隧道页签、实际系统加密密码文件、关闭并重启应用后留空密码连接成功、每列双向排序、字段复制、经 SSH 发出经确认的 SIGTERM、监控/历史/可拉伸折叠布局回归、配置目录和无密码导出。终止进程使用独立本地协议测试服务模拟，未终止真实服务器进程。

`test:files` 和对应 packaged 模式继续验证 SFTP 文件夹传输、权限、文本编辑/冲突和退出保护。报告：management-desktop.json、management-packaged.json、files-desktop.json、files-packaged.json。0.4.0 便携启动测试移除了演示依赖，改为验证空工作区、配置目录、系统加密可用性和隧道入口。

用户授权的真实 Linux 主机只读进程查询通过：343 个可见进程，42 个可读可执行位置，查询和身份检查共 2205 ms。报告 test-results/live-processes-v4.json 仅含汇总，不保存命令行内容或密码。

## 0.4.1 验证

47 项单元/协议测试通过，新增：JAR 绝对/相对路径、JVM 参数在 -jar 后、忽略 native library / Java Agent、含空格的 NUL 参数、Node/Python/dotnet/Shell 入口、模块启动回退、不可读工作目录、KB/MB/GB 阈值和按字节排序。

桌面回归新增服务 JAR 列及复制断言、GB/KB 显示、运行程序详情；截图为 test-results/processes-v041.png。真实服务器只读查询成功识别 43 个实际 JAR 位置；44 个 Java 进程中另一个无法读取相对路径对应的工作目录，显示未识别。报告为 test-results/live-processes-v041.json，不保存服务器命令行和凭据。

产物：release/EluShell-0.4.1-windows-x64.exe，校验文件 release/checksums-0.4.1.json。


## 0.5.0 验证

55 项单元及本地协议测试通过。新增旧配置外观默认值、颜色与资源标识校验、亮暗背景文字颜色、文件夹子树及连接移动、循环目录拒绝、Windows 文件占用重试与永久错误处理。

`appearance-smoke.mjs` 在开发构建与实际打包 EXE 均通过：点击文件夹离开新建表单并显示内容；右键创建和改名；拖动子树/连接及移回根目录；阻止自引用；双击已保存连接直接登录；缺少密码保留弹窗；概览顶置与 4 px 间隔；移除两行冗余信息；浮动搜索下一项/上一项、Escape 和高度不变；字体字号实时应用且不重连；独立/共享颜色背景与本地图片；图片源文件删除后重启仍正常；图片接口拒绝目录穿越；八会话窄窗口自动换行且工具按钮仍可见。

已通过打包版管理与文件回归：本地加密密码重启使用、SSH 隧道配置、进程排序/复制/SIGTERM、可拉伸折叠面板、SFTP 上传下载与递归操作、内置文本编辑、Ctrl+S、冲突及退出保护。测试数据使用 test-results 内隔离目录和本机临时 SSH 服务，不操作真实服务器。

报告：test-results/appearance-desktop.json、appearance-packaged.json、management-packaged.json、files-desktop.json、files-packaged.json。截图：folders-v5.png、appearance-settings-v5.png、wrapped-sessions-v5.png。

最终便携启动验收通过：直接启动 release/EluShell-0.5.0-windows-x64.exe，验证自解压、renderer/preload、外观设置、本地隔离配置、文件夹右键及 SSH 隧道入口。报告 test-results/portable-smoke.json。测试过程中自动权限审核曾超时，后改用同一次 PowerShell 执行内 Start-Process 启动并由 scripts/portable-inspect.mjs 检查，最终通过；测试完成后关闭测试窗口。校验文件 release/checksums-0.5.0.json，最终 EXE 为 88957401 字节。

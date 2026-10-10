# EluShell 0.8.0

新增右侧 AI 命令助手：DeepSeek / Kimi 预设、思考强度、流式回答、复制与人工命令操作、新建与历史对话、停止重试、上下文余量。模型没有执行工具，默认只填入；多行命令进入可编辑草稿。Key 通过系统加密，聊天和配置保存在 `.EluShell`。操作见 [AI 命令助手](AI-ASSISTANT.md)。

文件传输在新任务到达时自动展开。点击外部或 Esc 关闭，进度刷新不会重开同一个任务。蓝色进度配浅灰底色，完成后绿色；大小和数量放到进度下方左侧，移除每项「在文件夹中显示」，保留顶部「打开目录」。长文件名截断并提供悬停全文，只纵向滚动。

连接管理使用文件夹树下的 26px 单行列表，显示名称、地址、端口、用户。单击选中；右键新建连接、文件夹、编辑、复制地址、删除；编辑另开窗口。保留拖动分类、双击登录、导入导出、保存密码和隧道设置。删除文件夹会列出所含连接和文件夹数量，确认后仅删除本地配置。

安装包 `release/EluShell-Setup-0.8.0-x64.exe`，便携版 `release/EluShell-0.8.0-windows-x64.exe`。更新保留现有连接、凭据、命令库、历史和个人设置，更新地址仍默认空值。

## 验证

- 89 项单元测试 / 17 个文件通过，含新增 10 项 AI 测试。
- `scripts/ai-smoke.mjs`：流式、复制、仅填入、人工执行、停止、错误、重启保存；100 对话/100 传输任务与 1060×700 窗口检查。
- `scripts/connections-compact-smoke.mjs`：120 连接的单行列表、右键编辑、密码保留、文件夹/连接拖动、删除确认、搜索、双击登录。
- 打包测试结果分别记录在 `test-results/ai-packaged.json` 和 `test-results/connections-compact-packaged.json`。
- 终端、SFTP 回归：`scripts/terminal-files-smoke.mjs --packaged`、`scripts/files-smoke.mjs --packaged`。
- API 采用本机隔离 SSE 测试；未使用真实模型 Key 发起付费调用。

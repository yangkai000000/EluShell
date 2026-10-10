# 下载与更新服务器

2026-09-28 将原 `118.190.211.218` 下载站迁移至 `47.105.176.1`。协议、8800 端口和所有 URL 路径保持不变。

- 下载页：`http://47.105.176.1:8800/elushell-updates/`
- Windows 更新目录：`http://47.105.176.1:8800/elushell-updates/windows/x64/`
- SSH：`root@47.105.176.1:22`；密码通过运行时环境变量提供，不写入发布脚本或产物。
- 站点目录：`/srv/elushell-web/elushell-updates`
- Nginx：`/usr/local/software/openresty-1.19.3.1/nginx/sbin/nginx`
- 配置入口：`/home/itos/conf/itos.conf`
- 下载站配置：`/home/itos/conf/elushell-downloads.conf`，由上述入口 include。
- 迁移备份与校验记录：`/root/elushell-migration-20260928/`
- 新服务器 SSH 主机公钥 SHA256（hex）：`40cbf26fc7eb7f77180eeb35c63e435c271349bb7f88c81f9f27a1c5b9b0c7d9`。

本次迁移保留现有 0.10.9 和历史制品，不重新发布或覆盖同版本安装包。新发布使用相同的三平台与指南验证流程，最终发布目录改为上述路径。

旧版本客户端需要在软件更新设置中将 IP 改为 `47.105.176.1`，保留允许 HTTP 的原设置。源码已增加对旧官方 Windows 更新目录的启动迁移；该行为需包含此修改的后续安装包才能生效。自定义更新源及空默认值不受影响。

`scripts/release-target.py` 支持指定目标主机、账号、已核对的 SSH 主机公钥 SHA256 指纹和操作文件；使用 `ELUSHELL_RELEASE_PASSWORD` 传入密码。迁移前的 `release-transport.py`、`release-saved.cjs` 仍为旧服务器专用工具，不能用于新站发布。

## 迁移验收

- 758 个文件（约 7.5 GB）与旧站 SHA256 完全一致。
- 全部 758 个文件 URL 在新 Nginx 下通过 HEAD 和长度检查。
- 0.10.9 的 69 个发布文件通过新 Nginx 完整 HTTP 下载与 SHA256 校验。
- 公网首页、指南、更新清单、各平台包的大小与分段下载验证通过。
- 更新服务 13 项测试及生产构建通过。
- 本机 `.EluShell/updates.json` 已备份并替换 IP；正在运行的旧客户端需重新载入配置。

本地验收报告：`test-results/migration-all-url-checks.json`、`test-results/migration-http-verification.json`、`test-results/migration-sha256.log`、`test-results/public-release-metadata.json`。

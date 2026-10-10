# 内网 HTTPS 证书独立脚本

文件：`scripts/elushell-https.sh`。复制这一份文件到 Linux 服务器即可，无需安装 Python、Java、Node.js 或 EluShell。

依赖：Bash 4 及以上、awk、Linux 常用工具（包含 coreutils 的 timeout 等命令）、OpenSSL。脚本使用 Bash 和内嵌 awk 解析 Nginx 配置，识别注释、引号、嵌套块及变量，仅修改选择的 HTTP 站点；不联网、不自动安装依赖。

可先运行 `openssl version` 检查证书生成工具是否可用。只有 Java、没有 Python 也可以运行本脚本；若没有 OpenSSL，需要由管理员提供或安装 OpenSSL 后再运行。

## 交互运行

```bash
bash elushell-https.sh
```

按提示填写访问 IP / 域名、证书目录、KEY 目录和有效期。多个地址用逗号分隔，不带 `https://`、端口或路径。

默认只生成证书。选择写入 Nginx 时，还需填写站点文件、Nginx 可执行文件（包含程序名）、主配置文件、HTTPS 端口。多站点会列出编号供选择；已有 HTTPS 站点需填写现有 HTTPS 端口。只有实例启动时使用过 `-p`，才填写对应启动前缀。

执行前显示配置差异，输入 `yes` 后才生成并应用。使用当前运行脚本的用户权限；如 Nginx 主进程由 root 运行，需要使用 root 或通过已授权的 sudo 运行脚本。

## 仅生成证书和 KEY

```bash
bash elushell-https.sh \
  --names '10.0.0.10,app.internal' \
  --cert-dir /home/EluShell/certificates \
  --key-dir /home/EluShell/private \
  --days 365
```

目录不存在时会创建。默认生成独立名称的 `.crt` 和 `.key` 文件；可用 `--name internal-web` 指定文件名前缀，已有同名文件会报错，不覆盖。省略 `--key-dir` 时与证书存放在同一目录。

## 写入站点配置并重载

先只读查看所选文件中的站点编号：

```bash
bash elushell-https.sh --site-conf /home/itos/conf/itos.conf --list-sites
```

下面以 118 服务器已核实的路径为例。**把 `--server-index 1` 改成实际要配置的站点编号**，确认访问地址及端口后再执行：

```bash
bash elushell-https.sh \
  --names '47.105.176.1' \
  --cert-dir /home/EluShell/certificates \
  --key-dir /home/EluShell/private \
  --site-conf /home/itos/conf/itos.conf \
  --server-index 1 \
  --nginx-bin /usr/local/nginx/sbin/nginx \
  --nginx-conf /usr/local/nginx/conf/nginx.conf \
  --https-port 443 \
  --apply-nginx
```

脚本会检查原配置及站点引用、预览差异、生成证书、备份和更新所选站点，再检查新配置并平滑重载。保留原 HTTP 入口；已有 HTTPS 站点只替换证书路径。检查或重载失败时尝试恢复原配置；若期间其他人修改了配置，则保留其改动及证书，并提示备份位置。配置备份位于站点文件同目录，以 `.站点文件名.elushell-时间-标识.bak` 命名。

脚本不自动查找安装目录，也不自动判断多实例。程序路径、主配置及可选 `--nginx-prefix` 必须与目标运行实例一致。脚本通过该实例的 PID 配置发送重载信号，不使用 `systemctl restart`。配置差异可能包含站点原有内容，请勿把终端日志公开分享。

用于已核对的自动化流程时可添加 `--yes` 跳过确认；所有参数见：

```bash
bash elushell-https.sh --help
```

证书为 RSA 2048 / SHA-256 自签名服务器证书，包含 IP / 域名 SAN。KEY 权限设为 `600`；只向客户端分发证书，不分发 KEY。浏览器默认不信任自签名证书，需要自行导入信任。脚本不设置自动续期，不修改防火墙；重载命令成功也不等于客户端已能访问。

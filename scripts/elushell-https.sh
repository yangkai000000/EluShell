#!/usr/bin/env bash
# Standalone Linux tool: Bash 4+, awk, standard Linux tools and OpenSSL.
set -Eeo pipefail
export LC_ALL=C
umask 077

die() { printf '失败：%s\n' "$*" >&2; exit 1; }
help_text() {
  cat <<'HELP'
EluShell 内网自签名 HTTPS 证书工具
用法：bash elushell-https.sh [参数]
无参数运行进入交互模式。默认只生成证书。

  --names IP或域名列表    多个值用逗号分隔，不带协议、端口或路径
  --cert-dir 目录        证书目录，默认 /home/EluShell/certificates
  --key-dir 目录         KEY 目录，默认与证书目录相同
  --name 文件名前缀      默认独立名称；已有同名文件不会覆盖
  --days 天数            1–3650，默认 365
  --site-conf 文件       包含目标 HTTP server 块的站点配置文件
  --list-sites           只读列出上述文件中的站点编号
  --server-index 编号    从 1 开始；多个站点时必须指定
  --nginx-bin 程序       完整路径，例 /usr/local/nginx/sbin/nginx
  --nginx-conf 文件      实际运行实例的 Nginx 主配置完整路径
  --nginx-prefix 目录    可选，对应运行实例的 nginx -p 参数
  --https-port 端口      默认 443；已有 HTTPS 站点填现有端口
  --apply-nginx          备份并写入所选站点，校验后平滑重载
  --yes                 跳过应用前确认（用于已核对的自动化流程）
  -h, --help             显示本说明

依赖 Bash、awk、Linux 常用工具和 OpenSSL；无需 Python、Java 或 EluShell。
自签名证书需在客户端另行导入信任；不要分发 KEY。
HELP
}
absolute() {
  [[ $1 == /* && ! $1 =~ [[:cntrl:]] ]] || die "$2必须是服务器上的完整绝对路径"
}
number() {
  [[ $1 =~ ^[0-9]{1,5}$ ]] || die "$4必须是整数"
  local value=$((10#$1))
  (( value >= $2 && value <= $3 )) || die "$4应为 $2–$3"
  printf '%s' "$value"
}
prompt() {
  local answer
  if [[ -n ${3:-} ]]; then
    printf '%s [%s]：' "$2" "$3" >&4
  else
    printf '%s：' "$2" >&4
  fi
  IFS= read -r answer <&3 || die '输入已结束'
  printf -v "$1" '%s' "${answer:-${3:-}}"
}
open_terminal() {
  if ! { exec 3</dev/tty 4>/dev/tty; } 2>/dev/null; then
    die '无法读取交互输入，请使用命令参数；确认应用配置时可传入 --yes'
  fi
}

names='' cert_dir='/home/EluShell/certificates' key_dir='' stem='' days=365
site_conf='' server_index='' https_port=443 nginx_bin='' nginx_conf='' nginx_prefix=''
apply=0 list_sites=0 confirmed=0 interactive=0
(( $# )) || interactive=1
while (( $# )); do
  case $1 in
    -h|--help) help_text; exit 0 ;;
    --apply-nginx) apply=1; shift ;;
    --list-sites) list_sites=1; shift ;;
    --yes) confirmed=1; shift ;;
    --names|--cert-dir|--key-dir|--name|--days|--site-conf|--server-index|--https-port|--nginx-bin|--nginx-conf|--nginx-prefix)
      (( $# >= 2 )) || die "$1 缺少参数值"
      case $1 in
        --names) names=$2 ;; --cert-dir) cert_dir=$2 ;; --key-dir) key_dir=$2 ;;
        --name) stem=$2 ;; --days) days=$2 ;; --site-conf) site_conf=$2 ;;
        --server-index) server_index=$2 ;; --https-port) https_port=$2 ;;
        --nginx-bin) nginx_bin=$2 ;; --nginx-conf) nginx_conf=$2 ;;
        --nginx-prefix) nginx_prefix=$2 ;;
      esac
      shift 2 ;;
    *) die "未知参数：$1。使用 --help 查看用法" ;;
  esac
done
if (( interactive )); then
  open_terminal
  printf 'EluShell 内网 HTTPS 证书生成。自签名证书需在客户端另行导入信任。\n'
  prompt names '访问 IP / 域名（逗号分隔）'
  prompt cert_dir '证书存放目录' "$cert_dir"
  prompt key_dir 'KEY 存放目录' "$cert_dir"
  prompt days '有效期（天）' 365
  prompt choice '是否写入配置并重载 Nginx（yes/no）' no
  if [[ ${choice,,} == yes ]]; then
    apply=1
    prompt site_conf '站点配置文件完整路径'
    prompt nginx_bin 'Nginx 程序完整路径（例如 /usr/local/nginx/sbin/nginx）'
    prompt nginx_conf 'Nginx 主配置完整路径'
    prompt https_port 'HTTPS 端口' 443
    prompt nginx_prefix 'Nginx 启动前缀（未使用 -p 则直接回车）'
  fi
fi
for dependency in awk cat chmod cmp cp date diff grep ln mkdir mktemp mv readlink rm rmdir timeout wc; do
  command -v "$dependency" >/dev/null 2>&1 || die "缺少 Linux 工具：$dependency"
done
days=$(number "$days" 1 3650 '有效期')
https_port=$(number "$https_port" 1 65535 'HTTPS 端口')
[[ -n $key_dir ]] || key_dir=$cert_dir

work='' lock='' site='' backup='' keywork='' certwork='' cert='' key=''
changed=0 committed=0 key_created=0 cert_created=0
nginx_cmd=()
nginx_run() { timeout 120 "${nginx_cmd[@]}" "$@"; }
cleanup() {
  local status=$? keep=$committed
  trap - EXIT INT TERM HUP
  set +e
  if (( changed && status != 0 )); then
    if [[ ! -L $site ]] && cmp -s -- "$site" "$work/after.conf"; then
      if cp -p -- "$backup" "$lock/rollback" && mv -fT -- "$lock/rollback" "$site"; then
        printf '已恢复原 Nginx 配置。\n' >&2
        if ! { nginx_run -t && nginx_run -s reload; }; then
          keep=1
          printf '原配置重载未完成，保留证书。请核对备份：%s\n' "$backup" >&2
        fi
      else
        keep=1
        printf '恢复未完成，保留证书。请核对备份：%s\n' "$backup" >&2
      fi
    elif [[ ! -L $site ]] && cmp -s -- "$site" "$work/before.conf"; then
      :
    else
      keep=1
      printf '配置被其他操作修改，保留其改动和新证书，请核对备份：%s\n' "$backup" >&2
    fi
  fi
  if (( status != 0 && !keep )); then
    (( key_created )) && rm -f -- "$key"
    (( cert_created )) && rm -f -- "$cert"
  fi
  if [[ -n $keywork ]]; then rm -f -- "$keywork/key"; rmdir -- "$keywork"; fi
  if [[ -n $certwork ]]; then rm -f -- "$certwork/cert"; rmdir -- "$certwork"; fi
  if [[ -n $lock ]]; then
    rm -f -- "$lock/config.next" "$lock/rollback"
    rmdir -- "$lock"
  fi
  if [[ -n $work ]]; then
    rm -f -- "$work/nginx.awk" "$work/before.conf" "$work/after.conf" "$work/sites" \
      "$work/nginx.dump" "$work/request.cnf" "$work/new.key" "$work/new.crt" "$work/openssl.log"
    rmdir -- "$work"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
work=$(mktemp -d "${TMPDIR:-/tmp}/elushell-https.XXXXXXXX")

# The lexer handles comments, quoted braces, escapes and ${variables}; edits are
# restricted to direct children of the explicitly selected HTTP server block.
cat > "$work/nginx.awk" <<'NGINX_AWK'
BEGIN { RS="\0" }
function fail(message) { print "失败：" message > "/dev/stderr"; exit 2 }
function token(value, start, end, punctuation) {
  count++; tv[count]=value; ts[count]=start; te[count]=end; tp[count]=punctuation
}
function lex(    i,start,c,q,value,j) {
  i=1
  while (i<=length(text)) {
    c=substr(text,i,1)
    if (c ~ /[[:space:]]/) { i++; continue }
    if (c=="#") { while (i<=length(text) && substr(text,i,1)!="\n") i++; continue }
    start=i
    if (index("{};",c)) { token(c,i,i,1); i++; continue }
    value=""; q=""
    while (i<=length(text)) {
      c=substr(text,i,1)
      if (c=="\\") {
        if (i==length(text)) fail("Nginx 配置存在不完整转义")
        value=value substr(text,i+1,1); i+=2
      } else if (q!="") {
        i++; if (c==q) q=""; else value=value c
      } else if (c=="\"" || c=="\047") { q=c; i++ }
      else if (substr(text,i,2)=="${") {
        j=i+2; while (j<=length(text) && substr(text,j,1)!="}") j++
        if (j>length(text)) fail("Nginx 变量未闭合")
        value=value substr(text,i,j-i+1); i=j+1
      } else if (c ~ /[[:space:]]/ || index("{};#",c)) break
      else { value=value c; i++ }
    }
    if (q!="") fail("Nginx 配置引号未闭合")
    token(value,start,i-1,0)
  }
}
function block(parent,nested,    id,end) {
  while (ti<=count) {
    if (tp[ti] && tv[ti]=="}") {
      if (!nested) fail("Nginx 配置存在多余的右括号")
      ti++; return
    }
    id=++nodecount; np[id]=parent; ns[id]=ts[ti]
    while (ti<=count && !tp[ti]) { nw[id]++; word[id,nw[id]]=tv[ti]; ti++ }
    if (!nw[id] || ti>count || (tv[ti]!=";" && tv[ti]!="{")) fail("无法解析 Nginx 指令")
    end=ti++
    if (tv[end]=="{") { nb[id]=1; block(id,1); ne[id]=te[ti-1] }
    else ne[id]=te[end]
  }
  if (nested) fail("Nginx 配置块未闭合")
}
function quoted(value,    i,c,result) {
  result="\""
  for (i=1;i<=length(value);i++) {
    c=substr(value,i,1); if (index("\\\"$",c)) result=result "\\"
    result=result c
  }
  return result "\""
}
function edit(start,end,value) { ec++; es[ec]=start; ee[ec]=end; ev[ec]=value }
function listen_port(value,port) { return value==port || value ~ (":" port "$") }
{
  if (NR!=1) fail("配置文件含有 NUL 字符")
  text=$0; lex(); ti=1; block(0,0)
  for (id=1;id<=nodecount;id++)
    if (nb[id] && word[id,1]=="server" && (!np[id] || (word[np[id],1]=="http" && !np[np[id]])))
      servers[++servercount]=id
  if (!servercount) fail("所选文件没有 HTTP server 块，请指定实际站点文件")
  if (ENVIRON["ELUSHELL_AWK_MODE"]=="list") {
    for (s=1;s<=servercount;s++) {
      names=""; listens=""
      for (id=1;id<=nodecount;id++) if (np[id]==servers[s]) {
        value=""; for (w=2;w<=nw[id];w++) value=value (w>2?" ":"") word[id,w]
        if (word[id,1]=="server_name") names=names (names!=""?", ":"") value
        if (word[id,1]=="listen") listens=listens (listens!=""?", ":"") value
      }
      gsub(/[\r\n\t]/," ",names); gsub(/[\r\n\t]/," ",listens)
      printf "站点 %d：%s | 监听：%s\n",s,(names!=""?names:"(未设置 server_name)"),(listens!=""?listens:"默认")
    }
  } else {
    selected=ENVIRON["ELUSHELL_AWK_INDEX"]+0
    if (selected<1 || selected>servercount) fail("站点编号超出范围")
    target=servers[selected]; port=ENVIRON["ELUSHELL_AWK_PORT"]+0
    for (id=1;id<=nodecount;id++) if (np[id]==target) {
      directive=word[id,1]
      if (directive=="ssl_certificate" || directive=="ssl_certificate_key") {
        found[directive]++; if (found[directive]>1) fail("所选站点有多套证书，请先手动整理")
        value=ENVIRON[directive=="ssl_certificate"?"ELUSHELL_AWK_CERT":"ELUSHELL_AWK_KEY"]
        edit(ns[id],ne[id],directive " " quoted(value) ";")
      }
      if (directive=="listen") {
        listeners++; ssl=0
        for (w=2;w<=nw[id];w++) if (word[id,w]=="ssl") ssl=1
        if (listen_port(word[id,2],port)) sameport=1
        if (ssl) { tls++; if (listen_port(word[id,2],port)) sametls=1 }
      }
    }
    if (tls && !sametls) fail("站点已有 HTTPS，请将 --https-port 填为现有 HTTPS 端口")
    if (!tls && (sameport || (!listeners && port==80))) fail("指定 HTTPS 端口已用于普通 HTTP，请选择其他端口")
    if (!found["ssl_certificate"]) additions[++ac]="ssl_certificate " quoted(ENVIRON["ELUSHELL_AWK_CERT"]) ";"
    if (!found["ssl_certificate_key"]) additions[++ac]="ssl_certificate_key " quoted(ENVIRON["ELUSHELL_AWK_KEY"]) ";"
    if (!tls) {
      if (!listeners) additions[++ac]="listen 80;"
      additions[++ac]="listen " port " ssl;"
    }
    if (ac) {
      indent=substr(text,1,ne[target]-1); sub(/^.*\n/,"",indent)
      if (indent !~ /^[ \t]*$/) indent=""
      value="\n"; for (a=1;a<=ac;a++) value=value indent "    " additions[a] "\n"
      edit(ne[target],ne[target]-1,value indent)
    }
    for (a=1;a<=ec;a++) {
      biggest=0
      for (b=1;b<=ec;b++) if (!used[b] && (!biggest || es[b]>es[biggest])) biggest=b
      used[biggest]=1
      text=substr(text,1,es[biggest]-1) ev[biggest] substr(text,ee[biggest]+1)
    }
    printf "%s",text
  }
}
END { if (NR==0) fail("Nginx 配置文件为空") }
NGINX_AWK

if (( apply || list_sites )); then
  absolute "$site_conf" '站点配置文件'
  site=$(readlink -f -- "$site_conf") || die '站点配置文件不存在'
  [[ -f $site ]] || die '站点配置路径不是文件'
  if (( apply && !list_sites )); then
    candidate="${site%/*}/.${site##*/}.elushell-https.lock"
    mkdir -m 700 -- "$candidate" || die '已有证书任务正在处理此配置，或没有目录写入权限'
    lock=$candidate
  fi
  cp -p -- "$site" "$work/before.conf"
  ELUSHELL_AWK_MODE=list awk -f "$work/nginx.awk" "$work/before.conf" > "$work/sites"
  cat -- "$work/sites"
  (( list_sites )) && exit 0
  count=$(wc -l < "$work/sites")
  if [[ -z $server_index ]]; then
    if (( count == 1 )); then server_index=1
    elif (( interactive )); then prompt server_index '要修改的站点编号'
    else die '存在多个站点，请明确指定 --server-index 编号'; fi
  fi
  server_index=$(number "$server_index" 1 "$count" '站点编号')
  absolute "$nginx_bin" 'Nginx 程序'
  absolute "$nginx_conf" 'Nginx 主配置文件'
  [[ -f $nginx_bin && -x $nginx_bin ]] || die 'Nginx 程序不存在或没有执行权限，路径必须包含程序名'
  [[ -f $nginx_conf ]] || die 'Nginx 主配置文件不存在'
  nginx_cmd=("$nginx_bin" -c "$nginx_conf")
  if [[ -n $nginx_prefix ]]; then absolute "$nginx_prefix" 'Nginx 启动前缀'; nginx_cmd+=(-p "$nginx_prefix"); fi
  printf '检查现有配置及站点引用…\n'
  nginx_run -t
  nginx_run -T > "$work/nginx.dump" 2>&1 || die 'Nginx 主配置检查失败，请核对程序和配置路径'
  if ! grep -Fqx -- "# configuration file $site:" "$work/nginx.dump" &&
     ! grep -Fqx -- "# configuration file $site_conf:" "$work/nginx.dump"; then
    die '此站点文件未被指定的 Nginx 主配置加载，请检查主配置路径及 include'
  fi
fi

[[ -n $names ]] || die '需要 --names；使用 --help 查看用法'
command -v openssl >/dev/null 2>&1 || die '找不到 openssl，请先安装 OpenSSL'
absolute "$cert_dir" '证书目录'
absolute "$key_dir" 'KEY 目录'
identifier="$(date +%Y%m%d-%H%M%S)-$$-$RANDOM"
[[ -n $stem ]] || stem="elushell-$identifier"
[[ $stem =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$ ]] || die '文件名前缀仅支持字母、数字、点、下划线、横线，以字母或数字开头，最长 100 字符'
cert="${cert_dir%/}/$stem.crt" key="${key_dir%/}/$stem.key"
for target in "$cert" "$key"; do
  [[ ! -e $target && ! -L $target ]] || die "文件已存在，不会覆盖：$target"
done

normalized=${names//，/ }; normalized=${normalized//,/ }; normalized=${normalized//$'\n'/ }
normalized=${normalized//$'\r'/ }; normalized=${normalized//$'\t'/ }
read -r -a supplied_names <<< "$normalized"
valid_names=() name_types=()
ipv4() {
  local input=$1 octet
  local -a octets
  [[ $input =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  IFS=. read -r -a octets <<< "$input"
  for octet in "${octets[@]}"; do
    [[ $octet =~ ^(0|[1-9][0-9]{0,2})$ ]] && (( 10#$octet <= 255 )) || return 1
  done
}
for item in "${supplied_names[@]}"; do
  item=${item,,}; duplicate=0
  for seen in "${valid_names[@]}"; do [[ $seen != "$item" ]] || duplicate=1; done
  (( !duplicate )) || continue
  kind=DNS
  if ipv4 "$item"; then kind=IP
  elif [[ $item == *:* ]]; then
    # OpenSSL validates IPv6 structure when reading subjectAltName below.
    [[ $item =~ ^[0-9a-f:.]+$ && ${#item} -le 45 ]] || die "无效 IP 或域名：$item"
    kind=IP
  else
    host=$item; [[ $host != \*.* ]] || host=${host:2}
    [[ ${#item} -le 253 && ! $host =~ ^[0-9.]+$ && $host != *. && $host != .* && $host != *..* ]] || die "无效 IP 或域名：$item"
    IFS=. read -r -a labels <<< "$host"
    (( ${#labels[@]} )) || die "无效 IP 或域名：$item"
    for label in "${labels[@]}"; do
      [[ $label =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || die "无效 IP 或域名：$item，不要填写协议、端口或路径"
    done
  fi
  valid_names+=("$item"); name_types+=("$kind")
done
(( ${#valid_names[@]} >= 1 && ${#valid_names[@]} <= 30 )) || die '请提供 1–30 个 IP 或域名，以逗号分隔'
{
  printf '[req]\nprompt = no\ndistinguished_name = dn\nx509_extensions = server_cert\n[dn]\nCN = %s\n' "${valid_names[0]:0:64}"
  printf '[server_cert]\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = @names\n[names]\n'
  for i in "${!valid_names[@]}"; do printf '%s.%d = %s\n' "${name_types[i]}" "$((i+1))" "${valid_names[i]}"; done
} > "$work/request.cnf"
printf '适用地址：%s\n证书：%s\nKEY：%s\n' "${valid_names[*]}" "$cert" "$key"
if (( apply )); then
  ELUSHELL_AWK_MODE=edit ELUSHELL_AWK_INDEX=$server_index ELUSHELL_AWK_PORT=$https_port \
    ELUSHELL_AWK_CERT=$cert ELUSHELL_AWK_KEY=$key \
    awk -f "$work/nginx.awk" "$work/before.conf" > "$work/after.conf"
  printf '配置变更预览：\n'
  result=0
  diff -u -- "$work/before.conf" "$work/after.conf" || result=$?
  (( result <= 1 )) || die '无法生成配置差异'
  if (( !confirmed )); then
    (( interactive )) || open_terminal
    prompt choice '确认生成并应用到当前服务器？请输入 yes' no
    if [[ ${choice,,} != yes ]]; then printf '已取消，未生成证书或修改配置。\n'; exit 0; fi
  fi
fi

printf '生成 RSA 2048 / SHA-256 自签名证书…\n'
if ! timeout 120 openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days "$days" \
  -config "$work/request.cnf" -keyout "$work/new.key" -out "$work/new.crt" > "$work/openssl.log" 2>&1; then
  cat -- "$work/openssl.log" >&2
  die '证书生成失败，请检查地址格式和 OpenSSL 环境'
fi
chmod 600 -- "$work/new.key"
chmod 644 -- "$work/new.crt"
mkdir -p -m 700 -- "$cert_dir" "$key_dir"
keywork=$(mktemp -d "${key_dir%/}/.elushell-key.XXXXXXXX")
certwork=$(mktemp -d "${cert_dir%/}/.elushell-cert.XXXXXXXX")
cp -p -- "$work/new.key" "$keywork/key"
cp -p -- "$work/new.crt" "$certwork/cert"
ln -T -- "$keywork/key" "$key"
key_created=1
ln -T -- "$certwork/cert" "$cert"
cert_created=1

if (( apply )); then
  [[ ! -L $site ]] && cmp -s -- "$site" "$work/before.conf" || die '生成期间配置发生变化，拒绝覆盖，请重新运行'
  backup="${site%/*}/.${site##*/}.elushell-$identifier.bak"
  # Publish the backup without clobbering an existing file, preserving ownership/mode.
  cp -p -- "$site" "$lock/config.next"
  ln -T -- "$lock/config.next" "$backup"
  rm -f -- "$lock/config.next"
  cp -p -- "$site" "$lock/config.next"
  cat -- "$work/after.conf" > "$lock/config.next"
  [[ ! -L $site ]] && cmp -s -- "$site" "$work/before.conf" || die '应用前配置发生变化，拒绝覆盖，请重新运行'
  changed=1
  mv -fT -- "$lock/config.next" "$site"
  printf '检查修改后的配置…\n'
  nginx_run -t
  printf '平滑重载 Nginx…\n'
  nginx_run -s reload
  committed=1
  changed=0
  printf 'Nginx 配置检查及重载命令成功。备份：%s\n' "$backup"
fi
timeout 120 openssl x509 -in "$cert" -noout -subject -dates
printf '已完成。证书：%s\nKEY（权限 600）：%s\n' "$cert" "$key"
printf '自签名证书需在客户端导入信任；请勿分发私钥。\n'

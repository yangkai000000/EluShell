import { quote } from '../src/shared';
import type { NginxUpgradeSource } from '../src/nginx-upgrade-shared';

export type NginxSnapshot = {
  binary: string;
  config: string;
  prefix: string;
  pidPath: string;
  pid: number;
  start: string;
  commandHash: string;
  binaryHash: string;
  configHash: string;
  files: string[];
  unit?: string;
  unitHash?: string;
};
export const shellPreamble = `set -eu
export LC_ALL=C
umask 077
die() { echo "$*" >&2; exit 1; }
hash() { sha256sum "$1" | cut -d ' ' -f 1; }
start() { sed 's/.*) //' "/proc/$1/stat" | awk '{print $20}'; }
field() { printf '%s\\t' "$1"; printf '%s' "$2" | base64 -w 0; printf '\\n'; }
`;
export function inspectScript(o: NginxUpgradeSource) {
  return `${shellPreamble}
for tool in bash readlink sha256sum base64 awk sed curl timeout getconf ps seq cp mv; do command -v "$tool" >/dev/null || die "服务器缺少 $tool"; done
test "$(uname -s)" = Linux || die '仅支持 Linux 服务器'
binary=$(readlink -f -- ${quote(o.binary)})
config=$(readlink -f -- ${quote(o.config)})
prefix=$(readlink -f -- ${quote(o.prefix)})
test -x "$binary" && test -f "$config" && test -d "$prefix" || die '程序、主配置或运行目录不存在'
field binary "$binary"
field config "$config"
field prefix "$prefix"
field arch "$(uname -m)"
field glibc "$(getconf GNU_LIBC_VERSION)"
field system "$(cat /etc/os-release 2>/dev/null || :)"
field version "$("$binary" -V 2>&1)"
field binaryHash "$(hash "$binary")"
"$binary" -t -p "$prefix/" -c "$config" >&2
dump=$("$binary" -T -p "$prefix/" -c "$config" 2>/dev/null)
test "\${#dump}" -lt 2097152 || die '配置过大，请人工升级'
field dump "$dump"
field writable "$(test -w "$(dirname "$binary")" && echo yes || echo no)"
`;
}
export function processScript(
  s: Omit<NginxSnapshot, 'pid' | 'start' | 'commandHash' | 'binaryHash' | 'configHash' | 'files'>,
  healthUrl: string,
) {
  return `${shellPreamble}
pidfile=${quote(s.pidPath)}
test -f "$pidfile" && test ! -e "$pidfile.oldbin" || die 'PID 文件不存在或上一次平滑升级尚未结束'
pid=$(cat "$pidfile")
case "$pid" in ''|*[!0-9]*) die '无效的 master PID';; esac
test "$pid" -gt 1 || die '无效的 master PID'
test "$(readlink -f "/proc/$pid/exe")" = ${quote(s.binary)} || die '运行实例与指定程序不一致，或无权读取进程，请核对路径和 sudo'
kill -0 "$pid" || die '当前用户不能管理此实例'
field pid "$pid"
field start "$(start "$pid")"
field command "$(tr '\\000' ' ' < "/proc/$pid/cmdline")"
field commandHash "$(hash "/proc/$pid/cmdline")"
field cwd "$(readlink -f "/proc/$pid/cwd")"
field cgroup "$(cat "/proc/$pid/cgroup")"
count=0
for p in /proc/[0-9]*/exe; do
  if test "$(readlink -f "$p" 2>/dev/null || :)" = ${quote(s.binary)}; then
    title=$(tr '\\000' ' ' < "\${p%/exe}/cmdline" 2>/dev/null || :)
    case "$title" in 'nginx: master process '*) count=$((count + 1));; esac
  fi
done
field masters "$count"
code=$(curl --noproxy '*' -s -o /dev/null --max-time 8 -w '%{http_code}' -- ${quote(healthUrl)}) || die '本机健康检查无法访问，请核对地址、端口及证书信任'
field health "$code"
`;
}

export function serviceInspectionScript(unit: string, pid: number) {
  return `${shellPreamble}
command -v systemctl >/dev/null || die '找不到服务管理工具'
test "$(systemctl show -p MainPID --value ${quote(unit)})" = ${pid} || die '系统服务与当前 master 不一致'
test "$(systemctl show -p ActiveState --value ${quote(unit)})" = active || die '系统服务未正常运行'
field unitConfig "$(systemctl cat ${quote(unit)})"
`;
}

export function prepareScript(dir: string, upload: string, sha: string, s: NginxSnapshot) {
  return `${shellPreamble}
mkdir -m 700 -- ${quote(dir)}
cp -- ${quote(upload)} ${quote(dir + '/candidate')}
test "$(hash ${quote(dir + '/candidate')})" = ${quote(sha)} || die '升级包校验失败'
chmod 700 -- ${quote(dir + '/candidate')}
if command -v getenforce >/dev/null && test "$(getenforce)" = Enforcing; then chcon --reference=${quote(s.binary)} -- ${quote(dir + '/candidate')}; fi
${quote(dir + '/candidate')} -V 2>&1 | grep -q -- '--with-http_ssl_module' || die '升级包缺少 SSL 模块'
${quote(dir + '/candidate')} -t -p ${quote(s.prefix + '/')} -c ${quote(s.config)}
`;
}

export function upgradeScript(s: NginxSnapshot, dir: string, sha: string, healthUrl: string) {
  // No arbitrary commands are accepted. Old and new PIDs are verified before every signal.
  return `${shellPreamble}
binary=${quote(s.binary)}
config=${quote(s.config)}
prefix=${quote(s.prefix)}
pidfile=${quote(s.pidPath)}
work=${quote(dir)}
lock="$binary.elushell-upgrade.lock"
unit=${quote(s.unit || '')}
old=${s.pid}
new=''
newstart=''
replaced=0
switched=0
committed=0
recovered=1
stage() { echo "ELUSHELL_STAGE:$1:$2"; }
sameold() { test "$(start "$old" 2>/dev/null)" = ${quote(s.start)} && test "$(hash "/proc/$old/cmdline" 2>/dev/null)" = ${quote(s.commandHash)}; }
samenew() { test -n "$new" && test "$(start "$new" 2>/dev/null)" = "$newstart" && test "$(hash "/proc/$new/exe" 2>/dev/null)" = ${quote(sha)}; }
healthy() { code=$(curl --noproxy '*' -s -o /dev/null --max-time 8 -w '%{http_code}' -- ${quote(healthUrl)}) && case "$code" in 2??|3??) return 0;; *) return 1;; esac; }
capture_new() {
  if test -n "$unit"; then
    candidate=$(systemctl show -p MainPID --value "$unit")
  else
  candidate=$(cat "$pidfile" 2>/dev/null || :)
  fi
  case "$candidate" in ''|*[!0-9]*) return 1;; esac
  test "$candidate" -gt 1 && test "$candidate" != "$old" || return 1
  parent=$(sed 's/.*) //' "/proc/$candidate/stat" 2>/dev/null | awk '{print $2}')
  if test -z "$unit"; then test "$parent" = "$old" || return 1; fi
  test "$(hash "/proc/$candidate/exe" 2>/dev/null)" = ${quote(sha)} || return 1
  new="$candidate"
  newstart=$(start "$new")
}
cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  set +e
  if test "$result" != 0 && test "$committed" = 0 && test "$replaced" = 1; then
    recovered=0
    stage 85 '切换未完成，正在恢复旧程序'
    # A late-starting new master must also be retired during rollback.
    if test -z "$new"; then capture_new; fi
    if test "$(hash "$binary")" = ${quote(sha)} && { test -n "$unit" || sameold; }; then
      cp --preserve=all -- "$work/original" "$work/restore" && mv -fT -- "$work/restore" "$binary"
      if test -n "$unit"; then
        timeout 45 systemctl restart "$unit"
        restored=$(systemctl show -p MainPID --value "$unit")
        if test "$restored" -gt 1 && test "$(hash "/proc/$restored/exe")" = ${quote(s.binaryHash)} && healthy; then recovered=1; echo 'ELUSHELL_ROLLBACK_OK'; else echo 'ELUSHELL_RECOVERY_REQUIRED'; fi
      elif test "$switched" = 1; then
        sameold && kill -HUP "$old"
        sleep 2
        if samenew; then kill -QUIT "$new"; fi
      fi
      if test -z "$unit"; then
        sleep 2
        if sameold && test "$(hash "$binary")" = ${quote(s.binaryHash)} && healthy; then recovered=1; echo 'ELUSHELL_ROLLBACK_OK'; else echo 'ELUSHELL_RECOVERY_REQUIRED'; fi
      fi
    else
      echo 'ELUSHELL_RECOVERY_REQUIRED：进程或文件已被外部操作改变，未覆盖'
    fi
  fi
  if test "$replaced" = 0; then echo 'ELUSHELL_NO_CHANGE'; fi
  printf '%s\\n' "$result" > "$work/exit-code"
  if test "$recovered" = 1; then rmdir -- "$lock" 2>/dev/null || :; else echo "保留升级锁：$lock"; fi
  exit "$result"
}
stage 5 '重新检查实例与配置'
mkdir -m 700 -- "$lock" || { echo 'ELUSHELL_NO_CHANGE'; die '此程序有升级任务进行中，或存在待处理的升级锁'; }
trap cleanup EXIT
trap 'exit 143' HUP INT TERM
sameold || die '运行实例已改变，请重新检测'
if test -n "$unit"; then
  test "$(systemctl show -p MainPID --value "$unit")" = "$old" || die '服务 master 已变化'
  unit_config=$(systemctl cat "$unit")
  test "$(printf '%s' "$unit_config" | sha256sum | cut -d ' ' -f 1)" = ${quote(s.unitHash || '')} || die '系统服务配置已变化'
fi
count=0
for proc in /proc/[0-9]*/exe; do
  if test "$(readlink -f "$proc" 2>/dev/null || :)" = "$binary"; then
    title=$(tr '\\000' ' ' < "\${proc%/exe}/cmdline" 2>/dev/null || :)
    case "$title" in 'nginx: master process '*) count=$((count + 1));; esac
  fi
done
test "$count" = 1 || die '当前已有多个实例共用程序，请重新检测'
test "$(cat "$pidfile")" = "$old" && test ! -e "$pidfile.oldbin" || die 'PID 状态已变化'
test "$(hash "$binary")" = ${quote(s.binaryHash)} || die '现有程序已变化'
test "$(hash "$work/candidate")" = ${quote(sha)} || die '升级包已变化'
dump=$("$binary" -T -p "$prefix/" -c "$config" 2>/dev/null)
test "$(printf '%s' "$dump" | sha256sum | cut -d ' ' -f 1)" = ${quote(s.configHash)} || die '配置已改变，请重新检测'
healthy || die '升级前健康检查失败'
"$work/candidate" -t -p "$prefix/" -c "$config"
stage 20 '备份程序和已加载的配置'
test ! -e "$work/original" || die '此升级计划已使用'
cp --preserve=all -- "$binary" "$work/original"
mkdir -m 700 -- "$work/configuration"
${s.files.map((f) => `cp --parents -p -- ${quote(f)} "$work/configuration/"`).join('\n')}
printf '%s\\n' ${quote(`原程序：${s.binary}\n主配置：${s.config}\n运行目录：${s.prefix}\n原 master PID：${s.pid}\n自动回退未完成时：先核实 master/worker 状态，再从 original 恢复程序。不要在不确认进程的情况下直接杀进程或重复启动。`)} > "$work/README.txt"
cp --preserve=all -- "$binary" "$work/next"
cat "$work/candidate" > "$work/next"
test "$(hash "$work/next")" = ${quote(sha)} || die '程序写入校验失败'
sameold || die '进程已变化'
stage 40 '切换新版程序，启动新 master'
mv -fT -- "$work/next" "$binary"
replaced=1
switched=1
if test -n "$unit"; then
  stage 45 '按系统服务方式重启，可能短暂中断'
  timeout 45 systemctl restart "$unit"
else
  sameold && kill -USR2 "$old"
fi
for i in $(seq 1 20); do capture_new && break; sleep 1; done
samenew || die '新版 master 未正常启动'
stage 60 '新进程已启动'
if test -z "$unit"; then sameold && kill -WINCH "$old"; fi
sleep 2
stage 75 '检查新版服务响应'
for i in 1 2 3; do
  samenew && healthy || die '新版服务健康检查失败'
  workers=$(ps -o args= --ppid "$new" | grep -c '^nginx: worker process' || :)
  test "$workers" -gt 0 || die '新版 worker 未正常运行'
  sleep 1
done
samenew || die '切换时进程状态变化'
stage 95 '确认新版运行'
if test -z "$unit"; then sameold && kill -QUIT "$old"; fi
committed=1
stage 100 '升级完成，SSL 模块已启用'
if test -z "$unit"; then echo '原有连接可能仍在旧 worker 中收尾。'; fi
echo '配置和证书均未改变。'
echo "备份目录：$work"
`;
}

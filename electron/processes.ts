import { processLocation, decodeArgv } from './process-location';
import type { RemoteProcess } from '../src/shared';
export const processCommand = `LC_ALL=C; export LC_ALL; ps -eo pid=,user=,pcpu=,rss=,stat=,args= --cols 8192 | while read -r pid user cpu rss state args; do
  [ -n "$pid" ] || continue
  stat=$(cat /proc/$pid/stat 2>/dev/null) || continue
  rest=\${stat##*) }; start=$(printf '%s' "$rest" | awk '{print $20}')
  name=$(cat /proc/$pid/comm 2>/dev/null)
  exe=$(readlink /proc/$pid/exe 2>/dev/null)
  cwd=$(readlink /proc/$pid/cwd 2>/dev/null)
  argv=$(od -An -v -tx1 /proc/$pid/cmdline 2>/dev/null | tr -d ' \n')
  printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$pid" "$user" "$cpu" "$rss" "$state" "$name" "$start" "$exe" "$cwd" "$argv" "$args"
done`;
export function parseProcesses(text: string): RemoteProcess[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const [pid, user, cpu, rss, state, name, start, executable, cwd, argvHex, ...args] =
      line.split('\t');
    if (
      !/^\d+$/.test(pid) ||
      !/^\d+$/.test(start || '') ||
      !Number.isFinite(Number(cpu)) ||
      !Number.isFinite(Number(rss))
    )
      return [];
    return [
      {
        pid: Number(pid),
        user,
        cpu: Number(cpu),
        memory: Number(rss) * 1024,
        state,
        name,
        start,
        executable,
        cwd,
        ...processLocation(executable, cwd, decodeArgv(argvHex)),
        command: args.join('\t'),
      },
    ];
  });
}
export function identityCommand(pid: number) {
  if (!Number.isInteger(pid) || pid < 2 || pid > 2147483647) throw Error('无效 PID');
  return `s=$(cat /proc/${pid}/stat 2>/dev/null) || exit 1; r=\${s##*) }; printf '%s\\t' "$(printf '%s' "$r" | awk '{print $20}')"; cat /proc/${pid}/comm 2>/dev/null`;
}
export function terminateCommand(pid: number, start: string) {
  identityCommand(pid);
  if (!/^\d+$/.test(start)) throw Error('进程标识无效');
  return `s=$(cat /proc/${pid}/stat 2>/dev/null) || { printf '进程已退出'; exit 1; }; r=\${s##*) }; t=$(printf '%s' "$r" | awk '{print $20}'); [ "$t" = '${start}' ] || { printf '进程标识已改变'; exit 1; }; if kill -TERM ${pid} 2>&1; then printf '\\nELUSHELL_TERMINATED'; fi`;
}

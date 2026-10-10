import type { Metrics, Cpu } from '../src/shared';
// Fixed, read-only collection command. No user input is interpolated.
export const collectCommand = `export LC_ALL=C
printf '\\n@@HOST\\n'; hostname; uname -sr
printf '\\n@@UP\\n'; cat /proc/uptime; cat /proc/loadavg
printf '\\n@@CPU\\n'; cat /proc/stat
printf '\\n@@MEM\\n'; cat /proc/meminfo
printf '\\n@@DISK\\n'; df -Pk
printf '\\n@@NET\\n'; cat /proc/net/dev
printf '\\n@@PS\\n'; ps -eo pid,user,pcpu,rss,args --sort=-pcpu | head -31
printf '\\n@@ROUTE\\n'; ip route show 2>/dev/null || cat /proc/net/route
printf '\\n@@SOCKET\\n'; ss -tun 2>/dev/null | head -61
printf '\\n@@IO\\n'; cat /proc/diskstats
`;
export function parseMetrics(text: string, previous?: Metrics, at = Date.now()): Metrics {
  const sections: Record<string, string> = {};
  for (const part of text.split(/\n@@/).slice(1)) {
    const i = part.indexOf('\n');
    sections[part.slice(0, i)] = part.slice(i + 1).trim();
  }
  if (!sections.CPU || !sections.MEM) throw Error('服务器未提供 Linux /proc 指标');
  const rawCpu: Cpu[] = sections.CPU.split('\n')
    .filter((x) => /^cpu(?:\d+)?\s/.test(x))
    .map((line) => {
      const [name, ...values] = line.trim().split(/\s+/);
      const n = values.map(Number);
      return { name, idle: n[3] + (n[4] || 0), total: n.slice(0, 8).reduce((a, b) => a + b, 0) };
    });
  const percent = (c: Cpu) => {
    const old = previous?.rawCpu.find((p) => p.name === c.name);
    if (!old) return 0;
    const total = c.total - old.total;
    return total > 0 ? Math.max(0, Math.min(100, 100 * (1 - (c.idle - old.idle) / total))) : 0;
  };
  const mem: Record<string, number> = {};
  sections.MEM.split('\n').forEach((x) => {
    const [k, v] = x.split(/:\s*/);
    mem[k] = parseFloat(v) * 1024 || 0;
  });
  const network = (sections.NET || '')
    .split('\n')
    .filter((x) => x.includes(':'))
    .map((line) => {
      const [name, nums] = line.split(':');
      const n = nums.trim().split(/\s+/).map(Number);
      const old = previous?.network.find((x) => x.name === name.trim());
      const seconds = previous ? Math.max(0.001, (at - previous.at) / 1000) : 1;
      return {
        name: name.trim(),
        rx: n[0],
        tx: n[8],
        rxRate: old ? Math.max(0, (n[0] - old.rx) / seconds) : 0,
        txRate: old ? Math.max(0, (n[8] - old.tx) / seconds) : 0,
      };
    });
  return {
    at,
    hostname: sections.HOST?.split('\n')[0] || '',
    os: sections.HOST?.split('\n')[1] || '',
    uptime: parseFloat(sections.UP) || 0,
    load: (sections.UP?.split('\n')[1] || '0 0 0').split(' ').slice(0, 3).map(Number),
    cpu: rawCpu[0] ? percent(rawCpu[0]) : 0,
    cores: rawCpu.slice(1).map(percent),
    rawCpu,
    memory: {
      total: mem.MemTotal,
      available: mem.MemAvailable ?? mem.MemFree,
      cached: mem.Cached || 0,
      swapTotal: mem.SwapTotal || 0,
      swapFree: mem.SwapFree || 0,
    },
    disks: (sections.DISK || '')
      .split('\n')
      .slice(1)
      .flatMap((line) => {
        const n = line.trim().split(/\s+/);
        return n.length >= 6
          ? [
              {
                path: n.slice(5).join(' '),
                total: Number(n[1]) * 1024,
                used: Number(n[2]) * 1024,
                percent: parseFloat(n[4]),
              },
            ]
          : [];
      }),
    network,
    processes: (sections.PS || '')
      .split('\n')
      .slice(1)
      .flatMap((line) => {
        const m = line.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
        return m
          ? [{ pid: +m[1], user: m[2], cpu: +m[3], memory: +m[4] * 1024, command: m[5] }]
          : [];
      }),
    routes: sections.ROUTE || '暂无路由数据',
    sockets: sections.SOCKET || 'ss 不可用',
    diskIO: sections.IO || '',
  };
}

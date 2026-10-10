import { describe, it, expect } from 'vitest';
import { parseMetrics } from '../electron/metrics';
import {
  ProfileSchema,
  quote,
  remember,
  recommendations,
  suggestions,
  primaryInterface,
} from '../src/shared';
import { demoProfile } from './profile';
const sample = (cpu = 'cpu 100 0 20 880 0 0 0 0', rx = 1000) =>
  `\n@@HOST\nserver\nLinux 6.8\n@@UP\n1234.1 2000\n0.1 0.2 0.3 1/100 42\n@@CPU\n${cpu}\ncpu0 100 0 20 880 0 0 0 0\n@@MEM\nMemTotal: 1000 kB\nMemAvailable: 400 kB\nCached: 200 kB\nSwapTotal: 100 kB\nSwapFree: 80 kB\n@@DISK\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000 600 400 60% /\n@@NET\neth0: ${rx} 0 0 0 0 0 0 0 500 0 0 0 0 0 0 0\n@@PS\nPID USER %CPU RSS COMMAND\n42 deploy 12.5 128 java -jar app.jar\n@@ROUTE\ndefault via 10.0.0.1\n@@SOCKET\nESTAB\n@@IO\n8 0 sda 10 0 100 2 20 0 200 4 0 6 0`;
describe('Linux metrics', () => {
  it('uses the default-route interface instead of double-counting Docker bridges', () => {
    const m = parseMetrics(sample());
    m.network.unshift({ ...m.network[0], name: 'veth123' });
    m.routes = 'default via 10.0.0.1 dev eth0';
    expect(primaryInterface(m)?.name).toBe('eth0');
    m.routes = '';
    expect(primaryInterface(m)?.name).toBe('eth0');
  });
  it('parses memory, filesystem, process commands and uptime', () => {
    const m = parseMetrics(sample());
    expect(m.memory.available).toBe(409600);
    expect(m.disks[0].percent).toBe(60);
    expect(m.processes[0].command).toBe('java -jar app.jar');
    expect(m.uptime).toBe(1234.1);
    expect(m.cpu).toBe(0);
  });
  it('calculates CPU and network deltas using elapsed time', () => {
    const a = parseMetrics(sample(), undefined, 1000);
    const b = parseMetrics(sample('cpu 150 0 20 930 0 0 0 0', 3000), a, 3000);
    expect(b.cpu).toBe(50);
    expect(b.network[0].rxRate).toBe(1000);
  });
  it('does not report negative rates after counter reset', () => {
    const a = parseMetrics(sample(), undefined, 1000);
    const b = parseMetrics(sample('cpu 0 0 0 10 0 0 0 0', 1), a, 3000);
    expect(b.cpu).toBe(0);
    expect(b.network[0].rxRate).toBe(0);
  });
  it('rejects unsupported or missing metrics', () =>
    expect(() => parseMetrics('permission denied')).toThrow());
});
describe('command assistance', () => {
  it('shell-quotes embedded quotes and substitutions', () =>
    expect(quote("a'b;$(id)")).toBe("'a'\\''b;$(id)'"));
  it('deduplicates and bounds per-server history', () => {
    expect(remember(['ls', 'pwd'], 'pwd')).toEqual(['pwd', 'ls']);
    expect(
      remember(
        Array.from({ length: 110 }, (_, i) => `${i}`),
        'new',
      ),
    ).toHaveLength(100);
  });
  it('shares custom commands across servers and prioritizes recommendation tags', () => {
    const result = recommendations(demoProfile, [
      { id: 'x', name: 'secret-server', command: 'hidden', tags: [], serverId: 'other' },
    ]);
    expect(result.some((x) => x.id === 'x')).toBe(true);
    expect(result.findIndex((x) => x.id === 'docker')).toBeLessThan(
      result.findIndex((x) => x.id === 'nginx'),
    );
  });
  it('completes case-insensitively without duplicates', () =>
    expect(suggestions('DO', ['docker ps', 'docker ps'], [])).toEqual(['docker ps']));
  it('rejects invalid ports and shell characters in hostname', () => {
    expect(ProfileSchema.safeParse({ ...demoProfile, port: 0 }).success).toBe(false);
    expect(ProfileSchema.safeParse({ ...demoProfile, host: 'host;rm' }).success).toBe(false);
  });
});

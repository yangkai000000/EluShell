import { it, expect } from 'vitest';
import { remotePath, ancestors } from '../src/paths';
import { TunnelSchema } from '../src/shared';
it('normalizes relative paths and preserves spaces and unicode', () => {
  expect(remotePath('../日志 目录', '/home/deploy')).toBe('/home/日志 目录');
  expect(remotePath('../../..', '/')).toBe('/');
  expect(remotePath('/tmp//./logs')).toBe('/tmp/logs');
});
it('expands all ancestors for terminal-selected directory', () =>
  expect(ancestors('/opt/services/logs')).toEqual([
    '/',
    '/opt',
    '/opt/services',
    '/opt/services/logs',
  ]));
it('validates tunnel ports and target addresses', () => {
  const r = {
    id: 't',
    type: 'local',
    bindHost: '127.0.0.1',
    bindPort: 13306,
    targetHost: 'localhost',
    targetPort: 3306,
    enabled: true,
  };
  expect(TunnelSchema.safeParse(r).success).toBe(true);
  expect(TunnelSchema.safeParse({ ...r, bindPort: 0 }).success).toBe(false);
  expect(TunnelSchema.safeParse({ ...r, targetHost: 'host;cmd' }).success).toBe(false);
});

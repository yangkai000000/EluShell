import { it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NginxUpgradeService } from '../electron/nginx-upgrade';

const source = {
  binary: '/usr/local/nginx/sbin/nginx',
  config: '/usr/local/nginx/conf/nginx.conf',
  prefix: '/usr/local/nginx',
  pidPath: '',
  sudo: false,
  healthUrl: 'http://127.0.0.1:8800/',
};
const encoded = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([key, value]) => `${key}\t${Buffer.from(value).toString('base64')}\n`)
    .join('');
it('selects Kylin x86_64 and ARM64 bundles, binds plans to sessions, and distinguishes rollback from lost outcomes', async () => {
  const root = await mkdtemp(path.resolve('test-results/nginx-service-'));
  const bytes = Buffer.from('test-only package'),
    sha256 = createHash('sha256').update(bytes).digest('hex');
  const bundles = ['x86_64', 'aarch64'].map((arch) => ({
    arch,
    version: '1.30.5',
    minGlibc: '2.28',
    bytes: bytes.length,
    sha256,
    prefix: '/usr/local/nginx',
    config: 'conf/nginx.conf',
    pid: 'logs/nginx.pid',
  }));
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(bundles));
  for (const b of bundles) {
    await mkdir(path.join(root, b.arch));
    await writeFile(path.join(root, b.arch, 'nginx'), bytes);
  }
  let arch = 'x86_64',
    mode = 'success',
    executions = 0;
  let unitConfig = '';
  const client = {
    exec(command: string, cb: Function) {
      const stream = new EventEmitter() as any;
      stream.stderr = new EventEmitter();
      stream.close = () => {};
      cb(null, stream);
      queueMicrotask(() => {
        let output = '',
          status = 0;
        if (command.includes('field arch'))
          output = encoded({
            binary: source.binary,
            config: source.config,
            prefix: source.prefix,
            arch,
            glibc: 'glibc 2.28',
            version: 'nginx version: nginx/1.19.9\nconfigure arguments:',
            system: 'PRETTY_NAME="Kylin Linux Advanced Server V10"',
            writable: 'yes',
            binaryHash: 'a'.repeat(64),
            dump: '# configuration file /usr/local/nginx/conf/nginx.conf:\nevents {}\nhttp { server { listen 8800; } }',
          });
        else if (command.includes('field cgroup'))
          output = encoded({
            pid: '400',
            start: '12345',
            command: 'nginx: master process ./nginx',
            cwd: '/usr/local/nginx/sbin',
            commandHash: 'b'.repeat(64),
            cgroup: unitConfig
              ? '0::/system.slice/nginx.service'
              : '0::/user.slice/session-1.scope',
            masters: '1',
            health: '200',
          });
        else if (command.includes('field unitConfig')) output = encoded({ unitConfig });
        else if (command.includes('mktemp -d')) output = '/tmp/elushell-nginx.TEST1234\n';
        else if (command.includes('stage 5')) {
          executions++;
          if (mode === 'rollback') {
            status = 1;
            output = 'ELUSHELL_STAGE:85:正在回退\nELUSHELL_ROLLBACK_OK\n';
          } else if (mode === 'lost') {
            status = -1;
            output = 'ELUSHELL_STAGE:40:正在切换\n';
          } else output = 'ELUSHELL_STAGE:100:升级完成\n';
        }
        const b = Buffer.from(output);
        stream.emit('data', b.subarray(0, 4));
        stream.emit('data', b.subarray(4));
        stream.emit('close', status);
      });
    },
  };
  const ftp = {
    open(_file: string, _flags: string, _mode: number, cb: Function) {
      queueMicrotask(() => cb(null, Buffer.from('test')));
    },
    write(
      _handle: Buffer,
      _bytes: Buffer,
      _offset: number,
      _length: number,
      _position: number,
      cb: Function,
    ) {
      queueMicrotask(() => cb(null));
    },
    close(_handle: Buffer, cb: Function) {
      queueMicrotask(() => cb(null));
    },
  };
  const service = new NginxUpgradeService(
    () => client as any,
    async () => ftp as any,
    () => {},
    root,
  );
  const first = await service.inspect('s1', source);
  expect(first.ready).toBe(true);
  expect(first.system).toContain('Kylin');
  await expect(service.start('s2', first.id)).rejects.toThrow('过期');
  for (const state of ['success', 'rollback', 'lost']) {
    mode = state;
    arch = 'aarch64';
    const plan = await service.inspect('s1', source);
    expect(plan.ready).toBe(true);
    expect(plan.checks.find((c) => c.name === '服务器架构')?.detail).toContain('aarch64');
    await service.start('s1', plan.id);
    await expect.poll(() => service.isRunning()).toBe(false);
    expect(service.list('s1')[0].state).toBe(
      state === 'success' ? 'completed' : state === 'rollback' ? 'failed' : 'unknown',
    );
    await expect(service.start('s1', plan.id)).rejects.toThrow('过期');
  }
  arch = 'loongarch64';
  expect((await service.inspect('s1', source)).ready).toBe(false);
  expect(executions).toBe(3);
  arch = 'x86_64';
  unitConfig = '[Service]\nType=forking\nExecStart=/usr/local/nginx/sbin/nginx';
  const managed = await service.inspect('s1', source);
  expect(managed.ready).toBe(true);
  expect(managed.strategy).toContain('重启系统服务 nginx.service（会短暂中断）');
  unitConfig += '\nExecStartPost=/opt/site-hook.sh';
  const hooks = await service.inspect('s1', source);
  expect(hooks.ready).toBe(false);
  expect(hooks.checks.find((c) => c.name === '进程管理方式')?.ok).toBe(false);
});

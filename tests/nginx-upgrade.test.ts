import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { validateStartup } from '../electron/nginx-upgrade';
import {
  inspectScript,
  processScript,
  prepareScript,
  upgradeScript,
  type NginxSnapshot,
} from '../electron/nginx-upgrade-scripts';
import { NginxUpgradeSourceSchema, type NginxBundle } from '../src/nginx-upgrade-shared';

const source = {
  binary: '/usr/local/nginx/sbin/nginx',
  config: '/usr/local/nginx/conf/nginx.conf',
  prefix: '/usr/local/nginx',
  pidPath: '',
  sudo: false,
  healthUrl: 'http://127.0.0.1:8800/',
};
const bundle: NginxBundle = {
  arch: 'x86_64',
  version: '1.30.5',
  minGlibc: '2.28',
  sha256: 'a'.repeat(64),
  bytes: 10,
  prefix: '/usr/local/nginx',
  config: 'conf/nginx.conf',
  pid: 'logs/nginx.pid',
};
const snapshot: NginxSnapshot = {
  ...source,
  pidPath: '/usr/local/nginx/logs/nginx.pid',
  pid: 200,
  start: '12345',
  commandHash: 'b'.repeat(64),
  binaryHash: 'c'.repeat(64),
  configHash: 'd'.repeat(64),
  files: [source.config],
};

describe('Nginx upgrade preflight', () => {
  it('accepts the current default installation and explicit prefix/config instances', () => {
    expect(() =>
      validateStartup(
        'nginx: master process ./nginx',
        '/usr/local/nginx/sbin',
        source,
        'configure arguments:',
        bundle,
      ),
    ).not.toThrow();
    expect(() =>
      validateStartup(
        'nginx: master process /opt/nginx/nginx -p /opt/nginx -c /opt/nginx/app.conf',
        '/',
        { binary: '/opt/nginx/nginx', prefix: '/opt/nginx', config: '/opt/nginx/app.conf' },
        '',
        bundle,
      ),
    ).not.toThrow();
  });
  it('rejects implicit default changes, mismatched instances and complex command lines', () => {
    for (const cmd of [
      'nginx: master process /other/nginx',
      'nginx: worker process',
      'nginx: master process ./nginx -g daemon off;',
      'nginx: master process ./nginx -c /etc/other.conf',
      'nginx: master process ./nginx -p /opt/other',
    ])
      expect(() => validateStartup(cmd, '/usr/local/nginx/sbin', source, '', bundle)).toThrow();
    expect(() =>
      validateStartup(
        'nginx: master process ./nginx',
        '/usr/local/nginx/sbin',
        source,
        '--prefix=/usr/local/nginx',
        { ...bundle, prefix: '/etc/nginx' },
      ),
    ).toThrow();
  });
  it('keeps health probes local and paths unambiguous', () => {
    expect(NginxUpgradeSourceSchema.parse(source)).toEqual(source);
    for (const healthUrl of [
      'file:///etc/passwd',
      'https://example.com/',
      'http://127.0.0.1@evil.example/',
      'http://localhost/\ncommand',
      'http://localhost/#fragment',
    ])
      expect(NginxUpgradeSourceSchema.safeParse({ ...source, healthUrl }).success).toBe(false);
    for (const binary of ['nginx', '/opt/space name/nginx', '/tmp/$(reboot)', '/tmp/nginx\n'])
      expect(NginxUpgradeSourceSchema.safeParse({ ...source, binary }).success).toBe(
        binary === '/tmp/nginx\n',
      );
  });
  it('generates syntactically valid independent and systemd scripts', () => {
    const scripts = [
      inspectScript(source),
      processScript(snapshot, source.healthUrl),
      prepareScript('/opt/backup', '/tmp/pkg/nginx', bundle.sha256, snapshot),
      upgradeScript(snapshot, '/opt/backup', bundle.sha256, source.healthUrl),
      upgradeScript(
        { ...snapshot, unit: 'nginx.service', unitHash: 'f'.repeat(64) },
        '/opt/backup',
        bundle.sha256,
        source.healthUrl,
      ),
    ];
    for (const script of scripts) {
      const result = spawnSync(
        process.platform === 'win32' ? 'D:/idea/Git/bin/bash.exe' : '/bin/bash',
        ['-n'],
        { input: script, encoding: 'utf8' },
      );
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    }
  });
});

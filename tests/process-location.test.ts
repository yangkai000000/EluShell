import { it, expect } from 'vitest';
import { processLocation, decodeArgv } from '../electron/process-location';
import { parseProcesses } from '../electron/processes';
import { formatMemory } from '../src/format';
import { sortProcesses } from '../src/ProcessManager';
it('resolves the Java service JAR rather than the JDK, native library or agent', () => {
  const argv = [
    '/opt/jdk/bin/java',
    '-Xmx10g',
    '-Djava.library.path=/srv/app/native',
    '-javaagent:/opt/agent.jar',
    '-jar',
    'app.jar',
  ];
  expect(processLocation('/opt/jdk/bin/java', '/srv/services/api', argv)).toEqual({
    location: '/srv/services/api/app.jar',
    locationSource: 'entry',
  });
  expect(processLocation('', '', ['java', '-jar', '/srv/API service/main.jar']).location).toBe(
    '/srv/API service/main.jar',
  );
  expect(
    processLocation('/opt/jdk/bin/java', '/srv/api', [
      'java',
      '-cp',
      'libs/*',
      'com.example.Main',
      '-jar',
      'application-argument.jar',
    ]),
  ).toEqual({ location: '/srv/api', locationSource: 'cwd' });
  expect(processLocation('/opt/jdk/bin/java', '', ['java', '-jar', 'relative.jar'])).toEqual({
    location: '',
    locationSource: 'unknown',
  });
});
it.each([
  [
    '/usr/bin/dotnet',
    '/srv/api',
    ['dotnet', 'exec', '--runtimeconfig', '/env/runtime.json', 'Api.dll'],
    '/srv/api/Api.dll',
  ],
  [
    '/usr/bin/node',
    '/srv/node',
    ['node', '--require', '/env/preload.js', '--inspect', 'src/main.js'],
    '/srv/node/src/main.js',
  ],
  [
    '/usr/bin/python3.12',
    '/srv/worker',
    ['python3', '-u', '-X', 'dev', '../jobs/run.py'],
    '/srv/jobs/run.py',
  ],
  ['/bin/bash', '/srv/task', ['bash', '-x', 'run.sh'], '/srv/task/run.sh'],
  ['/usr/sbin/nginx', '/', ['nginx', '-g', 'daemon off;'], '/usr/sbin/nginx'],
  ['/usr/bin/python3', '/srv/module', ['python3', '-m', 'package.server'], '/srv/module'],
  [
    '/usr/bin/node',
    '/srv/node',
    ['node', '--unknown-option', '/env/option-value', 'server.js'],
    '/srv/node',
  ],
])('identifies service entry for %s', (exe, cwd, argv, expected) => {
  expect(processLocation(exe as string, cwd as string, argv as string[]).location).toBe(expected);
});
it('uses NUL-delimited process arguments to preserve spaces in actual JAR names', () => {
  const argv = ['java', '-Djava.library.path=/env/native', '-jar', 'API service.jar'];
  const hex = Buffer.from(argv.join('\0') + '\0').toString('hex');
  expect(decodeArgv(hex)).toEqual(argv);
  expect(decodeArgv('not hex')).toEqual([]);
  const row = [
    '42',
    'app',
    '2.5',
    '4120166',
    'S',
    'java',
    '1234',
    '/jdk/bin/java',
    '/srv/my project',
    hex,
    argv.join(' '),
  ].join('\t');
  const [p] = parseProcesses(row);
  expect(p.location).toBe('/srv/my project/API service.jar');
  expect(p.executable).toBe('/jdk/bin/java');
  expect(p.cwd).toBe('/srv/my project');
  const small = { ...p, pid: 7, memory: 100 * 1024 };
  expect(sortProcesses([small, p], 'memory', true)[0].pid).toBe(42);
});
it.each([
  [0, '0 B'],
  [512, '512 B'],
  [1024, '1.0 KB'],
  [1024 ** 2 - 1024, '1023.0 KB'],
  [1024 ** 2, '1.0 MB'],
  [1003.7 * 1024 ** 2, '1003.7 MB'],
  [1024 ** 3, '1.0 GB'],
  [4023.6 * 1024 ** 2, '3.9 GB'],
])('formats %s bytes as %s', (bytes, expected) =>
  expect(formatMemory(bytes as number)).toBe(expected),
);

it('handles JVM flags placed after -jar as used by existing services', () => {
  expect(
    processLocation('/opt/jdk/bin/java', '/srv/api', [
      'java',
      '-jar',
      '-Xmx2g',
      '-Xms512m',
      '-Djava.library.path=/env/lib',
      'app.jar',
    ]).location,
  ).toBe('/srv/api/app.jar');
  expect(
    processLocation('/opt/jdk/bin/java', '/srv/api', [
      'java',
      '-jar',
      '-javaagent:/env/agent.jar',
      '/srv/服务/api.jar',
      '--server.port=8080',
    ]).location,
  ).toBe('/srv/服务/api.jar');
});

import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('test-results', { recursive: true });
await build({
  entryPoints: ['electron/ssh.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['ssh2'],
  outfile: 'test-results/ssh-service.cjs',
});
const require = createRequire(import.meta.url);
const { SSHService } = require('../test-results/ssh-service.cjs');
console.log('Ready for credentials on stdin; credentials will not be logged or persisted.');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const input = await new Promise((resolve) =>
  process.stdin.once('data', (d) => resolve(JSON.parse(d.toString()))),
);
let output = '';
const report = { host: input.host, user: input.username, checks: [], fingerprint: '' };
const service = new SSHService(
  (e) => {
    if (e.type === 'data') output += e.data;
  },
  async (host, key) => {
    report.fingerprint = key;
    console.log('SSH host fingerprint (SHA256 hex): ' + key);
    return true;
  },
);
try {
  const id = await service.connect(
    {
      id: 'live-readonly',
      name: 'Live verification',
      host: input.host,
      port: 22,
      username: input.username,
      group: 'Test',
      tags: ['linux'],
      auth: 'password',
      startup: '',
      autoStartup: false,
    },
    input.password,
  );
  input.password = '';
  service.start(id);
  report.checks.push('SSH authentication and PTY');
  service.write(id, "printf '\\nELUSHELL_READONLY_PTY_OK\\n'\r");
  const first = await service.metrics(id);
  await new Promise((resolve) => setTimeout(resolve, 2100));
  const second = await service.metrics(id);
  report.checks.push('Linux monitoring, two samples');
  report.metrics = {
    os: second.os,
    cores: second.cores.length,
    cpu: second.cpu,
    memoryTotal: second.memory.total,
    disks: second.disks.length,
    interfaces: second.network.map((n) => n.name),
    processes: second.processes.length,
    routeAvailable: !!second.routes,
    diskstatsAvailable: !!second.diskIO,
    sampleSeconds: (second.at - first.at) / 1000,
  };
  const files = await service.files(id, '.');
  report.directoryEntryCount = files.length;
  report.checks.push('SFTP directory read');
  const completion = await service.complete(id, './');
  report.completionCount = completion.length;
  report.checks.push('SFTP path completion');
  if (!output.includes('ELUSHELL_READONLY_PTY_OK')) throw Error('PTY output missing');
  report.checks.push('PTY input and output');
  report.result = 'PASS';
} catch (e) {
  input.password = '';
  report.result = 'FAIL';
  report.error = e.message;
  process.exitCode = 1;
} finally {
  service.close();
  await writeFile('test-results/live-readonly.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.stdin.destroy();
}

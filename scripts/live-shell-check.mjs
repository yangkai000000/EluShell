import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const output = 'test-results/live-shell-service.cjs';
await build({ entryPoints: ['electron/ssh.ts'], outfile: output, bundle: true, platform: 'node', format: 'cjs', packages: 'external' });
const { SSHService } = createRequire(import.meta.url)('../' + output);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
console.log('Ready for single-use credentials on stdin; echo disabled.');
let input = '';
process.stdin.on('data', async data => {
  input += data.toString();
  if (!input.includes('\n') && !input.includes('\r')) return;
  process.stdin.removeAllListeners('data');
  const auth = JSON.parse(input.trim()); input = '';
  let text = '';
  const ssh = new SSHService(event => { if (event.type === 'data') text += event.data; }, async (_, key) => key === auth.fingerprint);
  const until = async predicate => { const start = Date.now(); while (!await predicate()) { if (Date.now() - start > 15000) throw Error('Live shell check timed out'); await new Promise(r => setTimeout(r, 100)); } };
  try {
    const id = await ssh.connect({ host: auth.host, port: 22, username: auth.username, auth: 'password', tunnels: [] }, auth.password);
    auth.password = '';
    ssh.start(id);
    await until(() => ssh.get(id).shellPid && text.length);
    assert(!text.includes('elushell;')); assert(!text.includes('printf'));
    const initial = await ssh.cwd(id);
    ssh.write(id, 'cd /tmp\r');
    await until(async () => await ssh.cwd(id) === '/tmp');
    const files = await ssh.files(id, '/tmp');
    assert(files.every(f => Number.isInteger(f.uid) && Number.isInteger(f.gid)));
    const report = { result: 'PASS', account: auth.username, checks: ['PTY login without visible probe command', 'login shell PID discovered', 'cd /tmp synchronizes directory', 'SFTP owner/group attributes'], initialDirectoryDetected: initial.startsWith('/'), namedOwners: files.filter(f => f.user && f.group).length };
    await writeFile('test-results/live-shell.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { ssh.close(); process.stdin.pause(); }
});

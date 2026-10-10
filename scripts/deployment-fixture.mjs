// Test-only PTY peer: deployment execution must use this original stream.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
export function deploymentFixture(root, run) {
  return {
    exec: command => command.includes('ps -eo pgid=,comm=') ? 'bash\n' : '',
    shell: stream => {
      stream.on('data', async data => {
        const input = data.toString();
        const match = input.match(/elushell-deploy;([a-f0-9-]{36});begin/);
        if (!match) return;
        const token = match[1];
        const script = await readFile(path.join(root, 'tmp', `.elushell-deploy-${token}.sh`), 'utf8');
        stream.write(`\x1b]778;elushell-deploy;${token};begin\x07`);
        const finish = code => stream.write(`\x1b]778;elushell-deploy;${token};end;${code}\x07`);
        await run(script, stream, finish);
      });
    },
  };
}

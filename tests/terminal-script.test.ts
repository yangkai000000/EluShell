import { it, expect } from 'vitest';
import {
  TerminalScript,
  isForegroundShell,
  foregroundShellCommand,
} from '../electron/terminal-script';

it('only permits an idle supported foreground shell, including an explicitly switched user shell', () => {
  for (const s of ['bash', 'zsh', 'sh', 'sudo\nsu\nbash']) expect(isForegroundShell(s)).toBe(true);
  for (const s of ['', 'sudo', 'vim', 'bash\ntail', 'fish', 'python'])
    expect(isForegroundShell(s)).toBe(false);
  expect(() => foregroundShellCommand(NaN)).toThrow();
});
it('captures only script output and strips markers even when split across every character', async () => {
  let command = '',
    output = '',
    unlocked = false;
  const stream = {
    write: (value: string, callback?: () => void) => {
      command += value;
      callback?.();
    },
  };
  const ftp = {
    writeFile: (_p: any, _s: any, _o: any, cb: any) => cb(),
    unlink: (_p: any, cb: any) => cb(),
  };
  const runner = new TerminalScript(stream as any, () => {
    unlocked = true;
  });
  const run = runner.run(
    'echo fixture',
    ftp as any,
    (s) => (output += s),
    new AbortController().signal,
  );
  await Promise.resolve();
  await Promise.resolve();
  const token = command.match(/elushell-deploy;([a-f0-9-]+);begin/)![1];
  const content = `prompt echo\r\n\x1b]778;elushell-deploy;${token};begin\x07中文 ✓\r\n\x1b]778;elushell-deploy;${token};end;7\x07$ `;
  let visible = '';
  for (const c of content) visible += runner.push(c);
  expect(await run).toBe(7);
  expect(output).toBe('中文 ✓\r\n');
  expect(visible).toBe('prompt echo\r\n中文 ✓\r\n$ ');
  runner.release();
  expect(unlocked).toBe(true);
});
it('rejects a lost terminal instead of reporting deployment success', async () => {
  const stream = { write: (_s: any, cb?: () => void) => cb?.() };
  const ftp = {
    writeFile: (_p: any, _s: any, _o: any, cb: any) => cb(),
    unlink: (_p: any, cb: any) => cb(),
  };
  const runner = new TerminalScript(stream as any, () => {});
  const run = runner.run('echo fixture', ftp as any, () => {}, new AbortController().signal);
  const assertion = expect(run).rejects.toThrow('断开');
  await Promise.resolve();
  await Promise.resolve();
  runner.closed();
  await assertion;
});

import { it, expect } from 'vitest';
import { ShellIdentityDecoder, loginShellCommand } from '../electron/shell-session';
const id = '11111111-2222-4333-8444-555555555555';
it('strips split shell identity messages without damaging UTF8 or terminal control sequences', () => {
  const pids: number[] = [];
  const decoder = new ShellIdentityDecoder(id, (pid) => pids.push(pid));
  const bytes = Buffer.from(`欢迎\x1b[32m\x1b]777;elushell;${id};123456\x07中文$ `);
  let text = '';
  for (const byte of bytes) text += decoder.push(Buffer.from([byte]));
  text += decoder.end();
  expect(text).toBe('欢迎\x1b[32m中文$ ');
  expect(pids).toEqual([123456]);
});
it('leaves unrelated OSC sequences intact and bounds incomplete invalid probes', () => {
  const decoder = new ShellIdentityDecoder(id, () => {
    throw Error('must not identify');
  });
  const ordinary = '\x1b]0;window title\x07';
  expect(decoder.push(Buffer.from(ordinary))).toBe(ordinary);
  const malformed = `\x1b]777;elushell;${id};${'x'.repeat(100)}`;
  expect(decoder.push(Buffer.from(malformed)) + decoder.end()).toBe(malformed);
});
it('starts a login shell through exec and refuses interpolated identifiers', () => {
  expect(loginShellCommand(id)).toContain('exec');
  expect(loginShellCommand(id)).toContain('${SHELL:-/bin/sh}');
  expect(() => loginShellCommand("'; rm -rf /'")).toThrow();
});

import { StringDecoder } from 'node:string_decoder';
import { quote } from '../src/shared';
// Execute before the interactive login shell starts, so no probe is typed into
// the terminal or saved in the user's interactive shell history. exec preserves PID.
export function loginShellCommand(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid shell session ID');
  return (
    '/bin/sh -c ' +
    quote(`printf '\\033]777;elushell;${id};%s\\007' "$$"; exec "\${SHELL:-/bin/sh}" -l`)
  );
}
export class ShellIdentityDecoder {
  private decoder = new StringDecoder('utf8');
  private pending = '';
  private prefix: string;
  constructor(
    id: string,
    private identify: (pid: number) => void,
  ) {
    this.prefix = `\x1b]777;elushell;${id};`;
  }
  push(bytes: Buffer) {
    this.pending += this.decoder.write(bytes);
    let visible = '';
    while (this.pending) {
      const index = this.pending.indexOf(this.prefix);
      if (index < 0) {
        let keep = Math.min(this.prefix.length - 1, this.pending.length);
        while (keep && !this.prefix.startsWith(this.pending.slice(-keep))) keep--;
        visible += keep ? this.pending.slice(0, -keep) : this.pending;
        this.pending = keep ? this.pending.slice(-keep) : '';
        break;
      }
      visible += this.pending.slice(0, index);
      this.pending = this.pending.slice(index);
      const end = this.pending.indexOf('\x07', this.prefix.length);
      if (end < 0 && this.pending.length < this.prefix.length + 32) break;
      const value = end < 0 ? '' : this.pending.slice(this.prefix.length, end);
      if (/^\d{1,10}$/.test(value) && +value > 0 && +value <= 2147483647) {
        this.identify(+value);
        this.pending = this.pending.slice(end + 1);
      } else {
        visible += this.pending[0];
        this.pending = this.pending.slice(1);
      }
    }
    return visible;
  }
  end() {
    const text = this.pending + this.decoder.end();
    this.pending = '';
    return text;
  }
}

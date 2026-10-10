import { randomUUID } from 'node:crypto';
import type { ClientChannel, SFTPWrapper } from 'ssh2';
import { quote } from '../src/shared';

export interface ShellScriptLease {
  run(
    script: string,
    ftp: SFTPWrapper,
    output: (text: string) => void,
    signal: AbortSignal,
  ): Promise<number>;
  release(): void;
}

// Read the foreground process group instead of interrupting a running command.
// /proc/<pid>/stat's comm field may contain spaces or parentheses.
export function foregroundShellCommand(pid: number) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error('无法识别终端 Shell');
  return `s=$(cat /proc/${pid}/stat 2>/dev/null) || exit 1; set -- \${s##*) }; g=$6; [ "$g" -gt 0 ] || exit 1; ps -eo pgid=,comm= | awk -v g="$g" '$1==g {print $2}'`;
}
export function isForegroundShell(text: string) {
  const names = text.trim().split(/\s+/);
  const shells = /^(?:-?(?:ba|da|k|z)?sh|ash)$/;
  return (
    names.some((n) => shells.test(n)) &&
    names.every((n) => shells.test(n) || /^(?:sudo|su)$/.test(n))
  );
}

// Source the file in a subshell of the *existing PTY*, never a new SSH exec shell.
// This inherits live variables (including unexported ones), aliases, functions,
// working directory, shell choice and any explicit su/sudo login in that PTY.
export function terminalScriptCommand(token: string, file: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw Error('Invalid script token');
  return `\x15 ( set +e; command printf '\\033]778;elushell-deploy;${token};begin\\007'; ( . ${quote(file)} ); command printf '\\033]778;elushell-deploy;${token};end;%s\\007' "$?" )\r`;
}

export class TerminalScript implements ShellScriptLease {
  private token = randomUUID();
  private pending = '';
  private started = false;
  private capture?: (text: string) => void;
  private finish?: (error?: Error, code?: number) => void;
  private active = false;
  constructor(
    private stream: ClientChannel,
    private unlock: () => void,
  ) {}
  get executing() {
    return this.active;
  }
  push(text: string) {
    if (!this.active) return text;
    this.pending += text;
    const prefix = `\x1b]778;elushell-deploy;${this.token};`;
    let visible = '';
    const plain = (value: string) => {
      visible += value;
      if (this.started) this.capture?.(value);
    };
    while (this.pending) {
      const index = this.pending.indexOf(prefix);
      if (index < 0) {
        let keep = Math.min(prefix.length - 1, this.pending.length);
        while (keep && !prefix.startsWith(this.pending.slice(-keep))) keep--;
        plain(keep ? this.pending.slice(0, -keep) : this.pending);
        this.pending = keep ? this.pending.slice(-keep) : '';
        break;
      }
      plain(this.pending.slice(0, index));
      this.pending = this.pending.slice(index);
      const end = this.pending.indexOf('\x07', prefix.length);
      if (end < 0 && this.pending.length < prefix.length + 32) break;
      const value = end < 0 ? '' : this.pending.slice(prefix.length, end);
      if (value === 'begin' || /^end;\d{1,3}$/.test(value)) {
        this.pending = this.pending.slice(end + 1);
        if (value === 'begin') this.started = true;
        else if (this.started) {
          this.started = false;
          this.finish?.(undefined, Number(value.slice(4)));
        }
      } else {
        plain(this.pending[0]);
        this.pending = this.pending.slice(1);
      }
    }
    return visible;
  }
  closed() {
    this.finish?.(Error('终端连接已断开，无法确认部署完成'));
  }
  release() {
    this.unlock();
  }
  async run(script: string, ftp: SFTPWrapper, output: (text: string) => void, signal: AbortSignal) {
    const file = `/tmp/.elushell-deploy-${this.token}.sh`;
    signal.throwIfAborted();
    // Exclusive creation and owner-only access prevent reading deployment secrets
    // or following a pre-existing path. Never send a 64K script through PTY input.
    await new Promise<void>((resolve, reject) =>
      ftp.writeFile(file, script, { flag: 'wx', mode: 0o600 }, (e) => (e ? reject(e) : resolve())),
    );
    try {
      signal.throwIfAborted();
      return await new Promise<number>((resolve, reject) => {
        let settled = false;
        this.capture = output;
        this.active = true;
        const complete = (error?: Error, code?: number) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          this.finish = undefined;
          this.active = false;
          error ? reject(error) : resolve(code!);
        };
        const abort = () => {
          // Interrupt only our foreground script; leave the SSH connection open.
          this.stream.write('\x03');
          complete(Error('已中断部署；停止不会回滚已执行的命令，请核对服务器状态。'));
        };
        const timer = setTimeout(() => {
          if (!this.started) {
            this.stream.write('\x15\x03');
            complete(Error('当前终端未开始执行脚本，请回到命令提示符后重试'));
          }
        }, 10000);
        this.finish = complete;
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) {
          abort();
          return;
        }
        this.stream.write(terminalScriptCommand(this.token, file), (error) => {
          if (error) complete(error);
        });
      });
    } finally {
      await new Promise<void>((resolve) => ftp.unlink(file, () => resolve())).catch(() => {});
      this.capture = undefined;
    }
  }
}

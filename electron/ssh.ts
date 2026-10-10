import { TerminalScript, foregroundShellCommand, isForegroundShell } from './terminal-script';
import { processCommand, parseProcesses, identityCommand, terminateCommand } from './processes';
import { TerminalOutput } from './terminal-output';
import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import type { Profile, Metrics, SessionEvent, RemoteFile } from '../src/shared';
import { collectCommand, parseMetrics } from './metrics';
import { TunnelManager } from './tunnels';
import { loginShellCommand, ShellIdentityDecoder } from './shell-session';
type Session = {
  profile: Profile;
  client: Client;
  stream?: ClientChannel;
  previous?: Metrics;
  sftp?: SFTPWrapper;
  sftpPending?: Promise<SFTPWrapper>;
  busy?: Promise<Metrics>;
  tunnels?: TunnelManager;
  shellPid?: number;
  script?: TerminalScript;
};
export class SSHService {
  sessions = new Map<string, Session>();
  private outputs = new Map<string, TerminalOutput>();
  ack(id: string, sequence: number) {
    this.outputs.get(id)?.ack(sequence);
  }
  private output(id: string, data: string) {
    const output = this.outputs.get(id);
    if (output) output.push(data);
    else this.emit({ id, type: 'data', data });
  }
  constructor(
    private emit: (event: SessionEvent) => void,
    private verify: (host: string, key: string) => Promise<boolean>,
  ) {}
  async connect(p: Profile, secret: string) {
    if (p.auth === 'agent' && process.platform !== 'win32' && !process.env.SSH_AUTH_SOCK)
      throw Error('未检测到 SSH Agent，请启动 ssh-agent 并添加私钥，或选择私钥文件认证。');
    const id = randomUUID(),
      client = new Client(),
      s: Session = { client, profile: p };
    const key = p.auth === 'key' ? await readFile(p.privateKeyPath || '') : undefined;
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      client.on('error', (err) => {
        if (!ready) reject(err);
        else this.emit({ id, type: 'error', data: err.message });
      });
      client.on('close', () => {
        s.script?.closed();
        s.tunnels?.close();
        this.sessions.delete(id);
        const closed = () => {
          this.outputs.get(id)?.dispose();
          this.outputs.delete(id);
          this.emit({ id, type: 'closed', data: '连接已关闭' });
        };
        const output = this.outputs.get(id);
        if (output) output.end(closed);
        else closed();
        if (!ready) reject(Error('SSH 连接提前关闭'));
      });
      client.on('ready', () => {
        client.exec(
          loginShellCommand(id),
          { pty: { term: 'xterm-256color', cols: 120, rows: 30 } },
          (err, stream) => {
            if (err) {
              client.end();
              reject(err);
              return;
            }
            ready = true;
            s.stream = stream;
            stream.pause();
            this.sessions.set(id, s);
            const identity = new ShellIdentityDecoder(id, (pid) => {
              s.shellPid = pid;
            });
            stream.on('data', (d: Buffer) => {
              const decoded = identity.push(d);
              const data = s.script ? s.script.push(decoded) : decoded;
              if (data) this.output(id, data);
            });
            stream.on('end', () => {
              const data = identity.end();
              if (data) this.output(id, data);
            });
            stream.stderr.on('data', (d: Buffer) =>
              this.output(id, s.script ? s.script.push(d.toString()) : d.toString()),
            );
            stream.on('close', () => client.end());
            resolve();
          },
        );
      });
      client.connect({
        host: p.host,
        port: p.port,
        username: p.username,
        password: p.auth === 'password' ? secret : undefined,
        privateKey: key,
        passphrase: p.auth === 'key' ? secret : undefined,
        agent: p.auth === 'agent' ? process.env.SSH_AUTH_SOCK || 'pageant' : undefined,
        readyTimeout: 20000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        hostHash: 'sha256',
        hostVerifier: (key: string | Buffer, cb: (valid: boolean) => void) => {
          void this.verify(`${p.host}:${p.port}`, String(key)).then(cb, () => cb(false));
        },
      });
    });
    s.tunnels = new TunnelManager(client, (message) =>
      this.emit({ id, type: 'error', data: message }),
    );
    try {
      await s.tunnels.open(p.tunnels || []);
    } catch (e) {
      this.disconnect(id);
      throw e;
    }
    return id;
  }
  get(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw Error('会话未连接');
    return s;
  }
  start(id: string, flowControlled = false) {
    const stream = this.get(id).stream;
    if (flowControlled && !this.outputs.has(id))
      this.outputs.set(
        id,
        new TerminalOutput(
          (data, sequence) => this.emit({ id, type: 'data', data, sequence }),
          () => {
            stream?.pause();
            stream?.stderr.pause();
          },
          () => {
            stream?.resume();
            stream?.stderr.resume();
          },
        ),
      );
    stream?.resume();
  }
  write(id: string, data: string) {
    const session = this.get(id);
    if (session.script && !session.script.executing) throw Error('正在准备部署，请稍候再输入命令');
    session.stream?.write(data);
  }
  async acquireScript(id: string) {
    const session = this.get(id);
    if (!session.stream || !session.shellPid) throw Error('终端尚未就绪，请回到命令提示符后重试');
    if (session.script) throw Error('此终端已有部署任务');
    const script = new TerminalScript(session.stream, () => {
      if (session.script === script) session.script = undefined;
    });
    session.script = script;
    try {
      if (!isForegroundShell(await this.exec(id, foregroundShellCommand(session.shellPid))))
        throw Error(
          '终端正运行其他程序或当前 Shell 不受支持，请回到 Bash、Zsh 或 Sh 命令提示符后重试',
        );
      return script;
    } catch (error) {
      script.release();
      throw error;
    }
  }
  resize(id: string, cols: number, rows: number) {
    this.get(id).stream?.setWindow(rows, cols, 0, 0);
  }
  disconnect(id: string) {
    this.outputs.get(id)?.dispose();
    this.outputs.delete(id);
    this.sessions.get(id)?.tunnels?.close();
    this.sessions.get(id)?.client.end();
    this.sessions.delete(id);
  }
  close() {
    for (const id of this.sessions.keys()) this.disconnect(id);
    for (const output of this.outputs.values()) output.dispose();
    this.outputs.clear();
  }
  exec(id: string, command: string, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '',
        settled = false;
      let channel: ClientChannel | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) {
          channel?.close();
          reject(error);
        } else resolve(output);
      };
      const abort = () => finish(Error('只读操作已停止'));
      const timer = setTimeout(() => finish(Error('远程请求超时')), 12000);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      try {
        this.get(id).client.exec(command, (err, stream) => {
          if (err) {
            finish(err);
            return;
          }
          channel = stream;
          if (settled) {
            stream.close();
            return;
          }
          stream.on('data', (d: Buffer) => {
            output += d.toString();
            if (output.length > 2_000_000) finish(Error('远程输出超出限制'));
          });
          stream.on('error', finish);
          stream.on('close', (code: number | undefined) => {
            // find may return partial readable results when some directories are inaccessible.
            if (signal && code && !output) finish(Error('只读查询失败或没有可访问的匹配结果'));
            else finish();
          });
        });
      } catch (e) {
        finish(e instanceof Error ? e : Error(String(e)));
      }
    });
  }
  async processes(id: string) {
    return parseProcesses(await this.exec(id, processCommand));
  }
  async processIdentity(id: string, pid: number) {
    const text = await this.exec(id, identityCommand(pid));
    const [start, ...name] = text.trim().split('\t');
    if (!/^\d+$/.test(start)) throw Error('进程已退出或无权读取');
    return { start, name: name.join('\t') };
  }
  async terminateProcess(id: string, pid: number, start: string) {
    if (this.get(id).shellPid === pid) throw Error('不能终止当前终端 Shell，请使用关闭会话');
    const result = await this.exec(id, terminateCommand(pid, start));
    if (!result.endsWith('ELUSHELL_TERMINATED'))
      throw Error(result.trim() || '终止失败：进程已退出或权限不足');
  }
  metrics(id: string) {
    const s = this.get(id);
    return (
      s.busy ??
      (s.busy = this.exec(id, collectCommand)
        .then((text) => (s.previous = parseMetrics(text, s.previous)))
        .finally(() => {
          s.busy = undefined;
        }))
    );
  }
  async sftp(id: string) {
    const s = this.get(id);
    if (s.sftp) return s.sftp;
    return (
      s.sftpPending ??
      (s.sftpPending = new Promise<SFTPWrapper>((resolve, reject) =>
        s.client.sftp((err, ftp) => (err ? reject(err) : resolve((s.sftp = ftp)))),
      ).finally(() => {
        s.sftpPending = undefined;
      }))
    );
  }
  async realpath(id: string, path: string) {
    const ftp = await this.sftp(id);
    return new Promise<string>((resolve, reject) =>
      ftp.realpath(path, (err, result) => (err ? reject(err) : resolve(result))),
    );
  }
  async cwd(id: string) {
    const pid = this.get(id).shellPid;
    if (!pid) return '';
    return (await this.exec(id, `readlink /proc/${pid}/cwd 2>/dev/null`)).replace(/\r?\n$/, '');
  }
  async files(id: string, path: string): Promise<RemoteFile[]> {
    const ftp = await this.sftp(id);
    return new Promise((resolve, reject) =>
      ftp.readdir(path, (err, list) =>
        err
          ? reject(err)
          : resolve(
              list
                .map((f) => ({
                  name: f.filename,
                  directory: f.attrs.isDirectory(),
                  size: f.attrs.size,
                  modified: f.attrs.mtime,
                  mode: f.attrs.mode,
                  uid: f.attrs.uid,
                  gid: f.attrs.gid,
                  user: f.longname?.match(/^\S+\s+\d+\s+(\S+)\s+(\S+)\s/)?.[1],
                  group: f.longname?.match(/^\S+\s+\d+\s+(\S+)\s+(\S+)\s/)?.[2],
                }))
                .sort(
                  (a, b) =>
                    Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
                ),
            ),
      ),
    );
  }
  async complete(id: string, path: string) {
    const directory = path.endsWith('/') ? path : posix.dirname(path);
    const prefix = path.endsWith('/') ? '' : posix.basename(path);
    return (await this.files(id, directory || '.'))
      .filter((f) => f.name.startsWith(prefix))
      .slice(0, 30)
      .map((f) => posix.join(directory, f.name) + (f.directory ? '/' : ''));
  }
  async upload(id: string, local: string, remote: string) {
    const ftp = await this.sftp(id);
    await new Promise<void>((resolve, reject) =>
      ftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve())),
    );
  }
  async download(id: string, remote: string, local: string) {
    const ftp = await this.sftp(id);
    await new Promise<void>((resolve, reject) =>
      ftp.fastGet(remote, local, (err) => (err ? reject(err) : resolve())),
    );
  }
}

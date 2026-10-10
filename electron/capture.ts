import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat, unlink, rename } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Client, ClientChannel } from 'ssh2';
import { z } from 'zod';
import {
  CaptureOptionsSchema,
  captureRunning,
  type CaptureCheck,
  type CaptureJob,
  type CaptureOptions,
} from '../src/capture-shared';
import { PcapWriter } from './pcap';
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export function captureFilter(options: CaptureOptions, ssh?: CaptureCheck['ssh']) {
  const parts: string[] = [];
  if (options.protocol !== 'all') parts.push(options.protocol);
  for (const [direction, value] of [
    ['src', options.source],
    ['dst', options.destination],
  ]) {
    if (value && !isIP(value)) throw Error('源和目标地址必须是有效的 IPv4 或 IPv6 地址');
    if (value) parts.push(`${direction} host ${value}`);
  }
  if (options.port) {
    const port = +options.port;
    if (port < 1 || port > 65535) throw Error('端口范围为 1–65535');
    parts.push(`port ${port}`);
  }
  if (options.filter) parts.push(`(${options.filter})`);
  if (options.excludeSSH) {
    if (!ssh) throw Error('未能识别当前 SSH 管理连接；请检查连接环境或手动关闭排除选项');
    parts.push(
      `not (tcp and host ${ssh.client} and port ${ssh.clientPort} and port ${ssh.serverPort})`,
    );
  }
  return parts.map((p) => `(${p})`).join(' and ');
}
export function captureCommand(options: CaptureOptions, filter: string) {
  const tcpdump = `${options.sudo ? 'sudo -n ' : ''}tcpdump -U -n -i ${quote(options.interface)} -s ${options.snaplen} -c ${options.packets} -w -${filter ? ' -- ' + quote(filter) : ''}`;
  // stdin is a dedicated stop channel. The helper stops tcpdump, then wait reaps both children.
  // timeout bounds remote lifetime even if the desktop or network disappears.
  const script = `exec 3<&0; ${tcpdump} </dev/null & p=$!; trap 'kill -INT "$p" 2>/dev/null' HUP INT TERM EXIT; (IFS= read -r stop <&3; kill -INT "$p" 2>/dev/null) & r=$!; wait "$p"; result=$?; kill "$r" 2>/dev/null; wait "$r" 2>/dev/null; trap - HUP INT TERM EXIT; exit "$result"`;
  return `exec timeout -s TERM -k 3 ${options.duration}s sh -c ${quote(script)}`;
}
type Running = {
  job: CaptureJob;
  stream?: ClientChannel;
  task: Promise<void>;
  stop?: string;
  timer?: ReturnType<typeof setTimeout>;
};
export class CaptureService {
  private jobs: CaptureJob[] = [];
  private running = new Map<string, Running>();
  private saving = Promise.resolve();
  private ready?: Promise<void>;
  private enabled = true;
  constructor(
    private root: string,
    private client: (id: string) => Client,
    private emit: (job: CaptureJob) => void,
  ) {}
  private async initialize() {
    return (this.ready ??= (async () => {
      await mkdir(this.root, { recursive: true });
      try {
        const data = JSON.parse(await readFile(path.join(this.root, 'index.json'), 'utf8'));
        this.jobs = z
          .array(
            z.object({
              id: z.string().uuid(),
              sessionId: z.string().uuid(),
              name: z.string(),
              host: z.string(),
              state: z.enum(['starting', 'running', 'stopping', 'completed', 'failed']),
              started: z.number(),
              finished: z.number().optional(),
              bytes: z.number(),
              packets: z.number(),
              options: CaptureOptionsSchema,
              filter: z.string(),
              error: z.string().optional(),
              reason: z.string().optional(),
              filename: z.string().regex(/^[a-f0-9-]{36}\.pcap$/),
            }),
          )
          .max(20)
          .parse(data)
          .map((j) =>
            captureRunning(j)
              ? { ...j, state: 'failed', error: '上次退出时采集未完成，可导出已保存的完整数据包' }
              : j,
          );
      } catch {
        this.jobs = [];
      }
    })());
  }
  private save() {
    const json = JSON.stringify(this.jobs);
    this.saving = this.saving
      .catch(() => {})
      .then(async () => {
        await writeFile(path.join(this.root, 'index.json.tmp'), json);
        await rename(path.join(this.root, 'index.json.tmp'), path.join(this.root, 'index.json'));
      });
    return this.saving;
  }
  async list() {
    await this.initialize();
    return structuredClone(this.jobs);
  }
  async check(id: string, sudo = false): Promise<CaptureCheck> {
    const command = `command -v timeout >/dev/null 2>&1 || { echo '缺少 timeout，请管理员安装 coreutils' >&2; exit 127; }; command -v tcpdump >/dev/null 2>&1 || { echo '缺少 tcpdump，请管理员安装' >&2; exit 127; }; printf '@@SSH\\n%s\\n@@INTERFACES\\n' "$SSH_CONNECTION"; ${sudo ? 'sudo -n ' : ''}tcpdump -D`;
    const output = await this.text(id, command);
    const interfaces = [...output.matchAll(/^\d+\.([^\s]+).*$/gm)]
      .map((m) => m[1])
      .filter((i) => /^[a-zA-Z0-9_.:@-]+$/.test(i));
    const tuple =
      output
        .match(/@@SSH\n([^\n]*)/)?.[1]
        .trim()
        .split(/\s+/) || [];
    const ssh =
      tuple.length === 4 &&
      isIP(tuple[0]) &&
      +tuple[1] > 0 &&
      +tuple[1] < 65536 &&
      +tuple[3] > 0 &&
      +tuple[3] < 65536
        ? { client: tuple[0], clientPort: +tuple[1], serverPort: +tuple[3] }
        : undefined;
    return {
      interfaces,
      ssh,
      ...(!interfaces.length ? { error: '没有可用网卡，请检查 tcpdump 和抓包权限' } : {}),
    };
  }
  private text(id: string, command: string) {
    return new Promise<string>((resolve, reject) => {
      let stream: ClientChannel | undefined,
        output = '',
        error = '',
        settled = false;
      const done = (e?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (e) {
          stream?.close();
          reject(e);
        } else resolve(output);
      };
      const timer = setTimeout(() => done(Error('依赖检查超时')), 12000);
      try {
        this.client(id).exec(command, (e, channel) => {
          if (e) {
            done(e);
            return;
          }
          stream = channel;
          if (settled) {
            channel.close();
            return;
          }
          channel.on('data', (b: Buffer) => {
            output += b.toString();
            if (output.length > 32000) done(Error('依赖检查输出过大'));
          });
          channel.stderr.on('data', (b: Buffer) => {
            error = (error + b.toString()).slice(-4000);
          });
          channel.on('error', done);
          channel.on('close', (code: number) =>
            done(code ? Error(error || '依赖检查失败') : undefined),
          );
        });
      } catch (e) {
        done(e as Error);
      }
    });
  }
  async start(id: string, name: string, host: string, value: unknown) {
    await this.initialize();
    if (!this.enabled) throw Error('工具包已停用');
    if (this.running.size >= 2) throw Error('最多同时运行 2 个抓包任务');
    if ([...this.running.values()].some((r) => r.job.sessionId === id))
      throw Error('此服务器正在抓包');
    if (this.jobs.length >= 20)
      throw Error('已保留 20 次采集结果，请先下载需要的 PCAP 并删除旧记录');
    const options = CaptureOptionsSchema.parse(value);
    // Reserve the slot before dependency I/O so repeated clicks cannot create parallel captures.
    const job: CaptureJob = {
      id: randomUUID(),
      sessionId: id,
      name,
      host,
      state: 'starting',
      started: Date.now(),
      bytes: 0,
      packets: 0,
      options,
      filter: '',
      filename: '',
    };
    job.filename = job.id + '.pcap';
    this.jobs = [job, ...this.jobs];
    const run: Running = { job, task: Promise.resolve() };
    this.running.set(job.id, run);
    this.emit({ ...job });
    run.task = this.perform(run).finally(() => {
      this.running.delete(job.id);
    });
    return structuredClone(job);
  }
  private async perform(run: Running) {
    const { job } = run;
    let stderr = '',
      code: number | undefined,
      lastEmit = 0;
    const publish = () => {
      if (Date.now() - lastEmit > 250) {
        lastEmit = Date.now();
        this.emit({ ...job });
      }
    };
    let parser: PcapWriter | undefined;
    try {
      const checked = await this.check(job.sessionId, job.options.sudo);
      if (checked.error) throw Error(checked.error);
      if (run.stop || !this.enabled) throw Error(run.stop || '工具包已停用');
      job.filter = captureFilter(job.options, checked.ssh);
      await this.save();
      await new Promise<void>((resolve, reject) => {
        this.client(job.sessionId).exec(captureCommand(job.options, job.filter), (e, stream) => {
          if (e) {
            reject(e);
            return;
          }
          run.stream = stream;
          stream.stderr.on('data', (b: Buffer) => {
            stderr = (stderr + b.toString()).slice(-4000);
          });
          stream.on('exit', (value: number) => {
            code = value;
          });
          parser = new PcapWriter(job.options.maxMB * 1048576, job.options.packets, () =>
            this.stop(job.id, '达到采集上限'),
          );
          parser.on('data', () => {
            job.bytes = parser!.bytes;
            job.packets = parser!.packets;
            publish();
          });
          const file = createWriteStream(path.join(this.root, job.filename), {
            flags: 'wx',
            highWaterMark: 65536,
          });
          job.state = run.stop ? 'stopping' : 'running';
          this.emit({ ...job });
          run.timer = setTimeout(
            () => this.stop(job.id, '达到采集时长'),
            job.options.duration * 1000 + 500,
          );
          if (run.stop) this.stop(job.id, run.stop);
          void pipeline(stream, parser, file).then(resolve, reject);
        });
      });
      job.bytes = parser?.bytes || 0;
      job.packets = parser?.packets || 0;
      if (code && ![0, 124, 130, 143].includes(code) && !run.stop)
        throw Error(stderr || `tcpdump 退出码 ${code}`);
      job.state = 'completed';
      job.reason = run.stop || (code === 124 ? '达到采集时长' : '采集结束');
    } catch (e) {
      job.bytes = parser?.bytes || 0;
      job.packets = parser?.packets || 0;
      job.state = 'failed';
      job.error = (stderr || (e instanceof Error ? e.message : String(e))).slice(0, 2000);
    } finally {
      clearTimeout(run.timer);
      run.stream?.close();
      run.stream = undefined;
      job.finished = Date.now();
      await this.save().catch(() => {
        job.error = '采集记录保存失败';
        job.state = 'failed';
      });
      this.emit({ ...job });
    }
  }
  stop(id: string, reason = '用户停止') {
    const run = this.running.get(id);
    if (!run) return;
    run.stop = reason;
    run.job.state = 'stopping';
    this.emit({ ...run.job });
    if (run.stream) {
      run.stream.write('\n');
      clearTimeout(run.timer);
      run.timer = setTimeout(() => {
        try {
          run.stream?.signal('INT');
        } catch {
          /* A disconnected channel no longer accepts signals. */
        } finally {
          run.stream?.close();
        }
      }, 3000);
    }
  }
  async stopSession(id: string) {
    const runs = [...this.running.values()].filter((r) => r.job.sessionId === id);
    for (const r of runs) this.stop(r.job.id, '关闭连接或工具');
    await Promise.allSettled(runs.map((r) => r.task));
  }
  async setEnabled(value: boolean) {
    this.enabled = value;
    if (!value) await this.close();
  }
  async close() {
    const runs = [...this.running.values()];
    for (const r of runs) this.stop(r.job.id, '停止并关闭');
    await Promise.allSettled(runs.map((r) => r.task));
    await this.saving;
  }
  async file(id: string) {
    await this.initialize();
    const job = this.jobs.find((j) => j.id === id);
    if (!job || captureRunning(job) || job.bytes < 24) throw Error('没有可以导出的采集结果');
    const file = path.join(this.root, job.filename);
    await stat(file);
    return file;
  }
  async remove(id: string) {
    await this.initialize();
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return this.list();
    if (captureRunning(job) || this.running.has(id)) throw Error('请先停止采集');
    await unlink(path.join(this.root, job.filename)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
    });
    this.jobs = this.jobs.filter((j) => j.id !== id);
    await this.save();
    return this.list();
  }
}

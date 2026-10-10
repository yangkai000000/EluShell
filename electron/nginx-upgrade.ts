import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { uploadNginxPackage } from './nginx-upload';
import type { Client, ClientChannel, SFTPWrapper } from 'ssh2';
import {
  NginxUpgradeSourceSchema,
  type NginxUpgradeSource,
  type NginxUpgradePreview,
  type NginxUpgradeJob,
  type NginxBundle,
} from '../src/nginx-upgrade-shared';
import { quote } from '../src/shared';
import { parseNginx } from './nginx-config';
import {
  inspectScript,
  processScript,
  prepareScript,
  upgradeScript,
  serviceInspectionScript,
  type NginxSnapshot,
} from './nginx-upgrade-scripts';

const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const safePath = (value: string) => /^\/[A-Za-z0-9_./-]+$/.test(value);
const fields = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .filter((l) => /^[A-Za-z]+\t/.test(l))
      .map((l) => {
        const [k, v] = l.split('\t');
        return [k, Buffer.from(v, 'base64').toString('utf8')];
      }),
  );
const versionAtLeast = (actual: string, required: string) => {
  const a = actual.match(/\d+/g)?.map(Number) || [],
    b = required.match(/\d+/g)?.map(Number) || [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
};

export function validateStartup(
  command: string,
  cwd: string,
  s: Pick<NginxSnapshot, 'binary' | 'config' | 'prefix'>,
  build: string,
  bundle: NginxBundle,
) {
  if (!command.startsWith('nginx: master process ')) throw Error('无法识别 Nginx master 启动参数');
  const parts = command.slice('nginx: master process '.length).trim().split(/\s+/);
  if (parts.some((p) => !/^[A-Za-z0-9_./-]+$/.test(p)))
    throw Error('启动参数包含复杂引号或指令，请人工升级');
  const executable = parts.shift()!;
  if (path.posix.resolve(cwd, executable) !== s.binary)
    throw Error('启动程序与指定路径不同（可能是链接或包装器），请人工升级');
  const args = new Map<string, string>();
  while (parts.length) {
    const flag = parts.shift()!,
      value = parts.shift();
    if (!['-p', '-c'].includes(flag) || !value || args.has(flag))
      throw Error('暂不支持此启动参数组合，请人工升级');
    args.set(flag, value);
  }
  const configured = (name: string, fallback: string) =>
    build.match(new RegExp(`(?:^|\\s)--${name}=([^\\s]+)`))?.[1] || fallback;
  const originalPrefix = configured('prefix', '/usr/local/nginx');
  const originalConf = configured('conf-path', 'conf/nginx.conf');
  const prefix = path.posix.resolve(cwd, args.get('-p') || originalPrefix);
  const config = path.posix.resolve(prefix, args.get('-c') || originalConf);
  if (prefix !== s.prefix || config !== s.config)
    throw Error('填写的主配置或运行目录与正在运行的实例不一致');
  if (!args.has('-p') && path.posix.normalize(bundle.prefix) !== prefix)
    throw Error('此实例使用不同的默认运行目录；无法保证新版继承启动参数，请人工升级');
  if (!args.has('-c') && path.posix.resolve(prefix, bundle.config) !== config)
    throw Error('此实例使用不同的默认配置路径，请人工升级');
}

type Plan = {
  sessionId: string;
  source: NginxUpgradeSource;
  snapshot: NginxSnapshot;
  preview: NginxUpgradePreview;
  bundle: NginxBundle;
};
export class NginxUpgradeService {
  private plans = new Map<string, Plan>();
  private jobs: NginxUpgradeJob[] = [];
  private running = new Set<string>();
  constructor(
    private client: (id: string) => Client,
    private sftp: (id: string) => Promise<SFTPWrapper>,
    private emit: (j: NginxUpgradeJob) => void,
    private resources = path.join(__dirname, 'nginx-bundles'),
  ) {}
  isRunning() {
    return this.running.size > 0;
  }
  hasSession(id: string) {
    return this.running.has(id);
  }
  list(id: string) {
    return structuredClone(this.jobs.filter((j) => j.sessionId === id));
  }
  private execute(
    id: string,
    script: string,
    sudo: boolean,
    seconds = 30,
    output?: (text: string) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let channel: ClientChannel | undefined,
        text = '',
        stderr = '',
        ended = false;
      const done = (error?: Error) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(text);
      };
      const grace = seconds >= 120 ? 90 : 10;
      const timer = setTimeout(
        () => {
          done(Error('服务器响应超时；如已开始切换，请检查备份目录与运行状态'));
          channel?.close();
        },
        (seconds + grace + 10) * 1000,
      );
      try {
        this.client(id).exec(
          `${sudo ? 'sudo -n -- ' : ''}timeout -s TERM -k ${grace} ${seconds} bash -c ${quote(script)}`,
          (error, stream) => {
            if (error) return done(error);
            channel = stream;
            if (ended) {
              stream.close();
              return;
            }
            const a = new StringDecoder('utf8'),
              b = new StringDecoder('utf8');
            const receive = (part: string, err: boolean) => {
              if (err) stderr += part;
              else text += part;
              output?.(part);
              if (text.length + stderr.length > 4_000_000) {
                done(Error('服务器输出超过限制'));
                stream.close();
              }
            };
            stream.on('data', (data: Buffer) => receive(a.write(data), false));
            stream.stderr.on('data', (data: Buffer) => receive(b.write(data), true));
            stream.on('error', done);
            stream.on('close', (code?: number) => {
              receive(a.end(), false);
              receive(b.end(), true);
              done(
                code === 0
                  ? undefined
                  : Error((stderr + '\n' + text).trim().slice(-3000) || '服务器连接中断'),
              );
            });
          },
        );
      } catch (e) {
        done(e instanceof Error ? e : Error(String(e)));
      }
    });
  }
  async inspect(sessionId: string, value: unknown): Promise<NginxUpgradePreview> {
    if (this.isRunning()) throw Error('已有检测或升级任务，请等待完成');
    const parsed = NginxUpgradeSourceSchema.safeParse(value);
    if (!parsed.success) throw Error(parsed.error.issues[0]?.message || '请检查填写内容');
    const source = parsed.data;
    this.running.add(sessionId);
    try {
      const info = fields(await this.execute(sessionId, inspectScript(source), source.sudo));
      const manifest: NginxBundle[] = JSON.parse(
        await readFile(path.join(this.resources, 'manifest.json'), 'utf8'),
      );
      const bundle = manifest.find((b) => b.arch === info.arch);
      const preview: NginxUpgradePreview = {
        id: randomUUID(),
        currentVersion: info.version.match(/nginx\/(\S+)/)?.[1] || '未知',
        targetVersion: bundle?.version || manifest[0]?.version || '',
        ssl: /--with-http_ssl_module(?:\s|$)/.test(info.version),
        binary: info.binary,
        config: info.config,
        prefix: info.prefix,
        pid: 0,
        backupPath: '',
        checks: [],
        ready: false,
        expiresAt: Date.now() + 15 * 60_000,
        packageBytes: bundle?.bytes || 0,
      };
      const check = (name: string, ok: boolean, detail: string) => {
        preview.checks.push({ name, ok, detail });
        return ok;
      };
      preview.system = info.system.match(/^PRETTY_NAME=["']?([^\r\n"']+)/m)?.[1] || 'Linux';
      check(
        '服务器架构',
        !!bundle,
        `${info.arch}${bundle ? ' · 内置包可用' : ' · 暂无经过验证的内置包，请勿使用其他架构文件'}`,
      );
      if (!bundle) return preview;
      check(
        '系统运行库',
        versionAtLeast(info.glibc, bundle.minGlibc),
        `${info.glibc}，需要 glibc ≥ ${bundle.minGlibc}`,
      );
      const needsUpgrade =
        !versionAtLeast(preview.currentVersion, bundle.version) ||
        (!preview.ssl && preview.currentVersion === bundle.version);
      check(
        '目标版本',
        needsUpgrade,
        needsUpgrade
          ? `${preview.currentVersion} → ${bundle.version}（含 SSL）`
          : '已经具备内置版本或更高版本，无需升级',
      );
      check(
        '程序写入权限',
        info.writable === 'yes',
        info.writable === 'yes'
          ? '可在程序目录建立备份并切换'
          : '请使用 root 连接，或启用免密 sudo',
      );
      const tree = parseNginx(info.dump).tree;
      check(
        '模块兼容性',
        /^nginx version: nginx\/\d+\.\d+\.\d+/m.test(info.version) &&
          !/--add-(?:dynamic-)?module|openresty|tengine/i.test(info.version) &&
          !tree.some((n) => n.words[0] === 'load_module'),
        '自动升级仅支持官方 Nginx，第三方或动态模块需人工适配',
      );
      const prefix = info.prefix;
      const declaredPid = tree.find((n) => n.words[0] === 'pid')?.words[1];
      const builtPid = info.version.match(/--pid-path=([^\s]+)/)?.[1] || 'logs/nginx.pid';
      const pidPath = path.posix.resolve(prefix, source.pidPath || declaredPid || builtPid);
      const newPid = path.posix.resolve(prefix, declaredPid || bundle.pid);
      check(
        'PID 路径兼容性',
        pidPath === newPid,
        pidPath === newPid
          ? pidPath
          : '新版默认 PID 位置不同；请先在主配置中明确设置 pid，再重新检测',
      );
      if (![info.binary, info.config, prefix, pidPath].every(safePath))
        throw Error('实际路径含特殊字符，暂不支持自动升级');
      const files = [...info.dump.matchAll(/^# configuration file (\/[^\r\n]+):$/gm)].map(
        (m) => m[1],
      );
      if (!files.length || files.some((f) => !safePath(f))) throw Error('无法可靠记录配置备份路径');
      const state = fields(
        await this.execute(
          sessionId,
          processScript(
            { binary: info.binary, config: info.config, prefix, pidPath },
            source.healthUrl,
          ),
          source.sudo,
        ),
      );
      preview.pid = Number(state.pid);
      const units = [
        ...new Set(
          [...state.cgroup.matchAll(/\/([A-Za-z0-9_.@-]+\.service)(?:\/|$)/gm)].map((m) => m[1]),
        ),
      ];
      const unit = units[0];
      let unitHash: string | undefined;
      preview.strategy = unit ? `重启系统服务 ${unit}（会短暂中断）` : '平滑切换（保留旧连接收尾）';
      if (unit && units.length === 1) {
        try {
          const service = fields(
            await this.execute(sessionId, serviceInspectionScript(unit, preview.pid), source.sudo),
          );
          unitHash = hash(service.unitConfig);
          check(
            '进程管理方式',
            !/^\s*(?:ExecStartPre|ExecStartPost|ExecStopPost)=\S+/m.test(service.unitConfig),
            preview.strategy + '；额外的启动 / 停止脚本需人工处理',
          );
        } catch (e) {
          check('进程管理方式', false, (e as Error).message);
        }
      } else check('进程管理方式', units.length === 0, preview.strategy);
      check(
        '唯一运行实例',
        state.masters === '1',
        state.masters === '1'
          ? '只有一个 master 使用此程序'
          : '多个 master 共用程序，请分别安排维护',
      );
      check(
        '当前服务响应',
        /^[23]\d\d$/.test(state.health),
        `${source.healthUrl} · HTTP ${state.health}`,
      );
      try {
        validateStartup(
          state.command,
          state.cwd,
          { binary: info.binary, config: info.config, prefix },
          info.version,
          bundle,
        );
        check('启动参数继承', true, '新版将继承当前 master 的运行目录与主配置');
      } catch (e) {
        check('启动参数继承', false, (e as Error).message);
      }
      const snapshot: NginxSnapshot = {
        binary: info.binary,
        config: info.config,
        prefix,
        pidPath,
        pid: preview.pid,
        start: state.start,
        commandHash: state.commandHash,
        binaryHash: info.binaryHash,
        configHash: hash(info.dump),
        files,
        unit,
        unitHash,
      };
      preview.backupPath = path.posix.join(
        path.posix.dirname(info.binary),
        '.elushell-nginx-' + preview.id,
      );
      preview.ready = preview.checks.every((c) => c.ok);
      if (preview.ready) {
        for (const [key, p] of this.plans)
          if (p.preview.expiresAt < Date.now() || p.sessionId === sessionId) this.plans.delete(key);
        while (this.plans.size >= 30) this.plans.delete(this.plans.keys().next().value!);
        this.plans.set(preview.id, { sessionId, source, snapshot, preview, bundle });
      }
      return preview;
    } finally {
      this.running.delete(sessionId);
    }
  }
  async start(sessionId: string, previewId: string) {
    const plan = this.plans.get(previewId);
    if (!plan || plan.sessionId !== sessionId || plan.preview.expiresAt < Date.now())
      throw Error('检测结果已过期，请重新检测');
    if (this.isRunning()) throw Error('已有检测或升级任务在运行');
    this.client(sessionId);
    this.plans.delete(previewId);
    this.running.add(sessionId);
    const job: NginxUpgradeJob = {
      id: randomUUID(),
      sessionId,
      state: 'running',
      percent: 0,
      stage: '校验内置包',
      output: '',
      backupPath: plan.preview.backupPath,
    };
    this.jobs = [job, ...this.jobs].slice(0, 20);
    this.emit({ ...job });
    void this.run(plan, job);
    return { ...job };
  }
  private async run(plan: Plan, job: NginxUpgradeJob) {
    let temp = '',
      started = false;
    const { sessionId, source, snapshot, bundle, preview } = plan;
    const output = (text: string) => {
      job.output = (job.output + text).slice(-64000);
      const stages = [...job.output.matchAll(/ELUSHELL_STAGE:(\d+):([^\n]+)\n/g)];
      const last = stages.at(-1);
      if (last) {
        job.percent = Number(last[1]);
        job.stage = last[2];
      }
      this.emit({ ...job });
    };
    try {
      const buffer = await readFile(path.join(this.resources, bundle.arch, 'nginx'));
      if (buffer.length !== bundle.bytes || hash(buffer) !== bundle.sha256)
        throw Error('本地内置包校验失败，请重新安装 EluShell');
      temp = (
        await this.execute(sessionId, 'umask 077; mktemp -d /tmp/elushell-nginx.XXXXXXXX', false)
      ).trim();
      if (!/^\/tmp\/elushell-nginx\.[A-Za-z0-9]+$/.test(temp)) throw Error('无法创建上传目录');
      job.stage = '上传离线升级包';
      this.emit({ ...job });
      const ftp = await this.sftp(sessionId);
      let uploadPercent = -1;
      await uploadNginxPackage(ftp, temp + '/nginx', buffer, (sent) => {
        const percent = Math.floor((sent / buffer.length) * 100);
        if (percent === uploadPercent) return;
        uploadPercent = percent;
        job.stage = `上传离线升级包 · ${percent}%`;
        this.emit({ ...job });
      });
      job.stage = '检查新版与现有配置兼容性';
      this.emit({ ...job });
      await this.execute(
        sessionId,
        prepareScript(preview.backupPath, temp + '/nginx', bundle.sha256, snapshot),
        source.sudo,
        45,
        output,
      );
      started = true;
      await this.execute(
        sessionId,
        upgradeScript(snapshot, preview.backupPath, bundle.sha256, source.healthUrl),
        source.sudo,
        150,
        output,
      );
      job.state = 'completed';
      job.percent = 100;
      job.stage = '升级完成';
    } catch (e) {
      const recovered = job.output.includes('ELUSHELL_ROLLBACK_OK');
      const unchanged = job.output.includes('ELUSHELL_NO_CHANGE');
      job.state = started && !recovered && !unchanged ? 'unknown' : 'failed';
      job.stage = recovered
        ? '切换失败，已恢复旧程序'
        : started && !unchanged
          ? '请核对服务器运行状态'
          : '检查未通过，尚未切换程序';
      job.error = String(e instanceof Error ? e.message : e)
        .split(/\r?\n/)
        .filter(
          (line) =>
            line.trim() &&
            !/^ELUSHELL_|^nginx: .*syntax is ok|^nginx: .*test is successful/.test(line),
        )
        .slice(0, 3)
        .join('\n')
        .slice(0, 1000);
    } finally {
      if (temp)
        await this.execute(
          sessionId,
          `rm -f -- ${quote(temp + '/nginx')}; rmdir -- ${quote(temp)}`,
          false,
        ).catch(() => {});
      this.running.delete(sessionId);
      this.emit({ ...job });
    }
  }
}

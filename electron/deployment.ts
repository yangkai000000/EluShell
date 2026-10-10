import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SFTPWrapper } from 'ssh2';
import type { ShellScriptLease } from './terminal-script';
import {
  DeploymentPlanSchema,
  deploymentRunning,
  type DeploymentPlan,
  type DeploymentJob,
} from '../src/deployment-shared';
import { quote, type Profile } from '../src/shared';
import type { ConfigStore } from './config-store';
import type { RemoteFiles } from './remote-files';

const OUTPUT_LIMIT = 128000;
type Running = {
  job: DeploymentJob;
  controller: AbortController;
  task: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  emitTimer?: ReturnType<typeof setTimeout>;
};
export class DeploymentService {
  private plans: DeploymentPlan[] = [];
  private jobs: DeploymentJob[] = [];
  private running = new Map<string, Running>();
  private ready?: Promise<void>;
  private queue = Promise.resolve();
  constructor(
    private store: ConfigStore,
    private session: (id: string) => { profile: Profile },
    private ftp: (id: string) => Promise<SFTPWrapper>,
    private files: RemoteFiles,
    private emit: (job: DeploymentJob) => void,
    private acquireShell: (id: string) => Promise<ShellScriptLease>,
    private plansChanged: (plans: DeploymentPlan[]) => void = () => {},
  ) {}
  private initialize() {
    return (this.ready ??= this.store.read<unknown>('deployments.json', []).then(async (data) => {
      const plans = DeploymentPlanSchema.array().max(500).parse(data);
      if (Array.isArray(data) && data.some((p) => p && typeof p === 'object' && 'profileId' in p)) {
        // Preserve every legacy plan; discard only its obsolete server association.
        await this.store.write('deployments.pre-shared.json', data);
        await this.store.write('deployments.json', plans);
      }
      this.plans = plans;
    }));
  }
  async state(profileId: string) {
    await this.initialize();
    return {
      plans: this.plans.map((p) => ({ ...p })),
      jobs: this.jobs.filter((j) => j.profileId === profileId),
    };
  }
  save(value: unknown) {
    const next = this.queue
      .catch(() => {})
      .then(async () => {
        await this.initialize();
        const plan = DeploymentPlanSchema.parse(value);
        const plans = [plan, ...this.plans.filter((p) => p.id !== plan.id)];
        if (plans.length > 500) throw Error('最多保存 500 个部署方案');
        await this.store.write('deployments.json', plans);
        this.plans = plans;
        this.plansChanged(plans.map((p) => ({ ...p })));
        return plan;
      });
    this.queue = next.then(() => {});
    return next;
  }
  remove(id: string) {
    const next = this.queue
      .catch(() => {})
      .then(async () => {
        await this.initialize();
        if ([...this.running.values()].some((r) => r.job.planId === id))
          throw Error('方案正在执行');
        const plans = this.plans.filter((p) => p.id !== id);
        await this.store.write('deployments.json', plans);
        this.plans = plans;
        this.plansChanged(plans.map((p) => ({ ...p })));
      });
    this.queue = next;
    return next;
  }
  async start(sessionId: string, planId: string) {
    await this.initialize();
    const session = this.session(sessionId);
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) throw Error('找不到此部署方案，可能已被删除');
    if (
      [...this.running.values()].some(
        (r) =>
          r.job.profileId === session.profile.id ||
          r.job.host ===
            `${session.profile.username}@${session.profile.host}:${session.profile.port}`,
      )
    )
      throw Error('此服务器已有部署任务，请等待完成');
    const job: DeploymentJob = {
      id: randomUUID(),
      sessionId,
      profileId: session.profile.id,
      planId,
      name: plan.name,
      host: `${session.profile.username}@${session.profile.host}:${session.profile.port}`,
      state: 'preparing',
      started: Date.now(),
      output: '',
      target: path.posix.join(plan.remoteDirectory, path.basename(plan.localPath)),
    };
    const run: Running = { job, controller: new AbortController(), task: Promise.resolve() };
    this.running.set(job.id, run);
    this.jobs = [job, ...this.jobs].slice(0, 30);
    this.publish(run);
    run.timer = setTimeout(
      () => run.controller.abort(Error(`部署超过 ${plan.timeoutMinutes} 分钟，已停止等待`)),
      plan.timeoutMinutes * 60000,
    );
    run.task = this.execute(run, { ...plan })
      .catch((error) => {
        job.state = run.controller.signal.aborted ? 'stopped' : 'failed';
        job.error = String(error instanceof Error ? error.message : error);
        this.output(run, `\n${job.error}\n`);
      })
      .finally(() => {
        clearTimeout(run.timer);
        clearTimeout(run.emitTimer);
        job.finished = Date.now();
        this.running.delete(job.id);
        this.publish(run);
      });
    return { ...job };
  }
  private publish(run: Running) {
    this.emit({ ...run.job });
  }
  private output(run: Running, text: string) {
    run.job.output = (run.job.output + text).slice(-OUTPUT_LIMIT);
    if (!run.emitTimer)
      run.emitTimer = setTimeout(() => {
        run.emitTimer = undefined;
        this.publish(run);
      }, 100);
  }
  private async execute(run: Running, plan: DeploymentPlan) {
    const shell = await this.acquireShell(run.job.sessionId);
    try {
      await this.executeInShell(run, plan, shell);
    } finally {
      shell.release();
    }
  }
  private async executeInShell(run: Running, plan: DeploymentPlan, shell: ShellScriptLease) {
    const { job, controller } = run,
      signal = controller.signal;
    if (!path.isAbsolute(plan.localPath)) throw Error('请选择本地文件或目录的完整路径');
    const local = await lstat(plan.localPath);
    if (local.isSymbolicLink() || (!local.isFile() && !local.isDirectory()))
      throw Error('只支持普通文件和目录');
    signal.throwIfAborted();
    this.output(run, `准备上传 ${plan.localPath}\n目标 ${job.host}:${job.target}\n`);
    const ftp = await this.ftp(job.sessionId);
    let directory = '';
    for (const part of path.posix.normalize(plan.remoteDirectory).split('/').filter(Boolean)) {
      signal.throwIfAborted();
      directory += '/' + part;
      try {
        const st = await new Promise<import('ssh2').Stats>((resolve, reject) =>
          ftp.lstat(directory, (e, st) => (e ? reject(e) : resolve(st))),
        );
        if (!st.isDirectory() || st.isSymbolicLink())
          throw Error('上传目录不是普通目录：' + directory);
      } catch (error) {
        if ((error as { code?: number }).code !== 2) throw error;
        await new Promise<void>((resolve, reject) =>
          ftp.mkdir(directory, (e) =>
            e
              ? reject(Error(`无法创建 ${directory}，请检查当前账户权限：${e.message}`))
              : resolve(),
          ),
        );
      }
    }
    signal.throwIfAborted();
    job.state = 'uploading';
    this.publish(run);
    await this.files.upload(
      job.sessionId,
      plan.localPath,
      plan.remoteDirectory,
      async () => true,
      signal,
    );
    signal.throwIfAborted();
    this.output(run, '\n上传成功，开始执行部署命令\n');
    job.state = 'executing';
    this.publish(run);
    const script = `set -e\nexport ELUSHELL_UPLOAD_DIR=${quote(path.posix.normalize(plan.remoteDirectory))}\nexport ELUSHELL_UPLOAD_PATH=${quote(job.target)}\n${plan.commands.replace(/\r\n?/g, '\n')}\n`;
    job.exitCode = await shell.run(script, ftp, (text) => this.output(run, text), signal);
    signal.throwIfAborted();
    if (job.exitCode !== 0) throw Error(`部署命令失败，退出码 ${job.exitCode}`);
    job.state = 'completed';
    this.output(run, '\n部署完成（命令退出码 0）\n');
  }
  async stop(id: string) {
    const run = this.running.get(id);
    if (run) {
      run.controller.abort(Error('任务已停止'));
      await run.task;
    }
  }
  hasSession(id: string) {
    return [...this.running.values()].some((r) => r.job.sessionId === id);
  }
  isRunning() {
    return this.jobs.some(deploymentRunning);
  }
  async close() {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
    await this.queue.catch(() => {});
  }
}

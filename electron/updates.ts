import type { ConfigStore } from './config-store';
import {
  UpdateConfigSchema,
  normalizeUpdatePreferences,
  type UpdateConfig,
  type UpdateStatus,
} from '../src/update-shared';

export interface UpdateDriver {
  on(event: string, fn: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<{
    isUpdateAvailable?: boolean;
    updateInfo: { version: string; releaseNotes?: unknown };
    cancellationToken?: { cancel(): void };
  } | null>;
  downloadUpdate(token?: any): Promise<string[]>;
  quitAndInstall(silent?: boolean, forceRun?: boolean): void;
  stopRequests?(): void;
}
export class UpdateService {
  private config = UpdateConfigSchema.parse({});
  private state: UpdateStatus;
  private driver?: UpdateDriver;
  private token?: { cancel(): void };
  private running = false;
  private epoch = 0;
  constructor(
    private store: Pick<ConfigStore, 'read' | 'write'>,
    currentVersion: string,
    supported: boolean,
    private factory: (url: string) => Promise<UpdateDriver>,
    private emit: (state: UpdateStatus) => void,
    private now = Date.now,
    private timeoutMs = 10000,
  ) {
    this.state = {
      currentVersion,
      supported,
      config: this.config,
      phase: 'disabled',
      prompt: false,
    };
  }
  async initialize() {
    this.config = UpdateConfigSchema.parse(await this.store.read('updates.json', {}));
    if (
      /^http:\/\/118\.190\.211\.218:8800\/elushell-updates\/windows\/x64\/?$/.test(this.config.url)
    ) {
      this.config.url = 'http://47.105.176.1:8800/elushell-updates/windows/x64/';
      this.config.lastChecked = 0;
      await this.persist();
    }
    normalizeUpdatePreferences(this.config);
    this.state.phase = this.config.url ? 'idle' : 'disabled';
    return this.status();
  }
  status(): UpdateStatus {
    return { ...this.state, config: { ...this.config } };
  }
  private publish(patch: Partial<UpdateStatus>) {
    Object.assign(this.state, patch);
    this.emit(this.status());
  }
  private persist() {
    return this.store.write('updates.json', { ...this.config });
  }
  async configure(value: unknown) {
    if (this.running) throw Error('请等待检查完成或取消下载后修改更新地址');
    const preferences = normalizeUpdatePreferences(value);
    const changed =
      preferences.url !== this.config.url || preferences.allowHttp !== this.config.allowHttp;
    const next = {
      ...this.config,
      ...preferences,
      ...(changed ? { ignoredVersion: '', deferredUntil: 0, lastChecked: 0 } : {}),
    };
    await this.store.write('updates.json', next);
    this.config = next;
    if (changed) {
      this.epoch++;
      this.driver = undefined;
      this.token = undefined;
      this.publish({
        phase: next.url ? 'idle' : 'disabled',
        prompt: false,
        version: undefined,
        notes: undefined,
        error: undefined,
        percent: undefined,
      });
    } else this.publish({});
    return this.status();
  }
  private async getDriver() {
    if (this.driver) return this.driver;
    const driver = await this.factory(this.config.url),
      epoch = this.epoch;
    driver.on('error', (error) => {
      // Check/download promises surface their own errors. Installer launch errors
      // arrive as events and must restore a usable retry button if the app remains open.
      if (epoch === this.epoch && this.state.phase === 'installing') this.installFailed(error);
    });
    driver.on('download-progress', (p) => {
      if (epoch === this.epoch && this.state.phase === 'downloading')
        this.publish({ percent: Math.max(0, Math.min(100, Number(p.percent) || 0)) });
    });
    this.driver = driver;
    return driver;
  }
  async check(manual = false) {
    if (this.running || ['downloading', 'ready'].includes(this.state.phase)) return this.status();
    if (!this.config.url || !this.state.supported) return this.status();
    if (!manual && (!this.config.autoCheck || this.config.deferredUntil > this.now()))
      return this.status();
    this.running = true;
    this.publish({ phase: 'checking', prompt: false, error: undefined, percent: undefined });
    try {
      const driver = await this.getDriver();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        driver.checkForUpdates(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            driver.stopRequests?.();
            reject(Error('连接更新服务器超时，请稍后重试'));
          }, this.timeoutMs);
        }),
      ]).finally(() => clearTimeout(timer));
      this.config.lastChecked = this.now();
      await this.persist();
      // electron-updater emits availability only for a newer supported version.
      if (!result?.isUpdateAvailable) {
        this.publish({ phase: 'current', version: undefined, notes: undefined });
      } else {
        this.token = result.cancellationToken;
        const notes = result.updateInfo.releaseNotes;
        const text =
          typeof notes === 'string'
            ? notes
            : Array.isArray(notes)
              ? notes.map((n) => (typeof n?.note === 'string' ? n.note : '')).join('\n')
              : '';
        this.publish({
          phase: 'available',
          version: result.updateInfo.version,
          notes: text.slice(0, 16000),
          prompt: manual || result.updateInfo.version !== this.config.ignoredVersion,
        });
      }
    } catch (error) {
      this.epoch++;
      this.driver = undefined;
      this.publish({
        phase: 'error',
        prompt: false,
        error: '检查更新失败：' + (error as Error).message.slice(0, 600),
      });
    } finally {
      this.running = false;
    }
    return this.status();
  }
  async download() {
    if (this.running) return this.status();
    if (this.state.phase !== 'available' || !this.driver) throw Error('请先检查并选择可用版本');
    this.running = true;
    this.publish({ phase: 'downloading', percent: 0, prompt: true, error: undefined });
    try {
      const files = await this.driver.downloadUpdate(this.token);
      if (!files.length) throw Error('没有得到完整的安装包');
      this.publish({ phase: 'ready', percent: 100, prompt: true });
    } catch (error) {
      this.publish({
        phase: 'error',
        error: '更新下载未完成：' + (error as Error).message.slice(0, 600),
        prompt: true,
      });
    } finally {
      this.running = false;
    }
    return this.status();
  }
  cancel() {
    this.token?.cancel();
  }
  async dismiss(ignore: boolean) {
    if (this.state.phase === 'installing') return this.status();
    if (ignore && this.state.phase !== 'available') throw Error('只能忽略尚未下载的版本');
    if (ignore) this.config.ignoredVersion = this.state.version || '';
    this.config.deferredUntil = ignore ? 0 : this.now() + 24 * 60 * 60 * 1000;
    await this.persist();
    this.publish({ prompt: false });
    return this.status();
  }
  private installFailed(error: unknown) {
    this.running = false;
    this.publish({
      phase: 'ready',
      installStep: undefined,
      prompt: true,
      error:
        '无法启动安装：' + (error instanceof Error ? error.message : String(error)).slice(0, 600),
    });
  }
  async install(prepare: () => Promise<boolean> = async () => true) {
    if (this.state.phase === 'installing') return false;
    if (this.state.phase !== 'ready' || !this.driver) throw Error('安装包尚未下载完成');
    this.running = true;
    this.publish({ phase: 'installing', installStep: 'preparing', prompt: true, error: undefined });
    try {
      if (!(await prepare())) {
        this.running = false;
        this.publish({ phase: 'ready', installStep: undefined });
        return false;
      }
      this.publish({ installStep: 'launching' });
      // Let the renderer paint the handoff message before the updater closes it.
      await new Promise((resolve) => setTimeout(resolve, 150));
      this.driver.quitAndInstall(false, true);
      return this.status().phase === 'installing';
    } catch (error) {
      this.installFailed(error);
      return false;
    }
  }
}

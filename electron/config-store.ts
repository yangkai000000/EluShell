import { mkdir, readFile, writeFile, unlink, copyFile } from 'node:fs/promises';
import { atomicReplace } from './atomic-replace';
import { migrateCommands } from '../src/commands';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { SettingsSchema, defaults, type Profile, type Settings } from '../src/shared';
import { ConnectionBundleSchema, exportConnectionBundle, mergeConnectionBundle } from '../src/connection-sharing';
type Cipher = {
  isEncryptionAvailable: () => boolean;
  encryptString: (s: string) => Buffer;
  decryptString: (b: Buffer) => string;
};
const binding = (p: Profile) =>
  createHash('sha256')
    .update(JSON.stringify([p.host, p.port, p.username, p.auth, p.privateKeyPath || '']))
    .digest('hex');
type Vault = Record<string, { binding: string; encrypted: string }>;
export class ConfigStore {
  private queue = Promise.resolve();
  constructor(
    readonly directory: string,
    private cipher: Cipher,
  ) {}
  async initialize(legacy?: string) {
    await mkdir(this.directory, { recursive: true });
    if (legacy && path.resolve(legacy) !== path.resolve(this.directory)) {
      for (const name of ['settings.json', 'known-hosts.json', 'downloads.json'])
        try {
          await copyFile(path.join(legacy, name), path.join(this.directory, name), 1);
        } catch (e) {
          if (!['ENOENT', 'EEXIST'].includes((e as NodeJS.ErrnoException).code || '')) throw e;
        }
    }
    const existing = await this.read<unknown>('settings.json', null);
    const settings = this.normalizeSettings(existing ?? defaults);
    // Existing, current configuration needs no disk replacement on startup.
    if (JSON.stringify(existing) !== JSON.stringify(settings))
      await this.write('settings.json', settings);
    return settings;
  }
  async read<T>(name: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(path.join(this.directory, name), 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw e;
    }
  }
  private async put(name: string, data: unknown) {
    const target = path.join(this.directory, name),
      temp = target + '.' + randomUUID() + '.tmp';
    await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    try {
      await atomicReplace(temp, target);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }
  write(name: string, data: unknown) {
    const task = this.queue.catch(() => {}).then(() => this.put(name, data));
    this.queue = task;
    return task;
  }
  async loadSettings(): Promise<Settings> {
    return this.normalizeSettings(await this.read('settings.json', defaults));
  }
  private normalizeSettings(value: unknown): Settings {
    const s = SettingsSchema.parse(value);
    s.profiles = s.profiles.filter((p) => !p.demo && p.id !== 'demo');
    delete s.history.demo;
    for (const p of s.profiles) {
      if (!p.folderId && p.group) {
        let f = s.folders.find((f) => f.name === p.group && !f.parentId);
        if (!f) {
          f = { id: randomUUID(), name: p.group };
          s.folders.push(f);
        }
        p.folderId = f.id;
      }
      delete p.demo;
    }
    return migrateCommands(s);
  }
  async credentialStatus(p: Profile) {
    const v = await this.read<Vault>('credentials.json', {});
    return v[p.id]?.binding === binding(p);
  }
  async secret(p: Profile) {
    const v = await this.read<Vault>('credentials.json', {}),
      entry = v[p.id];
    if (!entry || entry.binding !== binding(p)) return '';
    if (!this.cipher.isEncryptionAvailable()) throw Error('系统加密服务不可用，无法读取已保存密码');
    try {
      return this.cipher.decryptString(Buffer.from(entry.encrypted, 'base64'));
    } catch {
      throw Error('无法解密此密码，请在当前系统用户下重新输入并保存');
    }
  }
  saveCredential(p: Profile, secret: string, remember: boolean) {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        const v = await this.read<Vault>('credentials.json', {});
        if (!remember || p.auth === 'agent') delete v[p.id];
        else if (secret) {
          if (!this.cipher.isEncryptionAvailable()) throw Error('系统加密服务不可用，未保存密码');
          v[p.id] = {
            binding: binding(p),
            encrypted: this.cipher.encryptString(secret).toString('base64'),
          };
        } else if (v[p.id]?.binding !== binding(p)) delete v[p.id];
        await this.put('credentials.json', v);
      });
    this.queue = task;
    return task;
  }
  async exportConnections(settings: Settings, includePasswords = true) {
    await this.flush();
    if (!includePasswords) return exportConnectionBundle(settings);
    const credentials: { profileId: string; password: string }[] = [];
    for (const p of settings.profiles) {
      if (p.auth !== 'password') continue;
      const password = await this.secret(p);
      if (password) credentials.push({ profileId: p.id, password });
    }
    return exportConnectionBundle(settings, credentials);
  }
  importConnections(settings: Settings, input: unknown) {
    const task = this.queue.catch(() => {}).then(async () => {
      const bundle = ConnectionBundleSchema.parse(input);
      const result = mergeConnectionBundle(settings, bundle);
      if (!result.added && !result.foldersAdded) return result;
      const previous = await this.read<Vault>('credentials.json', {});
      const next = { ...previous };
      // Encrypt everything before changing either local file. Never persist the import bundle.
      for (const { sourceId, targetId } of result.importedIds) {
        const credential = bundle.credentials?.find((c) => c.profileId === sourceId);
        if (!credential) continue;
        if (!this.cipher.isEncryptionAvailable()) throw Error('系统加密服务不可用，未导入连接和密码');
        const profile = result.settings.profiles.find((p) => p.id === targetId)!;
        next[targetId] = {
          binding: binding(profile),
          encrypted: this.cipher.encryptString(credential.password).toString('base64'),
        };
      }
      await this.put('settings.pre-import-' + Date.now() + '.json', await this.loadSettings());
      const changed = result.passwordsAdded > 0;
      if (changed) await this.put('credentials.json', next);
      try {
        await this.put('settings.json', result.settings);
      } catch (error) {
        if (changed) await this.put('credentials.json', previous);
        throw error;
      }
      return result;
    });
    this.queue = task.then(() => {}, () => {});
    return task;
  }
  flush() {
    return this.queue;
  }
}

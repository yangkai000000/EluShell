import { it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigStore } from '../electron/config-store';
import { defaults, emptyProfile } from '../src/shared';

const cipher = (key: number) => ({
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from([...Buffer.from(s)].map((n) => n ^ key)),
  decryptString: (b: Buffer) => Buffer.from([...b].map((n) => n ^ key)).toString(),
});
const profile = { ...emptyProfile, id: 'source', name: 'Shared', host: 'server.example', username: 'deploy' };
it('shares saved passwords across local vaults and preserves duplicate credentials and personal data', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'elushell-sharing-'));
  try {
    const source = new ConfigStore(path.join(base, 'source'), cipher(31));
    const recipient = new ConfigStore(path.join(base, 'recipient'), cipher(72));
    await source.initialize(); await recipient.initialize();
    await source.saveCredential(profile, 'shared-秘密-$\\password', true);
    const s = { ...defaults, profiles: [profile] };
    const exported = await source.exportConnections(s);
    expect(exported.credentials).toEqual([{ profileId: 'source', password: 'shared-秘密-$\\password' }]);
    const local = { ...defaults, history: { local: ['pwd'] } };
    const result = await recipient.importConnections(local, exported);
    const imported = result.settings.profiles[0];
    expect(imported.id).not.toBe(profile.id);
    expect(await recipient.secret(imported)).toBe(exported.credentials![0].password);
    expect((await recipient.loadSettings()).history.local).toEqual(['pwd']);
    for (const file of ['credentials.json', 'settings.json'])
      expect(await readFile(path.join(base, 'recipient', file), 'utf8')).not.toContain('shared-秘密');
    expect(await readFile(path.join(base, 'recipient', 'credentials.json'), 'utf8'))
      .not.toContain(JSON.parse(await readFile(path.join(base, 'source', 'credentials.json'), 'utf8')).source.encrypted);
    await recipient.saveCredential(imported, 'recipients-new-password', true);
    const duplicate = await recipient.importConnections(result.settings, exported);
    expect(duplicate.passwordsAdded).toBe(0);
    expect(await recipient.secret(imported)).toBe('recipients-new-password');
    expect((await source.exportConnections(s, false)).credentials).toBeUndefined();
    expect((await source.exportConnections({ ...s, profiles: [{ ...profile, host: 'changed.example' }] })).credentials).toEqual([]);
    const key = { ...profile, auth: 'key' as const, privateKeyPath: '/private/id_ed25519' };
    await source.saveCredential(key, 'key-passphrase', true);
    const keyExport = await source.exportConnections({ ...s, profiles: [key] });
    expect(keyExport.credentials).toEqual([]);
    expect(keyExport.profiles[0].privateKeyPath).toBeUndefined();
  } finally {
    if (!path.resolve(base).startsWith(path.resolve(tmpdir()) + path.sep + 'elushell-sharing-')) throw Error('Unexpected cleanup');
    await rm(base, { recursive: true, force: true });
  }
});
it('aborts encrypted import on cipher failure and rolls back the vault when settings cannot be saved', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'elushell-sharing-'));
  try {
    const encryption = cipher(19);
    const store = new ConfigStore(base, encryption);
    await store.initialize();
    await store.saveCredential(profile, 'existing', true);
    const before = await readFile(path.join(base, 'credentials.json'), 'utf8');
    const bundle = { version: 2, profiles: [profile], folders: [], credentials: [{ profileId: profile.id, password: 'shared' }] };
    vi.spyOn(encryption, 'isEncryptionAvailable').mockReturnValue(false);
    await expect(store.importConnections(defaults, bundle)).rejects.toThrow('未导入');
    expect((await store.loadSettings()).profiles).toEqual([]);
    expect(await readFile(path.join(base, 'credentials.json'), 'utf8')).toBe(before);
    vi.restoreAllMocks();
    // Inject a failure at the second file's commit, after the vault has been written.
    const internal = store as unknown as { put: (name: string, value: unknown) => Promise<void> };
    const put = internal.put.bind(store);
    vi.spyOn(internal, 'put').mockImplementation((name, value) => name === 'settings.json' ? Promise.reject(Error('fixture disk failure')) : put(name, value));
    await expect(store.importConnections(defaults, bundle)).rejects.toThrow('fixture disk failure');
    expect(await readFile(path.join(base, 'credentials.json'), 'utf8')).toBe(before);
    expect((await store.loadSettings()).profiles).toEqual([]);
    vi.restoreAllMocks();
    // Old bundles still import when OS credential encryption is unavailable.
    vi.spyOn(encryption, 'isEncryptionAvailable').mockReturnValue(false);
    expect((await store.importConnections(defaults, { version: 1, profiles: [profile] })).added).toBe(1);
  } finally {
    vi.restoreAllMocks();
    if (!path.resolve(base).startsWith(path.resolve(tmpdir()) + path.sep + 'elushell-sharing-')) throw Error('Unexpected cleanup');
    await rm(base, { recursive: true, force: true });
  }
});

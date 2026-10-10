import { it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigStore } from '../electron/config-store';
import { defaults, emptyProfile, SettingsSchema } from '../src/shared';
import { parseProcesses, terminateCommand, identityCommand } from '../electron/processes';
import { sortProcesses } from '../src/ProcessManager';
it('migrates groups to folders without overwriting existing configuration and binds encrypted credentials to endpoints', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'elushell-config-'));
  const legacy = path.join(base, 'old'),
    root = path.join(base, '.EluShell');
  await mkdir(legacy);
  const p = {
    ...emptyProfile,
    id: 'fixture',
    name: 'server',
    username: 'test',
    host: '127.0.0.1',
    group: '生产环境',
  };
  const cipher = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from([...Buffer.from(s)].map((n) => n ^ 91)),
    decryptString: (b: Buffer) => Buffer.from([...b].map((n) => n ^ 91)).toString(),
  };
  try {
    await writeFile(
      path.join(legacy, 'settings.json'),
      JSON.stringify({
        ...defaults,
        profiles: [p, { ...p, id: 'demo', demo: true }],
        history: { demo: ['pwd'] },
      }),
    );
    const store = new ConfigStore(root, cipher);
    await store.initialize(legacy);
    let s = await store.loadSettings();
    expect(s.profiles).toHaveLength(1);
    expect(s.folders[0].name).toBe('生产环境');
    expect(s.profiles[0].folderId).toBe(s.folders[0].id);
    expect(s.history.demo).toBeUndefined();
    await store.saveCredential(p, 'fixture-private-password', true);
    expect(await readFile(path.join(root, 'credentials.json'), 'utf8')).not.toContain(
      'fixture-private-password',
    );
    expect(await store.secret(p)).toBe('fixture-private-password');
    expect(await store.secret({ ...p, host: 'another-host' })).toBe('');
    await store.saveCredential(p, '', true);
    expect(await store.secret(p)).toBe('fixture-private-password');
    await store.write('settings.json', { ...s, pollSeconds: 10 });
    const reopened = new ConfigStore(root, cipher);
    const startupWrites = vi.spyOn(reopened, 'write');
    await reopened.initialize(legacy);
    expect(startupWrites).not.toHaveBeenCalled();
    expect((await reopened.loadSettings()).pollSeconds).toBe(10);
    expect(await reopened.secret(p)).toBe('fixture-private-password');
    await reopened.saveCredential(p, '', false);
    expect(await reopened.credentialStatus(p)).toBe(false);
    const unavailable = new ConfigStore(root, { ...cipher, isEncryptionAvailable: () => false });
    await expect(unavailable.saveCredential(p, 'never-plaintext', true)).rejects.toThrow(
      '未保存密码',
    );
    expect(await readFile(path.join(root, 'credentials.json'), 'utf8')).not.toContain(
      'never-plaintext',
    );
  } finally {
    if (!path.resolve(base).startsWith(path.resolve(tmpdir()) + path.sep + 'elushell-config-'))
      throw Error('Unexpected cleanup');
    await rm(base, { recursive: true, force: true });
  }
});
it('rejects folder cycles and missing folder references', () => {
  expect(
    SettingsSchema.safeParse({
      ...defaults,
      folders: [
        { id: 'a', name: 'A', parentId: 'b' },
        { id: 'b', name: 'B', parentId: 'a' },
      ],
    }).success,
  ).toBe(false);
  expect(
    SettingsSchema.safeParse({
      ...defaults,
      profiles: [
        {
          ...emptyProfile,
          id: 'a',
          name: 'A',
          host: 'localhost',
          username: 'u',
          folderId: 'missing',
        },
      ],
    }).success,
  ).toBe(false);
});
it('parses full process fields and sorts numerically in both directions', () => {
  const rows = parseProcesses(
    '42\tu\t9.1\t1024\tS\tjava\t900\t/usr/bin/java\t/srv/app\t\tjava -jar service.jar\n7\troot\t80\t64\tR\tsshd\t800\t/usr/sbin/sshd\t/\t\tsshd: u\ninvalid',
  );
  expect(rows).toHaveLength(2);
  expect(rows[0].memory).toBe(1048576);
  expect(rows[0].command).toBe('java -jar service.jar');
  expect(sortProcesses(rows, 'pid', false).map((p) => p.pid)).toEqual([7, 42]);
  expect(sortProcesses(rows, 'cpu', true).map((p) => p.pid)).toEqual([7, 42]);
  expect(sortProcesses(rows, 'name', false)[0].name).toBe('java');
});
it('requires numeric PID and start time and uses graceful signal with identity validation', () => {
  expect(() => terminateCommand(1, '123')).toThrow();
  expect(() => identityCommand(-9)).toThrow();
  expect(() => terminateCommand(42, "1'; rm -rf /")).toThrow();
  expect(terminateCommand(42, '123')).toContain('[ "$t" = \'123\' ]');
  expect(terminateCommand(42, '123')).toContain('kill -TERM 42');
});

import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error Isolated test-only SSH fixture.
import { fixture } from '../scripts/sftp-fixture.mjs';
import { SSHService } from '../electron/ssh';
import { RemoteFiles } from '../electron/remote-files';
import { TransferManager } from '../electron/transfers';
import { demoProfile } from './profile';

it('batch delete and chmod preserve failed items, validate before changes, and handle recursive selections once', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'elushell-batch-'));
  await mkdir(path.join(root, 'folder'));
  for (const file of ['a.log', 'b.log', 'keep.log', 'folder/child'])
    await writeFile(path.join(root, file), file);
  const modes: { p: string; mode: number }[] = [];
  const server = await fixture(root, {
    chmod: (p: string, mode: number) => modes.push({ p, mode }),
    sftpRequest: (kind: string, p: string) => {
      if ((kind === 'REMOVE' || kind === 'SETSTAT') && p === '/keep.log')
        throw Object.assign(Error('Permission denied'), { code: 'EACCES' });
    },
  });
  const ssh = new SSHService(
    () => {},
    async () => true,
  );
  const remote = new RemoteFiles((id) => ssh.sftp(id), new TransferManager(() => {}));
  try {
    const id = await ssh.connect({ ...demoProfile, host: '127.0.0.1', port: server.port }, '');
    await expect(remote.actions(id, { kind: 'delete', paths: ['/a.log', '/'] })).rejects.toThrow(
      '根目录',
    );
    expect(await readFile(path.join(root, 'a.log'), 'utf8')).toBe('a.log');
    await expect(
      remote.actions(id, { kind: 'chmod', paths: ['/a.log'], mode: 0o10000 }),
    ).rejects.toThrow('无效权限');
    const chmod = await remote.actions(id, {
      kind: 'chmod',
      paths: ['/a.log', '/folder', '/keep.log'],
      mode: 0o750,
    });
    expect(chmod.completed).toEqual(['/a.log', '/folder']);
    expect(chmod.failed).toEqual([{ path: '/keep.log', error: 'Permission denied' }]);
    expect(modes.map((m) => m.p)).toEqual(['/a.log', '/folder']);
    modes.length = 0;
    await remote.actions(id, {
      kind: 'chmod',
      paths: ['/folder', '/folder/child'],
      mode: 0o700,
      recursive: true,
    });
    expect(modes).toEqual([
      { p: '/folder', mode: 0o700 },
      { p: '/folder/child', mode: 0o700 },
    ]);
    const removed = await remote.actions(id, {
      kind: 'delete',
      paths: ['/folder', '/folder/child', '/a.log', '/a.log', '/keep.log', '/b.log'],
    });
    expect(removed.completed).toEqual(['/folder', '/a.log', '/b.log']);
    expect(removed.failed).toEqual([{ path: '/keep.log', error: 'Permission denied' }]);
    expect(await readdir(root)).toEqual(['keep.log']);
  } finally {
    ssh.close();
    await server.close();
  }
}, 30000);

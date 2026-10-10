import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error Test-only JavaScript SSH fixture.
import { fixture } from '../scripts/sftp-fixture.mjs';
import { SSHService } from '../electron/ssh';
import { RemoteFiles } from '../electron/remote-files';
import { TransferManager } from '../electron/transfers';
import { demoProfile } from './profile';

it('moves exact selected files and directories over SFTP without replacing conflicts or deleting failed sources', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'elushell-move-'));
  const moves: string[] = [];
  let deny = '';
  for (const p of ['source/nested/child', 'dest', 'other'])
    await mkdir(path.join(root, p), { recursive: true });
  for (const [p, content] of [
    ['source/一.log', 'one'],
    ["source/team's log.txt", 'two'],
    ['source/nested/child/data', 'nested'],
    ['source/keep.log', 'keep'],
  ])
    await writeFile(path.join(root, p), content);
  const server = await fixture(root, {
    sftpRequest: (kind: string, source: string) => {
      if (kind === 'RENAME') {
        moves.push(source);
        if (source === deny)
          throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
      }
    },
  });
  const ssh = new SSHService(
    () => {},
    async () => true,
  );
  const remote = new RemoteFiles((id) => ssh.sftp(id), new TransferManager(() => {}));
  try {
    const id = await ssh.connect({ ...demoProfile, host: '127.0.0.1', port: server.port }, '');
    ssh.start(id);
    await expect(remote.moveMany(id, ['/source/nested'], '/source/nested/child')).rejects.toThrow(
      '子目录',
    );
    await expect(remote.moveMany(id, ['/source/nested'], '/source/nested')).rejects.toThrow('自身');
    await expect(remote.moveMany(id, ['/source/一.log'], '/source')).rejects.toThrow('已在');
    await expect(remote.moveMany(id, ['/'], '/dest')).rejects.toThrow('根目录');
    await expect(
      remote.moveMany(id, ['/source/nested', '/source/nested/child'], '/dest'),
    ).rejects.toThrow('子项目');
    await expect(remote.moveMany(id, ['/source/一.log', '/missing'], '/dest')).rejects.toThrow();
    await writeFile(path.join(root, 'dest', '一.log'), 'existing');
    await expect(
      remote.moveMany(id, ['/source/nested', '/source/一.log'], '/dest'),
    ).rejects.toThrow('同名');
    expect(moves).toEqual([]);
    expect(await readFile(path.join(root, 'dest', '一.log'), 'utf8')).toBe('existing');
    expect(await readdir(path.join(root, 'source'))).toContain('nested');
    await expect(remote.moveMany(id, ['/source/nested'], '/source/一.log')).rejects.toThrow(
      '不是文件夹',
    );
    const result = await remote.moveMany(
      id,
      ['/source/nested', "/source/team's log.txt", '/source/nested'],
      '/dest',
    );
    expect(result).toEqual({ moved: ['/source/nested', "/source/team's log.txt"], failed: [] });
    expect(await readFile(path.join(root, 'dest/nested/child/data'), 'utf8')).toBe('nested');
    expect(await readFile(path.join(root, "dest/team's log.txt"), 'utf8')).toBe('two');
    expect(await readdir(path.join(root, 'source'))).toEqual(['keep.log', '一.log']);
    deny = '/source/一.log';
    const partial = await remote.moveMany(id, ['/source/一.log', '/source/keep.log'], '/other');
    expect(partial.moved).toEqual(['/source/keep.log']);
    expect(partial.failed).toEqual([{ path: '/source/一.log', error: 'Permission denied' }]);
    expect(await readFile(path.join(root, 'source/一.log'), 'utf8')).toBe('one');
    expect(await readFile(path.join(root, 'other/keep.log'), 'utf8')).toBe('keep');
  } finally {
    ssh.close();
    await server.close();
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep + 'elushell-move-'))
      throw Error('Unexpected cleanup target');
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it('rejects a target alias pointing inside the moved directory before rename', async () => {
  let renamed = false;
  const ftp = {
    realpath: (p: string, cb: Function) => cb(null, p === '/alias' ? '/source/folder/child' : p),
    stat: (_p: string, cb: Function) => cb(null, { isDirectory: () => true }),
    lstat: (_p: string, cb: Function) => cb(null, { isDirectory: () => true }),
    rename: () => {
      renamed = true;
    },
  };
  const remote = new RemoteFiles(async () => ftp as any, new TransferManager(() => {}));
  await expect(remote.moveMany('s', ['/source/folder'], '/alias')).rejects.toThrow('子目录');
  expect(renamed).toBe(false);
});

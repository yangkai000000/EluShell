import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error Test-only JavaScript SSH fixture.
import { fixture } from '../scripts/sftp-fixture.mjs';
import { SSHService } from '../electron/ssh';
import { RemoteFiles, localName, mutationPath } from '../electron/remote-files';
import { TransferManager } from '../electron/transfers';
import { demoProfile } from './profile';
it('recursively transfers, edits with conflict protection, and manages remote files over real SFTP', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'elushell-files-'));
  await mkdir(path.join(root, 'remote'));
  await mkdir(path.join(root, 'downloads'));
  await mkdir(path.join(root, 'upload', 'nested'), { recursive: true });
  await writeFile(path.join(root, 'upload', 'nested', 'hello.txt'), '中文\r\nhello\r\n');
  await writeFile(path.join(root, 'upload', 'empty.txt'), '');
  const server = await fixture(path.join(root, 'remote')),
    service = new SSHService(
      () => {},
      async () => true,
    ),
    transfers = new TransferManager(() => {}),
    files = new RemoteFiles((id) => service.sftp(id), transfers);
  try {
    const id = await service.connect({ ...demoProfile, host: '127.0.0.1', port: server.port }, '');
    service.start(id);
    await files.upload(id, path.join(root, 'upload'), '/', async () => true);
    expect(await readFile(path.join(root, 'remote', 'upload', 'nested', 'hello.txt'), 'utf8')).toBe(
      '中文\r\nhello\r\n',
    );
    const downloaded = await files.download(id, '/upload', path.join(root, 'downloads'));
    expect(await readFile(path.join(downloaded, 'nested', 'hello.txt'), 'utf8')).toBe(
      '中文\r\nhello\r\n',
    );
    const second = await files.download(id, '/upload', path.join(root, 'downloads'));
    expect(second).not.toBe(downloaded);
    const doc = await files.openText(id, '/upload/nested/hello.txt');
    expect(doc.newline).toBe('CRLF');
    await files.saveText(doc.id, 'updated\n中文\n');
    expect(await readFile(path.join(root, 'remote', 'upload', 'nested', 'hello.txt'), 'utf8')).toBe(
      'updated\r\n中文\r\n',
    );
    await writeFile(
      path.join(root, 'remote', 'upload', 'nested', 'hello.txt'),
      'changed elsewhere',
    );
    await expect(files.saveText(doc.id, 'stale editor')).rejects.toThrow('其他程序修改');
    expect(await readFile(path.join(root, 'remote', 'upload', 'nested', 'hello.txt'), 'utf8')).toBe(
      'changed elsewhere',
    );
    expect(
      (await readdir(path.join(root, 'remote', 'upload', 'nested'))).filter((n) =>
        n.endsWith('.part'),
      ),
    ).toHaveLength(0);
    await files.action(id, { kind: 'rename', path: '/upload/empty.txt', name: 'renamed.txt' });
    await files.action(id, { kind: 'mkdir', path: '/upload/new-dir' });
    await files.action(id, { kind: 'touch', path: '/upload/new-dir/new.txt' });
    await files.action(id, { kind: 'chmod', path: '/upload', mode: 0o755, recursive: true });
    await writeFile(path.join(root, 'remote', 'binary.bin'), Buffer.from([0, 255, 12]));
    await expect(files.openText(id, '/binary.bin')).rejects.toThrow('二进制');
    await expect(files.action(id, { kind: 'delete', path: '/' })).rejects.toThrow('根目录');
    await files.action(id, { kind: 'delete', path: '/upload' });
    expect(await readdir(path.join(root, 'remote'))).toEqual(['binary.bin']);
    expect(
      transfers
        .list()
        .some((j) => j.state === 'completed' && j.filesTotal === 2 && j.filesDone === 2),
    ).toBe(true);
    expect(transfers.list().some((j) => j.state === 'failed')).toBe(true);
  } finally {
    service.close();
    await server.close();
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep + 'elushell-files-'))
      throw Error('Unexpected cleanup target');
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
it('rejects traversal and Windows-reserved file names', () => {
  for (const name of ['..', '../escape', 'a/b', 'NUL', 'COM1.txt', 'trailing.', 'a:b'])
    expect(() => localName(name)).toThrow();
  expect(() => mutationPath('/tmp/../')).toThrow();
  expect(localName('中文.txt')).toBe('中文.txt');
});
it('reports cancellation without claiming completion', async () => {
  let manager: TransferManager;
  manager = new TransferManager((job) => {
    if (job.state === 'running') manager.cancel(job.id);
  });
  await expect(
    manager.run('fixture', 'download', 'test', async (p) => {
      p.update({ state: 'running', total: 100 });
      p.signal.throwIfAborted();
    }),
  ).rejects.toThrow();
  expect(manager.list()[0].state).toBe('cancelled');
  expect(manager.list()[0].done).toBe(0);
});

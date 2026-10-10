import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
// @ts-expect-error Test-only JavaScript SSH fixture.
import { fixture } from '../scripts/sftp-fixture.mjs';
import { SSHService } from '../electron/ssh';
import { RemoteFiles } from '../electron/remote-files';
import { TransferManager } from '../electron/transfers';
import { TransferDiagnostics, traceSftp } from '../electron/transfer-diagnostics';
import { demoProfile } from './profile';

it.each(['OPEN', 'WRITE', 'SETSTAT', 'RENAME', 'success', 'local.read'])(
  'diagnoses %s without changing upload outcome or exposing file contents',
  async (failure) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'elushell-diagnostic-'));
    await mkdir(path.join(root, 'remote'));
    const local = path.join(root, 'bundle.jar');
    const target = path.join(root, 'remote', 'bundle.jar');
    const content = Buffer.alloc(256 * 1024, 'FILE_CONTENT_MUST_NOT_APPEAR');
    await writeFile(local, content);
    await writeFile(target, 'original remains intact');
    const log = new TransferDiagnostics(root, '0.9.1');
    const manager = new TransferManager(() => {}, log);
    const server = await fixture(path.join(root, 'remote'), {
      sftpRequest: (name: string) => {
        if (name === failure) throw Object.assign(Error('Permission denied'), { code: 'EACCES' });
      },
    });
    const service = new SSHService(
      () => {},
      async () => true,
    );
    try {
      const id = await service.connect(
        { ...demoProfile, host: '127.0.0.1', port: server.port },
        '',
      );
      service.start(id);
      const remote = new RemoteFiles(
        (s) => service.sftp(s),
        manager,
        () => ({
          host: '127.0.0.1',
          loginUsername: 'root',
          password: 'NEVER_LOG_PASSWORD',
        }),
      );
      let upload;
      if (failure === 'local.read') {
        upload = manager.run(id, 'upload', 'bundle.jar', async (progress) => {
          const sftp = traceSftp(await service.sftp(id), progress.trace!);
          const source = new Readable({
            read() {
              this.destroy(
                Object.assign(Error('EACCES: permission denied, open local.jar'), {
                  code: 'EACCES',
                }),
              );
            },
          });
          await (remote as any).write(sftp, '/bundle.jar', source, progress, 0);
        });
      } else upload = remote.upload(id, local, '/', async () => true);
      if (failure === 'success') {
        await expect(upload).resolves.toBe('/bundle.jar');
        expect(await readFile(target)).toEqual(content);
      } else {
        await expect(upload).rejects.toThrow(/permission denied/i);
        expect(await readFile(target, 'utf8')).toBe('original remains intact');
      }
      const exported = path.join(root, 'export.jsonl');
      await log.exportTo(exported);
      const text = await readFile(exported, 'utf8');
      const events = text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(text).not.toContain('NEVER_LOG_PASSWORD');
      expect(text).not.toContain('FILE_CONTENT_MUST_NOT_APPEAR');
      expect(text).not.toContain('original remains intact');
      expect(events.some((e) => e.event === 'transfer.start')).toBe(true);
      if (failure === 'success') {
        expect(
          events.some(
            (e) => e.event === 'upload.file-completed' && e.acknowledgedBytes === content.length,
          ),
        ).toBe(true);
        expect(events.some((e) => e.event === 'sftp.success' && e.operation === 'realpath')).toBe(
          true,
        );
      } else if (failure === 'local.read') {
        expect(events.find((e) => e.event === 'upload.stream-error')).toMatchObject({
          side: 'local.read',
          errorCode: 'EACCES',
        });
      } else {
        const operation = { OPEN: 'open', WRITE: 'write', SETSTAT: 'chmod', RENAME: 'rename' }[
          failure
        ];
        expect(
          events.some(
            (e) => e.event === 'sftp.error' && e.operation === operation && e.errorCode === 3,
          ),
        ).toBe(true);
        expect(events.some((e) => e.event === 'transfer.failed')).toBe(true);
        if (failure === 'OPEN') {
          expect(events.find((e) => e.event === 'upload.file-failed')).toMatchObject({
            stage: 'remote.open',
            acknowledgedBytes: 0,
          });
        }
      }
    } finally {
      service.close();
      await server.close();
      await log.flush();
    }
  },
  15000,
);

it('rotates logs, preserves valid JSONL, exports after flush and keeps logging failure from breaking transfers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'elushell-log-'));
  const logger = new TransferDiagnostics(root, '0.9.1', 700);
  for (let index = 0; index < 30; index++)
    logger.record('sample', { index, path: path.join(os.homedir(), 'private.jar') });
  const exported = path.join(root, 'export.jsonl');
  await logger.exportTo(exported);
  expect((await readdir(logger.directory)).sort()).toEqual([
    'transfers.1.jsonl',
    'transfers.2.jsonl',
    'transfers.jsonl',
  ]);
  const text = await readFile(exported, 'utf8');
  const entries = text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(entries.at(-1).index).toBe(29);
  expect(text).not.toContain(os.homedir());
  const blocked = path.join(root, 'blocked');
  await writeFile(blocked, 'not a directory');
  const broken = new TransferDiagnostics(blocked, '0.9.1');
  const manager = new TransferManager(() => {}, broken);
  await expect(manager.run('s', 'upload', 'file', async () => 'ok')).resolves.toBe('ok');
  await broken.flush();
  await expect(broken.exportTo(path.join(root, 'broken-export.jsonl'))).rejects.toThrow(
    '诊断日志写入失败',
  );
});

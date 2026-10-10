import { it, expect } from 'vitest';
import { Server, utils } from 'ssh2';
import { SSHService } from '../electron/ssh';
import { demoProfile } from './profile';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
it('lists and completes remote files, uploads and downloads exact binary content', async () => {
  const data = new Map<string, Buffer>([['/hello.txt', Buffer.from('hello')]]);
  const clients = new Set<any>();
  const server = new Server(
    { hostKeys: [utils.generateKeyPairSync('ed25519').private] },
    (client) => {
      clients.add(client);
      client.on('error', () => {});
      client.on('close', () => clients.delete(client));
      client.on('authentication', (ctx) => ctx.accept());
      client.on('ready', () =>
        client.on('session', (accept) => {
          const session = accept();
          session.on('pty', (a) => a?.());
          session.on('shell', (a) => a());
          session.on('exec', (a) => a());
          session.on('sftp', (accept) => {
            const ftp = accept();
            let listed = false;
            const attrs = (p: string) => ({
              mode: 0o100644,
              size: data.get(p)?.length || 0,
              uid: 1000,
              gid: 1000,
              atime: 1,
              mtime: 1,
            });
            ftp.on('OPENDIR', (id) => {
              listed = false;
              ftp.handle(id, Buffer.from('dir'));
            });
            ftp.on('READDIR', (id) => {
              if (listed) {
                ftp.status(id, 1);
                return;
              }
              listed = true;
              ftp.name(
                id,
                [...data.keys()].map((p) => ({
                  filename: p.slice(1),
                  longname: p.slice(1),
                  attrs: attrs(p),
                })),
              );
            });
            ftp.on('OPEN', (id, p, flags) => {
              if (flags & 8) data.set(p, Buffer.alloc(0));
              if (!data.has(p)) {
                ftp.status(id, 2);
                return;
              }
              ftp.handle(id, Buffer.from(p));
            });
            ftp.on('FSTAT', (id, handle) => ftp.attrs(id, attrs(handle.toString())));
            ftp.on('STAT', (id, p) => (data.has(p) ? ftp.attrs(id, attrs(p)) : ftp.status(id, 2)));
            ftp.on('READ', (id, handle, offset, length) => {
              const b = data.get(handle.toString())!;
              if (offset >= b.length) ftp.status(id, 1);
              else ftp.data(id, b.subarray(offset, offset + length));
            });
            ftp.on('WRITE', (id, handle, offset, chunk) => {
              const p = handle.toString(),
                old = data.get(p) || Buffer.alloc(0);
              const b = Buffer.alloc(Math.max(old.length, offset + chunk.length));
              old.copy(b);
              chunk.copy(b, offset);
              data.set(p, b);
              ftp.status(id, 0);
            });
            ftp.on('CLOSE', (id) => ftp.status(id, 0));
          });
        }),
      );
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const service = new SSHService(
    () => {},
    async () => true,
  );
  const dir = await mkdtemp(path.join(tmpdir(), 'elushell-sftp-'));
  try {
    const id = await service.connect(
      { ...demoProfile, host: '127.0.0.1', port: (server.address() as { port: number }).port },
      '',
    );
    service.start(id);
    expect((await service.files(id, '/'))[0].name).toBe('hello.txt');
    expect(await service.complete(id, '/hel')).toEqual(['/hello.txt']);
    const source = path.join(dir, 'source.bin'),
      target = path.join(dir, 'target.bin');
    const content = Buffer.from(Array.from({ length: 90000 }, (_, i) => i % 256));
    await writeFile(source, content);
    await service.upload(id, source, '/upload.bin');
    expect(data.get('/upload.bin')).toEqual(content);
    await service.download(id, '/upload.bin', target);
    expect(await readFile(target)).toEqual(content);
  } finally {
    service.close();
    for (const client of clients) client.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep + 'elushell-sftp-')) {
      throw Error('Unexpected fixture cleanup path');
    }
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
